// Beta PILOT 2 Phase 3-B: 현장 상황 공유 — 제보 목록·새 제보(유사 제보 제안)
// - 실제 재난·모의훈련 모두(훈련은 '훈련 상황 제보' 표시). 학급 대피 보고·교직원 소재 보고와 별개
// - 입력 최소: 유형 → 장소(+상세) → 설명. 비슷한 제보가 있으면 보여 주되 막지 않음(기존 제보에 정보 추가 또는 새로 등록)
// - 종료된 상황은 읽기 전용
import { useCallback, useEffect, useState } from "react";
import { INCIDENT_PRIVACY_HINT, INCIDENT_STATUS_LABEL, INCIDENT_TYPE_LABEL, INCIDENT_TYPES, incidentCreateSchema, type IncidentType } from "@shared/incident";
import { PLACE_DETAIL_MAX, PLACE_LABEL, PRESENCE_PLACES, type PresencePlace } from "@shared/presence";
import { api, describeError, newIdempotencyKey } from "../../lib/api";
import { formatTime } from "../../lib/format";
import { STATUS_TONE, type IncidentEventRef, type IncidentItem } from "../../lib/incident";
import type { StaffAlertItem } from "../../lib/presence";
import { Link, navigate } from "../../lib/router";
import { AppShell } from "../../components/layout/AppShell";
import { EmptyState, ErrorState, LoadingState } from "../../components/ui/States";
import { PrimaryButton } from "../../components/ui/PrimaryButton";

const POLL_MS = 15_000;

/** 모드 표시: 훈련은 '훈련 상황 제보'로 분명히 */
export function EventModeBadge({ event }: { event: IncidentEventRef }) {
  const real = event.mode === "real";
  return (
    <span className={`inline-flex items-center rounded-md px-2 py-0.5 text-sm font-extrabold text-white ${real ? "bg-danger" : "bg-warning-strong"}`}>
      {real ? "실제 재난 현장 제보" : "훈련 상황 제보 · 실제 아님"}
      {event.status === "closed" && " · 종료(조회만)"}
    </span>
  );
}

export function IncidentCard({ schoolId, item }: { schoolId: string; item: IncidentItem }) {
  return (
    <Link href={`/s/${schoolId}/incidents/${item.id}`} className="block rounded-card border border-line bg-card p-3 shadow-card hover:outline hover:outline-2 hover:outline-accent">
      <div className="flex flex-wrap items-center gap-2">
        <span className={`rounded-full px-2 py-0.5 text-sm font-bold ${STATUS_TONE[item.status]}`}>{INCIDENT_STATUS_LABEL[item.status]}</span>
        <strong className="text-base">{INCIDENT_TYPE_LABEL[item.type]}</strong>
        <span className="text-base font-semibold">{item.placeLabel}</span>
        {item.mine && <span className="rounded-full bg-page px-2 py-0.5 text-sm font-semibold">내 제보</span>}
        <span className="tabular ml-auto text-sm text-ink-muted">최근 {formatTime(item.lastActivityAt)}</span>
      </div>
      <p className="mt-1 line-clamp-2 text-base">{item.description}</p>
      <p className="mt-1 text-sm text-ink-muted">
        추가 정보 {item.updateCount}건{item.photoCount > 0 ? ` · 사진 ${item.photoCount}장` : ""}
        {item.reporterName ? ` · 제보 ${item.reporterName}` : ""}
      </p>
    </Link>
  );
}

type Load = { kind: "loading" } | { kind: "none" } | { kind: "error"; message: string } | { kind: "ready"; event: IncidentEventRef; incidents: IncidentItem[] };

