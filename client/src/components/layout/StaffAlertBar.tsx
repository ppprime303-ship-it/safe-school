// Beta PILOT 2 Phase 2: 모든 학교 화면 상단의 교직원 앱 내 알림(웹앱이 열려 있을 때 30초마다 조회 — 푸시 아님)
// - 실제 재난: '교직원 소재 보고' 버튼 + 알림 확인
// - 모의훈련: '재난훈련 안내 확인' 버튼만(소재 보고 버튼·입력 없음 — 서버도 훈련 소재를 거부)
// - 확인은 사용자가 버튼을 눌렀을 때만 기록. 알림 확인은 안전·위치 확인이 아님
import { useCallback, useEffect, useState } from "react";
import { DISASTER_TYPES } from "@shared/constants";
import { DRILL_ALERT_TEXT, STAFF_ALERT_NOTICE } from "@shared/presence";
import { api } from "../../lib/api";
import { formatTime } from "../../lib/format";
import { pickBannerAlert, type StaffAlertItem } from "../../lib/presence";
import { Link, usePath } from "../../lib/router";
import { Icon } from "../ui/Icon";

const POLL_MS = 30_000;

/** 표시 전용(테스트 가능): 실제/훈련을 색·문구·버튼으로 구분 */
export function StaffAlertBanner({ schoolId, alert, onAcknowledge, busy = false }: { schoolId: string; alert: StaffAlertItem; onAcknowledge: () => void; busy?: boolean }) {
  const real = alert.event.mode === "real";
  const types = alert.event.types.map((t) => DISASTER_TYPES[t]).join(" + ");
  return (
    <section aria-label="교직원 알림" data-testid={real ? "staff-alert-real" : "staff-alert-drill"} className={`border-b-4 ${real ? "border-danger bg-danger-soft" : "border-warning bg-warning-soft"}`}>
      <div className="mx-auto flex max-w-6xl flex-wrap items-center gap-x-3 gap-y-2 px-4 py-3">
        <span className={`inline-flex items-center gap-1.5 rounded-md px-2 py-0.5 text-base font-extrabold text-white ${real ? "bg-danger" : "bg-warning-strong"}`}>
          <Icon name={real ? "siren" : "info"} size={18} />
          {real ? "실제 재난 알림" : "모의훈련 안내 · 실제 아님"}
        </span>
        <p className="min-w-0 flex-1 text-base font-bold">
          {real ? `${types} 발생 — 본인 소재와 대피 지원 가능 여부를 보고해 주세요.` : `${DRILL_ALERT_TEXT} (${types} 훈련)`}
          <span className="ml-2 text-sm font-semibold text-ink-muted">발령 {formatTime(alert.event.startedAt)}</span>
        </p>
        <div className="flex flex-wrap gap-2">
          {real && (
            <Link href={`/s/${schoolId}/presence`} className="inline-flex min-h-touch items-center gap-1 rounded-control bg-danger px-4 text-base font-bold text-white">
              <Icon name="user" size={18} /> 교직원 소재 보고
            </Link>
          )}
          {!alert.readAt && (
            <button type="button" disabled={busy} onClick={onAcknowledge} className="min-h-touch rounded-control border-2 border-line-strong bg-card px-4 text-base font-bold">
              {real ? "알림 확인" : "재난훈련 안내 확인"}
            </button>
          )}
        </div>
        <p className="w-full text-sm text-ink-muted">{STAFF_ALERT_NOTICE}</p>
      </div>
    </section>
  );
}

export function StaffAlertBar({ schoolId }: { schoolId: string }) {
  const [alerts, setAlerts] = useState<StaffAlertItem[]>([]);
  const [busy, setBusy] = useState(false);
  const path = usePath();

  const load = useCallback(async () => {
    try {
      setAlerts((await api<{ alerts: StaffAlertItem[] }>("GET", `/schools/${schoolId}/staff-alerts`)).alerts);
    } catch {
      // 조회 실패 시 기존 표시 유지(다음 주기에 다시 시도). 상황판·보고 화면의 배너는 별도로 동작
    }
  }, [schoolId]);

  useEffect(() => {
    void load();
    const id = window.setInterval(() => void load(), POLL_MS);
    return () => window.clearInterval(id);
  }, [load]);

  const alert = pickBannerAlert(alerts);
  if (!alert) return null;
  // 소재 보고 화면 안에서는 실제 재난 '보고' 버튼이 중복되므로, 확인할 알림이 있을 때만 표시
  if (path === `/s/${schoolId}/presence` && alert.readAt) return null;
  const acknowledge = async () => {
    setBusy(true);
    try {
      await api("POST", `/schools/${schoolId}/staff-alerts/${alert.id}/read`);
      await load();
    } finally {
      setBusy(false);
    }
  };
  return <StaffAlertBanner schoolId={schoolId} alert={alert} onAcknowledge={() => void acknowledge()} busy={busy} />;
}
