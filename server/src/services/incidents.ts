// Beta PILOT 2 Phase 3 현장 상황 공유: 제보·후속 정보·처리 상태(사진은 incidentPhotos.ts)
//
// 원칙
// - 제보·후속 정보: 같은 학교 승인 교직원 누구나, **진행 중 사건만**(실제 재난·모의훈련 모두). 종료와 경합하면 사건 행 잠금(FOR SHARE)으로
//   순서를 정해 종료 뒤에는 저장되지 않음(DB 트리거도 거부).
// - 제보 본문은 바꾸지 않음(후속 정보로 추가). 처리 상태는 incident.manage(학교 관리자·교장·교감·안전업무 담당)만, 화면에서 본 상태와 같을 때만 바뀜.
// - 일반 교직원 응답에는 작성자 이름·사진을 넣지 않음('내가 쓴 것'만 표시). 이름은 incident.manage, 사진은 incident.photo 응답에만.
// - 감사 기록에는 설명·후속 내용·장소 상세를 넣지 않음(유형·상태·종류만).
import type { IncidentStatus, Prisma, PrismaClient } from "@prisma/client";
import { badRequest, conflict, isUniqueViolation, notFound } from "../errors.js";
import { writeAudit } from "./audit.js";
import {
  SIMILAR_THRESHOLD,
  incidentPlaceLabel,
  similarityScore,
  type IncidentCreateInput,
  type IncidentUpdateKind,
  type SimilarityInput,
} from "../../../shared/incident.js";

type Db = PrismaClient | Prisma.TransactionClient;
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export interface Viewer {
  membershipId: string;
  canManage: boolean;
  canPhoto: boolean;
}

/** 사건 행 공유 잠금 + 진행 중 확인(같은 학교). 종료(FOR UPDATE)와 순서를 정함 */
export async function lockActiveEvent(tx: Prisma.TransactionClient, schoolId: string, eventId: string) {
  if (!UUID_RE.test(eventId) || !UUID_RE.test(schoolId)) throw notFound("상황을 찾을 수 없습니다.");
  await tx.$queryRaw`SELECT 1 AS locked FROM "disaster_events" WHERE "id" = ${eventId}::uuid AND "school_id" = ${schoolId}::uuid FOR SHARE`;
  const event = await tx.disasterEvent.findFirst({ where: { id: eventId, schoolId }, select: { id: true, mode: true, status: true } });
  if (!event) throw notFound("상황을 찾을 수 없습니다.");
  if (event.status !== "active") throw conflict("event_closed", "종료된 상황입니다. 새 제보나 추가 정보를 남길 수 없습니다.");
  return event;
}

async function loadEvent(db: Db, schoolId: string, eventId: string) {
  if (!UUID_RE.test(eventId)) throw notFound("상황을 찾을 수 없습니다.");
  const event = await db.disasterEvent.findFirst({ where: { id: eventId, schoolId }, select: { id: true, mode: true, status: true } });
  if (!event) throw notFound("상황을 찾을 수 없습니다.");
  return event;
}

const listSelect = {
  id: true,
  type: true,
  placeCategory: true,
  placeDetail: true,
  description: true,
  status: true,
  createdAt: true,
  lastActivityAt: true,
  reporterMembershipId: true,
  reporter: { select: { user: { select: { displayName: true } } } },
  _count: { select: { updates: true, attachments: { where: { deletedAt: null } } } },
} satisfies Prisma.IncidentReportSelect;
type ListRow = Prisma.IncidentReportGetPayload<{ select: typeof listSelect }>;

function toListItem(r: ListRow, viewer: Viewer) {
  return {
    id: r.id,
    type: r.type,
    placeCategory: r.placeCategory,
    placeLabel: incidentPlaceLabel(r.placeCategory, r.placeDetail),
    description: r.description,
    status: r.status,
    createdAt: r.createdAt.toISOString(),
    lastActivityAt: r.lastActivityAt.toISOString(),
    updateCount: r._count.updates,
    photoCount: r._count.attachments,
    mine: r.reporterMembershipId === viewer.membershipId,
    ...(viewer.canManage ? { reporterName: r.reporter.user.displayName } : {}),
  };
}

const STATUS_ORDER: Record<IncidentStatus, number> = { received: 0, checking: 1, in_progress: 2, resolved: 3 };