export function IncidentsPage({ schoolId }: { schoolId: string }) {
  const [load, setLoad] = useState<Load>({ kind: "loading" });
  const [eventId, setEventId] = useState<string | null>(() => new URLSearchParams(window.location.search).get("event"));
  const [writing, setWriting] = useState(false);

  const fetchData = useCallback(async () => {
    try {
      let id = eventId;
      if (!id) {
        const { event } = await api<{ event: { id: string } | null }>("GET", `/schools/${schoolId}/events/active`);
        id = event?.id ?? (await api<{ alerts: StaffAlertItem[] }>("GET", `/schools/${schoolId}/staff-alerts`)).alerts[0]?.event.id ?? null;
        if (!id) {
          setLoad({ kind: "none" });
          return;
        }
        setEventId(id);
      }
      const r = await api<{ event: IncidentEventRef; incidents: IncidentItem[] }>("GET", `/schools/${schoolId}/events/${id}/incidents`);
      setLoad({ kind: "ready", ...r });
    } catch (e) {
      setLoad({ kind: "error", message: describeError(e).message });
    }
  }, [schoolId, eventId]);

  useEffect(() => {
    void fetchData();
    const id = window.setInterval(() => void fetchData(), POLL_MS);
    return () => window.clearInterval(id);
  }, [fetchData]);

  return (
    <AppShell title="현장 상황 공유" schoolId={schoolId}>
      <p className="mb-4 rounded-control border border-line bg-page p-3 text-sm">
        현장에서 본 위험·피해·도움이 필요한 상황을 함께 봅니다. <strong>학급 대피 보고·교직원 소재 보고와 별개</strong>이며, 급한 구조 요청은 먼저 전화·무전으로 하세요.
      </p>
      {load.kind === "loading" && <LoadingState />}
      {load.kind === "error" && <ErrorState message={load.message} onRetry={() => void fetchData()} />}
      {load.kind === "none" && <EmptyState icon="info" title="진행 중이거나 지난 재난·훈련이 없습니다" message="재난이나 훈련이 발령되면 이곳에서 현장 상황을 제보합니다." />}
      {load.kind === "ready" && (
        <div className="space-y-4">
          <div className="flex flex-wrap items-center gap-2">
            <EventModeBadge event={load.event} />
            {load.event.status === "active" && !writing && (
              <PrimaryButton className="ml-auto" icon="plus" onClick={() => setWriting(true)}>
                새 현장 제보
              </PrimaryButton>
            )}
          </div>
          {writing && load.event.status === "active" && (
            <NewIncidentForm
              schoolId={schoolId}
              event={load.event}
              onCancel={() => setWriting(false)}
              onCreated={(id) => navigate(`/s/${schoolId}/incidents/${id}`)}
            />
          )}
          {load.incidents.length === 0 ? (
            <EmptyState icon="check-circle" title="아직 제보가 없습니다" />
          ) : (
            <ul className="space-y-2">
              {load.incidents.map((i) => (
                <li key={i.id}>
                  <IncidentCard schoolId={schoolId} item={i} />
                </li>
              ))}
            </ul>
          )}
        </div>
      )}
    </AppShell>
  );
}

