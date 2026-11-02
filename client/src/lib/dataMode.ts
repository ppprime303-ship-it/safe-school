// 이 서버의 데이터 구분(가상 데이터 테스트 / 실제 학교 시범운영)을 /api/health 에서 한 번만 받아 안내 문구에 씁니다.
// 받지 못하면 null — 안내는 구분 없이 공통 문구만 보여 줍니다.
import { useEffect, useState } from "react";
import type { DataMode } from "@shared/release";

let cached: Promise<DataMode | null> | null = null;

function loadDataMode(): Promise<DataMode | null> {
  cached ??= fetch("/api/health", { headers: { Accept: "application/json" } })
    .then((r) => r.json() as Promise<{ dataMode?: DataMode }>)
    .then((b) => b.dataMode ?? null)
    .catch(() => {
      cached = null; // 다음 화면에서 다시 시도
      return null;
    });
  return cached;
}

export function useDataMode(): DataMode | null {
  const [mode, setMode] = useState<DataMode | null>(null);
  useEffect(() => {
    let alive = true;
    void loadDataMode().then((m) => {
      if (alive) setMode(m);
    });
    return () => {
      alive = false;
    };
  }, []);
  return mode;
}
