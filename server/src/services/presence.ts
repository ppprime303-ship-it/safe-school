// Beta PILOT 2 Phase 2 교직원 앱 내 알림·소재 보고·집계
//
// 원칙
// - 알림: 실제 재난·모의훈련 모두 승인 교직원별 1건(사건·소속 UNIQUE). created_at 은 '생성'이지 전달이 아니고, read_at 은 본인이 앱에서 확인한 시각.
//   모의훈련 알림 확인은 안전·위치 확인이 아닙니다.
// - 소재: **실제 재난(mode=real)·진행 중 사건에서만** 본인이 보고. 모의훈련은 서버가 403으로 거부하고 DB 트리거도 행 생성을 막습니다.
//   보고 대상자는 세션의 소속으로만 결정(요청에 사용자·소속 id를 받지 않음). 종료와 동시에 들어온 보고는 사건 행 잠금(FOR SHARE)으로 순서를 정해
//   종료 뒤에는 저장되지 않습니다.
// - 집계 대상: 그 사건의 알림을 받은 소속 중 '지금' 승인·활성인 교직원(진행 중 사건은 새로 승인된 교직원 알림을 먼저 보충).
//   회수·비활성 교직원의 응답은 지우지 않고 집계에서만 뺍니다. 미응답 = 대상 − 응답(교외·안전으로 추정하지 않음).
// - 일반 교직원은 개인을 알 수 없는 전체 숫자만, 개인별·위치별·미응답자 명단은 presence.detail 응답에만.
// - 감사 기록에는 위치 내용을 넣지 않습니다(사건·판 번호만).
import type { Prisma, PrismaClient } from "@prisma/client";
import { AppError, conflict, isUniqueViolation, notFound } from "../errors.js";
import { writeAudit } from "./audit.js";
import { placeLabel, type PresenceInput, type PresencePlace } from "../../../shared/presence.js";

type Db = PrismaClient | Prisma.TransactionClient;

const drillNotCollected = () =>
  new AppError(403, "presence_not_collected_for_drill", "모의훈련에서는 교직원 소재를 받지 않습니다. 훈련 안내 알림 확인만 하면 됩니다.");

const activeMemberWhere = (schoolId: string) => ({ schoolId, status: "approved" as const, user: { status: "active" as const } });

/** 사건의 승인·활성 교직원 전원에게 알림 생성(이미 있으면 건너뜀). 발령 트랜잭션 안에서, 그리고 진행 중 사건의 보충용으로 호출 */
export async function createAlertsForEvent(db: Db, params: { schoolId: string; eventId: string }) {
  const members = await db.schoolMembership.findMany({ where: activeMemberWhere(params.schoolId), select: { id: true } });
  if (members.length === 0) return 0;
  const r = await db.staffAlert.createMany({
    data: members.map((m) => ({ schoolId: params.schoolId, eventId: params.eventId, membershipId: m.id })),
    skipDuplicates: true,
  });
  return r.count;
}

async function backfillActive(db: Db, schoolId: string) {
  const active = await db.disasterEvent.findFirst({ where: { schoolId, status: "active" }, select: { id: true } });
  if (active) await createAlertsForEvent(db, { schoolId, eventId: active.id });
}

const eventSummarySelect = { id: true, mode: true, status: true, startedAt: true, closedAt: true, types: { orderBy: { addedAt: "asc" as const }, select: { type: true } } } as const;

// ───────────── 알림 ─────────────
export async function listMyAlerts(prisma: PrismaClient, params: { schoolId: string; membershipId: string }) {
  await backfillActive(prisma, params.schoolId); // 진행 중 사건 도중 승인된 교직원도 알림을 받음
  const rows = await prisma.staffAlert.findMany({
    where: { schoolId: params.schoolId, membershipId: params.membershipId },
    orderBy: { createdAt: "desc" },
    take: 20,
    select: { id: true, createdAt: true, readAt: true, event: { select: eventSummarySelect } },
  });
  const alerts = rows.map((a) => ({
    id: a.id,
    createdAt: a.createdAt.toISOString(),
    readAt: a.readAt?.toISOString() ?? null,
    event: {
      id: a.event.id,
      mode: a.event.mode,
      status: a.event.status,
      types: a.event.types.map((t) => t.type),
      startedAt: a.event.startedAt.toISOString(),
      closedAt: a.event.closedAt?.toISOString() ?? null,
    },
    // 소재 보고는 실제 재난·진행 중에만
    presenceRequested: a.event.mode === "real" && a.event.status === "active",
  }));
  return { alerts, unreadCount: alerts.filter((a) => !a.readAt).length };
}

