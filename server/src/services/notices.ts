// STEP 3-C 재난안전 안내문 작성 지원 및 교사 직접 발송
// - 공식 경보 원문(official_alerts)과 학교 안내문(school_notices)은 분리합니다. 원문은 읽기만 합니다.
// - 이 기능은 작성·수정·복사를 지원할 뿐, 결재·실제 발송·모의 발송을 하지 않습니다.
// - 모든 조회는 schoolId와 함께 합니다 → 다른 학교의 경보·안내문·처리 이력 ID는 404.
// - DB 트리거가 마지막 방어선입니다(같은 학교 대상 경보만, 취소 후 변경 금지, 판 번호 +1, 이력 자동 기록, 재사용 원본 검사).
import type { AlertProvider, Prisma, PrismaClient } from "@prisma/client";
import { AppError, conflict, forbidden, isUniqueViolation, notFound } from "../errors.js";
import { writeAudit } from "./audit.js";
import { NOTICE_EXAMPLES, NOTICE_GUIDE_TEXT, getNoticeExample } from "../../../shared/noticeExamples.js";

type Db = PrismaClient | Prisma.TransactionClient;
type Role = "admin" | "homeroom" | "staff";

export function listNoticeExamples() {
  return { examples: NOTICE_EXAMPLES, guide: NOTICE_GUIDE_TEXT };
}

// ───────────── 경보 연결 ─────────────
/**
 * 안내문에 연결할 경보 확인: 우리 학교 판정 행이 없으면 404, '대상'이 아니면 400,
 * 재송출 경보면 대표 경보로 바꿉니다(대표 경보도 '대상'이어야 함).
 */
async function resolveNoticeAlert(db: Db, schoolId: string, alertId: string) {
  const match = await db.schoolAlertMatch.findUnique({ where: { schoolId_alertId: { schoolId, alertId } } });
  if (!match) throw notFound("경보를 찾을 수 없습니다.");
  if (match.result !== "target") {
    throw new AppError(400, "alert_not_target", "우리 학교 대상으로 판정된 경보에만 안내문을 연결할 수 있습니다.");
  }
  if (!match.duplicateOfAlertId) return { alertId, redirectedFrom: null as string | null };
  const rep = await db.schoolAlertMatch.findUnique({ where: { schoolId_alertId: { schoolId, alertId: match.duplicateOfAlertId } } });
  if (!rep || rep.result !== "target" || rep.duplicateOfAlertId) {
    throw new AppError(400, "alert_not_target", "재송출 경보의 대표 경보를 확인할 수 없습니다.");
  }
  return { alertId: rep.alertId, redirectedFrom: alertId };
}

export interface NoticeAlertState {
  id: string;
  title: string | null;
  body: string;
  issuer: string;
  areasRaw: string;
  msgType: string;
  isMock: boolean;
  issuedAt: string;
  expiresAt: string | null;
  cancelled: boolean; // 해제 경보가 뒤따라 옴(경보함 '해제됨'과 같은 기준)
  expired: boolean;
}

/** 경보함과 같은 기준으로 해제 여부 판단: 재송출 묶음 안 어느 경보든 해제 경보가 가리키면 해제됨 */
async function alertState(db: Db, schoolId: string, alertId: string): Promise<NoticeAlertState> {
  const alert = await db.officialAlert.findUniqueOrThrow({ where: { id: alertId } });
  const dups = await db.schoolAlertMatch.findMany({
    where: { schoolId, duplicateOfAlertId: alertId },
    select: { alert: { select: { provider: true, externalId: true } } },
  });
  const keys = [{ provider: alert.provider, externalId: alert.externalId }, ...dups.map((d: { alert: { provider: string; externalId: string } }) => d.alert)];
  const cancelCount = await db.schoolAlertMatch.count({
    where: {
      schoolId,
      alert: { msgType: "cancel", OR: keys.map((k) => ({ provider: k.provider as AlertProvider, refExternalId: k.externalId })) },
    },
  });
  return {
    id: alert.id,
    title: alert.title,
    body: alert.body,
    issuer: alert.issuer,
    areasRaw: alert.areasRaw,
    msgType: alert.msgType,
    isMock: alert.isMock,
    issuedAt: alert.issuedAt.toISOString(),
    expiresAt: alert.expiresAt?.toISOString() ?? null,
    cancelled: cancelCount > 0,
    expired: alert.expiresAt ? alert.expiresAt.getTime() < Date.now() : false,
  };
}

