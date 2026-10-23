// STEP 3-C 학교 안내문 목록: 경보함에서 진입(메뉴 추가 없음). ?alert=<경보 ID> 로 한 경보의 안내문만 볼 수 있습니다.
import { useCallback, useEffect, useState } from "react";
import { api, describeError } from "../../lib/api";
import { NOTICE_STATUS_META, type NoticeSummary } from "../../lib/notices";
import { formatDateTime } from "../../lib/format";
import { Link } from "../../lib/router";
import { AppShell } from "../../components/layout/AppShell";
import { EmptyState, ErrorState, LoadingState } from "../../components/ui/States";
import { NOTICE_GUIDE_TEXT } from "@shared/noticeExamples";

type Load = { kind: "loading" } | { kind: "error"; title: string; message: string } | { kind: "ready"; notices: NoticeSummary[] };

export function NoticesPage({ schoolId }: { schoolId: string }) {
  const [alertId] = useState(() => new URLSearchParams(window.location.search).get("alert"));
  const [load, setLoad] = useState<Load>({ kind: "loading" });

  const fetchList = useCallback(async () => {
    try {
      const q = alertId ? `?alertId=${encodeURIComponent(alertId)}` : "";
      const data = await api<{ notices: NoticeSummary[] }>("GET", `/schools/${schoolId}/notices${q}`);
      setLoad({ kind: "ready", notices: data.notices });
    } catch (e) {
      const d = describeError(e);
      setLoad({ kind: "error", title: d.title, message: d.message });
    }
  }, [schoolId, alertId]);
  useEffect(() => {
    void fetchList();
  }, [fetchList]);

  return (
    <AppShell title="학교 안내문" schoolId={schoolId}>
      <div className="mx-auto max-w-2xl space-y-4">
        <p className="rounded-control border border-line bg-card px-3 py-2 text-sm text-ink-muted">{NOTICE_GUIDE_TEXT.feature}</p>
        <div className="flex flex-wrap items-center justify-between gap-2">
          <h2 className="text-lg font-bold">{alertId ? "이 경보의 안내문" : "작성한 안내문"}</h2>
          <div className="flex gap-3 text-base font-bold">
            {alertId && (
              <Link href={`/s/${schoolId}/notices`} className="inline-flex min-h-touch items-center text-accent underline underline-offset-4">
                전체 보기
              </Link>
            )}
            <Link href={`/s/${schoolId}/alerts`} className="inline-flex min-h-touch items-center text-accent underline underline-offset-4">
              경보함으로
            </Link>
          </div>
        </div>
        <p className="text-sm text-ink-muted">새 안내문은 경보함에서 경보를 열고 '안내문 작성'을 눌러 만듭니다.</p>

        {load.kind === "loading" && <LoadingState label="안내문을 불러오는 중…" />}
        {load.kind === "error" && <ErrorState title={load.title} message={load.message} onRetry={() => void fetchList()} />}
        {load.kind === "ready" &&
          (load.notices.length === 0 ? (
            <EmptyState icon="file" title="작성한 안내문이 없습니다" message="경보함에서 우리 학교 대상 경보를 열어 안내문을 작성하세요." />
          ) : (
            <ul className="space-y-3">
              {load.notices.map((n) => {
                const st = NOTICE_STATUS_META[n.status];
                return (
                  <li key={n.id}>
                    <Link
                      href={`/s/${schoolId}/notices/${n.id}`}
                      className={`block rounded-card border bg-card p-4 shadow-card hover:border-brand ${n.status === "cancelled" ? "border-line opacity-80" : "border-line"}`}
                    >
                      <div className="flex flex-wrap items-center gap-1.5">
                        <span className={`rounded-full px-2 py-0.5 text-sm font-bold ${st.badge}`}>{st.label}</span>
                        {n.sourceNoticeId && <span className="rounded-full bg-brand-soft px-2 py-0.5 text-sm font-bold text-brand">취소본에서 다시 만듦</span>}
                        {n.alert.isMock && <span className="rounded-full border-2 border-dashed border-warning px-2 py-0.5 text-sm font-bold text-warning-strong">모의 경보</span>}
                        <span className="text-sm text-ink-muted">판 {n.version}</span>
                      </div>
                      <p className={`mt-2 text-lg font-bold ${n.status === "cancelled" ? "line-through decoration-1" : ""}`}>{n.title}</p>
                      <p className="mt-1 text-sm text-ink-muted">
                        연결 경보: {n.alert.title} · 발령 {formatDateTime(n.alert.issuedAt)}
                      </p>
                      <p className="text-sm text-ink-muted">
                        작성 {n.createdByName ?? "(알 수 없음)"} · 최근 저장 {formatDateTime(n.updatedAt)}
                        {n.updatedByName && n.updatedByName !== n.createdByName ? ` (${n.updatedByName})` : ""}
                      </p>
                    </Link>
                  </li>
                );
              })}
            </ul>
          ))}
      </div>
    </AppShell>
  );
}
