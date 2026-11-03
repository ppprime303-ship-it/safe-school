// 외부 경보(긴급재난문자·기상특보) 교직원 안내: 기존 30초 조회 방식으로 서버에 저장된 자료만 확인합니다(외부 API를 브라우저에서 부르지 않음).
// - 평소에는 한 건씩 확인 창으로, 학교 사건 진행 중에는 대피 보고를 가리지 않도록 화면을 막지 않는 안내로 표시합니다.
// - '확인'은 교직원별로 저장되어 재로그인 후에도 다시 뜨지 않습니다. 조회 실패는 조용히 넘어가고 다른 기능에 영향을 주지 않습니다.
// - 경보는 학교 재난을 자동 발령하지 않으며, 이 안내는 대피를 지시하지 않습니다.
import { useCallback, useEffect, useRef, useState } from "react";
import { NOTICE_STATUS_LABEL, type PendingAlertNotice, type PendingAlertNotices } from "@shared/externalAlerts";
import { api, describeError } from "../../lib/api";
import { KIND_LABEL } from "../../lib/alerts";
import { formatDateTime } from "../../lib/format";
import { Link, usePath } from "../../lib/router";
import { Icon } from "../ui/Icon";

const POLL_MS = 30_000;

function NoticeDialog({ notice, remaining, schoolId, busy, saveError, onConfirm, onHide }: { notice: PendingAlertNotice; remaining: number; schoolId: string; busy: boolean; saveError: string | null; onConfirm: () => void; onHide: () => void }) {
  const panel = useRef<HTMLDivElement>(null);
  const confirm = useRef<HTMLButtonElement>(null);
  const urgent = notice.priority === "urgent";

  useEffect(() => {
    const before = document.activeElement as HTMLElement | null;
    confirm.current?.focus();
    return () => before?.focus?.();
  }, [notice.matchId]);

  const onKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === "Escape") {
      e.preventDefault();
      onHide();
      return;
    }
    if (e.key !== "Tab") return;
    const items = panel.current?.querySelectorAll<HTMLElement>("a[href], button:not([disabled])");
    if (!items?.length) return;
    const first = items[0]!;
    const last = items[items.length - 1]!;
    if (e.shiftKey && document.activeElement === first) {
      e.preventDefault();
      last.focus();
    } else if (!e.shiftKey && document.activeElement === last) {
      e.preventDefault();
      first.focus();
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-end justify-center bg-black/50 p-3 print:hidden sm:items-center" data-testid="external-alert-dialog">
      <div
        ref={panel}
        role="alertdialog"
        aria-modal="true"
        aria-labelledby="external-alert-title"
        aria-describedby="external-alert-body"
        onKeyDown={onKeyDown}
        className={`max-h-[calc(100dvh-1.5rem)] w-full max-w-lg overflow-y-auto rounded-card border-t-8 bg-card p-4 shadow-card ${urgent ? "border-danger" : "border-warning"}`}
      >
        <div className="flex flex-wrap items-center gap-1.5">
          <span className={`inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-sm font-bold ${urgent ? "bg-danger text-white" : "bg-warning-soft text-warning-strong"}`}>
            <Icon name="bell" size={16} /> {KIND_LABEL[notice.kind]}
          </span>
          <span className="rounded-full bg-neutral-soft px-2 py-0.5 text-sm font-semibold text-neutral">{NOTICE_STATUS_LABEL[notice.status]}</span>
          {notice.isMock && <span className="rounded-full border-2 border-dashed border-warning px-2 py-0.5 text-sm font-bold text-warning-strong">모의(가상)</span>}
          {remaining > 1 && <span className="ml-auto text-sm font-semibold text-ink-muted">미확인 {remaining}건</span>}
        </div>
        <h2 id="external-alert-title" className="mt-2 text-xl font-extrabold">{notice.title ?? `${KIND_LABEL[notice.kind]} 안내`}</h2>
        <p id="external-alert-body" className="mt-2 whitespace-pre-wrap break-words rounded-control border-l-4 border-line-strong bg-page px-3 py-2 text-base">{notice.body}</p>
        <dl className="mt-3 grid grid-cols-[auto_1fr] gap-x-3 gap-y-1 text-sm">
          <dt className="font-semibold text-ink-muted">기관</dt>
          <dd className="min-w-0 break-words">{notice.issuer}</dd>
          <dt className="font-semibold text-ink-muted">지역</dt>
          <dd className="min-w-0 break-words">{notice.areasRaw}{notice.relevance === "undetermined" && " · 우리 학교 포함 여부 확인 필요"}</dd>
          <dt className="font-semibold text-ink-muted">발표</dt>
          <dd className="tabular">{formatDateTime(notice.issuedAt)}</dd>
          <dt className="font-semibold text-ink-muted">출처</dt>
          <dd className="min-w-0 break-words">{notice.sourceLabel}{!notice.isMock && !notice.verified && " (응답 형식 확인 전 시범 수집)"}</dd>
          <dt className="font-semibold text-ink-muted">마지막 정상 조회</dt>
          <dd className="tabular">{notice.lastCollectedAt ? formatDateTime(notice.lastCollectedAt) : "기록 없음"}</dd>
        </dl>
        <p className="mt-3 text-sm text-ink-muted">이 안내는 학교 재난을 자동 발령하지 않습니다. 학교 대응은 관리자와 공식 지침을 따르세요.</p>
        {saveError && <p role="alert" className="mt-2 text-sm font-bold text-danger">확인을 저장하지 못했습니다. {saveError}</p>}
        <div className="mt-3 flex gap-2">
          <button ref={confirm} type="button" disabled={busy} onClick={onConfirm} className="min-h-touch flex-1 rounded-control bg-brand px-4 text-base font-bold text-white hover:bg-brand-hover disabled:opacity-60">확인</button>
          <Link href={`/s/${schoolId}/alerts`} className="inline-flex min-h-touch flex-1 items-center justify-center rounded-control border-2 border-line-strong bg-card px-4 text-base font-bold">상세 보기</Link>
        </div>
      </div>
    </div>
  );
}

