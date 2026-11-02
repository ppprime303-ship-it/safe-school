// 학급 보고 화면(데이터 연결)
// - 진행 중인 재난이 있으면 담당 학급이 자동으로 열립니다(학급이 하나면 선택 단계 없음).
// - 통신 장애로 저장하지 못하면 기기에 '미전송'으로 보관하고, 연결되면 같은 요청(같은 멱등키)으로 다시 보냅니다.
//   서버 응답을 받기 전에는 절대 '저장 완료'로 표시하지 않습니다.
import { useCallback, useEffect, useState } from "react";
import { api, ApiError, describeError, newIdempotencyKey, storage } from "../../lib/api";
import type { ActiveEvent, ClassReport, ClassReportView, ReportInput } from "../../lib/disaster";
import { formatTime } from "../../lib/format";
import { useSession } from "../../lib/session";
import { AppShell } from "../../components/layout/AppShell";
import { ClassStatusCard } from "../../components/ui/ClassStatusCard";
import { EmptyState, ErrorState, LoadingState, type SaveState } from "../../components/ui/States";
import { ReportFormView } from "./ReportFormView";
import { SPECIAL_CLASS_NOTICE } from "@shared/headcount";

type Load =
  | { kind: "loading" }
  | { kind: "unavailable" } // 서버에 재난 API가 아직 없음(STEP 3 전)
  | { kind: "error"; message: string }
  | { kind: "none" }
  | { kind: "ready"; event: ActiveEvent; classes: ClassReportView[] };

interface Pending {
  key: string;
  input: ReportInput;
  savedAt: string;
}
const EVENT_POLL_MS = 5000;
const pendingKey = (eventId: string, classId: string) => `ss.pending.${eventId}.${classId}`;

