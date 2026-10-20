import { useEffect, useState } from "react";

/** 일정 간격으로 현재 시각을 돌려줍니다(경과 시간 표시용). */
export function useNow(intervalMs = 1000): Date {
  const [now, setNow] = useState(() => new Date());
  useEffect(() => {
    const id = window.setInterval(() => setNow(new Date()), intervalMs);
    return () => window.clearInterval(id);
  }, [intervalMs]);
  return now;
}
