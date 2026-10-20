// 핵심 수치 카드: 숫자는 크게(28~36px, 800), 단위·설명은 작게. 위험 수치는 색과 아이콘으로 강조.
import type { ReactNode } from "react";
import { Icon, type IconName } from "./Icon";

type Tone = "default" | "danger" | "warning" | "success" | "neutral";

const TONE: Record<Tone, { box: string; value: string }> = {
  default: { box: "border-line bg-card", value: "text-ink" },
  danger: { box: "border-danger bg-danger-soft", value: "text-danger" },
  warning: { box: "border-warning bg-warning-soft", value: "text-warning-strong" },
  success: { box: "border-line bg-card", value: "text-success" },
  neutral: { box: "border-line bg-card", value: "text-neutral" },
};

export function StatCard({
  label,
  value,
  unit,
  sub,
  tone = "default",
  icon,
  progress,
}: {
  label: string;
  value: ReactNode;
  unit?: string;
  sub?: ReactNode;
  tone?: Tone;
  icon?: IconName;
  /** 0~100: 막대 표시(예: 보고 진행률) */
  progress?: number;
}) {
  const t = TONE[tone];
  return (
    <div className={`rounded-card border-2 p-4 shadow-card ${t.box}`}>
      <div className="flex items-center gap-1.5 text-base font-bold text-ink-muted">
        {icon && <Icon name={icon} size={18} />}
        <span>{label}</span>
      </div>
      <div className={`tabular mt-1 flex flex-wrap items-baseline gap-x-1 ${t.value}`}>
        <span className="text-[2rem] leading-tight font-extrabold sm:text-[2.25rem]">{value}</span>
        {unit && <span className="text-lg font-bold whitespace-nowrap">{unit}</span>}
      </div>
      {progress !== undefined && (
        <div
          className="mt-2 h-2.5 overflow-hidden rounded-full bg-neutral-soft"
          role="progressbar"
          aria-valuemin={0}
          aria-valuemax={100}
          aria-valuenow={progress}
          aria-label={`${label} ${progress}%`}
        >
          <div className="h-full bg-accent" style={{ width: `${Math.min(100, Math.max(0, progress))}%` }} />
        </div>
      )}
      {sub && <div className="mt-1.5 text-sm font-medium text-ink-muted">{sub}</div>}
    </div>
  );
}