// ───────────── 조회 ─────────────
const noticeSummarySelect = {
  id: true,
  alertId: true,
  title: true,
  status: true,
  version: true,
  exampleKey: true,
  sourceNoticeId: true,
  createdAt: true,
  updatedAt: true,
  cancelledAt: true,
  createdById: true,
  createdBy: { select: { displayName: true } },
  updatedBy: { select: { displayName: true } },
  alert: { select: { title: true, body: true, issuedAt: true, isMock: true } },
} as const;

type SummaryRow = {
  id: string;
  alertId: string;
  title: string;
  status: string;
  version: number;
  exampleKey: string | null;
  sourceNoticeId: string | null;
  createdAt: Date;
  updatedAt: Date;
  cancelledAt: Date | null;
  createdById: string | null;
  createdBy: { displayName: string } | null;
  updatedBy: { displayName: string } | null;
  alert: { title: string | null; body: string; issuedAt: Date; isMock: boolean };
};

function summary(n: SummaryRow) {
  return {
    id: n.id,
    alertId: n.alertId,
    title: n.title,
    status: n.status,
    version: n.version,
    exampleKey: n.exampleKey,
    sourceNoticeId: n.sourceNoticeId,
    createdAt: n.createdAt.toISOString(),
    updatedAt: n.updatedAt.toISOString(),
    cancelledAt: n.cancelledAt?.toISOString() ?? null,
    createdById: n.createdById,
    createdByName: n.createdBy?.displayName ?? null,
    updatedByName: n.updatedBy?.displayName ?? null,
    alert: { title: n.alert.title ?? n.alert.body.slice(0, 40), issuedAt: n.alert.issuedAt.toISOString(), isMock: n.alert.isMock },
  };
}

export async function listNotices(db: Db, params: { schoolId: string; alertId?: string }) {
  const rows = (await db.schoolNotice.findMany({
    where: { schoolId: params.schoolId, ...(params.alertId ? { alertId: params.alertId } : {}) },
    select: noticeSummarySelect,
    orderBy: { updatedAt: "desc" },
    take: 200,
  })) as SummaryRow[];
  return { notices: rows.map(summary) };
}

async function findNotice(db: Db, schoolId: string, noticeId: string) {
  const n = await db.schoolNotice.findFirst({ where: { id: noticeId, schoolId } });
  if (!n) throw notFound("안내문을 찾을 수 없습니다.");
  return n;
}

