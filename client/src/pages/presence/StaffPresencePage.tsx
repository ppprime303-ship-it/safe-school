// Beta PILOT 2 Phase 2-C: 교직원 소재 현황(실제 재난만 — 학생 대피 보고 집계와 별개 화면)
// - 승인 교직원 누구나: 개인을 알 수 없는 숫자 요약(서버가 요약만 보냄)
// - presence.detail(학교 관리자·교장·교감·안전업무 담당): 응답률, 미응답자 명단, 장소별, 개인별 소재·응답 시각·알림 확인
// - 모의훈련은 소재를 받지 않으므로 집계 없음(서버도 403)
import { useCallback, useEffect, useState } from "react";
import { AVAILABILITY_LABEL, LOCATION_LABEL, PLACE_LABEL } from "@shared/presence";
import { api, ApiError, describeError } from "../../lib/api";
import { formatCount, formatDateTime, formatTime, percent } from "../../lib/format";
import { can } from "../../lib/permissions";
import type { PresenceDetailResponse, PresenceSummaryResponse, StaffAlertItem } from "../../lib/presence";
import { useSession } from "../../lib/session";
import { AppShell } from "../../components/layout/AppShell";
import { EmptyState, ErrorState, LoadingState } from "../../components/ui/States";
import { StatCard } from "../../components/ui/StatCard";

const POLL_MS = 15_000;
const ROLE_LABEL: Record<string, string> = { admin: "관리자", homeroom: "담임", staff: "교직원" };

type Load =
  | { kind: "loading" }
  | { kind: "none" }
  | { kind: "drill" }
  | { kind: "error"; message: string }
  | { kind: "ready"; data: PresenceSummaryResponse | PresenceDetailResponse };