/** 본인 알림만 확인 처리(처음 확인 시각 유지). 다른 사람·다른 학교 알림은 404 */
export async function markMyAlertRead(prisma: PrismaClient, params: { schoolId: string; membershipId: string; alertId: string }) {
  const alert = await prisma.staffAlert.findFirst({ where: { id: params.alertId, schoolId: params.schoolId, membershipId: params.membershipId } });
  if (!alert) throw notFound("알림을 찾을 수 없습니다.");
  if (!alert.readAt) await prisma.staffAlert.updateMany({ where: { id: alert.id, readAt: null }, data: { readAt: new Date() } });
  const after = await prisma.staffAlert.findUniqueOrThrow({ where: { id: alert.id }, select: { readAt: true } });
  return { id: alert.id, readAt: after.readAt!.toISOString() };
}

// ───────────── 소재 보고 ─────────────
async function loadRealEvent(db: Db, schoolId: string, eventId: string) {
  const event = await db.disasterEvent.findFirst({ where: { id: eventId, schoolId }, select: { id: true, mode: true, status: true } });
  if (!event) throw notFound("상황을 찾을 수 없습니다.");
  if (event.mode !== "real") throw drillNotCollected();
  return event;
}

type PresenceRow = { id: string; location: string; placeCategory: PresencePlace | null; placeDetail: string | null; availability: string; version: number; firstRespondedAt: Date; respondedAt: Date };
const toPresenceDto = (p: PresenceRow) => ({
  id: p.id,
  location: p.location,
  placeCategory: p.placeCategory,
  placeDetail: p.placeDetail,
  placeLabel: placeLabel(p.placeCategory, p.placeDetail),
  availability: p.availability,
  version: p.version,
  firstRespondedAt: p.firstRespondedAt.toISOString(),
  respondedAt: p.respondedAt.toISOString(),
});

export async function getMyPresence(prisma: PrismaClient, params: { schoolId: string; eventId: string; membershipId: string }) {
  const event = await loadRealEvent(prisma, params.schoolId, params.eventId);
  const p = await prisma.staffPresence.findUnique({ where: { eventId_membershipId: { eventId: event.id, membershipId: params.membershipId } } });
  return { eventStatus: event.status, presence: p ? toPresenceDto(p) : null };
}

