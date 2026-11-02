// STEP 3-B ①②③ 공식 경보 수집 → 원문 보존 → 학교 지역 매칭 → 중복 방지
// - 원문(official_alerts)은 받은 그대로 저장하고 수정·삭제하지 않습니다(DB 트리거).
// - 같은 공급자의 같은 경보 ID는 한 번만 저장합니다(재수신 = 중복).
// - 같은 내용이 짧은 시간 안에 다른 ID로 재송출되면 저장은 하되, 학교 경보함에는 '재송출'로 묶어 다시 알리지 않습니다.
// - 학교 지역을 확인할 수 없으면 '미판정'으로 남기고 관리자에게만 보입니다(자동 판단으로 대상 처리하지 않음).
// - 수집은 학교 재난 발령이나 학부모 발송을 자동으로 하지 않습니다.
import { createHash } from "node:crypto";
import type { Prisma, PrismaClient } from "@prisma/client";
import { isUniqueViolation } from "../errors.js";
import type { AlertSource, NormalizedAlert } from "./providers.js";
import { matchRegion, parseAddress, type Region } from "./region.js";
import { regroupRebroadcasts } from "./grouping.js";

export { REBROADCAST_WINDOW_MS } from "./grouping.js";

export function contentHash(a: Pick<NormalizedAlert, "issuer" | "body" | "areas" | "msgType">): string {
  const areas = a.areas
    .map((x) => `${x.sido ?? "?"}|${x.sigungu ?? "*"}|${x.sido ? "" : x.raw}`)
    .sort()
    .join(",");
  const text = [a.msgType, a.issuer.trim(), a.body.replace(/\s+/g, " ").trim(), areas].join("\n");
  return createHash("sha256").update(text).digest("hex");
}

/** 오류 메시지에서 인증키 등 비밀값으로 보이는 부분을 지웁니다. */
export function sanitizeError(error: unknown): string {
  const text = error instanceof Error ? error.message : String(error);
  return text
    .replace(/(serviceKey|apiKey|api_key|key|token|secret)=([^&\s]+)/gi, "$1=***")
    .replace(/(Bearer\s+)[A-Za-z0-9._-]+/gi, "$1***")
    .slice(0, 500);
}

/** 학교 소재지: 저장된 값이 없으면 주소에서 자동 추출해 '미확인'으로 저장 */
export async function ensureSchoolRegion(db: PrismaClient | Prisma.TransactionClient, school: { id: string; address: string | null }): Promise<Region | null> {
  const existing = await db.schoolRegion.findUnique({ where: { schoolId: school.id } });
  if (existing) return { sido: existing.sido, sigungu: existing.sigungu };
  const parsed = parseAddress(school.address);
  if (!parsed) return null;
  try {
    await db.schoolRegion.create({ data: { schoolId: school.id, sido: parsed.sido, sigungu: parsed.sigungu, source: "address_parsed" } });
  } catch (error) {
    if (!isUniqueViolation(error)) throw error; // 동시에 다른 수집이 먼저 저장
  }
  return parsed;
}

async function matchAlertToSchools(prisma: PrismaClient, alertId: string, alert: NormalizedAlert, hash: string) {
  const schools = await prisma.school.findMany({ where: { status: "active" }, select: { id: true, address: true } });
  let targets = 0;
  for (const school of schools) {
    const region = await ensureSchoolRegion(prisma, school);
    const { result, reason } = alert.matchRegion ? alert.matchRegion(region) : matchRegion(region, alert.areas);
    try {
      await prisma.schoolAlertMatch.create({ data: { schoolId: school.id, alertId, result, reason } });
    } catch (error) {
      if (!isUniqueViolation(error)) throw error; // 이미 매칭됨(동시 수집)
    }
    if (result === "target") {
      // 같은 내용 재송출 묶음: 소재지 재판정·데이터 정리와 같은 함수(grouping.ts)로 처리
      await regroupRebroadcasts(prisma, school.id, { contentHashes: [hash] });
      const mine = await prisma.schoolAlertMatch.findUnique({ where: { schoolId_alertId: { schoolId: school.id, alertId } }, select: { duplicateOfAlertId: true } });
      if (mine && !mine.duplicateOfAlertId) targets++;
    }
  }
  return targets;
}