/** 표시 전용(테스트 가능): 서버 응답 범위(scope)에 있는 것만 그림 */
export function StaffPresenceView({ data }: { data: PresenceSummaryResponse | PresenceDetailResponse }) {
  const s = data.summary;
  return (
    <div className="space-y-5">
      <p className="rounded-control border border-line bg-page p-3 text-sm">
        <strong>교직원 소재</strong> 현황입니다(학생 대피 보고와 별개). 미응답은 '미응답'으로만 셉니다 — 교외나 안전으로 추정하지 않습니다.
        {data.eventStatus === "closed" && <strong className="ml-1">종료된 상황 · 조회만 가능</strong>}
      </p>
      <section aria-label="교직원 소재 요약" className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <StatCard label="응답" icon="users" value={formatCount(s.respondedCount)} unit={`/ ${s.targetCount}명`} progress={percent(s.respondedCount, s.targetCount)} sub={`응답률 ${percent(s.respondedCount, s.targetCount)}%`} />
        <StatCard label="미응답" icon="question" value={formatCount(s.notRespondedCount)} unit="명" tone={s.notRespondedCount > 0 ? "danger" : "success"} sub="추정하지 않음" />
        <StatCard label="교내 / 교외" icon="school" value={`${s.onCampus} / ${s.offCampus}`} unit="명" sub="응답한 교직원 기준" />
        <StatCard label="대피 지원 가능" icon="check-circle" value={formatCount(s.available)} unit="명" tone="success" sub={`불가 ${s.unavailable} · 확인 필요 ${s.unsure}`} />
      </section>
      <p className="tabular text-sm text-ink-muted">
        최근 응답 {s.latestRespondedAt ? formatTime(s.latestRespondedAt) : "없음"} · 앱에서 알림 확인 {s.alertsRead}/{s.targetCount}명(확인 ≠ 안전 확인)
      </p>

      {data.scope === "detail" && (
        <>
          <section aria-labelledby="not-responded" className="rounded-card border-2 border-danger bg-card p-4 shadow-card">
            <h2 id="not-responded" className="text-lg font-bold text-danger">
              미응답 {data.notResponded.length}명
            </h2>
            {data.notResponded.length === 0 ? (
              <p className="mt-1 text-base">모든 대상 교직원이 응답했습니다.</p>
            ) : (
              <ul className="mt-2 flex flex-wrap gap-2">
                {data.notResponded.map((p) => (
                  <li key={p.membershipId} className="rounded-full border border-line-strong px-3 py-1 text-base font-semibold">
                    {p.name}
                    <span className="ml-1 text-sm text-ink-muted">{p.alertReadAt ? "알림 확인함" : "알림 미확인"}</span>
                  </li>
                ))}
              </ul>
            )}
          </section>

          {data.byPlace.length > 0 && (
            <section aria-labelledby="by-place" className="rounded-card border border-line bg-card p-4 shadow-card">
              <h2 id="by-place" className="text-lg font-bold">
                교내 장소별
              </h2>
              <ul className="mt-2 flex flex-wrap gap-2">
                {data.byPlace.map((b) => (
                  <li key={b.placeCategory} className="rounded-control bg-page px-3 py-1 text-base font-semibold">
                    {PLACE_LABEL[b.placeCategory]} {b.count}명
                  </li>
                ))}
              </ul>
            </section>
          )}

          <section aria-labelledby="people" className="rounded-card border border-line bg-card p-4 shadow-card">
            <h2 id="people" className="text-lg font-bold">
              개인별 소재
            </h2>
            <div className="mt-2 overflow-x-auto">
              <table className="w-full min-w-[36rem] text-left text-base">
                <thead className="text-sm text-ink-muted">
                  <tr>
                    <th className="py-1 pr-2">성명</th>
                    <th className="py-1 pr-2">소재</th>
                    <th className="py-1 pr-2">대피 지원</th>
                    <th className="py-1 pr-2">응답 시각</th>
                    <th className="py-1">알림</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-line">
                  {data.people.map((p) => (
                    <tr key={p.membershipId}>
                      <td className="py-2 pr-2 font-bold">
                        {p.name} <span className="text-sm font-normal text-ink-muted">{ROLE_LABEL[p.role] ?? p.role}</span>
                      </td>
                      <td className="py-2 pr-2">{p.presence ? (p.presence.location === "on_campus" ? `${LOCATION_LABEL.on_campus} · ${p.presence.placeLabel}` : LOCATION_LABEL.off_campus) : <span className="font-bold text-danger">미응답</span>}</td>
                      <td className="py-2 pr-2">{p.presence ? AVAILABILITY_LABEL[p.presence.availability] : "–"}</td>
                      <td className="tabular py-2 pr-2">{p.presence ? formatDateTime(p.presence.respondedAt) : "–"}</td>
                      <td className="py-2 text-sm">{p.alertReadAt ? `확인 ${formatTime(p.alertReadAt)}` : "미확인"}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            {data.excludedResponses > 0 && <p className="mt-2 text-sm text-ink-muted">소속 회수·비활성으로 집계에서 뺀 응답 {data.excludedResponses}건(기록은 보존)</p>}
          </section>
        </>
      )}
    </div>
  );
}

export function StaffPresencePage({ schoolId }: { schoolId: string }) {
  const { usableMemberships } = useSession();
  const membership = usableMemberships.find((m) => m.school.id === schoolId) ?? null;
  const detail = can(membership, "presence.detail");
  const [load, setLoad] = useState<Load>({ kind: "loading" });
  const [eventId, setEventId] = useState<string | null>(() => new URLSearchParams(window.location.search).get("event"));

  const fetchData = useCallback(async () => {
    try {
      let id = eventId;
      if (!id) {
        // 사건을 지정하지 않으면 진행 중이거나 가장 최근의 실제 재난
        const { alerts } = await api<{ alerts: StaffAlertItem[] }>("GET", `/schools/${schoolId}/staff-alerts`);
        const real = alerts.filter((a) => a.event.mode === "real");
        id = (real.find((a) => a.event.status === "active") ?? real[0])?.event.id ?? null;
        if (!id) {
          setLoad(alerts.some((a) => a.event.status === "active") ? { kind: "drill" } : { kind: "none" });
          return;
        }
        setEventId(id);
      }
      const path = `/schools/${schoolId}/events/${id}/presence${detail ? "" : "/summary"}`;
      setLoad({ kind: "ready", data: await api<PresenceSummaryResponse | PresenceDetailResponse>("GET", path) });
    } catch (e) {
      if (e instanceof ApiError && e.code === "presence_not_collected_for_drill") setLoad({ kind: "drill" });
      else setLoad({ kind: "error", message: describeError(e).message });
    }
  }, [schoolId, eventId, detail]);

  useEffect(() => {
    void fetchData();
    const id = window.setInterval(() => void fetchData(), POLL_MS);
    return () => window.clearInterval(id);
  }, [fetchData]);

  return (
    <AppShell title="교직원 소재 현황" schoolId={schoolId}>
      {load.kind === "loading" && <LoadingState />}
      {load.kind === "error" && <ErrorState message={load.message} onRetry={() => void fetchData()} />}
      {load.kind === "none" && <EmptyState icon="info" title="실제 재난 소재 보고가 없습니다" message="교직원 소재는 실제 재난에서만 받습니다." />}
      {load.kind === "drill" && <EmptyState icon="info" title="모의훈련에서는 교직원 소재를 받지 않습니다" message="훈련 안내 알림 확인만 기록합니다. 학생 대피 현황은 상황판에서 확인하세요." />}
      {load.kind === "ready" && <StaffPresenceView data={load.data} />}
    </AppShell>
  );
}
