// 실제 재난 현장 제보의 후속 조치(재난대피일지 작성 권한자). 사건이 종료된 뒤에도 조치 대기·조치 완료를 기록합니다.
// 원본 제보를 바꾸는 별도 작업입니다. 보고서의 '저장하기'는 원본 제보를 바꾸지 않습니다.
import { useCallback, useEffect, useState } from "react";
import { INCIDENT_STATUS_LABEL, type IncidentStatus } from "@shared/incident";
import { api, ApiError, describeError, newIdempotencyKey } from "../../lib/api";
import { PrimaryButton } from "../../components/ui/PrimaryButton";
import type { IncidentItem } from "../../lib/incident";

export function FollowupForm({ schoolId, incidentId, status, onDone }: { schoolId: string; incidentId: string; status: IncidentStatus; onDone: () => void }) {
  const [open, setOpen] = useState(false);
  const [note, setNote] = useState("");
  const [completedAt, setCompletedAt] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [key, setKey] = useState(newIdempotencyKey);
  const finishing = status !== "resolved";
  const to: IncidentStatus = finishing ? "resolved" : "received";

  const submit = async () => {
    setBusy(true);
    setError(null);
    try {
      await api("POST", `/schools/${schoolId}/incidents/${incidentId}/followup`, { status: to, expectedStatus: status, note: note.trim(), ...(finishing && completedAt ? { completedAt: new Date(completedAt).toISOString() } : {}) }, { idempotencyKey: key });
      setOpen(false);
      setNote("");
      setCompletedAt("");
      setKey(newIdempotencyKey());
      onDone();
    } catch (e) {
      if (e instanceof ApiError && e.code === "status_changed") onDone();
      setError(describeError(e).message);
    } finally {
      setBusy(false);
    }
  };

  if (!open) {
    return (
      <PrimaryButton variant={finishing ? "secondary" : "ghost"} onClick={() => setOpen(true)}>
        {finishing ? "조치 완료 기록" : "조치 대기로 정정"}
      </PrimaryButton>
    );
  }
  return (
    <div className="mt-2 w-full space-y-2 rounded-control border-2 border-accent p-3">
      <p className="text-sm font-semibold">
        {finishing ? "실제 조치가 끝났는지 확인한 뒤 기록하세요." : "완료 기록을 지우지 않고 정정 이력으로 남깁니다."} 원본 제보의 상태가 바뀌며, 보고서 저장과는 별개입니다.
      </p>
      <label className="block font-bold">
        {finishing ? "후속 조치 내용" : "정정 사유"}
        <textarea className="mt-1 block w-full rounded-control border-2 border-line-strong bg-card px-3 py-2 text-base" rows={2} maxLength={280} value={note} onChange={(e) => setNote(e.target.value)} />
        <span className="mt-1 block text-sm font-normal text-ink-muted">교직원·학생 이름과 전화번호는 적지 마세요.</span>
      </label>
      {finishing && (
        <label className="block font-bold">
          실제 완료 시각(비우면 지금)
          <input type="datetime-local" className="mt-1 block min-h-touch w-full rounded-control border-2 border-line-strong bg-card px-3 text-base" value={completedAt} onChange={(e) => setCompletedAt(e.target.value)} />
        </label>
      )}
      {error && <p role="alert" className="font-semibold text-danger">{error}</p>}
      <div className="flex flex-wrap gap-2">
        <PrimaryButton loading={busy} loadingText="기록 중…" disabled={!note.trim()} onClick={() => void submit()}>
          {finishing ? "조치 완료로 기록" : "조치 대기로 정정"}
        </PrimaryButton>
        <PrimaryButton variant="ghost" disabled={busy} onClick={() => setOpen(false)}>취소</PrimaryButton>
      </div>
    </div>
  );
}

/** 재난대피일지 편집 화면: 원본 제보의 지금 상태와 후속 조치 */
export function IncidentFollowupSection({ schoolId, eventId, onChanged }: { schoolId: string; eventId: string; onChanged: () => void }) {
  const [items, setItems] = useState<IncidentItem[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const load = useCallback(async () => {
    try {
      setItems((await api<{ incidents: IncidentItem[] }>("GET", `/schools/${schoolId}/events/${eventId}/incidents`)).incidents);
      setError(null);
    } catch (e) {
      setError(describeError(e).message);
    }
  }, [schoolId, eventId]);
  useEffect(() => {
    void load();
  }, [load]);
  if (!items?.length && !error) return null;
  return (
    <section aria-labelledby="followup-title" className="rounded-card border-2 border-accent bg-card p-4 shadow-card print:hidden">
      <h2 id="followup-title" className="text-lg font-bold">현장 제보 후속 조치(원본 제보)</h2>
      <p className="mt-1 text-sm text-ink-muted">상황이 종료된 뒤에도 기록할 수 있습니다. 사건·학급 보고·교직원 소재 기록은 바뀌지 않습니다.</p>
      {error && <p role="alert" className="mt-2 font-semibold text-danger">{error}</p>}
      <ul className="mt-2 divide-y divide-line">
        {(items ?? []).map((i) => (
          <li key={i.id} className="flex flex-wrap items-center gap-2 py-3">
            <span className={`font-bold ${i.status === "resolved" ? "text-success" : "text-warning-strong"}`}>{INCIDENT_STATUS_LABEL[i.status]}</span>
            <span className="min-w-0 flex-1 basis-48">{i.placeLabel} · {i.description}</span>
            <FollowupForm schoolId={schoolId} incidentId={i.id} status={i.status} onDone={() => { void load(); onChanged(); }} />
          </li>
        ))}
      </ul>
    </section>
  );
}