export async function submitMyPresence(
  prisma: PrismaClient,
  params: { schoolId: string; eventId: string; membershipId: string; actorUserId: string; idempotencyKey: string; input: PresenceInput; ip?: string | null },
) {
  const { input } = params;
  const key = `${params.eventId}:${params.idempotencyKey}`;
  // 같은 요청의 재전송: 처음 보낸 본인에게만 저장된 결과를 돌려줌
  const prior = await prisma.staffPresenceHistory.findUnique({ where: { idempotencyKey: key }, include: { presence: true } });
  if (prior) {
    if (prior.presence.schoolId !== params.schoolId || prior.presence.eventId !== params.eventId) throw notFound("상황을 찾을 수 없습니다.");
    if (prior.presence.membershipId !== params.membershipId) throw conflict("idempotency_key_reused", "이미 사용된 요청 번호입니다. 화면을 새로 고친 뒤 다시 보고하세요.");
    return { presence: toPresenceDto(prior.presence), replayed: true };
  }

  try {
    return await prisma.$transaction(async (tx) => {
      // 사건 행 공유 잠금: 종료(UPDATE)와 순서를 정해 종료 후 저장을 막음
      await tx.$queryRaw`SELECT 1 AS locked FROM "disaster_events" WHERE "id" = ${params.eventId}::uuid AND "school_id" = ${params.schoolId}::uuid FOR SHARE`;
      const event = await loadRealEvent(tx, params.schoolId, params.eventId);
      if (event.status !== "active") throw conflict("event_closed", "종료된 상황입니다. 소재 보고를 새로 하거나 수정할 수 없습니다.");
      await createAlertsForEvent(tx, { schoolId: params.schoolId, eventId: event.id }); // 대상자 알림 보장(이미 있으면 그대로)

      const existing = await tx.staffPresence.findUnique({ where: { eventId_membershipId: { eventId: event.id, membershipId: params.membershipId } } });
      const now = new Date();
      let presence;
      if (!existing) {
        if (input.expectedVersion !== null) throw conflict("version_conflict", "아직 보고가 없습니다. 화면을 새로 고친 뒤 다시 보고하세요.");
        presence = await tx.staffPresence.create({
          data: {
            schoolId: params.schoolId,
            eventId: event.id,
            membershipId: params.membershipId,
            location: input.location,
            placeCategory: input.placeCategory,
            placeDetail: input.placeDetail,
            availability: input.availability,
            version: 1,
            firstRespondedAt: now,
            respondedAt: now,
          },
        });
      } else {
        if (input.expectedVersion !== existing.version) {
          throw conflict("version_conflict", "다른 기기에서 먼저 소재를 수정했습니다. 최신 내용을 확인한 뒤 다시 보고하세요.", { current: toPresenceDto(existing) });
        }
        const { count } = await tx.staffPresence.updateMany({
          where: { id: existing.id, version: existing.version },
          data: { location: input.location, placeCategory: input.placeCategory, placeDetail: input.placeDetail, availability: input.availability, version: existing.version + 1, respondedAt: now },
        });
        if (count !== 1) throw conflict("version_conflict", "다른 기기에서 먼저 소재를 수정했습니다. 다시 시도하세요.");
        presence = await tx.staffPresence.findUniqueOrThrow({ where: { id: existing.id } });
      }
      await tx.staffPresenceHistory.create({
        data: {
          presenceId: presence.id,
          version: presence.version,
          location: presence.location,
          placeCategory: presence.placeCategory,
          placeDetail: presence.placeDetail,
          availability: presence.availability,
          idempotencyKey: key,
          changedAt: now,
        },
      });
      await writeAudit(tx, {
        schoolId: params.schoolId,
        actorUserId: params.actorUserId,
        action: existing ? "presence.updated" : "presence.reported",
        targetType: "staff_presence",
        targetId: presence.id,
        after: { eventId: event.id, version: presence.version }, // 위치 내용은 기록하지 않음
        ip: params.ip,
      });
      return { presence: toPresenceDto(presence), replayed: false };
    });
  } catch (error) {
    if (isUniqueViolation(error)) {
      const raced = await prisma.staffPresenceHistory.findUnique({ where: { idempotencyKey: key }, include: { presence: true } });
      if (raced && raced.presence.membershipId === params.membershipId) return { presence: toPresenceDto(raced.presence), replayed: true };
      throw conflict("version_conflict", "다른 기기에서 먼저 소재를 보고했습니다. 화면을 새로 고친 뒤 다시 보고하세요.");
    }
    throw error;
  }
}

// ───────────── 집계 ─────────────
async function collect(prisma: PrismaClient, schoolId: string, eventId: string) {
  const event = await loadRealEvent(prisma, schoolId, eventId);
  if (event.status === "active") await createAlertsForEvent(prisma, { schoolId, eventId: event.id });
  const targets = await prisma.staffAlert.findMany({
    where: { eventId: event.id, schoolId, membership: activeMemberWhere(schoolId) },
    select: { membershipId: true, readAt: true, membership: { select: { role: true, user: { select: { displayName: true } } } } },
  });
  const targetIds = new Set(targets.map((t) => t.membershipId));
  const all = await prisma.staffPresence.findMany({ where: { eventId: event.id, schoolId } });
  const responses = all.filter((p) => targetIds.has(p.membershipId));
  return { event, targets, responses, excludedResponses: all.length - responses.length };
}

