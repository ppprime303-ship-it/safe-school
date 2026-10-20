// 학급 상태 카드(상황판): 상태 배지 + 핵심 숫자 + 마지막 보고 시각
import { deriveClassStatus, type ClassReportView } from "../../lib/disaster";
import { formatTime } from "../../lib/format";
import { CLASS_STATUS_META, StatusBadge } from "./StatusBadge";

export function ClassStatusCard({ view, onSelect }: { view: ClassReportView; onSelect?: (view: ClassReportView) => void }) {
  const status = deriveClassStatus(view);
  const meta = CLASS_STATUS_META[status];
  const r = view.report;
  const body = (
    <>
      <div className="flex items-start justify-between gap-2">
        <h3 className="text-lg font-bold">{view.label}</h3>
        <StatusBadge status={status} size="sm" />
      </div>
      {r ? (
        <dl className="tabular mt-2 grid grid-cols-3 gap-1 text-center">
          <div>
            <dt className="text-sm text-ink-muted">대피 확인</dt>
            <dd className="text-xl font-extrabold">
              {r.evacuated}
              <span className="text-sm font-semibold text-ink-muted">/{r.enrolledCount}</span>
            </dd>
          </div>
          <div>
            <dt className="text-sm text-ink-muted">미확인</dt>
            <dd className={`text-xl font-extrabold ${r.unconfirmed > 0 ? "text-danger" : ""}`}>{r.unconfirmed}</dd>
          </div>
          <div>
            <dt className="text-sm text-ink-muted">부상</dt>
            <dd className={`text-xl font-extrabold ${r.injured > 0 ? "text-warning-strong" : ""}`}>{r.injured}</dd>
          </div>
        </dl>
      ) : (
        <p className="mt-2 text-base font-semibold text-neutral">
          보고 대기 · 재적 {view.enrolledCount ?? "미확인"}
          {view.enrolledCount !== null && "명"}
        </p>
      )}
      <p className="mt-2 text-sm text-ink-muted">
        {r ? `최근 보고 ${formatTime(r.reportedAt)}${r.reporterName ? ` · ${r.reporterName}` : ""}${r.absentKnown > 0 ? ` · 사전 부재 ${r.absentKnown}` : ""}` : "아직 보고되지 않았습니다"}
      </p>
      {r?.note && <p className="mt-1 line-clamp-2 text-sm font-medium">메모: {r.note}</p>}
    </>
  );
  const className = `block w-full rounded-card border-2 p-3 text-left shadow-card ${meta.card}`;
  return onSelect ? (
    <button type="button" className={`${className} hover:outline hover:outline-2 hover:outline-accent`} onClick={() => onSelect(view)}>
      {body}
    </button>
  ) : (
    <article className={className}>{body}</article>
  );
}