/** 사건의 제보 목록(같은 학교 승인 교직원). 조치가 필요한 것(완료 아님) 먼저, 그 안에서 최근 활동 순 */
export async function listIncidents(prisma: PrismaClient, params: { schoolId: string; eventId: string; viewer: Viewer }) {
  const event = await loadEvent(prisma, params.schoolId, params.eventId);
  const rows = await prisma.incidentReport.findMany({ where: { schoolId: params.schoolId, eventId: event.id }, select: listSelect, orderBy: { lastActivityAt: "desc" }, take: 200 });
  const items = rows.map((r) => toListItem(r, params.viewer)).sort((a, b) => Number(a.status === "resolved") - Number(b.status === "resolved") || STATUS_ORDER[a.status] - STATUS_ORDER[b.status] || b.lastActivityAt.localeCompare(a.lastActivityAt));
  return { event: { id: event.id, mode: event.mode, status: event.status }, incidents: items };
}

/** 유사 제보 제안(규칙 기반, 최대 5건). 막지 않고 보여 주기만 함 */
export async function similarIncidents(prisma: PrismaClient, params: { schoolId: string; eventId: string; draft: SimilarityInput; viewer: Viewer; now?: Date }) {
  const event = await loadEvent(prisma, params.schoolId, params.eventId);
  const rows = await prisma.incidentReport.findMany({ where: { schoolId: params.schoolId, eventId: event.id }, select: listSelect, orderBy: { lastActivityAt: "desc" }, take: 200 });
  const now = params.now ?? new Date();
  return {
    similar: rows
      .map((r) => ({ r, score: similarityScore(params.draft, r, now) }))
      .filter((x) => x.score >= SIMILAR_THRESHOLD)
      .sort((a, b) => b.score - a.score || b.r.lastActivityAt.getTime() - a.r.lastActivityAt.getTime())
      .slice(0, 5)
      .map((x) => ({ ...toListItem(x.r, params.viewer), score: x.score })),
  };
}

export async function createIncident(
  prisma: PrismaClient,
  params: { schoolId: string; eventId: string; membershipId: string; actorUserId: string; idempotencyKey: string; input: IncidentCreateInput; ip?: string | null },
) {
  const key = `${params.eventId}:${params.membershipId}:${params.idempotencyKey}`;
  const prior = await prisma.incidentReport.findUnique({ where: { idempotencyKey: key }, select: { id: true } });
  if (prior) return { id: prior.id, replayed: true };
  try {
    return await prisma.$transaction(async (tx) => {
      const event = await lockActiveEvent(tx, params.schoolId, params.eventId);
      const row = await tx.incidentReport.create({
        data: {
          schoolId: params.schoolId,
          eventId: event.id,
          reporterMembershipId: params.membershipId,
          type: params.input.type,
          placeCategory: params.input.placeCategory,
          placeDetail: params.input.placeDetail,
          description: params.input.description,
          idempotencyKey: key,
        },
        select: { id: true },
      });
      await writeAudit(tx, {
        schoolId: params.schoolId,
        actorUserId: params.actorUserId,
        action: "incident.reported",
        targetType: "incident_report",
        targetId: row.id,
        after: { eventId: event.id, mode: event.mode, type: params.input.type }, // 설명·장소 상세는 기록하지 않음
        ip: params.ip,
      });
      return { id: row.id, replayed: false };
    });
  } catch (error) {
    if (isUniqueViolation(error)) {
      const raced = await prisma.incidentReport.findUnique({ where: { idempotencyKey: key }, select: { id: true } });
      if (raced) return { id: raced.id, replayed: true };
    }
    throw error;
  }
}

async function loadIncident(db: Db, schoolId: string, incidentId: string) {
  if (!UUID_RE.test(incidentId)) throw notFound("제보를 찾을 수 없습니다.");
  const inc = await db.incidentReport.findFirst({ where: { id: incidentId, schoolId }, select: { id: true, eventId: true, status: true } });
  if (!inc) throw notFound("제보를 찾을 수 없습니다.");
  return inc;
}