export function ReportPage({ schoolId }: { schoolId: string }) {
  const { current } = useSession();
  const [load, setLoad] = useState<Load>({ kind: "loading" });
  const [selected, setSelected] = useState<string | null>(null);
  const [saveState, setSaveState] = useState<SaveState>({ kind: "idle" });
  const [retryTick, setRetryTick] = useState(0);

  const fetchAll = useCallback(async () => {
    try {
      const { event } = await api<{ event: ActiveEvent | null }>("GET", `/schools/${schoolId}/events/active`);
      if (!event) return setLoad({ kind: "none" });
      const { classes } = await api<{ classes: ClassReportView[] }>("GET", `/schools/${schoolId}/events/${event.id}/my-classes`);
      setLoad({ kind: "ready", event, classes });
      if (classes.length === 1) setSelected(classes[0]!.classId);
    } catch (e) {
      if (e instanceof ApiError && e.status === 404 && e.code === "not_found") return setLoad({ kind: "unavailable" });
      setLoad({ kind: "error", message: e instanceof ApiError ? e.message : "불러오지 못했습니다." });
    }
  }, [schoolId]);

  useEffect(() => {
    void fetchAll();
  }, [fetchAll]);

  // 발령·종료를 새로 고침 없이 반영: 5초마다 진행 중 상황만 가볍게 확인하고, 바뀌었을 때만 다시 불러옴
  // (입력 중인 보고 양식은 건드리지 않음)
  const currentEventId = load.kind === "ready" ? load.event.id : null;
  const watching = load.kind === "ready" || load.kind === "none";
  useEffect(() => {
    if (!watching) return;
    const id = window.setInterval(async () => {
      try {
        const { event } = await api<{ event: ActiveEvent | null }>("GET", `/schools/${schoolId}/events/active`);
        if ((event?.id ?? null) !== currentEventId) {
          setSelected(null);
          setSaveState({ kind: "idle" });
          void fetchAll();
        }
      } catch {
        /* 통신 실패: 화면은 그대로 두고 다음 주기에 다시 확인 */
      }
    }, EVENT_POLL_MS);
    return () => window.clearInterval(id);
  }, [watching, currentEventId, schoolId, fetchAll]);

  const send = useCallback(
    async (event: ActiveEvent, classId: string, pending: Pending) => {
      setSaveState({ kind: "saving" });
      try {
        const { report } = await api<{ report: ClassReport }>("PUT", `/schools/${schoolId}/events/${event.id}/reports/${classId}`, pending.input, {
          idempotencyKey: pending.key,
        });
        storage.remove(pendingKey(event.id, classId));
        setSaveState({ kind: "saved", at: formatTime(report.reportedAt) });
        setLoad((prev) =>
          prev.kind === "ready" ? { ...prev, classes: prev.classes.map((c) => (c.classId === classId ? { ...c, report } : c)) } : prev,
        );
      } catch (e) {
        if (e instanceof ApiError && e.isNetwork) {
          storage.set(pendingKey(event.id, classId), JSON.stringify(pending));
          setSaveState({ kind: "queued", message: "통신이 연결되면 자동으로 다시 보냅니다. 급하면 구두로도 보고하세요." });
        } else if (e instanceof ApiError && e.status === 429) {
          // 요청 제한: 입력을 잃지 않게 보관하고, 서버가 알려 준 시간 뒤 같은 요청 번호로 다시 보냄(중복 보고 없음)
          storage.set(pendingKey(event.id, classId), JSON.stringify(pending));
          setSaveState({ kind: "queued", message: `${describeError(e).message} 입력한 내용은 보관했으며 자동으로 다시 보냅니다.` });
          const waitSec = typeof e.details?.retryAfterSec === "number" ? e.details.retryAfterSec : 30;
          window.setTimeout(() => setRetryTick((n) => n + 1), waitSec * 1000);
        } else if (e instanceof ApiError && (e.code === "version_conflict" || e.code === "event_closed")) {
          // 다른 사람이 먼저 수정했거나 상황이 종료됨: 최신 내용을 다시 불러와 보여 줌(덮어쓰지 않음)
          storage.remove(pendingKey(event.id, classId));
          setSaveState({ kind: "failed", message: e.message });
          void fetchAll();
        } else {
          setSaveState({ kind: "failed", message: e instanceof ApiError ? e.message : "다시 시도하세요." });
        }
      }
    },
    [schoolId, fetchAll],
  );

  // 연결이 돌아오거나 요청 제한 시간이 지나면 미전송 보고를 다시 보냄
  useEffect(() => {
    if (load.kind !== "ready" || !selected) return;
    const retry = () => {
      const raw = storage.get(pendingKey(load.event.id, selected));
      if (raw) void send(load.event, selected, JSON.parse(raw) as Pending);
    };
    retry();
    window.addEventListener("online", retry);
    return () => window.removeEventListener("online", retry);
  }, [load, selected, send, retryTick]);

  const event = load.kind === "ready" ? load.event : null;
  const view = load.kind === "ready" ? load.classes.find((c) => c.classId === selected) ?? null : null;

  // Phase 1-3: 보고 권한은 담임 배정과 이번 상황의 대리 지정뿐 — 보조(assist) 배정은 따로 표시(보고 권한 아님)
  const myAssignments = current?.school.id === schoolId ? current.assignments : [];
  const assignedClasses = myAssignments.filter((a) => a.duty === "homeroom");
  const assistClasses = myAssignments.filter((a) => a.duty === "assist");
  const delegatedClasses = load.kind === "ready" ? load.classes.filter((c) => c.responsibility === "delegated") : [];

  return (
    <AppShell title="학급 대피 보고" schoolId={schoolId} event={event}>
      <section className="mx-auto mb-4 max-w-xl rounded-card border border-line bg-card p-4 shadow-card" aria-label="내 담당 학급">
        <h2 className="text-lg font-bold">내 담당 학급</h2>
        {assignedClasses.length > 0 ? (
          <p className="mt-2 text-xl font-extrabold">
            {assignedClasses.map((a) => a.class.label).join(", ")}
          </p>
        ) : (
          <p className="mt-2 text-base text-ink-muted">담임 학급이 없습니다. 학교 관리자에게 담당 학급 배정을 요청하세요.</p>
        )}
        <p className="mt-2 text-sm text-ink-muted">학급 보고는 담임 학급과, 재난 상황에서 대리 담당으로 지정된 학급만 할 수 있습니다. 학교 전체 현황은 상황판에서 확인하세요.</p>
        {assistClasses.length > 0 && (
          <p className="mt-1 text-sm text-ink-muted">
            보조 배정 {assistClasses.map((a) => a.class.label).join(", ")}: 대리 담당 후보로만 쓰이며, 보고하려면 상황 중 대리 담당으로 지정되어야 합니다.
          </p>
        )}
        {delegatedClasses.length > 0 && (
          <div className="mt-3 rounded-control border-2 border-warning bg-warning-soft p-3">
            <h3 className="font-bold text-warning-strong">대리 담당 학급(이번 상황 동안만)</h3>
            <p className="mt-1 text-lg font-extrabold">{delegatedClasses.map((c) => c.label).join(", ")}</p>
            <p className="mt-1 text-sm">학급마다 따로 보고하세요. 여러 학급 인원을 합쳐서 한 번에 보고하지 마세요.</p>
          </div>
        )}
        <p className="mt-3 text-sm text-ink-muted">{SPECIAL_CLASS_NOTICE}</p>
      </section>
      {load.kind === "loading" && <LoadingState />}
      {load.kind === "error" && <ErrorState message={load.message} onRetry={() => void fetchAll()} />}
      {load.kind === "unavailable" && (
        <EmptyState icon="info" title="재난 대응 기능 준비 중" message="재난 발령·보고 서버 기능은 다음 개발 단계(STEP 3)에서 연결됩니다. 화면 디자인은 /design 에서 미리 볼 수 있습니다." />
      )}
      {load.kind === "none" && (
        <EmptyState
          icon="check-circle"
          title="진행 중인 재난 상황이 없습니다"
          message={`재난이 발령되면 ${assignedClasses.map((a) => a.class.label).join(", ") || "담당 학급"} 보고 화면이 이곳에 바로 열립니다.`}
        />
      )}
      {load.kind === "ready" && load.classes.length === 0 && (
        <EmptyState
          icon="users"
          title="보고할 학급이 없습니다"
          message="담임 학급이 없고 이번 상황의 대리 담당으로도 지정되지 않았습니다. 학교 전체 현황은 상황판에서 확인하세요. 담임이 보고할 수 없는 학급은 발령 권한자가 대리 담당을 지정합니다."
        />
      )}
      {load.kind === "ready" && !view && load.classes.length > 1 && (
        <div className="mx-auto max-w-xl">
          <h2 className="text-lg font-bold">보고할 학급을 고르세요</h2>
          {(
            [
              ["내 담당 학급", load.classes.filter((c) => c.responsibility !== "delegated")],
              ["대리 담당 학급", load.classes.filter((c) => c.responsibility === "delegated")],
            ] as const
          )
            .filter(([, list]) => list.length > 0)
            .map(([title, list]) => (
              <div key={title} className="mt-3">
                {delegatedClasses.length > 0 && <h3 className="text-base font-bold text-ink-muted">{title}</h3>}
                <div className="mt-2 grid gap-3">
                  {list.map((c) => (
                    <ClassStatusCard key={c.classId} view={c} onSelect={(v) => { setSelected(v.classId); setSaveState({ kind: "idle" }); }} />
                  ))}
                </div>
              </div>
            ))}
        </div>
      )}
      {event && view && (
        <>
          {load.kind === "ready" && load.classes.length > 1 && (
            <button type="button" onClick={() => setSelected(null)} className="mx-auto mb-2 block min-h-touch max-w-xl text-base font-bold text-accent underline underline-offset-4">
              ← 다른 학급 보고
            </button>
          )}
          {view.responsibility === "delegated" && (
            <p className="mx-auto mb-2 max-w-xl rounded-control border-2 border-warning bg-warning-soft p-2 text-center font-bold text-warning-strong">대리 담당으로 {view.label}을 보고합니다</p>
          )}
          <ReportFormView
            key={`${view.classId}-${view.report?.version ?? 0}`}
            view={view}
            saveState={saveState}
            onSubmit={(input) => void send(event, view.classId, { key: newIdempotencyKey(), input, savedAt: new Date().toISOString() })}
          />
        </>
      )}
    </AppShell>
  );
}