/** 개인을 알 수 없는 전체 요약(실제 재난만). Phase 4 결과 보고서에도 이 형식만 사용 */
export function summarizePresence(targets: { readAt: Date | null }[], responses: { location: string; availability: string; respondedAt: Date }[]) {
  const count = (pred: (r: (typeof responses)[number]) => boolean) => responses.filter(pred).length;
  const latest = responses.reduce<Date | null>((m, r) => (!m || r.respondedAt > m ? r.respondedAt : m), null);
  return {
    targetCount: targets.length,
    respondedCount: responses.length,
    notRespondedCount: targets.length - responses.length,
    onCampus: count((r) => r.location === "on_campus"),
    offCampus: count((r) => r.location === "off_campus"),
    available: count((r) => r.availability === "available"),
    unavailable: count((r) => r.availability === "unavailable"),
    unsure: count((r) => r.availability === "unsure"),
    alertsRead: targets.filter((t) => t.readAt).length,
    latestRespondedAt: latest?.toISOString() ?? null,
  };
}

export async function presenceSummary(prisma: PrismaClient, params: { schoolId: string; eventId: string }) {
  const { event, targets, responses } = await collect(prisma, params.schoolId, params.eventId);
  return { eventId: event.id, eventStatus: event.status, scope: "summary" as const, summary: summarizePresence(targets, responses) };
}

/** 개인별 상세(presence.detail 전용): 성명·소재·교내 위치·지원 가능 여부·응답 시각·알림 확인, 미응답자 명단, 장소별 현황 */
export async function presenceDetail(prisma: PrismaClient, params: { schoolId: string; eventId: string }) {
  const { event, targets, responses, excludedResponses } = await collect(prisma, params.schoolId, params.eventId);
  const byMember = new Map(responses.map((r) => [r.membershipId, r]));
  const people = targets
    .map((t) => {
      const r = byMember.get(t.membershipId);
      return {
        membershipId: t.membershipId,
        name: t.membership.user.displayName,
        role: t.membership.role,
        alertReadAt: t.readAt?.toISOString() ?? null,
        presence: r ? toPresenceDto(r) : null,
      };
    })
    .sort((a, b) => Number(a.presence !== null) - Number(b.presence !== null) || a.name.localeCompare(b.name, "ko"));
  const byPlace = new Map<string, number>();
  for (const r of responses) if (r.placeCategory) byPlace.set(r.placeCategory, (byPlace.get(r.placeCategory) ?? 0) + 1);
  return {
    eventId: event.id,
    eventStatus: event.status,
    scope: "detail" as const,
    summary: summarizePresence(targets, responses),
    byPlace: [...byPlace.entries()].map(([placeCategory, count]) => ({ placeCategory, count })),
    notResponded: people.filter((p) => !p.presence).map((p) => ({ membershipId: p.membershipId, name: p.name, alertReadAt: p.alertReadAt })),
    people,
    excludedResponses, // 소속 회수·비활성으로 집계에서 뺀 응답 수(행은 보존)
  };
}

/** 한 교직원의 소재 변경 이력(presence.detail 전용, 같은 학교·사건만) */
export async function presenceHistory(prisma: PrismaClient, params: { schoolId: string; eventId: string; membershipId: string }) {
  await loadRealEvent(prisma, params.schoolId, params.eventId);
  const p = await prisma.staffPresence.findFirst({
    where: { eventId: params.eventId, schoolId: params.schoolId, membershipId: params.membershipId },
    include: { history: { orderBy: { version: "asc" } } },
  });
  if (!p) throw notFound("소재 보고가 없습니다.");
  return {
    history: p.history.map((h) => ({
      version: h.version,
      location: h.location,
      placeLabel: placeLabel(h.placeCategory, h.placeDetail),
      availability: h.availability,
      changedAt: h.changedAt.toISOString(),
    })),
  };
}
