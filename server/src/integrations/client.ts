import { createSchoolinfoClient, type SchoolinfoClient } from "./schoolinfo.js";

let cached: SchoolinfoClient | null | undefined;

// SCHOOLINFO_API_KEY 가 없으면 null(검색은 저장된 목록으로만 동작)
export function getSchoolinfoClient(): SchoolinfoClient | null {
  if (cached !== undefined) return cached;
  const apiKey = process.env.SCHOOLINFO_API_KEY;
  cached = apiKey ? createSchoolinfoClient({ apiKey }) : null;
  return cached;
}
