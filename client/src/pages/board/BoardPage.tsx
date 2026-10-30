// 상황판(데이터 연결 · Beta PILOT 2: 승인된 교직원 누구나 열람, 발령·종료·대리 지정은 권한자만): 5초마다 갱신, 실패하면 마지막 갱신 시각과 연결 상태를 표시합니다.
import { useCallback, useEffect, useRef, useState } from "react";
import { api, ApiError } from "../../lib/api";
import type { ActiveEvent, BoardData } from "../../lib/disaster";
import { AppShell } from "../../components/layout/AppShell";
import { ConfirmDialog } from "../../components/ui/ConfirmDialog";
import { EmptyState, ErrorState, LoadingState } from "../../components/ui/States";
import { BoardView, type Connection } from "./BoardView";
import { IssueEventForm } from "./IssueEventForm";
import { DelegationPanel } from "./DelegationPanel";
import { useSession } from "../../lib/session";
import { can } from "../../lib/permissions";
import { Link } from "../../lib/router";

const POLL_MS = 5000;

type Load = { kind: "loading" } | { kind: "unavailable" } | { kind: "none" } | { kind: "error"; message: string } | { kind: "ready"; data: BoardData };

export function BoardPage({ schoolId }: { schoolId: string }) {
  const [load, setLoad] = useState<Load>({ kind: "loading" });
  const [connection, setConnection] = useState<Connection>({ lastSuccessAt: null, failing: false });
  const [confirmClose, setConfirmClose] = useState(false);
  const [closing, setClosing] = useState(false);
  const [closeError, setCloseError] = useState<string | null>(null);
  const eventIdRef = useRef<string | null>(null);
  const { usableMemberships } = useSession();
  const membership = usableMemberships.find((m) => m.school.id === schoolId) ?? null;

  const poll = useCallback(async () => {
    try {
      let eventId = eventIdRef.current;
      if (!eventId) {
        const { event } = await api<{ event: ActiveEvent | null }>("GET", `/schools/${schoolId}/events/active`);
        if (!event) {
          setLoad({ kind: "none" });
          setConnection({ lastSuccessAt: new Date(), failing: false });
          return;
        }
        eventId = event.id;
        eventIdRef.current = eventId;
      }
      const data = await api<BoardData>("GET", `/schools/${schoolId}/events/${eventId}/board`);
      if (!data.event) eventIdRef.current = null;
      setLoad({ kind: "ready", data });
      setConnection({ lastSuccessAt: new Date(), failing: false });
    } catch (e) {
      if (e instanceof ApiError && e.status === 404 && e.code === "not_found" && !eventIdRef.current) {
        setLoad({ kind: "unavailable" });
        return;
      }
      const message = e instanceof ApiError ? e.message : "알 수 없는 오류";
      // 이미 화면에 데이터가 있으면 그대로 두고 연결 상태만 경고(숫자를 지우지 않음)
      setConnection((c) => ({ ...c, failing: true, message }));
      setLoad((prev) => (prev.kind === "ready" ? prev : { kind: "error", message }));
    }
  }, [schoolId]);

  useEffect(() => {
    void poll();
    const id = window.setInterval(() => void poll(), POLL_MS);
    return () => window.clearInterval(id);
  }, [poll]);

  const closeEvent = async () => {
    if (load.kind !== "ready") return;
    setClosing(true);
    setCloseError(null);
    try {
      // 확인 창(실제 상황은 "종료" 입력)을 거친 뒤에만 호출되므로 명시적 확인을 함께 보냄
      await api("POST", `/schools/${schoolId}/events/${load.data.event.id}/close`, { confirmClose: true });
      eventIdRef.current = null;
      setConfirmClose(false);
      await poll();
    } catch (e) {
      setCloseError(e instanceof ApiError ? e.message : "종료하지 못했습니다.");
    } finally {
      setClosing(false);
    }
  };

  const event = load.kind === "ready" ? load.data.event : null;
  return (
    <AppShell title="재난 상황판" schoolId={schoolId} event={event}>
      {load.kind === "loading" && <LoadingState label="상황판을 불러오는 중…" />}
      {load.kind === "unavailable" && (
        <EmptyState icon="info" title="재난 대응 기능 준비 중" message="재난 발령·상황판 서버 기능은 다음 개발 단계(STEP 3)에서 연결됩니다. 화면 디자인은 /design 에서 미리 볼 수 있습니다." />
      )}
      {load.kind === "none" && (
        <>
          <EmptyState icon="check-circle" title="진행 중인 재난 상황이 없습니다" message="재난이 발령되면 이 화면에 학급별 보고가 실시간으로 모입니다." />
          <div className="mt-4">
            {can(membership, "event.issue") && <IssueEventForm schoolId={schoolId} onIssued={() => void poll()} />}
          </div>
        </>
      )}
      {load.kind === "error" && <ErrorState message={load.message} onRetry={() => void poll()} />}
      {load.kind === "ready" && <BoardView data={load.data} connection={connection} onCloseEvent={can(membership, "event.close") ? () => setConfirmClose(true) : undefined} />}
      {/* Beta PILOT 2 Phase 2-C: 교직원 소재는 실제 재난에서만, 학생 대피 현황과 별도 화면 */}
      {load.kind === "ready" && load.data.event.mode === "real" && (
        <Link
          href={`/s/${schoolId}/staff-presence?event=${load.data.event.id}`}
          className="mt-5 flex min-h-touch items-center justify-between rounded-card border-2 border-danger bg-card p-4 text-lg font-bold shadow-card"
        >
          <span>교직원 소재 현황 보기(학생 대피 현황과 별개)</span>
          <span aria-hidden>›</span>
        </Link>
      )}
      {load.kind === "ready" && can(membership, "event.issue") && (
        <div className="mt-5">
          <DelegationPanel schoolId={schoolId} eventId={load.data.event.id} classes={load.data.classes} onChanged={() => void poll()} />
        </div>
      )}

      <ConfirmDialog
        open={confirmClose}
        title="재난 상황을 종료할까요?"
        confirmLabel="상황 종료"
        confirmPhrase={event?.mode === "real" ? "종료" : undefined}
        loading={closing}
        onConfirm={() => void closeEvent()}
        onCancel={() => setConfirmClose(false)}
      >
        <p>종료하면 교직원이 더 이상 보고할 수 없고, 종료 시점의 최종 집계가 기록으로 남습니다. 보고 기록은 삭제되지 않습니다.</p>
        {closeError && <p className="mt-2 font-semibold text-danger">{closeError}</p>}
      </ConfirmDialog>
    </AppShell>
  );
}
