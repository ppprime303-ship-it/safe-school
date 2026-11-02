// 외부 경보의 교직원별 미확인 안내(저장된 자료만 읽음 — 외부 API를 부르지 않습니다). 확인은 기존 alert_reads(POST /alerts/:matchId/read)를 씁니다.
// - 긴급재난문자 등: 대상 경보 중 안 읽은 것, 최근 24시간, 해제·기간 종료·재송출 제외
// - 기상특보: 구역·종류·강도별 최신 발표만. 해제된 묶음은 안내하지 않고, 연장은 이미 확인했으면 다시 알리지 않으며 정정·변경은 다시 알립니다.
// - 안내는 학교 재난 발령이나 대피 권고와 연결되지 않습니다.
import type { PrismaClient } from "@prisma/client";
import { ALERT_SOURCE_LABEL, type NoticeStatus, type PendingAlertNotice, type PendingAlertNotices } from "../../../shared/externalAlerts.js";
import { MOIS_CBS_CONTRACT, parseKstDateTime } from "../alerts/moisCbs.js";
import { seriesKeyOf } from "../alerts/kmaSource.js";
import { KMA_WARNING_CONTRACT } from "../integrations/kmaWarnings.js";

export const NOTICE_MAX_AGE_MS = 24 * 3600_000;
export const WEATHER_NOTICE_MAX_AGE_MS = 14 * 24 * 3600_000;
const MAX_NOTICES = 20;

/** 묶음의 최신 발표로 현재 상태 판단. null = 해제됨 */
export function weatherStatus(alert: { msgType: string; raw: unknown }, now: Date): NoticeStatus | null {
  if (alert.msgType === "cancel") return null;
  const raw = (alert.raw ?? {}) as { allEndTime?: unknown; startTime?: unknown; command?: unknown };
  const end = parseKstDateTime(String(raw.allEndTime ?? ""));
  if (end && end <= now) return null;
  if (!["1", "3", "6", "7"].includes(String(raw.command ?? ""))) return "unknown";
  const start = parseKstDateTime(String(raw.startTime ?? ""));
  return start && start > now ? "scheduled" : "active";
}

export async function listPendingAlertNotices(prisma: PrismaClient, params: { schoolId: string; userId: string; canManageRegion: boolean; now?: Date }): Promise<PendingAlertNotices> {
  const now = params.now ?? new Date();
  const matches = await prisma.schoolAlertMatch.findMany({
    where: {
      schoolId: params.schoolId,
      result: { in: params.canManageRegion ? ["target", "undetermined"] : ["target"] },
      duplicateOfAlertId: null,
      alert: { issuedAt: { gte: new Date(now.getTime() - WEATHER_NOTICE_MAX_AGE_MS) } },
    },
    include: { alert: true, reads: { where: { userId: params.userId }, select: { readAt: true } } },
    orderBy: [{ alert: { issuedAt: "asc" } }, { createdAt: "asc" }],
    take: 500,
  });
  const ids = matches.map((m) => m.alertId);
  const dupReads = ids.length
    ? await prisma.schoolAlertMatch.findMany({
        where: { schoolId: params.schoolId, duplicateOfAlertId: { in: ids }, reads: { some: { userId: params.userId } } },
        select: { duplicateOfAlertId: true },
      })
    : [];
  const readByGroup = new Set(dupReads.map((d) => d.duplicateOfAlertId));
  const isRead = (m: (typeof matches)[number]) => m.reads.length > 0 || readByGroup.has(m.alertId);

  // 해제 경보가 가리키는 원래 경보
  const cancelled = new Set(matches.filter((m) => m.alert.msgType === "cancel" && m.alert.refExternalId).map((m) => `${m.alert.provider}:${m.alert.refExternalId}`));

  const series = new Map<string, (typeof matches)[number][]>();
  const picks: { m: (typeof matches)[number]; status: NoticeStatus }[] = [];
  for (const m of matches) {
    if (m.alert.provider === "kma_warning") {
      const key = seriesKeyOf(m.alert.externalId);
      series.set(key, [...(series.get(key) ?? []), m]);
    } else if (
      !isRead(m) &&
      m.alert.msgType !== "cancel" &&
      !cancelled.has(`${m.alert.provider}:${m.alert.externalId}`) &&
      now.getTime() - m.alert.issuedAt.getTime() <= NOTICE_MAX_AGE_MS &&
      !(m.alert.expiresAt && m.alert.expiresAt < now)
    ) {
      picks.push({ m, status: "issued" });
    }
  }
  for (const list of series.values()) {
    const last = list[list.length - 1]!;
    const status = weatherStatus(last.alert, now);
    if (!status || isRead(last)) continue;
    const anyRead = list.some(isRead);
    const command = String((last.alert.raw as { command?: unknown } | null)?.command ?? "");
    if (anyRead && command === "3") continue; // 연장: 이미 안내한 특보
    picks.push({ m: last, status });
  }

  const [lastRuns, activeEvent] = await Promise.all([
    Promise.all(
      [...new Set(picks.map((p) => p.m.alert.provider))].map(async (provider) => {
        const run = await prisma.alertCollectionRun.findFirst({ where: { provider, status: "success" }, orderBy: { startedAt: "desc" }, select: { startedAt: true, finishedAt: true } });
        return [provider, run ? (run.finishedAt ?? run.startedAt).toISOString() : null] as const;
      }),
    ),
    prisma.disasterEvent.findFirst({ where: { schoolId: params.schoolId, status: "active" }, select: { id: true } }),
  ]);
  const lastCollected = new Map<string, string | null>(lastRuns);
  const rank = (s: string) => (s === "emergency" ? 0 : s === "warning" ? 1 : 2);

  const notices: PendingAlertNotice[] = picks
    .sort((a, b) => rank(a.m.alert.severity) - rank(b.m.alert.severity) || b.m.alert.issuedAt.getTime() - a.m.alert.issuedAt.getTime())
    .slice(0, MAX_NOTICES)
    .map(({ m, status }) => ({
      matchId: m.id,
      kind: m.alert.kind,
      isMock: m.alert.isMock,
      verified: m.alert.provider === "mois_cbs" ? MOIS_CBS_CONTRACT.verified : m.alert.provider === "kma_warning" ? KMA_WARNING_CONTRACT.verified : false,
      priority: rank(m.alert.severity) < 2 ? "urgent" : "normal",
      relevance: m.result === "target" ? "target" : "undetermined",
      title: m.alert.title,
      issuer: m.alert.issuer,
      areasRaw: m.alert.areasRaw,
      body: m.alert.body,
      issuedAt: m.alert.issuedAt.toISOString(),
      status,
      sourceLabel: ALERT_SOURCE_LABEL[m.alert.provider] ?? m.alert.provider,
      lastCollectedAt: lastCollected.get(m.alert.provider) ?? null,
    }));
  return { notices, activeEvent: activeEvent !== null };
}