export async function getNotice(db: Db, params: { schoolId: string; noticeId: string; userId: string; role: Role }) {
  const n = await db.schoolNotice.findFirst({
    where: { id: params.noticeId, schoolId: params.schoolId },
    include: {
      createdBy: { select: { displayName: true } },
      updatedBy: { select: { displayName: true } },
      revisions: { orderBy: { version: "desc" }, include: { changedBy: { select: { displayName: true } } } },
      records: { orderBy: { recordedAt: "desc" }, include: { recordedBy: { select: { displayName: true } } } },
    },
  });
  if (!n) throw notFound("안내문을 찾을 수 없습니다.");
  const [alert, source, reusedBy, school] = await Promise.all([
    alertState(db, params.schoolId, n.alertId),
    n.sourceNoticeId
      ? db.schoolNotice.findFirst({ where: { id: n.sourceNoticeId, schoolId: params.schoolId }, select: { id: true, title: true, cancelledAt: true, cancelReason: true, alertId: true } })
      : null,
    db.schoolNotice.findMany({ where: { schoolId: params.schoolId, sourceNoticeId: n.id }, select: { id: true, title: true, status: true, createdAt: true }, orderBy: { createdAt: "desc" } }),
    db.school.findUniqueOrThrow({ where: { id: params.schoolId }, select: { name: true } }),
  ]);
  const canEdit = n.status !== "cancelled" && (n.createdById === params.userId || params.role === "admin");
  return {
    notice: {
      id: n.id,
      alertId: n.alertId,
      title: n.title,
      body: n.body,
      status: n.status,
      version: n.version,
      exampleKey: n.exampleKey,
      exampleVersion: n.exampleVersion,
      sourceNoticeId: n.sourceNoticeId,
      createdById: n.createdById,
      createdByName: n.createdBy?.displayName ?? null,
      updatedByName: n.updatedBy?.displayName ?? null,
      createdAt: n.createdAt.toISOString(),
      updatedAt: n.updatedAt.toISOString(),
      cancelledAt: n.cancelledAt?.toISOString() ?? null,
      cancelReason: n.cancelReason,
    },
    schoolName: school.name,
    canEdit,
    alert,
    source: source
      ? { id: source.id, title: source.title, cancelledAt: source.cancelledAt?.toISOString() ?? null, cancelReason: source.cancelReason, sameAlert: source.alertId === n.alertId }
      : null,
    reusedBy: reusedBy.map((r: { id: string; title: string; status: string; createdAt: Date }) => ({ ...r, createdAt: r.createdAt.toISOString() })),
    revisions: n.revisions.map((r: { version: number; title: string; body: string; status: string; exampleKey: string | null; changedAt: Date; changedBy: { displayName: string } | null }) => ({
      version: r.version,
      title: r.title,
      body: r.body,
      status: r.status,
      exampleKey: r.exampleKey,
      changedAt: r.changedAt.toISOString(),
      changedByName: r.changedBy?.displayName ?? null,
    })),
    records: n.records.map((r: {
      id: string; channel: string | null; channelNote: string | null; audienceCategory: string | null; sentByTeacher: boolean; sentAt: Date | null;
      memo: string | null; recordedById: string | null; recordedAt: Date; voidedAt: Date | null; voidReason: string | null; recordedBy: { displayName: string } | null;
    }) => ({
      id: r.id,
      channel: r.channel,
      channelNote: r.channelNote,
      audienceCategory: r.audienceCategory,
      sentByTeacher: r.sentByTeacher,
      sentAt: r.sentAt?.toISOString() ?? null,
      memo: r.memo,
      recordedById: r.recordedById,
      recordedByName: r.recordedBy?.displayName ?? null,
      recordedAt: r.recordedAt.toISOString(),
      voidedAt: r.voidedAt?.toISOString() ?? null,
      voidReason: r.voidReason,
    })),
  };
}

// ───────────── 작성·수정·취소 ─────────────
function exampleFields(key: string | null | undefined) {
  if (key === undefined) return {};
  if (key === null) return { exampleKey: null, exampleVersion: null };
  const ex = getNoticeExample(key);
  if (!ex) throw new AppError(400, "unknown_example", "없는 예시문입니다.");
  return { exampleKey: ex.key, exampleVersion: ex.version };
}

/** DB 트리거의 보호 규칙 위반(경쟁 상태에서만 도달)을 사용자 메시지로 바꿉니다. */
function mapGuardError(error: unknown): never {
  const text = error instanceof Error ? error.message : String(error);
  if (text.includes("취소된 안내문")) throw conflict("notice_cancelled", "취소된 안내문은 수정할 수 없습니다. 새 초안으로 다시 만드세요.");
  if (text.includes("판 번호")) throw conflict("version_conflict", "다른 사람이 먼저 저장했습니다. 최신 내용을 확인하세요.");
  if (text.includes("대상 경보") || text.includes("대표 경보")) throw new AppError(400, "alert_not_target", "우리 학교 대상 경보에만 연결할 수 있습니다.");
  if (text.includes("원본은 같은 학교의 취소된 안내문")) throw conflict("source_not_cancelled", "취소된 안내문만 새 초안의 원본으로 쓸 수 있습니다.");
  throw error;
}

export async function createNotice(
  prisma: PrismaClient,
  params: { schoolId: string; actorUserId: string; alertId: string; title: string; body: string; exampleKey?: string | null; ip?: string | null },
) {
  return prisma.$transaction(async (tx) => {
    const target = await resolveNoticeAlert(tx, params.schoolId, params.alertId);
    const ex = exampleFields(params.exampleKey ?? null);
    let created;
    try {
      created = await tx.schoolNotice.create({
        data: {
          schoolId: params.schoolId,
          alertId: target.alertId,
          title: params.title,
          body: params.body,
          ...ex,
          createdById: params.actorUserId,
          updatedById: params.actorUserId,
        },
        select: { id: true, version: true },
      });
    } catch (error) {
      mapGuardError(error);
    }
    await writeAudit(tx, {
      schoolId: params.schoolId,
      actorUserId: params.actorUserId,
      action: "notice.created",
      targetType: "school_notice",
      targetId: created.id,
      after: { alertId: target.alertId, redirectedFrom: target.redirectedFrom, exampleKey: ex.exampleKey ?? null, version: 1 },
      ip: params.ip,
    });
    return { id: created.id, version: created.version, alertId: target.alertId, redirectedFrom: target.redirectedFrom };
  });
}

