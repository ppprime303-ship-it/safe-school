// 아이콘(외부 라이브러리 없이 직접 그린 선형 아이콘, 24×24). 의미 전달용 아이콘에는 label을 줍니다.
import type { SVGProps } from "react";

const PATHS = {
  alert: "M12 3 2 20h20L12 3Zm0 6v5m0 3.5v.5",
  check: "M4 12.5 9.5 18 20 6",
  "check-circle": "M21 12a9 9 0 1 1-18 0 9 9 0 0 1 18 0ZM8 12.5l3 3 5-6",
  clock: "M12 7v5l3 2m6-2a9 9 0 1 1-18 0 9 9 0 0 1 18 0Z",
  question: "M9.5 9a2.5 2.5 0 1 1 3.5 2.3c-.6.3-1 .9-1 1.6V14m0 3.5v.5M21 12a9 9 0 1 1-18 0 9 9 0 0 1 18 0Z",
  medical: "M10 4h4v6h6v4h-6v6h-4v-6H4v-4h6V4Z",
  users: "M16 19v-1.5a3.5 3.5 0 0 0-3.5-3.5h-5A3.5 3.5 0 0 0 4 17.5V19m16 0v-1.5a3.5 3.5 0 0 0-2.5-3.35M14.5 4.6a3.5 3.5 0 0 1 0 6.8M13.5 8a3.5 3.5 0 1 1-7 0 3.5 3.5 0 0 1 7 0Z",
  "wifi-off": "M3 3l18 18M8.5 16.5a5 5 0 0 1 7 0M5 13a10 10 0 0 1 5-2.7m4 0A10 10 0 0 1 19 13M2 9.5a15 15 0 0 1 4.5-2.8M12 20h.01",
  refresh: "M20 11a8 8 0 0 0-14.7-4M4 4v3.5h3.5M4 13a8 8 0 0 0 14.7 4M20 20v-3.5h-3.5",
  home: "M4 10.5 12 4l8 6.5V20h-5v-6H9v6H4v-9.5Z",
  clipboard: "M9 4h6v3H9V4Zm-2 1.5H5V21h14V5.5h-2M8.5 13l2.5 2.5 4.5-5",
  dashboard: "M4 4h7v9H4V4Zm9 0h7v5h-7V4ZM4 15h7v5H4v-5Zm9-4h7v9h-7v-9Z",
  school: "M3 10l9-5 9 5-9 5-9-5Zm3 1.7V16c0 1.7 2.7 3 6 3s6-1.3 6-3v-4.3",
  search: "M20 20l-4.5-4.5M17 10.5a6.5 6.5 0 1 1-13 0 6.5 6.5 0 0 1 13 0Z",
  logout: "M15 4h4v16h-4M10 8l-4 4 4 4M6 12h10",
  "chevron-right": "M9 5l7 7-7 7",
  minus: "M5 12h14",
  plus: "M12 5v14M5 12h14",
  x: "M6 6l12 12M18 6 6 18",
  info: "M12 11v6m0-9.5v.5M21 12a9 9 0 1 1-18 0 9 9 0 0 1 18 0Z",
  bell: "M6 16V11a6 6 0 1 1 12 0v5l2 2H4l2-2Zm4 4h4",
  siren: "M7 17v-5a5 5 0 0 1 10 0v5M5 17h14v3H5v-3ZM12 3v2M4.2 6.2l1.4 1.4M19.8 6.2l-1.4 1.4",
  copy: "M9 9h11v11H9V9Zm-4 6H4V4h11v1",
  file: "M6 3h8l4 4v14H6V3Zm8 0v4h4M9 12h6M9 16h6",
  user: "M19 20v-1.5A3.5 3.5 0 0 0 15.5 15h-7A3.5 3.5 0 0 0 5 18.5V20M15.5 7.5a3.5 3.5 0 1 1-7 0 3.5 3.5 0 0 1 7 0Z",
  book: "M12 6.5C10.5 5 8 4.5 4 4.5V18c4 0 6.5.5 8 2 1.5-1.5 4-2 8-2V4.5c-4 0-6.5.5-8 2Zm0 0V20", // STEP 4 안전교육 자료
  "chevron-left": "M15 5l-7 7 7 7",
  shield: "M12 3l8 3v6c0 4.5-3.4 8.3-8 9-4.6-.7-8-4.5-8-9V6l8-3Z", // 공공기관 일반 심볼(STEP 4)
  external: "M14 4h6v6M20 4l-9 9M18 14v6H4V6h6", // 새 창(외부 사이트)

} as const;

export type IconName = keyof typeof PATHS;

export function Icon({ name, label, size = 20, ...rest }: { name: IconName; label?: string; size?: number } & SVGProps<SVGSVGElement>) {
  return (
    <svg
      viewBox="0 0 24 24"
      width={size}
      height={size}
      fill="none"
      stroke="currentColor"
      strokeWidth={2}
      strokeLinecap="round"
      strokeLinejoin="round"
      role={label ? "img" : undefined}
      aria-label={label}
      aria-hidden={label ? undefined : true}
      focusable="false"
      {...rest}
    >
      <path d={PATHS[name]} />
    </svg>
  );
}