function NewIncidentForm({ schoolId, event, onCancel, onCreated }: { schoolId: string; event: IncidentEventRef; onCancel: () => void; onCreated: (id: string) => void }) {
  const [type, setType] = useState<IncidentType | null>(null);
  const [place, setPlace] = useState<PresencePlace | null>(null);
  const [detail, setDetail] = useState("");
  const [description, setDescription] = useState("");
  const [similar, setSimilar] = useState<(IncidentItem & { score: number })[]>([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [key] = useState(newIdempotencyKey);

  // 유형·장소를 고르면(설명은 입력 중이어도) 비슷한 제보를 찾아 보여 줌 — 0.5초 쉬었다가 조회
  useEffect(() => {
    if (!type || !place) return setSimilar([]);
    const t = window.setTimeout(() => {
      const q = new URLSearchParams({ type, placeCategory: place, ...(detail.trim() ? { placeDetail: detail.trim() } : {}), ...(description.trim() ? { description: description.trim().slice(0, 300) } : {}) });
      api<{ similar: (IncidentItem & { score: number })[] }>("GET", `/schools/${schoolId}/events/${event.id}/incidents/similar?${q}`)
        .then((r) => setSimilar(r.similar))
        .catch(() => setSimilar([]));
    }, 500);
    return () => window.clearTimeout(t);
  }, [schoolId, event.id, type, place, detail, description]);

  const parsed = type && place ? incidentCreateSchema.safeParse({ type, placeCategory: place, placeDetail: detail.trim() || null, description }) : null;
  const problem = parsed && !parsed.success && description.trim().length > 0 ? parsed.error.issues[0]?.message : null;
  const choice = (on: boolean) => `min-h-touch rounded-control border-2 px-3 text-base font-bold ${on ? "border-brand bg-brand text-white" : "border-line-strong bg-card"}`;

  const submit = async () => {
    if (!parsed?.success) return;
    setBusy(true);
    setError(null);
    try {
      const r = await api<{ id: string }>("POST", `/schools/${schoolId}/events/${event.id}/incidents`, parsed.data, { idempotencyKey: key });
      onCreated(r.id);
    } catch (e) {
      setError(describeError(e).message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <section aria-labelledby="new-incident" className={`space-y-4 rounded-card border-2 bg-card p-4 shadow-card ${event.mode === "real" ? "border-danger" : "border-warning"}`}>
      <h2 id="new-incident" className="text-xl font-bold">
        {event.mode === "real" ? "새 현장 제보" : "새 훈련 상황 제보(실제 아님)"}
      </h2>
      <fieldset>
        <legend className="text-base font-bold">1. 어떤 상황인가요?</legend>
        <div className="mt-2 grid grid-cols-2 gap-2 sm:grid-cols-5">
          {INCIDENT_TYPES.map((t) => (
            <button key={t} type="button" aria-pressed={type === t} className={choice(type === t)} onClick={() => setType(t)}>
              {INCIDENT_TYPE_LABEL[t]}
            </button>
          ))}
        </div>
      </fieldset>
      <fieldset>
        <legend className="text-base font-bold">2. 어디인가요?</legend>
        <div className="mt-2 grid grid-cols-3 gap-2 sm:grid-cols-5">
          {PRESENCE_PLACES.map((p) => (
            <button key={p} type="button" aria-pressed={place === p} className={choice(place === p)} onClick={() => setPlace(p)}>
              {PLACE_LABEL[p]}
            </button>
          ))}
        </div>
        <input
          aria-label={`상세 위치 ${place === "other" ? "(필수)" : "(선택)"}`}
          value={detail}
          maxLength={PLACE_DETAIL_MAX}
          onChange={(e) => setDetail(e.target.value)}
          placeholder="상세 위치(선택) 예: 본관 2층, 과학실"
          className="mt-2 block min-h-touch w-full rounded-control border-2 border-line-strong px-3 text-base"
        />
      </fieldset>
      <div>
        <label className="text-base font-bold" htmlFor="incident-desc">
          3. 무엇을 봤나요?
        </label>
        <textarea
          id="incident-desc"
          value={description}
          maxLength={300}
          rows={3}
          onChange={(e) => setDescription(e.target.value)}
          className="mt-1 block w-full rounded-control border-2 border-line-strong px-3 py-2 text-base"
        />
        <p className="mt-1 text-sm text-ink-muted">{INCIDENT_PRIVACY_HINT}</p>
      </div>

      {similar.length > 0 && (
        <SimilarSuggestions schoolId={schoolId} items={similar} />
      )}

      {(problem || error) && <p className="font-semibold text-danger">{problem ?? error}</p>}
      <div className="grid gap-2 sm:grid-cols-2">
        <PrimaryButton size="xl" disabled={!parsed?.success || busy} loading={busy} onClick={() => void submit()}>
          {similar.length > 0 ? "다른 상황이라 새로 제보" : "제보하기"}
        </PrimaryButton>
        <PrimaryButton variant="ghost" onClick={onCancel} disabled={busy}>
          취소
        </PrimaryButton>
      </div>
    </section>
  );
}

/** 유사 제보 제안: 막지 않고 '기존 제보에 정보 추가'를 권함 */
export function SimilarSuggestions({ schoolId, items }: { schoolId: string; items: IncidentItem[] }) {
  return (
    <div className="rounded-control border-2 border-warning bg-warning-soft p-3">
      <p className="font-bold">비슷한 제보가 있습니다 — 같은 상황이면 기존 제보에 정보를 추가해 주세요.</p>
      <ul className="mt-2 space-y-2">
        {items.map((s) => (
          <li key={s.id} className="flex flex-wrap items-center gap-2 rounded-control bg-card p-2">
            <span className="text-sm font-bold">{INCIDENT_TYPE_LABEL[s.type]}</span>
            <span className="text-sm">{s.placeLabel}</span>
            <span className="min-w-0 flex-1 truncate text-sm text-ink-muted">{s.description}</span>
            <Link href={`/s/${schoolId}/incidents/${s.id}`} className="text-sm font-bold text-accent underline">
              이 제보에 정보 추가
            </Link>
          </li>
        ))}
      </ul>
      <p className="mt-2 text-sm">다른 위험이거나 새로 생긴 피해라면 그대로 새로 제보해도 됩니다.</p>
    </div>
  );
}
