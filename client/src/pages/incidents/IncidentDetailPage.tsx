// Beta PILOT 2 Phase 3-B: 현장 제보 상세 — 본문(바뀌지 않음)·후속 정보·처리 상태 이력, 정보 추가, (대응 담당자) 처리 상태 변경
// - 종료된 상황은 읽기 전용. 일반 교직원 화면에는 작성자 이름·사진이 없음(서버가 보내지 않음)
import { useCallback, useEffect, useState } from "react";
import {
  INCIDENT_PRIVACY_HINT,
  INCIDENT_STATUSES,
  INCIDENT_STATUS_LABEL,
  INCIDENT_TYPE_LABEL,
  INCIDENT_UPDATE_KINDS,
  INCIDENT_UPDATE_LABEL,
  incidentUpdateSchema,
  type IncidentStatus,
  type IncidentUpdateKind,
} from "@shared/incident";
import { api, ApiError, describeError, newIdempotencyKey } from "../../lib/api";
import { formatDateTime } from "../../lib/format";
import { can } from "../../lib/permissions";
import { STATUS_TONE, type IncidentDetail } from "../../lib/incident";
import { Link } from "../../lib/router";
import { useSession } from "../../lib/session";
import { AppShell } from "../../components/layout/AppShell";
import { ErrorState, LoadingState } from "../../components/ui/States";
import { PrimaryButton } from "../../components/ui/PrimaryButton";
import { EventModeBadge } from "./IncidentsPage";
import { IncidentPhotos } from "./IncidentPhotos";

/** 표시 전용(테스트 가능) */
export function IncidentDetailView({ schoolId, incident, canManage, onStatus, statusBusy = false }: { schoolId: string; incident: IncidentDetail; canManage: boolean; onStatus?: (to: IncidentStatus) => void; statusBusy?: boolean }) {
  const active = incident.event.status === "active";
  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-2">
        <EventModeBadge event={incident.event} />
        <Link href={`/s/${schoolId}/incidents?event=${incident.event.id}`} className="ml-auto text-sm font-bold text-accent underline">
          목록으로
        </Link>
      </div>
      <article className="rounded-card border border-line bg-card p-4 shadow-card">
        <div className="flex flex-wrap items-center gap-2">
          <span className={`rounded-full px-2 py-0.5 text-sm font-bold ${STATUS_TONE[incident.status]}`}>{INCIDENT_STATUS_LABEL[incident.status]}</span>
          <strong className="text-lg">{INCIDENT_TYPE_LABEL[incident.type]}</strong>
          <span className="text-lg font-semibold">{incident.placeLabel}</span>
        </div>
        <p className="mt-2 whitespace-pre-wrap text-base">{incident.description}</p>
        <p className="mt-2 text-sm text-ink-muted">
          제보 {formatDateTime(incident.createdAt)}
          {incident.mine && " · 내 제보"}
          {incident.reporterName && ` · ${incident.reporterName}`}
        </p>
      </article>

      {canManage && (
        <section aria-labelledby="status" className="rounded-card border-2 border-accent bg-card p-4 shadow-card">
          <h2 id="status" className="text-lg font-bold">
            처리 상태(대응 담당자)
          </h2>
          {active ? (
            <div className="mt-2 grid grid-cols-2 gap-2 sm:grid-cols-4">
              {INCIDENT_STATUSES.map((s) => (
                <button
                  key={s}
                  type="button"
                  aria-pressed={incident.status === s}
                  disabled={incident.status === s || statusBusy}
                  onClick={() => onStatus?.(s)}
                  className={`min-h-touch rounded-control border-2 px-3 text-base font-bold ${incident.status === s ? "border-brand bg-brand text-white" : "border-line-strong bg-card"}`}
                >
                  {INCIDENT_STATUS_LABEL[s]}
                </button>
              ))}
            </div>
          ) : (
            <p className="mt-1 text-sm text-ink-muted">종료된 상황이라 처리 상태를 바꿀 수 없습니다. 정정이 필요하면 플랫폼 운영자에게 정정 절차를 요청하세요(기록은 보존).</p>
          )}
        </section>
      )}

      <section aria-labelledby="timeline" className="rounded-card border border-line bg-card p-4 shadow-card">
        <h2 id="timeline" className="text-lg font-bold">
          추가 정보·처리 기록
        </h2>
        {incident.updates.length === 0 && incident.statusHistory.length === 0 && <p className="mt-1 text-base text-ink-muted">아직 추가 정보가 없습니다.</p>}
        <ul className="mt-2 space-y-2">
          {[
            ...incident.updates.map((u) => ({ at: u.createdAt, key: `u-${u.id}`, node: (
              <>
                <span className="rounded-full bg-page px-2 py-0.5 text-sm font-bold">{INCIDENT_UPDATE_LABEL[u.kind]}</span> <span className="whitespace-pre-wrap">{u.note}</span>
                <span className="block text-sm text-ink-muted">
                  {formatDateTime(u.createdAt)}
                  {u.mine && " · 내가 추가"}
                  {u.authorName && ` · ${u.authorName}`}
                </span>
              </>
            ) })),
            ...incident.statusHistory.map((h, i) => ({ at: h.createdAt, key: `s-${i}`, node: (
              <>
                <span className="font-bold">상태 변경</span> {INCIDENT_STATUS_LABEL[h.from]} → {INCIDENT_STATUS_LABEL[h.to]}
                <span className="block text-sm text-ink-muted">
                  {formatDateTime(h.createdAt)}
                  {h.changedByName && ` · ${h.changedByName}`}
                </span>
              </>
            ) })),
          ]
            .sort((a, b) => a.at.localeCompare(b.at))
            .map((x) => (
              <li key={x.key} className="rounded-control border border-line p-2 text-base">
                {x.node}
              </li>
            ))}
        </ul>
      </section>
    </div>
  );
}