function assertCanEdit(notice: { createdById: string | null }, userId: string, role: Role) {
  if (notice.createdById !== userId && role !== "admin") throw forbidden("안내문은 작성자와 학교 관리자만 고칠 수 있습니다.");
}

export async function updateNotice(
  prisma: PrismaClient,
  params: {
    schoolId: string; noticeId: string; actorUserId: string; role: Role;
    title: string; body: string; status: "draft" | "completed"; exampleKey?: string | null; expectedVersion: number; ip?: string | null;
  },
) {
  return prisma.$transaction(async (tx) => {
    const n = await findNotice(tx, params.schoolId, params.noticeId);
    assertCanEdit(n, params.actorUserId, params.role);
    if (n.status === "cancelled") throw conflict("notice_cancelled", "취소된 안내문은 수정할 수 없습니다. 새 초안으로 다시 만드세요.");
    if (n.version !== params.expectedVersion) {
      throw conflict("version_conflict", "다른 사람이 먼저 저장했습니다. 최신 내용을 확인하세요.", { currentVersion: n.version });
    }
    const ex = exampleFields(params.exampleKey);
    const changed =
      n.title !== params.title || n.body !== params.body || n.status !== params.status ||
      ("exampleKey" in ex && (n.exampleKey !== ex.exampleKey || n.exampleVersion !== ex.exampleVersion));
    if (!changed) return { id: n.id, version: n.version, changed: false };

    let count = 0;
    try {
      // 조건부 갱신: 읽은 판 그대로일 때만(동시 저장이면 0건 → 409)
      ({ count } = await tx.schoolNotice.updateMany({
        where: { id: n.id, schoolId: params.schoolId, version: params.expectedVersion, status: { not: "cancelled" } },
        data: { title: params.title, body: params.body, status: params.status, ...ex, version: params.expectedVersion + 1, updatedById: params.actorUserId, updatedAt: new Date() },
      }));
    } catch (error) {
      mapGuardError(error);
    }
    if (count === 0) throw conflict("version_conflict", "다른 사람이 먼저 저장했습니다. 최신 내용을 확인하세요.");
    await writeAudit(tx, {
      schoolId: params.schoolId,
      actorUserId: params.actorUserId,
      action: n.status !== params.status && params.status === "completed" ? "notice.completed" : "notice.updated",
      targetType: "school_notice",
      targetId: n.id,
      before: { version: n.version, status: n.status, titleChanged: n.title !== params.title, bodyLength: n.body.length },
      after: { version: params.expectedVersion + 1, status: params.status, bodyLength: params.body.length, exampleKey: "exampleKey" in ex ? ex.exampleKey : n.exampleKey },
      ip: params.ip,
    });
    return { id: n.id, version: params.expectedVersion + 1, changed: true };
  });
}

export async function cancelNotice(
  prisma: PrismaClient,
  params: { schoolId: string; noticeId: string; actorUserId: string; role: Role; reason: string; expectedVersion: number; ip?: string | null },
) {
  return prisma.$transaction(async (tx) => {
    const n = await findNotice(tx, params.schoolId, params.noticeId);
    assertCanEdit(n, params.actorUserId, params.role);
    if (n.status === "cancelled") throw conflict("notice_cancelled", "이미 취소된 안내문입니다.");
    if (n.version !== params.expectedVersion) throw conflict("version_conflict", "다른 사람이 먼저 저장했습니다. 최신 내용을 확인하세요.", { currentVersion: n.version });
    let count = 0;
    try {
      ({ count } = await tx.schoolNotice.updateMany({
        where: { id: n.id, schoolId: params.schoolId, version: params.expectedVersion, status: { not: "cancelled" } },
        data: { status: "cancelled", cancelledAt: new Date(), cancelReason: params.reason, version: params.expectedVersion + 1, updatedById: params.actorUserId, updatedAt: new Date() },
      }));
    } catch (error) {
      mapGuardError(error);
    }
    if (count === 0) throw conflict("version_conflict", "다른 사람이 먼저 저장했습니다. 최신 내용을 확인하세요.");
    await writeAudit(tx, {
      schoolId: params.schoolId,
      actorUserId: params.actorUserId,
      action: "notice.cancelled",
      targetType: "school_notice",
      targetId: n.id,
      before: { version: n.version, status: n.status },
      after: { version: params.expectedVersion + 1, status: "cancelled", reason: params.reason },
      ip: params.ip,
    });
    return { id: n.id, version: params.expectedVersion + 1 };
  });
}

