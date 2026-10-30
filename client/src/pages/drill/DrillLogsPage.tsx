// STEP 3-D 훈련일지 목록: 사건별로 '만들기'(작성 권한) 또는 '열기'(열람 권한)
// Beta PILOT 2 Phase 4: 모의훈련 → 비상대피훈련일지(작성: 안전업무 담당), 실제 재난 → 재난대피 상황보고서(작성: 학교 관리자·안전업무 담당).
// 진행 중 사건도 '작성 중'으로 만들 수 있음(최종본은 종료 후). 서식은 서버가 사건 mode 로 결정
import { useCallback, useEffect, useState } from "react";
import { api, describeError } from "../../lib/api";
import { formatDateTime } from "../../lib/format";
import { Link, navigate } from "../../lib/router";
import { AppShell } from "../../components/layout/AppShell";
import { EmptyState, ErrorState, LoadingState } from "../../components/ui/States";
import { PrimaryButton } from "../../components/ui/PrimaryButton";

interface Target {
  eventId: string;
  mode?: "drill" | "real";
  status?: "active" | "closed";
  typeLabel: string;
  startedAt: string;
  closedAt: string | null;
  log: { id: string; status: "draft" | "completed"; version: number; updatedAt: string; updatedByName: string | null } | null;
}

export function DrillLogsPage({ schoolId }: { schoolId: string }) {
  const [data, setData] = useState<{ events: Target[]; canEdit: boolean; canEditReal?: boolean } | null>(null);
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
    <AppShell title="훈련일지·상황보고서" schoolId={schoolId}>
      <div className="mx-auto max-w-3xl space-y-4">
        <p className="rounded-control border border-line bg-card px-3 py-2 text-sm text-ink-muted">
          모의훈련은 <strong>비상대피훈련일지</strong>, 실제 재난은 같은 서식의 <strong>재난대피 상황보고서</strong>를 대피 보고·현장 제보로 자동 작성하고, 담당자가 확인·보완한 뒤
          한글(HWPX)·PDF(인쇄)로 출력합니다. 진행 중에는 작성 중 초안만, 최종본은 종료 후 만듭니다. 결재는 K-에듀파인에서 파일을 직접 첨부해 진행하세요(자동 상신 없음).
        </p>
        {!data && !err && <LoadingState label="훈련 기록을 불러오는 중…" />}
        {err && <ErrorState title={err.title} message={err.message} onRetry={() => void load()} />}
        {actionErr && <p role="alert" className="rounded-control border-2 border-danger bg-danger-soft px-3 py-2 font-semibold text-danger">{actionErr}</p>}
        {data &&
          (data.events.length === 0 ? (
            <EmptyState icon="file" title="재난·훈련 기록이 없습니다" message="상황판에서 모의훈련이나 실제 상황을 발령하면 여기에 나타납니다." />
          ) : (
            <ul className="space-y-3">
              {data.events.map((e) => (
                <li key={e.eventId} className="flex flex-wrap items-center gap-3 rounded-card border border-line bg-card p-4 shadow-card">
                  <div className="min-w-0 flex-1">
                    <p className="flex flex-wrap items-center gap-2 text-lg font-bold">
                      {e.mode === "real" ? (
                        <span className="rounded-md bg-danger px-2 py-0.5 text-sm font-extrabold text-white">실제 재난</span>
                      ) : (
                        <span className="rounded-md bg-warning-strong px-2 py-0.5 text-sm font-extrabold text-white">모의훈련</span>
                      )}
                      {e.typeLabel} {e.mode === "real" ? "재난대피 상황보고서" : "훈련일지"}
                      {e.status === "active" && <span className="rounded-full border border-warning px-2 py-0.5 text-sm font-bold text-warning-strong">진행 중</span>}
                      {e.log ? (
                        <span className={`rounded-full border px-2 py-0.5 text-sm font-bold ${e.log.status === "completed" ? "border-success bg-success-soft text-success" : "border-warning bg-warning-soft text-warning-strong"}`}>
                          {e.log.status === "completed" ? "작성 완료" : "작성 중"} · 판 {e.log.version}
                        </span>
                      ) : (
                        <span className="rounded-full border border-line-strong bg-neutral-soft px-2 py-0.5 text-sm font-bold text-neutral">{e.mode === "real" ? "보고서 없음" : "훈련일지 없음"}</span>
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
                  ) : (e.mode === "real" ? data.canEditReal : data.canEdit) ? (
                    <PrimaryButton loading={busy === e.eventId} loadingText="만드는 중…" disabled={!!busy} icon="file" onClick={() => void create(e.eventId)}>
                      {e.mode === "real" ? "상황보고서 만들기" : "훈련일지 만들기"}
                    </PrimaryButton>
                  ) : (
                    <span className="text-sm text-ink-muted">{e.mode === "real" ? "학교 관리자·안전업무 담당이 만들 수 있습니다" : "안전업무 담당이 만들 수 있습니다"}</span>
                  )}
                </li>
              ))}
            </ul>
          ))}
      </div>
    </AppShell>
  );
}
