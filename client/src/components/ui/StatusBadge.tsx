// 학급 상태 배지: 색상 + 상태명 + 아이콘(색만으로 구분하지 않음). 미보고는 중립 회색 + 시계 아이콘.
import type { ClassStatus } from "../../lib/disaster";
import { Icon, type IconName } from "./Icon";

export const CLASS_STATUS_META: Record<ClassStatus, { label: string; icon: IconName; badge: string; card: string }> = {
  unreported: {
    label: "미보고",
    icon: "clock",
    badge: "bg-neutral-soft text-neutral border-neutral",
    card: "border-neutral border-dashed bg-card",
  },
  unconfirmed: {
    label: "미확인 인원 있음",
    icon: "question",
    badge: "bg-danger text-white border-danger",
    card: "border-danger bg-danger-soft",
  },
  injured: {
    label: "부상자 있음",
    icon: "medical",
    badge: "bg-warning text-white border-warning",
    card: "border-warning bg-warning-soft",
  },
  reported: {
    label: "보고 완료",
    icon: "check-circle",
    badge: "bg-success-soft text-success border-success",
    card: "border-line bg-card",
  },
};

export function StatusBadge({ status, size = "md" }: { status: ClassStatus; size?: "sm" | "md" }) {
  const meta = CLASS_STATUS_META[status];
  return (
    <span
      className={`inline-flex items-center gap-1 rounded-full border font-bold whitespace-nowrap ${meta.badge} ${size === "sm" ? "px-2 py-0.5 text-sm" : "px-3 py-1 text-base"}`}
    >
      <Icon name={meta.icon} size={size === "sm" ? 16 : 18} />
      {meta.label}
    </span>
  );
}

// 일반 용도 배지(소속 상태 등)
const TONE = {
  neutral: "bg-neutral-soft text-neutral border-neutral",
  info: "bg-brand-soft text-brand border-brand",
  success: "bg-success-soft text-success border-success",
  warning: "bg-warning-soft text-warning-strong border-warning",
  danger: "bg-danger-soft text-danger border-danger",
} as const;

export function Badge({ tone = "neutral", icon, children }: { tone?: keyof typeof TONE; icon?: IconName; children: string }) {
  return (
    <span className={`inline-flex items-center gap-1 rounded-full border px-2.5 py-0.5 text-sm font-bold ${TONE[tone]}`}>
      {icon && <Icon name={icon} size={16} />}
      {children}
    </span>
  );
}
