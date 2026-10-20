// 학급 보고 화면(데이터 연결)
// - 진행 중인 재난이 있으면 담당 학급이 자동으로 열립니다(학급이 하나면 선택 단계 없음).
// - 통신 장애로 저장하지 못하면 기기에 '미전송'으로 보관하고, 연결되면 같은 요청(같은 멱등키)으로 다시 보냅니다.
//   서버 응답을 받기 전에는 절대 '저장 완료'로 표시하지 않습니다.
import { useCallback, useEffect, useState } from "react";
import { api, ApiError, newIdempotencyKey, storage } from "../../lib/api";
import type { ActiveEvent, ClassReport, ClassReportView, ReportInput } from "../../lib/disaster";
import { formatTime } from "../../lib/format";
import { useSession } from "../../lib/session";
import { AppShell } from "../../components/layout/AppShell";
import { ClassStatusCard } from "../../components/ui/ClassStatusCard";
import { EmptyState, ErrorState, LoadingState, type SaveState } from "../../components/ui/States";
import { ReportFormView } from "./ReportFormView";

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
const pendingKey = (eventId: string, classId: string) => `ss.pending.${eventId}.${classId}`;

export function ReportPage({ schoolId }: { schoolId: string }) {
  const { current } = useSession();
  const [load, setLoad] = useState<Load>({ kind: "loading" });
  const [selected, setSelected] = useState<string | null>(null);
  const [saveState, setSaveState] = useState<SaveState>({ kind: "idle" });

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
        } else {
          setSaveState({ kind: "failed", message: e instanceof ApiError ? e.message : "다시 시도하세요." });
        }
      }
    },
    [schoolId],
  );

  // 연결이 돌아오면 미전송 보고를 다시 보냄
  useEffect(() => {
    if (load.kind !== "ready" || !selected) return;
    const retry = () => {
      const raw = storage.get(pendingKey(load.event.id, selected));
      if (raw) void send(load.event, selected, JSON.parse(raw) as Pending);
    };
    retry();
    window.addEventListener("online", retry);
    return () => window.removeEventListener("online", retry);
  }, [load, selected, send]);

  const event = load.kind === "ready" ? load.event : null;
  const view = load.kind === "ready" ? load.classes.find((c) => c.classId === selected) ?? null : null;

  return (
    <AppShell title="학급 대피 보고" schoolId={schoolId} event={event}>
      {load.kind === "loading" && <LoadingState />}
      {load.kind === "error" && <ErrorState message={load.message} onRetry={() => void fetchAll()} />}
      {load.kind === "unavailable" && (
        <EmptyState icon="info" title="재난 대응 기능 준비 중" message="재난 발령·보고 서버 기능은 다음 개발 단계(STEP 3)에서 연결됩니다. 화면 디자인은 /design 에서 미리 볼 수 있습니다." />
      )}
      {load.kind === "none" && (
        <EmptyState
          icon="check-circle"
          title="진행 중인 재난 상황이 없습니다"
          message={`재난이 발령되면 ${current?.assignments.map((a) => a.class.label).join(", ") || "담당 학급"} 보고 화면이 이곳에 바로 열립니다.`}
        />
      )}
      {load.kind === "ready" && load.classes.length === 0 && (
        <EmptyState icon="users" title="배정된 학급이 없습니다" message="학교 관리자에게 담당 학급 배정을 요청하세요." />
      )}
      {load.kind === "ready" && !view && load.classes.length > 1 && (
        <div className="mx-auto max-w-xl">
          <h2 className="text-lg font-bold">보고할 학급을 고르세요</h2>
          <div className="mt-3 grid gap-3">
            {load.classes.map((c) => (
              <ClassStatusCard key={c.classId} view={c} onSelect={(v) => { setSelected(v.classId); setSaveState({ kind: "idle" }); }} />
            ))}
          </div>
        </div>
      )}
      {event && view && (
        <>
          {load.kind === "ready" && load.classes.length > 1 && (
            <button type="button" onClick={() => setSelected(null)} className="mx-auto mb-2 block min-h-touch max-w-xl text-base font-bold text-accent underline underline-offset-4">
              ← 다른 학급 보고
            </button>
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
