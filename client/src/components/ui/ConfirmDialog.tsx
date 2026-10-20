// 최종 확인 창: 실제 발령·외부 발송·삭제·상황 종료처럼 되돌리기 어려운 작업에만 씁니다.
// 실제 상황 발령처럼 위험도가 높으면 confirmPhrase(예: "실제")를 입력해야 확인 버튼이 켜집니다.
import { useEffect, useId, useRef, useState, type ReactNode } from "react";
import { PrimaryButton } from "./PrimaryButton";

export function ConfirmDialog({
  open,
  title,
  children,
  confirmLabel,
  cancelLabel = "취소",
  tone = "danger",
  confirmPhrase,
  loading = false,
  onConfirm,
  onCancel,
}: {
  open: boolean;
  title: string;
  children: ReactNode;
  confirmLabel: string;
  cancelLabel?: string;
  tone?: "danger" | "primary";
  confirmPhrase?: string;
  loading?: boolean;
  onConfirm: () => void;
  onCancel: () => void;
}) {
  const ref = useRef<HTMLDialogElement>(null);
  const [typed, setTyped] = useState("");
  const titleId = useId();

  useEffect(() => {
    const dialog = ref.current;
    if (!dialog) return;
    if (open && !dialog.open) {
      setTyped("");
      dialog.showModal(); // 초점 가두기·Esc 닫기는 브라우저 기본 동작 사용
    } else if (!open && dialog.open) {
      dialog.close();
    }
  }, [open]);

  const ready = !confirmPhrase || typed.trim() === confirmPhrase;
  return (
    <dialog
      ref={ref}
      aria-labelledby={titleId}
      onCancel={(e) => {
        e.preventDefault();
        if (!loading) onCancel();
      }}
      className="m-auto w-[min(92vw,28rem)] rounded-card border-0 bg-card p-0 text-ink shadow-xl backdrop:bg-ink/60"
    >
      <div className="p-5">
        <h2 id={titleId} className="text-xl font-bold">
          {title}
        </h2>
        <div className="mt-3 text-base">{children}</div>
        {confirmPhrase && (
          <label className="mt-4 block text-base font-semibold">
            계속하려면 <strong className="text-danger">"{confirmPhrase}"</strong>를 입력하세요
            <input
              value={typed}
              onChange={(e) => setTyped(e.target.value)}
              className="mt-1.5 block min-h-touch w-full rounded-control border-2 border-line-strong px-3 text-lg"
              autoComplete="off"
            />
          </label>
        )}
      </div>
      <div className="flex flex-col-reverse gap-2 border-t border-line p-4 sm:flex-row sm:justify-end">
        <PrimaryButton variant="ghost" onClick={onCancel} disabled={loading}>
          {cancelLabel}
        </PrimaryButton>
        <PrimaryButton variant={tone === "danger" ? "danger" : "primary"} onClick={onConfirm} disabled={!ready} loading={loading}>
          {confirmLabel}
        </PrimaryButton>
      </div>
    </dialog>
  );
}
