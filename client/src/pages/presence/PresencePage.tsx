// Beta PILOT 2 Phase 2-B: 재난 알림 · 내 소재(승인 교직원 누구나)
// - 알림 목록: 실제 재난·모의훈련 알림과 '확인' 기록(확인 ≠ 안전·위치 확인)
// - 내 소재 보고: **실제 재난에서만** 교내/교외 → (교내) 장소 + 상세 → 대피 지원 가능 여부 → 확인 → 제출. 종료된 상황은 읽기 전용
// - 모의훈련에는 소재 입력을 보여 주지 않음(서버도 거부)
import { useCallback, useEffect, useMemo, useState } from "react";
import { DISASTER_TYPES } from "@shared/constants";
import {
  AVAILABILITY_LABEL,
  LOCATION_LABEL,
  PLACE_DETAIL_MAX,
  PLACE_LABEL,
  PRESENCE_PLACES,
  PRESENCE_PRIVACY_HINT,
  STAFF_ALERT_NOTICE,
  placeLabel,
  presenceInputSchema,
  type PresencePlace,
} from "@shared/presence";
import { api, ApiError, describeError, newIdempotencyKey } from "../../lib/api";
import { formatDateTime, formatTime } from "../../lib/format";
import { can } from "../../lib/permissions";
import type { MyPresence, PresenceSummaryResponse, StaffAlertItem } from "../../lib/presence";
import { Link } from "../../lib/router";
import { useSession } from "../../lib/session";
import { AppShell } from "../../components/layout/AppShell";
import { ConfirmDialog } from "../../components/ui/ConfirmDialog";
import { Icon } from "../../components/ui/Icon";
import { PrimaryButton } from "../../components/ui/PrimaryButton";
import { EmptyState, ErrorState, LoadingState } from "../../components/ui/States";

type Location = "on_campus" | "off_campus";
type Availability = "available" | "unavailable" | "unsure";

const typesOf = (a: StaffAlertItem) => a.event.types.map((t) => DISASTER_TYPES[t]).join(" + ");

/** 제출 전 확인 문구: '교내 · 교실 / 3학년 2반 · 대피 지원 가능' */
export function presenceSentence(p: { location: Location; placeCategory: PresencePlace | null; placeDetail: string | null; availability: Availability }) {
  const where = p.location === "on_campus" ? `${LOCATION_LABEL.on_campus} · ${placeLabel(p.placeCategory, p.placeDetail) ?? "장소 미선택"}` : LOCATION_LABEL.off_campus;
  return `${where} · ${AVAILABILITY_LABEL[p.availability]}`;
}