// ───────────── 취소된 안내문으로 새 초안 만들기(재사용) ─────────────
export interface ReuseWarning {
  code: "alert_cancelled" | "alert_expired" | "alert_changed" | "past_content";
  message: string;
}

/**
 * 원본(같은 학교의 취소된 안내문)은 그대로 두고, 제목·본문을 복사한 새 초안(새 ID·판 1·작성 중)을 만듭니다.
 * - 같은 원본의 작성 중 초안이 이미 있으면 새로 만들지 않고 그 초안을 돌려줍니다(두 번 누르기·동시 요청 방지).
 * - alertId를 주면 그 경보로 연결(우리 학교 대상·대표 경보 검사), 없으면 원본과 같은 경보(다시 검사).
 */
class ReuseRace extends Error {}

export async function reuseNotice(
  prisma: PrismaClient,
  params: { schoolId: string; sourceNoticeId: string; actorUserId: string; alertId?: string; ip?: string | null },
) {
  const run = () => prisma.$transaction(async (tx) => {
    const source = await findNotice(tx, params.schoolId, params.sourceNoticeId);
    if (source.status !== "cancelled") {
      throw conflict("source_not_cancelled", "취소된 안내문만 새 초안으로 다시 만들 수 있습니다. 이 안내문은 바로 고칠 수 있습니다.");
    }
    const existing = await tx.schoolNotice.findFirst({ where: { schoolId: params.schoolId, sourceNoticeId: source.id, status: "draft" }, select: { id: true, alertId: true } });
    if (existing) return { id: existing.id, alertId: existing.alertId, created: false, sourceAlertId: source.alertId };

    const target = await resolveNoticeAlert(tx, params.schoolId, params.alertId ?? source.alertId);
    let created;
    try {
      created = await tx.schoolNotice.create({
        data: {
          schoolId: params.schoolId,
          alertId: target.alertId,
          title: source.title,
          body: source.body,
          exampleKey: source.exampleKey,
          exampleVersion: source.exampleVersion,
          sourceNoticeId: source.id,
          createdById: params.actorUserId,
          updatedById: params.actorUserId,
        },
        select: { id: true },
      });
    } catch (error) {
      if (isUniqueViolation(error)) throw new ReuseRace(); // 동시 요청이 먼저 만듦 → 트랜잭션을 되돌리고 그 초안을 돌려줌
      mapGuardError(error);
    }
    await writeAudit(tx, {
      schoolId: params.schoolId,
      actorUserId: params.actorUserId,
      action: "notice.reused",
      targetType: "school_notice",
      targetId: created.id,
      before: { sourceNoticeId: source.id, sourceAlertId: source.alertId, sourceVersion: source.version },
      after: { alertId: target.alertId, sameAlert: target.alertId === source.alertId, redirectedFrom: target.redirectedFrom, version: 1 },
      ip: params.ip,
    });
    return { id: created.id, alertId: target.alertId, created: true, sourceAlertId: source.alertId };
  });
  let result: Awaited<ReturnType<typeof run>> | null;
  try {
    result = await run();
  } catch (error) {
    if (!(error instanceof ReuseRace)) throw error;
    result = null;
  }

  const final =
    result ??
    (await (async () => {
      const again = await prisma.schoolNotice.findFirst({ where: { schoolId: params.schoolId, sourceNoticeId: params.sourceNoticeId, status: "draft" }, select: { id: true, alertId: true, sourceNoticeId: true } });
      if (!again) throw conflict("reuse_conflict", "새 초안을 만들지 못했습니다. 다시 시도하세요.");
      const src = await findNotice(prisma, params.schoolId, params.sourceNoticeId);
      return { id: again.id, alertId: again.alertId, created: false, sourceAlertId: src.alertId };
    })());

  const state = await alertState(prisma, params.schoolId, final.alertId);
  const warnings: ReuseWarning[] = [];
  if (state.cancelled) warnings.push({ code: "alert_cancelled", message: "연결된 경보는 이미 해제되었습니다. 해제 안내가 아니라면 내용을 확인하거나 다른 경보에 연결하세요." });
  else if (state.expired) warnings.push({ code: "alert_expired", message: "연결된 경보의 유효 시각이 지났습니다. 현재도 유효한 상황인지 확인하세요." });
  if (final.alertId !== final.sourceAlertId) warnings.push({ code: "alert_changed", message: "원본과 다른 경보에 연결했습니다. 본문의 경보 제목·발령 시각·지역을 새 경보에 맞게 고치세요." });
  warnings.push({ code: "past_content", message: NOTICE_GUIDE_TEXT.reusePast });
  return { id: final.id, created: final.created, alertId: final.alertId, warnings };
}

