// STEP 3-D 훈련일지 목록: 종료된 모의훈련별로 '훈련일지 만들기'(안전업무 담당) 또는 '열기'(열람 권한)
// 실제 재난 대응 기록에는 훈련일지를 만들지 않습니다(목록에도 나오지 않음).
import { useCallback, useEffect, useState } from "react";
import { api, describeError } from "../../lib/api";
import { formatDateTime } from "../../lib/format";
import { Link, navigate } from "../../lib/router";
import { AppShell } from "../../components/layout/AppShell";
import { EmptyState, ErrorState, LoadingState } from "../../components/ui/States";
import { PrimaryButton } from "../../components/ui/PrimaryButton";

interface Target {
  eventId: string;
  typeLabel: string;
  startedAt: string;
  closedAt: string | null;
  log: { id: string; status: "draft" | "completed"; version: number; updatedAt: string; updatedByName: string | null } | null;
}

export function DrillLogsPage({ schoolId }: { schoolId: string }) {
  const [data, setData] = useState<{ events: Target[]; canEdit: boolean } | null>(null);
  const [err, setErr] = useState<ReturnType<typeof describeError> | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [actionErr, setActionErr] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      setData(await api("GET", `/schools/${schoolId}/drill-logs`));
      setErr(null);
    } catch (e) {
      setErr(describeError(e));
    }
  }, [schoolId]);
  useEffect(() => {
    void load();
  }, [load]);

  const create = async (eventId: string) => {
    if (busy) return;
    setBusy(eventId);
    setActionErr(null);
    try {
      const r = await api<{ id: string }>("POST", `/schools/${schoolId}/events/${eventId}/drill-log`, {});
      navigate(`/s/${schoolId}/drill-logs/${r.id}`);
    } catch (e) {
      setActionErr(describeError(e).message);
      setBusy(null);
    }
  };

  return (
    <AppShell title="훈련일지" schoolId={schoolId}>
      <div className="mx-auto max-w-3xl space-y-4">
        <p className="rounded-control border border-line bg-card px-3 py-2 text-sm text-ink-muted">
          종료된 모의훈련의 대피 보고로 비상대피훈련일지 초안을 만들고, 담당자가 확인·보완한 뒤 한글(HWPX) 파일로 내려받습니다. 결재는 K-에듀파인에서 파일을 직접 첨부해
          진행하세요(자동 상신 없음).
        </p>
        {!data && !err && <LoadingState label="훈련 기록을 불러오는 중…" />}
        {err && <ErrorState title={err.title} message={err.message} onRetry={() => void load()} />}
        {actionErr && <p role="alert" className="rounded-control border-2 border-danger bg-danger-soft px-3 py-2 font-semibold text-danger">{actionErr}</p>}
        {data &&
          (data.events.length === 0 ? (
            <EmptyState icon="file" title="종료된 모의훈련이 없습니다" message="상황판에서 모의훈련을 발령·종료하면 여기에 나타납니다." />
          ) : (
            <ul className="space-y-3">
              {data.events.map((e) => (
                <li key={e.eventId} className="flex flex-wrap items-center gap-3 rounded-card border border-line bg-card p-4 shadow-card">
                  <div className="min-w-0 flex-1">
                    <p className="flex flex-wrap items-center gap-2 text-lg font-bold">
                      {e.typeLabel} 모의훈련
                      {e.log ? (
                        <span className={`rounded-full border px-2 py-0.5 text-sm font-bold ${e.log.status === "completed" ? "border-success bg-success-soft text-success" : "border-warning bg-warning-soft text-warning-strong"}`}>
                          {e.log.status === "completed" ? "작성 완료" : "작성 중"} · 판 {e.log.version}
                        </span>
                      ) : (
                        <span className="rounded-full border border-line-strong bg-neutral-soft px-2 py-0.5 text-sm font-bold text-neutral">훈련일지 없음</span>
                      )}
                    </p>
                    <p className="text-sm text-ink-muted">
                      {formatDateTime(e.startedAt)} ~ {e.closedAt ? formatDateTime(e.closedAt) : "-"}
                      {e.log && ` · 최근 저장 ${formatDateTime(e.log.updatedAt)}${e.log.updatedByName ? ` (${e.log.updatedByName})` : ""}`}
                    </p>
                  </div>
                  {e.log ? (
                    <Link href={`/s/${schoolId}/drill-logs/${e.log.id}`} className="inline-flex min-h-touch items-center rounded-control bg-brand px-4 font-bold text-white hover:bg-brand-hover">
                      열기
                    </Link>
                  ) : data.canEdit ? (
                    <PrimaryButton loading={busy === e.eventId} loadingText="만드는 중…" disabled={!!busy} icon="file" onClick={() => void create(e.eventId)}>
                      훈련일지 만들기
                    </PrimaryButton>
                  ) : (
                    <span className="text-sm text-ink-muted">안전업무 담당이 만들 수 있습니다</span>
                  )}
                </li>
              ))}
            </ul>
          ))}
      </div>
    </AppShell>
  );
}
