// 전교 대피 현황: 차트 하나에 전교 전체와 학년별 세로 100% 누적 막대. 상황판이 받은 자료로 그려 새 API·폴링이 없습니다.
// 색만으로 구분하지 않도록 값마다 상태 이름과 숫자를 함께 씁니다. 학생 대피 완료율과 학급 보고율은 따로 표시합니다.
// 대피 미확인은 학급 보고의 미확인 인원이며 대피 실패를 뜻하지 않습니다.
import { evacuationRateText, evacuationRows, type ClassReportView, type EvacuationRow } from "../../lib/disaster";
import { formatCount, formatTime } from "../../lib/format";
import { Icon } from "../../components/ui/Icon";
import type { Connection } from "./BoardView";

// 아래부터 쌓임(완료가 바닥). short 는 좁은 칸의 수치 줄, label 은 범례·낭독용
const PARTS = [
  { key: "evacuated", label: "대피 완료", short: "완료", bar: "bg-evac-done" },
  { key: "notEvacuated", label: "대피 미확인", short: "미확인", bar: "bg-danger" },
  { key: "unknown", label: "확인되지 않음", short: "미보고", bar: "bg-evac-unknown" },
] as const;

/** 대상 인원을 믿을 수 없어 막대가 100%로 보이면 안 되는 행 */
const isPartial = (row: EvacuationRow) => row.enrolledUnknownClasses > 0 || row.target === 0;

function Bar({ row, className }: { row: EvacuationRow; className: string }) {
  const partial = isPartial(row);
  return (
    <div aria-hidden className={`flex flex-col-reverse gap-0.5 overflow-hidden rounded-control bg-neutral-soft ${partial ? "border-2 border-dashed border-line-strong" : ""} ${className}`}>
      {PARTS.map((p) => row[p.key] > 0 && <div key={p.key} data-part={p.key} className={`${p.bar} min-h-1`} style={{ flexGrow: row[p.key], flexBasis: 0 }} />)}
      {/* 재적을 모르는 부분: 크기를 알 수 없어 일정한 빈칸으로 둠(확정 수치처럼 차 보이지 않게) */}
      {partial && <div data-part="unmeasured" className="min-h-4 flex-[0_0_30%]" />}
    </div>
  );
}

const describe = (row: EvacuationRow) =>
  `${row.label}: 대피 완료율 ${evacuationRateText(row)}, ${PARTS.map((p) => `${p.label} ${formatCount(row[p.key])}명`).join(", ")}, 대상 ${formatCount(row.target)}명, 학급 보고 ${row.reportedClasses}/${row.totalClasses}` +
  `${row.absentKnown > 0 ? `, 사전 부재 ${formatCount(row.absentKnown)}명 제외` : ""}${row.key === "all" ? `, 재적 ${formatCount(row.enrolled)}명` : ""}${row.enrolledUnknownClasses > 0 ? `, 재적을 모르는 미보고 학급 ${row.enrolledUnknownClasses}곳` : ""}`;

function Numbers({ row }: { row: EvacuationRow }) {
  return (
    <div className="tabular min-w-0 text-sm">
      <ul className="space-y-0.5 text-base font-bold">
        {PARTS.map((p) => (
          <li key={p.key} className="flex items-center gap-1 whitespace-nowrap">
            <span className={`size-2.5 shrink-0 rounded-sm ${p.bar}`} />
            {p.short} {formatCount(row[p.key])}
          </li>
        ))}
      </ul>
      <p className="mt-1 flex flex-wrap gap-x-2 text-ink-muted">
        <span className="whitespace-nowrap">대상 {formatCount(row.target)}</span>
        <span className="whitespace-nowrap">보고 {row.reportedClasses}/{row.totalClasses}</span>
      </p>
      {row.absentKnown > 0 && <p className="text-ink-muted">사전 부재 {formatCount(row.absentKnown)}</p>}
      {row.enrolledUnknownClasses > 0 && <p className="font-bold text-warning-strong">재적 미상 {row.enrolledUnknownClasses}학급 · 일부 집계</p>}
    </div>
  );
}

function Column({ row }: { row: EvacuationRow }) {
  const primary = row.key === "all";
  return (
    <li data-testid={`evac-row-${row.key}`} className={primary ? "col-span-3 flex items-center gap-3 rounded-control border-2 border-line-strong bg-page p-2 sm:col-span-6 lg:flex-[1.35] lg:flex-col lg:items-stretch lg:gap-1" : "min-w-0 lg:flex-1"}>
      <p className="sr-only">{describe(row)}</p>
      <div aria-hidden className={primary ? "w-20 shrink-0 lg:w-auto" : ""}>
        <p className={`tabular text-center font-extrabold leading-tight ${primary ? "text-xl" : "text-lg"}`}>{evacuationRateText(row)}</p>
        <Bar row={row} className={`mx-auto mt-1 ${primary ? "h-24 w-16" : "h-20 w-12"}`} />
        <h3 className={`mt-1 text-center font-bold ${primary ? "text-base" : "text-base"}`}>{row.label}</h3>
      </div>
      <div aria-hidden className={primary ? "min-w-0 flex-1" : "mt-1"}>
        <Numbers row={row} />
        {primary && <p className="tabular text-sm text-ink-muted">재적 {formatCount(row.enrolled)}</p>}
      </div>
    </li>
  );
}

export function EvacuationChart({ classes, connection }: { classes: ClassReportView[]; connection: Connection }) {
  const rows = evacuationRows(classes);
  return (
    <section aria-labelledby="evac-chart" className="rounded-card border border-line bg-card p-3 shadow-card">
      <div className="flex flex-wrap items-baseline justify-between gap-x-3">
        <h2 id="evac-chart" className="text-xl font-bold">전교 대피 현황</h2>
        <ul aria-hidden className="flex flex-wrap gap-x-3 text-sm font-semibold">
          {PARTS.map((p) => (
            <li key={p.key} className="flex items-center gap-1">
              <span className={`size-3 rounded-sm ${p.bar}`} />
              {p.label}{p.key === "unknown" ? "(미보고 학급 재적)" : ""}
            </li>
          ))}
        </ul>
        <p className="tabular text-sm font-semibold text-ink-muted">마지막 갱신 {connection.lastSuccessAt ? formatTime(connection.lastSuccessAt) : "없음"}</p>
      </div>
      {connection.failing && (
        <p role="alert" className="mt-2 flex items-center gap-2 rounded-control border-2 border-danger bg-danger-soft px-3 py-2 text-base font-bold text-danger">
          <Icon name="wifi-off" size={20} /> 연결 끊김 — 아래 수치는 마지막 갱신 기준입니다.
        </p>
      )}
      {classes.length === 0 ? (
        <p className="mt-3 text-base text-ink-muted">등록된 학급이 없어 집계할 수 없습니다.</p>
      ) : (
        <>
          <ul className="mt-2 grid grid-cols-3 gap-x-2 gap-y-3 sm:grid-cols-6 lg:flex lg:items-start lg:gap-2">
            {rows.map((r) => (
              <Column key={r.key} row={r} />
            ))}
          </ul>
          <p className="mt-2 text-sm text-ink-muted">숫자는 사람 수입니다. 막대 위 값은 학생 대피 완료율이며 학급 보고율(보고 n/m)과 다릅니다. 대피 미확인은 대피 실패를 뜻하지 않으며, 미보고 학급은 완료나 미확인으로 세지 않습니다.</p>
        </>
      )}
    </section>
  );
}