// ───────────── 선택적 처리 이력(교사 직접 입력) ─────────────
export async function addHandlingRecord(
  prisma: PrismaClient,
  params: {
    schoolId: string; noticeId: string; actorUserId: string;
    channel?: "sms" | "school_app" | "kakao" | "other" | null; channelNote?: string | null; audienceCategory?: string | null;
    sentByTeacher: boolean; sentAt?: string | null; memo?: string | null; ip?: string | null;
  },
) {
  return prisma.$transaction(async (tx) => {
    const n = await findNotice(tx, params.schoolId, params.noticeId);
    if (n.status === "cancelled") throw conflict("notice_cancelled", "취소된 안내문에는 처리 이력을 남길 수 없습니다.");
    const rec = await tx.noticeHandlingRecord.create({
      data: {
        noticeId: n.id,
        schoolId: params.schoolId,
        channel: params.channel ?? null,
        channelNote: params.channelNote || null,
        audienceCategory: params.audienceCategory || null,
        sentByTeacher: params.sentByTeacher,
        sentAt: params.sentByTeacher && params.sentAt ? new Date(params.sentAt) : null,
        memo: params.memo || null,
        recordedById: params.actorUserId,
      },
      select: { id: true },
    });
    await writeAudit(tx, {
      schoolId: params.schoolId,
      actorUserId: params.actorUserId,
      action: "notice.record_added",
      targetType: "notice_handling_record",
      targetId: rec.id,
      after: { noticeId: n.id, channel: params.channel ?? null, sentByTeacher: params.sentByTeacher },
      ip: params.ip,
    });
    return { id: rec.id };
  });
}

export async function voidHandlingRecord(
  prisma: PrismaClient,
  params: { schoolId: string; noticeId: string; recordId: string; actorUserId: string; role: Role; reason: string; ip?: string | null },
) {
  return prisma.$transaction(async (tx) => {
    const rec = await tx.noticeHandlingRecord.findFirst({ where: { id: params.recordId, noticeId: params.noticeId, schoolId: params.schoolId } });
    if (!rec) throw notFound("처리 이력을 찾을 수 없습니다.");
    if (rec.recordedById !== params.actorUserId && params.role !== "admin") throw forbidden("처리 이력은 기록한 사람과 학교 관리자만 무효 처리할 수 있습니다.");
    if (rec.voidedAt) throw conflict("record_voided", "이미 무효 처리된 이력입니다.");
    const { count } = await tx.noticeHandlingRecord.updateMany({
      where: { id: rec.id, schoolId: params.schoolId, voidedAt: null },
      data: { voidedAt: new Date(), voidReason: params.reason },
    });
    if (count === 0) throw conflict("record_voided", "이미 무효 처리된 이력입니다.");
    await writeAudit(tx, {
      schoolId: params.schoolId,
      actorUserId: params.actorUserId,
      action: "notice.record_voided",
      targetType: "notice_handling_record",
      targetId: rec.id,
      after: { noticeId: params.noticeId, reason: params.reason },
      ip: params.ip,
    });
    return { id: rec.id };
  });
}

/** 경보함용: 경보별 안내문 수(취소 제외) */
export async function noticeCountsByAlert(db: Db, schoolId: string, alertIds: string[]): Promise<Map<string, number>> {
  if (alertIds.length === 0) return new Map();
  const rows = await db.schoolNotice.groupBy({
    by: ["alertId"],
    where: { schoolId, alertId: { in: alertIds }, status: { not: "cancelled" } },
    _count: { _all: true },
  });
  return new Map(rows.map((r: { alertId: string; _count: { _all: number } }) => [r.alertId, r._count._all]));
}