export function ExternalAlertNotice({ schoolId }: { schoolId: string }) {
  const [data, setData] = useState<PendingAlertNotices | null>(null);
  const [hidden, setHidden] = useState<ReadonlySet<string>>(new Set());
  const [busy, setBusy] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);
  const path = usePath();

  const load = useCallback(async () => {
    try {
      setData(await api<PendingAlertNotices>("GET", `/schools/${schoolId}/alerts/pending`));
    } catch {
      // 조회 실패 시 기존 표시 유지(다음 주기에 다시 시도). 대피 보고 등 다른 기능과 무관
    }
  }, [schoolId]);

  useEffect(() => {
    void load();
    const id = window.setInterval(() => void load(), POLL_MS);
    return () => window.clearInterval(id);
  }, [load]);

  const visible = data?.notices.filter((n) => !hidden.has(n.matchId)) ?? [];
  const notice = visible[0];
  // 경보함에서는 미확인 경보가 이미 보임
  if (!data || !notice || path === `/s/${schoolId}/alerts`) return null;

  if (data.activeEvent) {
    return (
      <section aria-label="외부 경보 안내" data-testid="external-alert-strip" className="border-b-2 border-warning bg-warning-soft print:hidden">
        <p className="mx-auto flex max-w-6xl flex-wrap items-center gap-x-3 px-4 py-2 text-base font-bold">
          <Icon name="bell" size={18} />
          <span className="min-w-0 flex-1">{KIND_LABEL[notice.kind]}{notice.isMock ? "(모의)" : ""}: {notice.title ?? notice.areasRaw}{visible.length > 1 ? ` 외 ${visible.length - 1}건` : ""}</span>
          <Link href={`/s/${schoolId}/alerts`} className="inline-flex min-h-touch items-center text-accent underline underline-offset-4">경보함에서 보기</Link>
        </p>
      </section>
    );
  }

  const confirm = async () => {
    setBusy(true);
    setSaveError(null);
    try {
      await api("POST", `/schools/${schoolId}/alerts/${notice.matchId}/read`, {});
      setData((d) => (d ? { ...d, notices: d.notices.filter((n) => n.matchId !== notice.matchId) } : d));
    } catch (e) {
      // 서버 연결 실패와 서버 거절을 구분해 표시합니다(조회 실패는 기존 창을 유지하므로, 서버가 꺼져도 창이 남아 있을 수 있음).
      setSaveError(describeError(e).message);
    } finally {
      setBusy(false);
    }
  };

  return <NoticeDialog notice={notice} remaining={visible.length} schoolId={schoolId} busy={busy} saveError={saveError} onConfirm={() => void confirm()} onHide={() => setHidden((h) => new Set(h).add(notice.matchId))} />;
}
