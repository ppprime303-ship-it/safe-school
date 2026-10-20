// 공통 상태 화면: 불러오는 중 / 오류(다시 시도) / 비어 있음
import type { ReactNode } from "react";
import { Icon, type IconName } from "./Icon";
import { PrimaryButton } from "./PrimaryButton";

export function LoadingState({ label = "불러오는 중…" }: { label?: string }) {
  return (
    <div role="status" aria-live="polite" className="flex items-center justify-center gap-3 py-12 text-lg font-semibold text-ink-muted">
      <span className="size-6 animate-spin rounded-full border-[3px] border-accent border-r-transparent" aria-hidden />
      {label}
    </div>
  );
}

export function ErrorState({
  title = "문제가 발생했습니다",
  message,
  onRetry,
  retrying = false,
  icon = "alert",
}: {
  title?: string;
  message: string;
  onRetry?: () => void;
  retrying?: boolean;
  icon?: IconName;
}) {
  return (
    <div role="alert" className="rounded-card border-2 border-danger bg-danger-soft p-5">
      <div className="flex items-start gap-3 text-danger">
        <Icon name={icon} size={26} />
        <div className="text-ink">
          <h2 className="text-lg font-bold text-danger">{title}</h2>
          <p className="mt-1 text-base">{message}</p>
        </div>
      </div>
      {onRetry && (
        <PrimaryButton className="mt-4" variant="secondary" icon="refresh" onClick={onRetry} loading={retrying} loadingText="다시 시도하는 중…">
          다시 시도
        </PrimaryButton>
      )}
    </div>
  );
}

export function EmptyState({ title, message, icon = "info", action }: { title: string; message?: ReactNode; icon?: IconName; action?: ReactNode }) {
  return (
    <div className="rounded-card border-2 border-dashed border-line-strong bg-card p-6 text-center">
      <div className="mx-auto flex size-12 items-center justify-center rounded-full bg-brand-soft text-brand">
        <Icon name={icon} size={26} />
      </div>
      <h2 className="mt-3 text-lg font-bold">{title}</h2>
      {message && <div className="mt-1 text-base text-ink-muted">{message}</div>}
      {action && <div className="mt-4 flex justify-center">{action}</div>}
    </div>
  );
}

/** 저장 상태 표시: 저장 중 / 저장됨 / 저장 실패 / 미전송(통신 장애) */
export type SaveState = { kind: "idle" } | { kind: "saving" } | { kind: "saved"; at: string } | { kind: "failed"; message: string } | { kind: "queued"; message: string };

export function SaveStatus({ state }: { state: SaveState }) {
  if (state.kind === "idle") return null;
  const map = {
    saving: { cls: "border-brand bg-brand-soft text-brand", icon: "clock" as const, text: "저장 중… 화면을 닫지 마세요" },
    saved: { cls: "border-success bg-success-soft text-success", icon: "check-circle" as const, text: "" },
    failed: { cls: "border-danger bg-danger-soft text-danger", icon: "alert" as const, text: "" },
    queued: { cls: "border-warning bg-warning-soft text-warning-strong", icon: "wifi-off" as const, text: "" },
  }[state.kind];
  const text =
    state.kind === "saved"
      ? `서버 저장 완료 · ${state.at}`
      : state.kind === "failed"
        ? `저장 실패 — ${state.message}`
        : state.kind === "queued"
          ? `미전송 — ${state.message}`
          : map.text;
  return (
    <div role="status" aria-live="polite" className={`flex items-center gap-2 rounded-control border-2 px-3 py-2.5 text-base font-bold ${map.cls}`}>
      <Icon name={map.icon} size={22} />
      <span>{text}</span>
    </div>
  );
}