export interface CollectOptions {
  /** 같은 공급자 수집 최소 간격(과다 호출 방지). 기본 60초 */
  minIntervalMs?: number;
  /** 실패 시 재시도 횟수(첫 시도 제외). 기본 2 */
  retries?: number;
  retryDelayMs?: number;
  sleep?: (ms: number) => Promise<void>;
  /** 공급자 일일 호출 상한(한국 날짜). 수집 기록으로 세므로 같은 DB를 쓰는 서버들이 함께 지킵니다 */
  dailyCallLimit?: number;
  /** 시도 1회의 최대 호출 수. 기본 1 */
  callsPerAttempt?: number;
}

/** 한국 날짜 오늘 0시 */
export const kstDayStart = (now: Date) => new Date(Math.floor((now.getTime() + 9 * 3600_000) / 86_400_000) * 86_400_000 - 9 * 3600_000);

export interface CollectResult {
  runId: string;
  status: "success" | "failed" | "skipped";
  fetched: number;
  inserted: number;
  duplicates: number;
  newTargetMatches: number;
  error?: string;
}

export async function collectOnce(prisma: PrismaClient, source: AlertSource, options: CollectOptions = {}): Promise<CollectResult> {
  const minIntervalMs = options.minIntervalMs ?? 60_000;
  const retries = options.retries ?? 2;
  const sleep = options.sleep ?? ((ms: number) => new Promise((r) => setTimeout(r, ms)));

  const last = await prisma.alertCollectionRun.findFirst({
    where: { provider: source.provider, status: { not: "skipped" } },
    orderBy: { startedAt: "desc" },
  });
  if (last && minIntervalMs > 0 && Date.now() - last.startedAt.getTime() < minIntervalMs) {
    const run = await prisma.alertCollectionRun.create({
      data: { provider: source.provider, status: "skipped", attempts: 0, finishedAt: new Date(), errorMessage: "최소 수집 간격 전이라 건너뜀" },
    });
    return { runId: run.id, status: "skipped", fetched: 0, inserted: 0, duplicates: 0, newTargetMatches: 0 };
  }
  if (options.dailyCallLimit !== undefined) {
    const perAttempt = options.callsPerAttempt ?? 1;
    const today = kstDayStart(new Date());
    // 같은 키를 쓰는 다른 서버·수동 호출은 이 DB에 집계되지 않으므로, 제공기관이 호출 제한을 알리면 그날은 더 호출하지 않습니다
    const limited = await prisma.alertCollectionRun.findFirst({
      where: { provider: source.provider, status: "failed", startedAt: { gte: today }, OR: [{ errorMessage: { contains: "결과 코드 22" } }, { errorMessage: { contains: "LIMITED" } }, { errorMessage: { contains: "429" } }] },
      select: { id: true },
    });
    if (limited) {
      const run = await prisma.alertCollectionRun.create({
        data: { provider: source.provider, status: "skipped", attempts: 0, finishedAt: new Date(), errorMessage: "제공기관 호출 제한 응답으로 다음 날까지 건너뜀" },
      });
      return { runId: run.id, status: "skipped", fetched: 0, inserted: 0, duplicates: 0, newTargetMatches: 0 };
    }
    const used = await prisma.alertCollectionRun.aggregate({ where: { provider: source.provider, status: { not: "skipped" }, startedAt: { gte: today } }, _sum: { attempts: true } });
    if ((used._sum.attempts ?? 0) * perAttempt + perAttempt * (retries + 1) > options.dailyCallLimit) {
      const run = await prisma.alertCollectionRun.create({
        data: { provider: source.provider, status: "skipped", attempts: 0, finishedAt: new Date(), errorMessage: "일일 호출 상한에 도달해 건너뜀" },
      });
      return { runId: run.id, status: "skipped", fetched: 0, inserted: 0, duplicates: 0, newTargetMatches: 0 };
    }
  }
  const lastSuccess = await prisma.alertCollectionRun.findFirst({
    where: { provider: source.provider, status: "success" },
    orderBy: { startedAt: "desc" },
    select: { cursor: true },
  });

  const startedAt = new Date();
  let attempts = 0;
  let fetched: Awaited<ReturnType<AlertSource["fetch"]>> | null = null;
  let lastError: unknown = null;
  while (attempts <= retries) {
    attempts++;
    try {
      fetched = await source.fetch(lastSuccess?.cursor ?? null);
      break;
    } catch (error) {
      lastError = error;
      if (attempts <= retries) await sleep((options.retryDelayMs ?? 2000) * attempts);
    }
  }
  if (!fetched) {
    const message = sanitizeError(lastError);
    const run = await prisma.alertCollectionRun.create({
      data: { provider: source.provider, status: "failed", startedAt, finishedAt: new Date(), attempts, errorMessage: message },
    });
    return { runId: run.id, status: "failed", fetched: 0, inserted: 0, duplicates: 0, newTargetMatches: 0, error: message };
  }

  let inserted = 0;
  let duplicates = 0;
  let newTargetMatches = 0;
  // 발령 시각 순서로 처리해야 재송출 판단이 일정함
  const alerts = [...fetched.alerts].sort((a, b) => a.issuedAt.getTime() - b.issuedAt.getTime());
  for (const alert of alerts) {
    const hash = contentHash(alert);
    let id: string;
    try {
      const created = await prisma.officialAlert.create({
        data: {
          provider: source.provider,
          externalId: alert.externalId,
          isMock: source.isMock,
          kind: alert.kind,
          severity: alert.severity,
          msgType: alert.msgType,
          refExternalId: alert.refExternalId,
          issuer: alert.issuer,
          title: alert.title,
          body: alert.body,
          areasRaw: alert.areasRaw,
          areas: alert.areas as unknown as Prisma.InputJsonValue,
          issuedAt: alert.issuedAt,
          expiresAt: alert.expiresAt,
          contentHash: hash,
          raw: (alert.raw ?? {}) as Prisma.InputJsonValue,
        },
        select: { id: true },
      });
      id = created.id;
      inserted++;
    } catch (error) {
      if (isUniqueViolation(error)) {
        duplicates++; // 같은 경보 재수신: 원문을 바꾸지 않고 건너뜀
        continue;
      }
      throw error;
    }
    newTargetMatches += await matchAlertToSchools(prisma, id, alert, hash);
  }

  const run = await prisma.alertCollectionRun.create({
    data: {
      provider: source.provider,
      status: "success",
      startedAt,
      finishedAt: new Date(),
      attempts,
      fetchedCount: fetched.alerts.length,
      newCount: inserted,
      duplicateCount: duplicates,
      matchedSchoolCount: newTargetMatches,
      cursor: fetched.nextCursor ?? lastSuccess?.cursor ?? null,
    },
  });
  return { runId: run.id, status: "success", fetched: fetched.alerts.length, inserted, duplicates, newTargetMatches };
}

/** 서버 안 주기 수집(기본 꺼짐). 공급자가 하나도 없으면 시작하지 않습니다. */
export function startCollector(prisma: PrismaClient, sources: AlertSource[], intervalMs: number, log = console, collect: CollectOptions = {}) {
  if (sources.length === 0) return () => {};
  let running = false;
  const tick = async () => {
    if (running) return; // 이전 수집이 끝나기 전 겹치지 않게
    running = true;
    try {
      for (const source of sources) {
        const r = await collectOnce(prisma, source, { minIntervalMs: Math.max(0, intervalMs - 1000), ...collect });
        if (r.status === "failed") log.warn(`[alerts] ${source.provider} 수집 실패: ${r.error}`);
        else if (r.inserted > 0) log.log(`[alerts] ${source.provider} 새 경보 ${r.inserted}건, 학교 알림 ${r.newTargetMatches}건`);
      }
    } catch (error) {
      log.warn(`[alerts] 수집 중 오류: ${sanitizeError(error)}`);
    } finally {
      running = false;
    }
  };
  void tick();
  const id = setInterval(() => void tick(), intervalMs);
  return () => clearInterval(id);
}
