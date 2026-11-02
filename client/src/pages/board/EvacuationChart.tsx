// 전교 대피 현황: 차트 하나에 전교 전체 행과 학년별 행(가로 누적 막대). 상황판이 받은 자료로 그려 새 API·폴링이 없습니다.
// 색만으로 구분하지 않도록 모든 값에 상태 이름과 숫자를 함께 씁니다. 학생 대피 완료율과 학급 보고율은 따로 표시합니다.
import { evacuationRateText, evacuationRows, type ClassReportView, type EvacuationRow } from "../../lib/disaster";
import { formatCount, formatTime } from "../../lib/format";
import { Icon } from "../../components/ui/Icon";
import type { Connection } from "./BoardView";

const PARTS = [
  { key: "evacuated", label: "대피 완료", bar: "bg-evac-done" },
  { key: "notEvacuated", label: "대피 미완료", bar: "bg-danger" },
  { key: "unknown", label: "확인되지 않음", bar: "bg-evac-unknown" },
] as const;

function Bar({ row, tall }: { row: EvacuationRow; tall: boolean }) {
  // 대상을 모르는 행도 막대 자리는 회색으로 두어 0%나 100%로 보이지 않게 합니다
  return (
    <div aria-hidden className={`mt-1 flex w-full gap-0.5 overflow-hidden rounded-control bg-neutral-soft ${tall ? "h-10" : "h-6"}`}>
      {PARTS.map((p) => row[p.key] > 0 && <div key={p.key} data-part={p.key} className={`${p.bar} min-w-1`} style={{ flexGrow: row[p.key], flexBasis: 0 }} />)}
    </div>
  );
}

function Row({ row, primary }: { row: EvacuationRow; primary: boolean }) {
  return (
    <li data-testid={`evac-row-${row.key}`} className={primary ? "rounded-control border-2 border-line-strong bg-page p-3" : "py-3"}>
      <div className="flex flex-wrap items-baseline justify-between gap-x-3">
        <h3 className={primary ? "text-xl font-extrabold" : "text-lg font-bold"}>{row.label}</h3>
        <p className={`tabular font-extrabold ${primary ? "text-2xl" : "text-lg"}`}>대피 완료율 {evacuationRateText(row)}</p>
      </div>
      <Bar row={row} tall={primary} />
      <ul className={`tabular mt-2 flex flex-wrap gap-x-4 gap-y-1 font-bold ${primary ? "text-lg" : "text-base"}`}>
        {PARTS.map((p) => (
          <li key={p.key} className="flex items-center gap-1.5">
            <span aria-hidden className={`size-3 shrink-0 rounded-sm ${p.bar}`} />
            {p.label} {formatCount(row[p.key])}명
          </li>
        ))}
      </ul>
      <p className="tabular mt-1 text-base text-ink-muted">
        대상 {formatCount(row.target)}명 · 학급 보고 {row.reportedClasses}/{row.totalClasses}
        {primary && ` · 재적 ${formatCount(row.enrolled)}명`}
        {row.absentKnown > 0 && ` · 사전 부재 ${formatCount(row.absentKnown)}명 제외`}
      </p>
      {row.enrolledUnknownClasses > 0 && <p className="mt-1 text-base font-bold text-warning-strong">재적을 모르는 미보고 학급 {row.enrolledUnknownClasses}곳 — 확인 필요</p>}
    </li>
  );
}

export function EvacuationChart({ classes, connection }: { classes: ClassReportView[]; connection: Connection }) {
  const rows = evacuationRows(classes);
  const [all, ...rest] = rows;
  return (
    <section aria-labelledby="evac-chart" className="rounded-card border border-line bg-card p-4 shadow-card">
      <div className="flex flex-wrap items-baseline justify-between gap-x-3">
        <h2 id="evac-chart" className="text-xl font-bold">전교 대피 현황</h2>
        <p className="tabular text-base font-semibold text-ink-muted">마지막 갱신 {connection.lastSuccessAt ? formatTime(connection.lastSuccessAt) : "없음"}</p>
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
          <ul className="mt-3">
            <Row row={all!} primary />
          </ul>
          {rest.length > 0 && (
            <ul className="mt-1 divide-y divide-line">
              {rest.map((r) => (
                <Row key={r.key} row={r} primary={false} />
              ))}
            </ul>
          )}
          <p className="mt-2 text-base text-ink-muted">대피 미완료는 학급 보고의 미확인 인원, 확인되지 않음은 아직 보고하지 않은 학급의 재적입니다. 미보고 학급은 완료나 미완료로 세지 않습니다.</p>
        </>
      )}
    </section>
  );
}