export async function getIncident(prisma: PrismaClient, params: { schoolId: string; incidentId: string; viewer: Viewer }) {
  const base = await loadIncident(prisma, params.schoolId, params.incidentId);
  const r = await prisma.incidentReport.findUniqueOrThrow({
    where: { id: base.id },
    select: {
      ...listSelect,
      event: { select: { id: true, mode: true, status: true } },
      updates: { orderBy: { createdAt: "asc" }, select: { id: true, kind: true, note: true, createdAt: true, authorMembershipId: true, author: { select: { user: { select: { displayName: true } } } } } },
      statusHistory: { orderBy: { createdAt: "asc" }, select: { fromStatus: true, toStatus: true, createdAt: true, changedBy: { select: { user: { select: { displayName: true } } } } } },
      attachments: { where: { deletedAt: null }, orderBy: { createdAt: "asc" }, select: { id: true, mimeType: true, sizeBytes: true, createdAt: true } },
    },
  });
  const v = params.viewer;
  return {
    incident: {
      ...toListItem(r, v),
      event: r.event,
      updates: r.updates.map((u) => ({
        id: u.id,
        kind: u.kind,
        note: u.note,
        createdAt: u.createdAt.toISOString(),
        mine: u.authorMembershipId === v.membershipId,
        ...(v.canManage ? { authorName: u.author.user.displayName } : {}),
      })),
      statusHistory: r.statusHistory.map((h) => ({ from: h.fromStatus, to: h.toStatus, createdAt: h.createdAt.toISOString(), ...(v.canManage ? { changedByName: h.changedBy.user.displayName } : {}) })),
      // 사진: 열람 권한자에게만 목록, 그 외에는 장수만(toListItem 의 photoCount)
      ...(v.canPhoto ? { photos: r.attachments.map((a) => ({ id: a.id, mimeType: a.mimeType, sizeBytes: a.sizeBytes, createdAt: a.createdAt.toISOString() })) } : {}),
    },
  };
}

export async function addIncidentUpdate(
  prisma: PrismaClient,
  params: { schoolId: string; incidentId: string; membershipId: string; actorUserId: string; idempotencyKey: string; input: { kind: IncidentUpdateKind; note: string }; ip?: string | null },
) {
  const inc = await loadIncident(prisma, params.schoolId, params.incidentId);
  const key = `${inc.id}:${params.membershipId}:${params.idempotencyKey}`;
  const prior = await prisma.incidentUpdate.findUnique({ where: { idempotencyKey: key }, select: { id: true } });
  if (prior) return { id: prior.id, replayed: true };
  try {
    return await prisma.$transaction(async (tx) => {
      await lockActiveEvent(tx, params.schoolId, inc.eventId);
      const u = await tx.incidentUpdate.create({ data: { incidentId: inc.id, authorMembershipId: params.membershipId, kind: params.input.kind, note: params.input.note, idempotencyKey: key }, select: { id: true, createdAt: true } });
      await tx.incidentReport.update({ where: { id: inc.id }, data: { lastActivityAt: u.createdAt } });
      await writeAudit(tx, {
        schoolId: params.schoolId,
        actorUserId: params.actorUserId,
        action: "incident.update_added",
        targetType: "incident_report",
        targetId: inc.id,
        after: { kind: params.input.kind }, // 내용은 기록하지 않음
        ip: params.ip,
      });
      return { id: u.id, replayed: false };
    });
  } catch (error) {
    if (isUniqueViolation(error)) {
      const raced = await prisma.incidentUpdate.findUnique({ where: { idempotencyKey: key }, select: { id: true } });
      if (raced) return { id: raced.id, replayed: true };
    }
    throw error;
  }
}

/** 처리 상태 변경(incident.manage — 라우트에서 검사). 화면에서 본 상태(expectedStatus)와 다르면 409 */
export async function changeIncidentStatus(
  prisma: PrismaClient,
  params: { schoolId: string; incidentId: string; membershipId: string; actorUserId: string; status: IncidentStatus; expectedStatus: IncidentStatus; ip?: string | null },
) {
  if (params.status === params.expectedStatus) throw badRequest("지금 상태와 같습니다.");
  const inc = await loadIncident(prisma, params.schoolId, params.incidentId);
  return prisma.$transaction(async (tx) => {
    await lockActiveEvent(tx, params.schoolId, inc.eventId);
    const { count } = await tx.incidentReport.updateMany({ where: { id: inc.id, status: params.expectedStatus }, data: { status: params.status, lastActivityAt: new Date() } });
    if (count !== 1) throw conflict("status_changed", "그사이 다른 담당자가 처리 상태를 바꿨습니다. 화면을 새로 고친 뒤 다시 확인하세요.");
    await tx.incidentStatusHistory.create({ data: { incidentId: inc.id, fromStatus: params.expectedStatus, toStatus: params.status, changedByMembershipId: params.membershipId } });
    await writeAudit(tx, {
      schoolId: params.schoolId,
      actorUserId: params.actorUserId,
      action: "incident.status_changed",
      targetType: "incident_report",
      targetId: inc.id,
      before: { status: params.expectedStatus },
      after: { status: params.status },
      ip: params.ip,
    });
    return { id: inc.id, status: params.status };
  });
}