export function PresencePage({ schoolId }: { schoolId: string }) {
  const { usableMemberships } = useSession();
  const membership = usableMemberships.find((m) => m.school.id === schoolId) ?? null;
  const [alerts, setAlerts] = useState<StaffAlertItem[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [selected, setSelected] = useState<string | null>(() => new URLSearchParams(window.location.search).get("event"));

  const load = useCallback(async () => {
    try {
      setAlerts((await api<{ alerts: StaffAlertItem[] }>("GET", `/schools/${schoolId}/staff-alerts`)).alerts);
      setError(null);
    } catch (e) {
      setError(describeError(e).message);
    }
  }, [schoolId]);
  useEffect(() => {
    void load();
  }, [load]);

  const realAlerts = useMemo(() => (alerts ?? []).filter((a) => a.event.mode === "real"), [alerts]);
  // 기본 선택: 진행 중 실제 재난 → 가장 최근 실제 재난
  const current = realAlerts.find((a) => a.event.id === selected) ?? realAlerts.find((a) => a.event.status === "active") ?? realAlerts[0] ?? null;

  const acknowledge = async (a: StaffAlertItem) => {
    await api("POST", `/schools/${schoolId}/staff-alerts/${a.id}/read`).catch(() => undefined);
    await load();
  };

  return (
    <AppShell title="재난 알림 · 내 소재" schoolId={schoolId}>
      <p className="mb-4 rounded-control border border-line bg-page p-3 text-sm">{STAFF_ALERT_NOTICE}</p>
      {!alerts && !error && <LoadingState />}
      {error && <ErrorState message={error} onRetry={() => void load()} />}
      {alerts && (
        <div className="space-y-6">
          <section aria-labelledby="my-alerts" className="rounded-card border border-line bg-card p-4 shadow-card">
            <h2 id="my-alerts" className="text-xl font-bold">
              내 알림
            </h2>
            {alerts.length === 0 && <p className="mt-2 text-base text-ink-muted">받은 알림이 없습니다.</p>}
            <ul className="mt-2 divide-y divide-line">
              {alerts.map((a) => {
                const real = a.event.mode === "real";
                return (
                  <li key={a.id} className="flex flex-wrap items-center gap-2 py-3">
                    <span className={`rounded-md px-2 py-0.5 text-sm font-extrabold text-white ${real ? "bg-danger" : "bg-warning-strong"}`}>{real ? "실제 재난" : "모의훈련 · 실제 아님"}</span>
                    <span className="font-bold">{typesOf(a)}</span>
                    <span className="text-sm text-ink-muted">
                      {formatDateTime(a.event.startedAt)} · {a.event.status === "active" ? "진행 중" : "종료"}
                    </span>
                    <span className="ml-auto flex flex-wrap items-center gap-2">
                      {a.readAt ? (
                        <span className="text-sm font-semibold text-ink-muted">확인 {formatTime(a.readAt)}</span>
                      ) : (
                        <PrimaryButton variant="secondary" onClick={() => void acknowledge(a)}>
                          {real ? "알림 확인" : "재난훈련 안내 확인"}
                        </PrimaryButton>
                      )}
                      {real && current?.event.id !== a.event.id && (
                        <PrimaryButton variant="ghost" onClick={() => setSelected(a.event.id)}>
                          {a.event.status === "active" ? "소재 보고" : "내 보고 보기"}
                        </PrimaryButton>
                      )}
                    </span>
                  </li>
                );
              })}
            </ul>
            <p className="mt-2 text-sm text-ink-muted">모의훈련 안내는 확인 여부만 기록하며, 교직원 소재는 받지 않습니다. 알림 확인은 안전이나 위치 확인을 뜻하지 않습니다.</p>
          </section>

          {current ? (
            <MyPresenceSection key={current.event.id} schoolId={schoolId} alert={current} canDetail={can(membership, "presence.detail")} />
          ) : (
            <EmptyState icon="info" title="실제 재난 소재 보고가 없습니다" message="실제 재난이 발령되면 이곳에서 본인 소재와 대피 지원 가능 여부를 보고합니다. 모의훈련에서는 소재를 받지 않습니다." />
          )}
        </div>
      )}
    </AppShell>
  );
}

function MyPresenceSection({ schoolId, alert, canDetail }: { schoolId: string; alert: StaffAlertItem; canDetail: boolean }) {
  const eventId = alert.event.id;
  const [presence, setPresence] = useState<MyPresence | null | undefined>(undefined);
  const [closed, setClosed] = useState(alert.event.status === "closed");
  const [editing, setEditing] = useState(false);
  const [location, setLocation] = useState<Location | null>(null);
  const [place, setPlace] = useState<PresencePlace | null>(null);
  const [detail, setDetail] = useState("");
  const [availability, setAvailability] = useState<Availability | null>(null);
  const [confirming, setConfirming] = useState(false);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<{ tone: "ok" | "error"; text: string } | null>(null);
  const [summary, setSummary] = useState<PresenceSummaryResponse | null>(null);

  const fill = (p: MyPresence | null) => {
    setLocation(p?.location ?? null);
    setPlace(p?.placeCategory ?? null);
    setDetail(p?.placeDetail ?? "");
    setAvailability(p?.availability ?? null);
  };
  const load = useCallback(async () => {
    try {
      const r = await api<{ eventStatus: "active" | "closed"; presence: MyPresence | null }>("GET", `/schools/${schoolId}/events/${eventId}/presence/me`);
      setPresence(r.presence);
      setClosed(r.eventStatus === "closed");
      fill(r.presence);
      setEditing(r.presence === null && r.eventStatus === "active");
      setSummary(await api<PresenceSummaryResponse>("GET", `/schools/${schoolId}/events/${eventId}/presence/summary`));
    } catch (e) {
      setMessage({ tone: "error", text: describeError(e).message });
      setPresence(null);
    }
  }, [schoolId, eventId]);
  useEffect(() => {
    void load();
  }, [load]);

  const draft = location && availability ? { location, placeCategory: location === "on_campus" ? place : null, placeDetail: location === "on_campus" ? detail.trim() || null : null, availability } : null;
  const parsed = draft ? presenceInputSchema.safeParse({ ...draft, expectedVersion: presence?.version ?? null }) : null;
  const problem = parsed && !parsed.success ? parsed.error.issues[0]?.message ?? "입력을 확인하세요." : null;

  const submit = async () => {
    if (!parsed?.success) return;
    setBusy(true);
    setMessage(null);
    try {
      const r = await api<{ presence: MyPresence }>("PUT", `/schools/${schoolId}/events/${eventId}/presence/me`, parsed.data, { idempotencyKey: newIdempotencyKey() });
      setPresence(r.presence);
      setEditing(false);
      setConfirming(false);
      setMessage({ tone: "ok", text: `보고했습니다 · ${formatTime(r.presence.respondedAt)}` });
      setSummary(await api<PresenceSummaryResponse>("GET", `/schools/${schoolId}/events/${eventId}/presence/summary`).catch(() => summary));
    } catch (e) {
      setConfirming(false);
      if (e instanceof ApiError && e.code === "event_closed") {
        setClosed(true);
        setEditing(false);
      }
      if (e instanceof ApiError && e.code === "version_conflict") await load(); // 다른 기기의 최신 내용으로 다시 채움
      setMessage({ tone: "error", text: describeError(e).message });
    } finally {
      setBusy(false);
    }
  };

  const choice = (on: boolean) => `min-h-touch rounded-control border-2 px-3 text-base font-bold ${on ? "border-brand bg-brand text-white" : "border-line-strong bg-card"}`;

  return (
    <section aria-labelledby="my-presence" className="rounded-card border-2 border-danger bg-card p-4 shadow-card">
      <div className="flex flex-wrap items-center gap-2">
        <span className="rounded-md bg-danger px-2 py-0.5 text-sm font-extrabold text-white">실제 재난</span>
        <h2 id="my-presence" className="text-xl font-bold">
          교직원 소재 보고 · {typesOf(alert)}
        </h2>
        {closed && <span className="rounded-md bg-neutral px-2 py-0.5 text-sm font-bold text-white">종료된 상황 · 조회만</span>}
      </div>

      {presence === undefined && <LoadingState />}
      {presence && !editing && (
        <div className="mt-3 rounded-control bg-page p-3">
          <p className="text-lg font-extrabold">{presenceSentence(presence)}</p>
          <p className="mt-1 text-sm text-ink-muted">
            최근 보고 {formatDateTime(presence.respondedAt)} · {presence.version}번째 보고
          </p>
          {!closed && (
            <PrimaryButton className="mt-3" variant="secondary" onClick={() => { fill(presence); setEditing(true); }}>
              소재 수정
            </PrimaryButton>
          )}
        </div>
      )}
      {presence === null && closed && <p className="mt-3 text-base text-ink-muted">이 상황에서 보고한 소재가 없습니다. 종료된 상황이라 새로 보고할 수 없습니다.</p>}

      {editing && !closed && (
        <div className="mt-3 space-y-4">
          <fieldset>
            <legend className="text-base font-bold">1. 지금 위치</legend>
            <div className="mt-2 grid grid-cols-2 gap-2">
              {(["on_campus", "off_campus"] as const).map((l) => (
                <button key={l} type="button" aria-pressed={location === l} className={choice(location === l)} onClick={() => setLocation(l)}>
                  {LOCATION_LABEL[l]}
                </button>
              ))}
            </div>
          </fieldset>

          {location === "on_campus" && (
            <fieldset>
              <legend className="text-base font-bold">2. 교내 장소</legend>
              <div className="mt-2 grid grid-cols-3 gap-2 sm:grid-cols-5">
                {PRESENCE_PLACES.map((p) => (
                  <button key={p} type="button" aria-pressed={place === p} className={choice(place === p)} onClick={() => setPlace(p)}>
                    {PLACE_LABEL[p]}
                  </button>
                ))}
              </div>
              <label className="mt-3 block text-sm font-bold" htmlFor="presence-detail">
                상세 위치 {place === "other" ? "(필수)" : "(선택)"}
              </label>
              <input
                id="presence-detail"
                value={detail}
                maxLength={PLACE_DETAIL_MAX}
                onChange={(e) => setDetail(e.target.value)}
                placeholder="예: 3학년 2반, 과학실, 본관 2층"
                className="mt-1 block min-h-touch w-full rounded-control border-2 border-line-strong px-3 text-base"
              />
              <p className="mt-1 text-sm text-ink-muted">{PRESENCE_PRIVACY_HINT}</p>
            </fieldset>
          )}
          {location === "off_campus" && <p className="text-sm text-ink-muted">교외는 위치를 적지 않습니다.</p>}

          <fieldset>
            <legend className="text-base font-bold">{location === "on_campus" ? "3" : "2"}. 대피 지원</legend>
            <div className="mt-2 grid grid-cols-3 gap-2">
              {(["available", "unavailable", "unsure"] as const).map((a) => (
                <button key={a} type="button" aria-pressed={availability === a} className={choice(availability === a)} onClick={() => setAvailability(a)}>
                  {AVAILABILITY_LABEL[a]}
                </button>
              ))}
            </div>
          </fieldset>

          {problem && <p className="font-semibold text-danger">{problem}</p>}
          <div className="grid gap-2 sm:grid-cols-2">
            <PrimaryButton size="xl" disabled={!parsed?.success || busy} onClick={() => setConfirming(true)}>
              {presence ? "수정 내용 확인" : "보고 내용 확인"}
            </PrimaryButton>
            {presence && (
              <PrimaryButton variant="ghost" onClick={() => { fill(presence); setEditing(false); }} disabled={busy}>
                취소
              </PrimaryButton>
            )}
          </div>
        </div>
      )}

      {message && (
        <p role="status" className={`mt-3 font-semibold ${message.tone === "ok" ? "text-success" : "text-danger"}`}>
          {message.text}
        </p>
      )}

      {summary && (
        <div className="mt-4 rounded-control border border-line p-3">
          <p className="text-sm font-bold text-ink-muted">학교 전체 교직원 소재(개인 정보 없는 요약 · 학생 대피 보고와 별개)</p>
          <p className="tabular mt-1 text-base font-semibold">
            응답 {summary.summary.respondedCount}/{summary.summary.targetCount}명 · 미응답 {summary.summary.notRespondedCount}명 · 교내 {summary.summary.onCampus} · 교외 {summary.summary.offCampus} · 지원 가능{" "}
            {summary.summary.available}
          </p>
          <Link href={`/s/${schoolId}/staff-presence?event=${eventId}`} className="mt-1 inline-flex min-h-touch items-center gap-1 text-sm font-bold text-accent underline">
            <Icon name="users" size={16} /> {canDetail ? "교직원 소재 현황(개인별)" : "교직원 소재 요약"}
          </Link>
        </div>
      )}

      {draft && (
        <ConfirmDialog open={confirming} title="이 내용으로 보고할까요?" confirmLabel={presence ? "수정 보고" : "보고"} tone="primary" loading={busy} onConfirm={() => void submit()} onCancel={() => setConfirming(false)}>
          <p className="text-lg font-bold">{presenceSentence(draft)}</p>
          <p className="mt-1 text-sm">학교 관리자·교장·교감·안전업무 담당이 개인별로 확인합니다. 다른 교직원에게는 숫자 요약만 보입니다.</p>
        </ConfirmDialog>
      )}
    </section>
  );
}
