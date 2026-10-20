// 관리자 상황판(표시 전용). 가장 중요한 수치를 맨 위에, 위험한 학급을 먼저 보여 줍니다.
import { useMemo, useState } from "react";
import { deriveClassStatus, summarizeBoard, type BoardData, type ClassStatus } from "../../lib/disaster";
import { formatCount, formatTime } from "../../lib/format";
import { ClassStatusCard } from "../../components/ui/ClassStatusCard";
import { Icon } from "../../components/ui/Icon";
import { PrimaryButton } from "../../components/ui/PrimaryButton";
import { StatCard } from "../../components/ui/StatCard";
import { CLASS_STATUS_META } from "../../components/ui/StatusBadge";

export interface Connection {
  lastSuccessAt: Date | null;
  failing: boolean;
  message?: string;
}

type Filter = "all" | ClassStatus;
// 위험한 상태가 먼저 오도록 정렬
const ORDER: Record<ClassStatus, number> = { unconfirmed: 0, injured: 1, unreported: 2, reported: 3 };

export function ConnectionStatus({ connection }: { connection: Connection }) {
  const last = connection.lastSuccessAt ? formatTime(connection.lastSuccessAt) : "없음";
  if (connection.failing) {
    return (
      <div role="alert" className="flex flex-wrap items-center gap-2 rounded-control border-2 border-danger bg-danger-soft px-3 py-2 text-base font-bold text-danger">
        <Icon name="wifi-off" size={22} />
        연결 끊김 — 화면의 숫자는 {last} 기준입니다. 자동으로 다시 연결 중…
        {connection.message && <span className="font-medium">({connection.message})</span>}
      </div>
    );
  }
  return (
    <p className="tabular flex items-center gap-1.5 text-base font-semibold text-ink-muted" aria-live="off">
      <span className="size-2.5 rounded-full bg-accent" aria-hidden />
      실시간 연결 · 마지막 갱신 {last}
    </p>
  );
}

export function BoardView({
  data,
  connection,
  onCloseEvent,
}: {
  data: BoardData;
  connection: Connection;
  onCloseEvent?: () => void;
}) {
  const [filter, setFilter] = useState<Filter>("all");
  const s = useMemo(() => summarizeBoard(data.classes), [data.classes]);

  const counts = useMemo(() => {
    const c: Record<ClassStatus, number> = { unreported: 0, unconfirmed: 0, injured: 0, reported: 0 };
    for (const v of data.classes) c[deriveClassStatus(v)]++;
    return c;
  }, [data.classes]);

  const grades = useMemo(() => {
    const filtered = data.classes
      .filter((c) => filter === "all" || deriveClassStatus(c) === filter)
      .sort((a, b) => a.grade - b.grade || a.classNo - b.classNo);
    const map = new Map<number, typeof filtered>();
    for (const c of filtered) map.set(c.grade, [...(map.get(c.grade) ?? []), c]);
    return [...map.entries()];
  }, [data.classes, filter]);

  const urgent = useMemo(
    () => data.classes.filter((c) => ["unconfirmed", "injured"].includes(deriveClassStatus(c))).sort((a, b) => ORDER[deriveClassStatus(a)] - ORDER[deriveClassStatus(b)]),
    [data.classes],
  );

  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <ConnectionStatus connection={connection} />
        {onCloseEvent && (
          <PrimaryButton variant="secondary" icon="x" onClick={onCloseEvent}>
            상황 종료
          </PrimaryButton>
        )}
      </div>

      {/* 핵심 수치 */}
      <section aria-label="핵심 수치" className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <StatCard
          label="미확인 인원"
          icon="question"
          value={formatCount(s.unconfirmed)}
          unit="명"
          tone={s.unconfirmed > 0 ? "danger" : "default"}
          sub={s.unconfirmed > 0 ? `${s.classesWithUnconfirmed}개 학급 — 즉시 확인 필요` : "보고된 학급 기준 0명"}
        />
        <StatCard
          label="미보고 학급"
          icon="clock"
          value={formatCount(s.unreportedClasses)}
          unit={`/ ${s.totalClasses}`}
          tone={s.unreportedClasses > 0 ? "neutral" : "success"}
          sub={`보고 대기 인원 ${formatCount(s.pendingStudents)}명${s.enrolledUnknownClasses > 0 ? ` · 재적 미확인 ${s.enrolledUnknownClasses}학급` : ""}`}
        />
        <StatCard
          label="부상자"
          icon="medical"
          value={formatCount(s.injured)}
          unit="명"
          tone={s.injured > 0 ? "warning" : "default"}
          sub={s.injured > 0 ? `${s.classesWithInjured}개 학급` : "보고된 학급 기준"}
        />
        <StatCard
          label="대피 확인"
          icon="users"
          value={formatCount(s.evacuated)}
          unit={`/ ${formatCount(s.enrolledTotal)}명`}
          tone="success"
          progress={s.reportProgress}
          sub={`학급 보고 ${s.reportProgress}% · 사전 부재 ${formatCount(s.absentKnown)}명`}
        />
      </section>

      {/* 위급 학급 우선 목록 */}
      {urgent.length > 0 && (
        <section aria-labelledby="urgent" className="rounded-card border-2 border-danger bg-card p-4">
          <h2 id="urgent" className="flex items-center gap-2 text-lg font-bold text-danger">
            <Icon name="alert" size={22} /> 확인이 필요한 학급 {urgent.length}곳
          </h2>
          <ul className="mt-2 divide-y divide-line">
            {urgent.map((c) => (
              <li key={c.classId} className="flex flex-wrap items-center justify-between gap-2 py-2 text-base">
                <span className="font-bold">{c.label}</span>
                <span className="tabular font-semibold">
                  {c.report!.unconfirmed > 0 && <span className="text-danger">미확인 {c.report!.unconfirmed}명</span>}
                  {c.report!.unconfirmed > 0 && c.report!.injured > 0 && " · "}
                  {c.report!.injured > 0 && <span className="text-warning-strong">부상 {c.report!.injured}명</span>}
                  {c.report!.note && <span className="text-ink-muted"> · {c.report!.note}</span>}
                </span>
              </li>
            ))}
          </ul>
        </section>
      )}

      {/* 학급별 상태 */}
      <section aria-labelledby="classes">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <h2 id="classes" className="text-xl font-bold">
            학급별 상태
          </h2>
          <div role="group" aria-label="상태로 거르기" className="flex flex-wrap gap-2">
            {(["all", "unconfirmed", "injured", "unreported", "reported"] as Filter[]).map((f) => (
              <button
                key={f}
                type="button"
                aria-pressed={filter === f}
                onClick={() => setFilter(f)}
                className={`min-h-touch rounded-full border-2 px-3 text-base font-bold ${filter === f ? "border-brand bg-brand text-white" : "border-line-strong bg-card text-ink"}`}
              >
                {f === "all" ? `전체 ${data.classes.length}` : `${CLASS_STATUS_META[f].label} ${counts[f]}`}
              </button>
            ))}
          </div>
        </div>
        {grades.length === 0 && <p className="mt-3 text-base text-ink-muted">해당 상태의 학급이 없습니다.</p>}
        {grades.map(([grade, list]) => (
          <div key={grade} className="mt-4">
            <h3 className="text-base font-bold text-ink-muted">{grade}학년</h3>
            <div className="mt-2 grid grid-cols-1 gap-3 sm:grid-cols-2 xl:grid-cols-3">
              {list.map((c) => (
                <ClassStatusCard key={c.classId} view={c} />
              ))}
            </div>
          </div>
        ))}
      </section>
    </div>
  );
}
