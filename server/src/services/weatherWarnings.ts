// 학교 경보함의 기상특보(읽기 전용): 저장·알림·재난 발령을 하지 않습니다. 학교 소재지에 해당하는 구역만 돌려줍니다.
import type { PrismaClient } from "@prisma/client";
import { parseAddress } from "../alerts/region.js";
import { KMA_WARNING_CONTRACT, summarizeWarnings, zonesForRegion, type KmaWarningClient } from "../integrations/kmaWarnings.js";
import type { SchoolWeatherWarnings } from "../../../shared/weatherWarnings.js";

/** 마지막 정상 조회가 이보다 오래되면 '오래된 자료' 안내 */
export const WEATHER_STALE_MS = 30 * 60_000;

export async function getSchoolWeatherWarnings(prisma: PrismaClient, schoolId: string, client: KmaWarningClient | null, now: Date = new Date()): Promise<SchoolWeatherWarnings> {
  const [school, saved] = await Promise.all([
    prisma.school.findUniqueOrThrow({ where: { id: schoolId }, select: { address: true } }),
    prisma.schoolRegion.findUnique({ where: { schoolId }, select: { sido: true, sigungu: true } }),
  ]);
  const region = saved ?? parseAddress(school.address);
  const zones = zonesForRegion(region);
  const base = {
    source: KMA_WARNING_CONTRACT.source,
    contractVerified: KMA_WARNING_CONTRACT.verified,
    windowDays: KMA_WARNING_CONTRACT.windowDays,
    region: region ? { sido: region.sido, sigungu: region.sigungu } : null,
    regionSupported: zones !== null,
  };
  if (!client) return { ...base, state: "not_configured", fetchedAt: null, stale: false, errorKind: null, partial: false, warnings: [] };

  const snap = await client.latest();
  const fetched = snap.fetchedAt !== null;
  const warnings = zones
    ? summarizeWarnings(snap.rows.filter((r) => zones.target.has(r.areaCode) || zones.undetermined.has(r.areaCode)), now).map((w) => ({
        key: w.key,
        areaCode: w.areaCode,
        areaName: w.areaName,
        kind: w.kind,
        level: w.level,
        status: w.status,
        relevance: zones.target.has(w.areaCode) ? ("target" as const) : ("undetermined" as const),
        issuedAt: w.issuedAt.toISOString(),
        effectiveAt: w.effectiveAt?.toISOString() ?? null,
        releasedAt: w.releasedAt?.toISOString() ?? null,
      }))
    : [];
  return {
    ...base,
    state: snap.error && !fetched ? "failing" : "ok",
    fetchedAt: snap.fetchedAt?.toISOString() ?? null,
    stale: fetched && (snap.error !== null || now.getTime() - snap.fetchedAt!.getTime() > WEATHER_STALE_MS),
    errorKind: snap.error?.kind ?? null,
    partial: snap.partial,
    warnings,
  };
}
