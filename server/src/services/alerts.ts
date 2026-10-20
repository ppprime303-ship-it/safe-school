// STEP 3-B ④ 교직원 경보함·학교 소재지 관리
// - 교직원: 우리 학교 '대상' 경보만(재송출은 원래 경보에 묶어 표시)
// - 관리자: 추가로 '미판정' 경보(학교 소재지 또는 경보 지역을 확정할 수 없는 경우)를 보고 소재지를 확인
import type { PrismaClient } from "@prisma/client";
import { AppError, notFound } from "../errors.js";
import { writeAudit } from "./audit.js";
import { ensureSchoolRegion } from "../alerts/collector.js";
import { matchRegion, normalizeSido, NATIONWIDE, type Area } from "../alerts/region.js";

export interface AlertItem {
  matchId: string;
  result: "target" | "undetermined";
  reason: string;
  read: boolean;
  rebroadcastCount: number;
  cancelled: boolean; // 해제 경보가 뒤따라 옴
  expired: boolean;
  alert: {
    id: string;
    provider: string;
    isMock: boolean;
    kind: string;
    severity: string;
    msgType: string;
    issuer: string;
    title: string | null;
    body: string;
    areasRaw: string;
    issuedAt: string;
    expiresAt: string | null;
    receivedAt: string;
  };
}

export async function listSchoolAlerts(prisma: PrismaClient, params: { schoolId: string; userId: string; role: string; limit?: number }) {
  const results = params.role === "admin" ? (["target", "undetermined"] as const) : (["target"] as const);
  const matches = await prisma.schoolAlertMatch.findMany({
    where: { schoolId: params.schoolId, result: { in: [...results] }, duplicateOfAlertId: null },
    include: { alert: true, reads: { where: { userId: params.userId }, select: { readAt: true } } },
    orderBy: { alert: { issuedAt: "desc" } },
    take: params.limit ?? 100,
  });
  const ids = matches.map((m) => m.alertId);
  const rebroadcasts = ids.length
    ? await prisma.schoolAlertMatch.groupBy({
        by: ["duplicateOfAlertId"],
        where: { schoolId: params.schoolId, duplicateOfAlertId: { in: ids } },
        _count: { _all: true },
      })
    : [];
  const rebroadcastBy = new Map(rebroadcasts.map((r) => [r.duplicateOfAlertId, r._count._all]));
  // 해제(cancel) 경보가 가리키는 원래 경보
  const cancelledRefs = new Set(
    matches.filter((m) => m.alert.msgType === "cancel" && m.alert.refExternalId).map((m) => `${m.alert.provider}:${m.alert.refExternalId}`),
  );
  const now = Date.now();
  const items: AlertItem[] = matches.map((m) => ({
    matchId: m.id,
    result: m.result as "target" | "undetermined",
    reason: m.reason,
    read: m.reads.length > 0,
    rebroadcastCount: rebroadcastBy.get(m.alertId) ?? 0,
    cancelled: cancelledRefs.has(`${m.alert.provider}:${m.alert.externalId}`),
    expired: m.alert.expiresAt ? m.alert.expiresAt.getTime() < now : false,
    alert: {
      id: m.alert.id,
      provider: m.alert.provider,
      isMock: m.alert.isMock,
      kind: m.alert.kind,
      severity: m.alert.severity,
      msgType: m.alert.msgType,
      issuer: m.alert.issuer,
      title: m.alert.title,
      body: m.alert.body,
      areasRaw: m.alert.areasRaw,
      issuedAt: m.alert.issuedAt.toISOString(),
      expiresAt: m.alert.expiresAt?.toISOString() ?? null,
      receivedAt: m.alert.receivedAt.toISOString(),
    },
  }));
  const unreadCount = items.filter((i) => i.result === "target" && !i.read).length;
  return { alerts: items, unreadCount };
}

export async function markAlertRead(prisma: PrismaClient, params: { schoolId: string; userId: string; role: string; matchId: string }) {
  const match = await prisma.schoolAlertMatch.findFirst({ where: { id: params.matchId, schoolId: params.schoolId } });
  const visible = match && (match.result === "target" || (match.result === "undetermined" && params.role === "admin"));
  if (!match || !visible) throw notFound("경보를 찾을 수 없습니다.");
  await prisma.alertRead.upsert({
    where: { userId_matchId: { userId: params.userId, matchId: match.id } },
    create: { userId: params.userId, matchId: match.id },
    update: {},
  });
  return { ok: true };
}

// ───────────── 학교 소재지(관리자) ─────────────
export async function getSchoolRegion(prisma: PrismaClient, schoolId: string) {
  const school = await prisma.school.findUniqueOrThrow({ where: { id: schoolId }, select: { id: true, address: true } });
  await ensureSchoolRegion(prisma, school);
  const region = await prisma.schoolRegion.findUnique({ where: { schoolId } });
  return {
    address: school.address,
    region: region
      ? { sido: region.sido, sigungu: region.sigungu, source: region.source, confirmed: region.confirmedAt !== null, confirmedAt: region.confirmedAt?.toISOString() ?? null }
      : null,
  };
}

export async function confirmSchoolRegion(
  prisma: PrismaClient,
  params: { schoolId: string; actorUserId: string; sido: string; sigungu: string | null; ip?: string | null },
) {
  const sido = normalizeSido(params.sido);
  if (!sido || sido === NATIONWIDE) throw new AppError(400, "invalid_sido", "시도 이름을 확인하세요.");
  const sigungu = params.sigungu?.trim() || null;
  if (sigungu && !/^[가-힣]+(시|군|구)( [가-힣]+구)?$/.test(sigungu)) throw new AppError(400, "invalid_sigungu", "시군구는 '남동구', '수원시 장안구'처럼 적으세요.");

  return prisma.$transaction(async (tx) => {
    const before = await tx.schoolRegion.findUnique({ where: { schoolId: params.schoolId } });
    const data = { sido, sigungu, source: "admin" as const, confirmedAt: new Date(), confirmedById: params.actorUserId };
    await tx.schoolRegion.upsert({ where: { schoolId: params.schoolId }, create: { schoolId: params.schoolId, ...data }, update: data });

    // 소재지를 몰라 '미판정'이었던 경보를 다시 판정(대상/비대상). 원문은 그대로입니다.
    const pending = await tx.schoolAlertMatch.findMany({ where: { schoolId: params.schoolId, result: "undetermined" }, include: { alert: true } });
    let rematched = 0;
    for (const m of pending) {
      const r = matchRegion({ sido, sigungu }, m.alert.areas as unknown as Area[]);
      if (r.result === "undetermined") continue;
      await tx.schoolAlertMatch.update({ where: { id: m.id }, data: { result: r.result, reason: `${r.reason} (소재지 확인 후 재판정)` } });
      rematched++;
    }
    await writeAudit(tx, {
      schoolId: params.schoolId,
      actorUserId: params.actorUserId,
      action: "region.confirmed",
      targetType: "school",
      targetId: params.schoolId,
      before: before ? { sido: before.sido, sigungu: before.sigungu, source: before.source } : undefined,
      after: { sido, sigungu, rematched },
      ip: params.ip,
    });
    return { sido, sigungu, rematched };
  });
}
