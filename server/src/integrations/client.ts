import { createSchoolinfoClient, type SchoolinfoClient } from "./schoolinfo.js";
import { createNeisClient, type NeisClient } from "./neis.js";

let cached: SchoolinfoClient | null | undefined;

// SCHOOLINFO_API_KEY 가 없으면 null(검색은 저장된 목록으로만 동작)
export function getSchoolinfoClient(): SchoolinfoClient | null {
  if (cached !== undefined) return cached;
  const apiKey = process.env.SCHOOLINFO_API_KEY;
  cached = apiKey ? createSchoolinfoClient({ apiKey }) : null;
  return cached;
}

// STEP A: 나이스 교육정보 개방 포털(공개 데이터). NEIS_API_KEY 가 없으면 null(호출하지 않음 — 샘플 응답을 실제로 오인하지 않게)
let neisCached: NeisClient | null | undefined;
export function getNeisClient(): NeisClient | null {
  if (neisCached !== undefined) return neisCached;
  const apiKey = process.env.NEIS_API_KEY?.trim();
  const dailyLimit = Number(process.env.NEIS_DAILY_LIMIT ?? "");
  neisCached = apiKey ? createNeisClient({ apiKey, ...(Number.isInteger(dailyLimit) && dailyLimit > 0 ? { dailyLimit } : {}) }) : null;
  return neisCached;
}
