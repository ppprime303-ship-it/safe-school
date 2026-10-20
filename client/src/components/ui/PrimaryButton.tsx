// 버튼: 최소 높이 48px(터치 영역), 저장 중에는 스피너와 문구로 상태를 알립니다.
import type { ButtonHTMLAttributes, ReactNode } from "react";
import { Icon, type IconName } from "./Icon";

type Variant = "primary" | "secondary" | "danger" | "ghost" | "success";
type Size = "md" | "lg" | "xl";

const VARIANT: Record<Variant, string> = {
  primary: "bg-brand text-white hover:bg-brand-hover",
  secondary: "border-2 border-brand bg-card text-brand hover:bg-brand-soft",
  danger: "bg-danger text-white hover:bg-danger-hover",
  success: "bg-accent text-white hover:bg-accent-hover",
  ghost: "bg-transparent text-brand hover:bg-brand-soft",
};

const SIZE: Record<Size, string> = {
  md: "min-h-touch px-4 text-base",
  lg: "min-h-14 px-5 text-lg",
  xl: "min-h-16 px-6 text-xl", // 재난 중 핵심 버튼
};

export function PrimaryButton({
  variant = "primary",
  size = "md",
  loading = false,
  loadingText = "처리 중…",
  icon,
  fullWidth = false,
  children,
  className = "",
  disabled,
  ...rest
}: ButtonHTMLAttributes<HTMLButtonElement> & {
  variant?: Variant;
  size?: Size;
  loading?: boolean;
  loadingText?: string;
  icon?: IconName;
  fullWidth?: boolean;
  children: ReactNode;
}) {
  return (
    <button
      type="button"
      disabled={disabled || loading}
      aria-busy={loading || undefined}
      className={`inline-flex items-center justify-center gap-2 rounded-control font-bold transition-colors disabled:cursor-not-allowed disabled:opacity-60 ${VARIANT[variant]} ${SIZE[size]} ${fullWidth ? "w-full" : ""} ${className}`}
      {...rest}
    >
      {loading ? (
        <>
          <span className="size-5 animate-spin rounded-full border-2 border-current border-r-transparent" aria-hidden />
          <span>{loadingText}</span>
        </>
      ) : (
        <>
          {icon && <Icon name={icon} size={size === "xl" ? 26 : 22} />}
          <span>{children}</span>
        </>
      )}
    </button>
  );
}
