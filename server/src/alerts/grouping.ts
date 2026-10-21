// 재송출 묶음(같은 내용의 경보를 학교 경보함에서 한 건으로) — 수집·소재지 재판정·데이터 정리가 모두 이 함수 하나를 씁니다.
// 기준: 같은 학교 · 판정 '대상' · 같은 공급자 · 같은 내용 해시(contentHash) · 묶음 첫 경보 발령 후 6시간 이내.
// 묶음의 첫 경보(발령 시각이 가장 이른 것)를 대표로 남기고 나머지는 duplicate_of_alert_id 로 대표를 가리킵니다.
// official_alerts(원문)는 읽기만 하고 school_alert_matches 의 묶음 정보만 바꿉니다. 여러 번 실행해도 결과가 같습니다.
import type { Prisma, PrismaClient } from "@prisma/client";

type Db = PrismaClient | Prisma.TransactionClient;
export const REBROADCAST_WINDOW_MS = 6 * 60 * 60 * 1000;
export const REBROADCAST_SUFFIX = " · 같은 내용 재송출";

export interface RegroupChange {
  matchId: string;
  alertId: string;
  from: string | null;
  to: string | null;
}

export async function regroupRebroadcasts(
  db: Db,
  schoolId: string,
  options: { contentHashes?: string[]; dryRun?: boolean } = {},
): Promise<RegroupChange[]> {
  const matches = await db.schoolAlertMatch.findMany({
    where: { schoolId, result: "target", ...(options.contentHashes ? { alert: { contentHash: { in: options.contentHashes } } } : {}) },
    include: { alert: { select: { provider: true, contentHash: true, issuedAt: true } } },
    orderBy: [{ alert: { issuedAt: "asc" } }, { createdAt: "asc" }, { id: "asc" }],
  });
  const plan = planRegroup(
    matches.map((m) => ({ id: m.id, alertId: m.alertId, provider: m.alert.provider, contentHash: m.alert.contentHash, issuedAt: m.alert.issuedAt, duplicateOfAlertId: m.duplicateOfAlertId, reason: m.reason })),
  );
  const changes: RegroupChange[] = [];
  for (const p of plan) {
    changes.push({ matchId: p.id, alertId: p.alertId, from: p.from, to: p.to });
    if (!options.dryRun) await db.schoolAlertMatch.update({ where: { id: p.id }, data: { duplicateOfAlertId: p.to, reason: p.reason } });
  }
  return changes;
}

export interface GroupInput {
  id: string;
  alertId: string;
  provider: string;
  contentHash: string;
  issuedAt: Date;
  duplicateOfAlertId: string | null;
  reason: string;
}

/** 순수 함수: 발령 시각 순으로 묶음 대표를 정하고, 바뀌어야 하는 판정만 돌려줌(테스트 대상) */
export function planRegroup(items: GroupInput[]) {
  const sorted = [...items].sort((a, b) => a.issuedAt.getTime() - b.issuedAt.getTime() || a.id.localeCompare(b.id));
  const heads = new Map<string, { alertId: string; issuedAt: number }>();
  const out: { id: string; alertId: string; from: string | null; to: string | null; reason: string }[] = [];
  for (const m of sorted) {
    const key = `${m.provider}|${m.contentHash}`;
    const head = heads.get(key);
    const t = m.issuedAt.getTime();
    let dup: string | null = null;
    if (head && t - head.issuedAt <= REBROADCAST_WINDOW_MS) dup = head.alertId;
    else heads.set(key, { alertId: m.alertId, issuedAt: t });
    const base = m.reason.endsWith(REBROADCAST_SUFFIX) ? m.reason.slice(0, -REBROADCAST_SUFFIX.length) : m.reason;
    const reason = dup ? base + REBROADCAST_SUFFIX : base;
    if (m.duplicateOfAlertId !== dup || m.reason !== reason) out.push({ id: m.id, alertId: m.alertId, from: m.duplicateOfAlertId, to: dup, reason });
  }
  return out;
}