export function IncidentDetailPage({ schoolId, incidentId }: { schoolId: string; incidentId: string }) {
  const { usableMemberships } = useSession();
  const membership = usableMemberships.find((m) => m.school.id === schoolId) ?? null;
  const canManage = can(membership, "incident.manage");
  const [incident, setIncident] = useState<IncidentDetail | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [statusBusy, setStatusBusy] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      setIncident((await api<{ incident: IncidentDetail }>("GET", `/schools/${schoolId}/incidents/${incidentId}`)).incident);
      setError(null);
    } catch (e) {
      setError(describeError(e).message);
    }
  }, [schoolId, incidentId]);
  useEffect(() => {
    void load();
    const id = window.setInterval(() => void load(), 15_000);
    return () => window.clearInterval(id);
  }, [load]);

  const changeStatus = async (to: IncidentStatus) => {
    if (!incident) return;
    setStatusBusy(true);
    setNotice(null);
    try {
      await api("POST", `/schools/${schoolId}/incidents/${incidentId}/status`, { status: to, expectedStatus: incident.status });
    } catch (e) {
      setNotice(describeError(e).message);
    } finally {
      setStatusBusy(false);
      await load();
    }
  };

  return (
    <AppShell title="현장 제보 상세" schoolId={schoolId}>
      {!incident && !error && <LoadingState />}
      {error && <ErrorState message={error} onRetry={() => void load()} />}
      {incident && (
        <div className="space-y-4">
          {notice && <p className="font-semibold text-danger">{notice}</p>}
          <IncidentDetailView schoolId={schoolId} incident={incident} canManage={canManage} onStatus={(s) => void changeStatus(s)} statusBusy={statusBusy} />
          <IncidentPhotos schoolId={schoolId} incident={incident} onChanged={() => void load()} />
          {incident.event.status === "active" ? <AddUpdateForm schoolId={schoolId} incidentId={incidentId} onAdded={() => void load()} /> : <p className="text-base text-ink-muted">종료된 상황입니다. 기록은 조회만 할 수 있습니다.</p>}
        </div>
      )}
    </AppShell>
  );
}

function AddUpdateForm({ schoolId, incidentId, onAdded }: { schoolId: string; incidentId: string; onAdded: () => void }) {
  const [kind, setKind] = useState<IncidentUpdateKind>("info");
  const [note, setNote] = useState("");
  const [key, setKey] = useState(newIdempotencyKey);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const parsed = incidentUpdateSchema.safeParse({ kind, note });
  const submit = async () => {
    if (!parsed.success) return;
    setBusy(true);
    setError(null);
    try {
      await api("POST", `/schools/${schoolId}/incidents/${incidentId}/updates`, parsed.data, { idempotencyKey: key });
      setNote("");
      setKey(newIdempotencyKey());
      onAdded();
    } catch (e) {
      setError(e instanceof ApiError && e.code === "event_closed" ? "상황이 종료되어 추가할 수 없습니다." : describeError(e).message);
      onAdded();
    } finally {
      setBusy(false);
    }
  };
  return (
    <section aria-labelledby="add-update" className="rounded-card border border-line bg-card p-4 shadow-card">
      <h2 id="add-update" className="text-lg font-bold">
        이 제보에 정보 추가
      </h2>
      <div className="mt-2 grid grid-cols-3 gap-2">
        {INCIDENT_UPDATE_KINDS.map((k) => (
          <button key={k} type="button" aria-pressed={kind === k} onClick={() => setKind(k)} className={`min-h-touch rounded-control border-2 px-3 text-base font-bold ${kind === k ? "border-brand bg-brand text-white" : "border-line-strong bg-card"}`}>
            {INCIDENT_UPDATE_LABEL[k]}
          </button>
        ))}
      </div>
      <textarea aria-label="추가 내용" value={note} maxLength={300} rows={3} onChange={(e) => setNote(e.target.value)} className="mt-2 block w-full rounded-control border-2 border-line-strong px-3 py-2 text-base" />
      <p className="mt-1 text-sm text-ink-muted">{INCIDENT_PRIVACY_HINT}</p>
      {note.trim().length > 0 && !parsed.success && <p className="font-semibold text-danger">{parsed.error.issues[0]?.message}</p>}
      {error && <p className="font-semibold text-danger">{error}</p>}
      <PrimaryButton className="mt-2" disabled={!parsed.success || busy} loading={busy} onClick={() => void submit()}>
        정보 추가
      </PrimaryButton>
    </section>
  );
}
