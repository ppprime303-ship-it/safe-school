// 시각·숫자 표시(한국 시간 기준)
const timeFmt = new Intl.DateTimeFormat("ko-KR", { timeZone: "Asia/Seoul", hour: "2-digit", minute: "2-digit", second: "2-digit", hour12: false });
const dateTimeFmt = new Intl.DateTimeFormat("ko-KR", {
  timeZone: "Asia/Seoul",
  month: "long",
  day: "numeric",
  hour: "2-digit",
  minute: "2-digit",
  hour12: false,
});

export const formatTime = (iso: string | Date) => timeFmt.format(new Date(iso));
export const formatDateTime = (iso: string | Date) => dateTimeFmt.format(new Date(iso));

/** 경과 시간: "12분 30초", "1시간 5분" */
export function formatElapsed(fromIso: string | Date, now: Date = new Date()): string {
  const sec = Math.max(0, Math.floor((now.getTime() - new Date(fromIso).getTime()) / 1000));
  const h = Math.floor(sec / 3600);
  const m = Math.floor((sec % 3600) / 60);
  const s = sec % 60;
  if (h > 0) return `${h}시간 ${m}분`;
  if (m > 0) return `${m}분 ${s}초`;
  return `${s}초`;
}

export const formatCount = (n: number | null | undefined) => (n === null || n === undefined ? "–" : n.toLocaleString("ko-KR"));

export function percent(part: number, whole: number): number {
  if (whole <= 0) return 0;
  return Math.round((part / whole) * 100);
}
