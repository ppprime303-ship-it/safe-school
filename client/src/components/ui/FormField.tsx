// 입력 필드: 라벨은 항상 보이게(자리표시자만으로 안내하지 않음), 오류는 문구 + 테두리 + 아이콘
import { useId, type InputHTMLAttributes, type ReactNode } from "react";
import { Icon } from "./Icon";

export function FormField({
  label,
  hint,
  error,
  className = "",
  ...input
}: InputHTMLAttributes<HTMLInputElement> & { label: ReactNode; hint?: ReactNode; error?: string | null }) {
  const id = useId();
  const hintId = `${id}-hint`;
  const errorId = `${id}-error`;
  return (
    <div className={className}>
      <label htmlFor={id} className="block text-base font-bold">
        {label}
        {input.required && <span className="ml-1 text-danger" aria-hidden>*</span>}
      </label>
      {hint && (
        <p id={hintId} className="mt-0.5 text-sm text-ink-muted">
          {hint}
        </p>
      )}
      <input
        id={id}
        aria-invalid={error ? true : undefined}
        aria-describedby={[hint ? hintId : null, error ? errorId : null].filter(Boolean).join(" ") || undefined}
        className={`mt-1.5 block min-h-touch w-full rounded-control border-2 bg-card px-3 text-lg font-medium placeholder:text-ink-muted/70 ${error ? "border-danger" : "border-line-strong"}`}
        {...input}
      />
      {error && (
        <p id={errorId} className="mt-1 flex items-center gap-1 text-base font-semibold text-danger">
          <Icon name="alert" size={18} />
          {error}
        </p>
      )}
    </div>
  );
}

/** 큰 숫자 입력(− / + 버튼): 재난 중 한 손 조작용 */
export function NumberStepper({
  label,
  value,
  onChange,
  min = 0,
  max = 60,
  hint,
}: {
  label: string;
  value: number;
  onChange: (v: number) => void;
  min?: number;
  max?: number;
  hint?: string;
}) {
  const id = useId();
  const clamp = (v: number) => Math.min(max, Math.max(min, v));
  return (
    <div>
      <label htmlFor={id} className="block text-base font-bold">
        {label}
      </label>
      {hint && <p className="text-sm text-ink-muted">{hint}</p>}
      <div className="mt-1.5 flex items-stretch gap-2">
        <button
          type="button"
          onClick={() => onChange(clamp(value - 1))}
          disabled={value <= min}
          className="flex min-h-14 w-14 items-center justify-center rounded-control border-2 border-line-strong bg-card text-brand disabled:opacity-40"
          aria-label={`${label} 1 줄이기`}
        >
          <Icon name="minus" size={26} />
        </button>
        <input
          id={id}
          type="number"
          inputMode="numeric"
          min={min}
          max={max}
          value={value}
          onChange={(e) => onChange(clamp(Number(e.target.value) || 0))}
          className="tabular min-h-14 w-full min-w-0 rounded-control border-2 border-line-strong bg-card text-center text-[1.75rem] font-extrabold"
        />
        <button
          type="button"
          onClick={() => onChange(clamp(value + 1))}
          disabled={value >= max}
          className="flex min-h-14 w-14 items-center justify-center rounded-control border-2 border-line-strong bg-card text-brand disabled:opacity-40"
          aria-label={`${label} 1 늘리기`}
        >
          <Icon name="plus" size={26} />
        </button>
      </div>
    </div>
  );
}
