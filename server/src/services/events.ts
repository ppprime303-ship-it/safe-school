// STEP 3-A 재난 발령·학급 대피 보고·상황판·종료
// - 화면 계약: client/src/lib/disaster.ts (ActiveEvent, ClassReport, ClassReportView, BoardData, ReportInput)
// - 무결성: DB 제약(학교당 진행 중 1건, 합계 일치, 멱등키·버전 유일, 감사 로그 추가 전용)이 최종 방어선
// - 학교 재난 발령은 사람(관리자)이 결정합니다. 공식 경보 수신만으로 자동 발령하지 않습니다(STEP 3-B).
import type { DisasterEvent, DisasterType, EnrolledChangeReason, EventMode, Prisma, PrismaClient } from "@prisma/client";
import { AppError, conflict, isUniqueViolation, notFound } from "../errors.js";
import { writeAudit } from "./audit.js";

type Db = PrismaClient | Prisma.TransactionClient;

export const currentSchoolYear = () =>
  Number(new Intl.DateTimeFormat("en", { timeZone: "Asia/Seoul", year: "numeric" }).format(new Date()));

// ───────────── 응답 형태 ─────────────
export interface ActiveEventView {
  id: string;
  mode: EventMode;
  status: "active" | "closed";
  types: DisasterType[];
  location: string | null;
  evacPlace: string | null;
  message: string | null;
  startedAt: string;
  closedAt: string | null;
}

export interface ClassReportDto {
  enrolledCount: number;
  absentKnown: number;
  evacuated: number;
  unconfirmed: number;
  injured: number;
  note: string | null;
  version: number;
  reportedAt: string;
  reporterName: string | null;
}

export interface ClassReportViewDto {
  classId: string;
  grade: number;
  classNo: number;
  label: string;
  enrolledCount: number | null;
  report: ClassReportDto | null;
}

async function toEventView(db: Db, event: DisasterEvent): Promise<ActiveEventView> {
  const types = await db.disasterEventType.findMany({ where: { eventId: event.id }, orderBy: { addedAt: "asc" }, select: { type: true } });
  const list = types.map((t) => t.type);
  if (!list.includes(event.primaryType)) list.unshift(event.primaryType);
  return {
    id: event.id,
    mode: event.mode,
    status: event.status,
    types: list,
    location: event.location,
    evacPlace: event.evacPlace,
    message: event.message,
    startedAt: event.startedAt.toISOString(),
    closedAt: event.closedAt?.toISOString() ?? null,
  };
}

async function loadEvent(db: Db, schoolId: string, eventId: string) {
  const event = await db.disasterEvent.findFirst({ where: { id: eventId, schoolId } });
  if (!event) throw notFound("재난 상황을 찾을 수 없습니다.");
  return event;
}

// ───────────── A1 발령 ─────────────
export async function getActiveEvent(prisma: PrismaClient, schoolId: string) {
  const event = await prisma.disasterEvent.findFirst({ where: { schoolId, status: "active" } });
  return event ? toEventView(prisma, event) : null;
}

export async function issueEvent(
  prisma: PrismaClient,
  params: {
    schoolId: string;
    actorUserId: string;
    primaryType: DisasterType;
    mode: EventMode;
    location?: string | null;
    evacPlace?: string | null;
    message?: string | null;
    confirmReal?: boolean;
    ip?: string | null;
  },
) {
  if (params.mode === "real" && params.confirmReal !== true) {
    throw new AppError(400, "confirm_required", "실제 상황 발령은 명시적 확인이 필요합니다.");
  }
  try {
    return await prisma.$transaction(async (tx) => {
      const event = await tx.disasterEvent.create({
        data: {
          schoolId: params.schoolId,
          primaryType: params.primaryType,
          mode: params.mode,
          location: params.location?.trim() || null,
          evacPlace: params.evacPlace?.trim() || null,
          message: params.message?.trim() || null,
          createdById: params.actorUserId,
        },
      });
      await tx.disasterEventType.create({ data: { eventId: event.id, type: params.primaryType, addedById: params.actorUserId } });
      await writeAudit(tx, {
        schoolId: params.schoolId,
        actorUserId: params.actorUserId,
        action: params.mode === "real" ? "event.issued_real" : "event.issued_drill",
        targetType: "disaster_event",
        targetId: event.id,
        after: { primaryType: params.primaryType, mode: params.mode, evacPlace: event.evacPlace },
        ip: params.ip,
      });
      return toEventView(tx, event);
    });
  } catch (error) {
    if (isUniqueViolation(error)) {
      // 동시에 두 명이 발령한 경우 등: 기존 진행 중 상황을 알려 줌
      const existing = await prisma.disasterEvent.findFirst({ where: { schoolId: params.schoolId, status: "active" }, select: { id: true } });
      throw conflict("event_already_active", "이미 진행 중인 재난 상황이 있습니다. 상황판에서 확인하세요.", { eventId: existing?.id });
    }
    throw error;
  }
}

export async function addEventType(
  prisma: PrismaClient,
  params: { schoolId: string; eventId: string; actorUserId: string; type: DisasterType; note?: string | null; ip?: string | null },
) {
  return prisma.$transaction(async (tx) => {
    const event = await loadEvent(tx, params.schoolId, params.eventId);
    if (event.status !== "active") throw conflict("event_closed", "종료된 상황에는 유형을 추가할 수 없습니다.");
    const exists = await tx.disasterEventType.findUnique({ where: { eventId_type: { eventId: event.id, type: params.type } } });
    if (!exists) {
      await tx.disasterEventType.create({ data: { eventId: event.id, type: params.type, note: params.note?.trim() || null, addedById: params.actorUserId } });
      await writeAudit(tx, {
        schoolId: params.schoolId,
        actorUserId: params.actorUserId,
        action: "event.type_added",
        targetType: "disaster_event",
        targetId: event.id,
        after: { type: params.type, note: params.note ?? null },
        ip: params.ip,
      });
    }
    return toEventView(tx, event);
  });
}

export async function updateEvent(
  prisma: PrismaClient,
  params: { schoolId: string; eventId: string; actorUserId: string; location?: string | null; evacPlace?: string | null; message?: string | null; ip?: string | null },
) {
  return prisma.$transaction(async (tx) => {
    const event = await loadEvent(tx, params.schoolId, params.eventId);
    if (event.status !== "active") throw conflict("event_closed", "종료된 상황은 수정할 수 없습니다.");
    const data: { location?: string | null; evacPlace?: string | null; message?: string | null } = {};
    if (params.location !== undefined) data.location = params.location?.trim() || null;
    if (params.evacPlace !== undefined) data.evacPlace = params.evacPlace?.trim() || null;
    if (params.message !== undefined) data.message = params.message?.trim() || null;
    const updated = await tx.disasterEvent.update({ where: { id: event.id }, data });
    await writeAudit(tx, {
      schoolId: params.schoolId,
      actorUserId: params.actorUserId,
      action: "event.updated",
      targetType: "disaster_event",
      targetId: event.id,
      before: { location: event.location, evacPlace: event.evacPlace, message: event.message },
      after: data,
      ip: params.ip,
    });
    return toEventView(tx, updated);
  });
}

// ───────────── 학급 목록·보고 조회 ─────────────
async function classViews(db: Db, schoolId: string, eventId: string, classIds: string[] | null): Promise<ClassReportViewDto[]> {
  const classes = await db.schoolClass.findMany({
    where: { schoolId, schoolYear: currentSchoolYear(), active: true, ...(classIds ? { id: { in: classIds } } : {}) },
    orderBy: [{ grade: "asc" }, { classNo: "asc" }],
  });
  const reports = await db.evacuationReport.findMany({
    where: { eventId, classId: { in: classes.map((c) => c.id) } },
    include: { reportedBy: { select: { displayName: true } } },
  });
  const byClass = new Map<string, (typeof reports)[number]>(reports.map((r) => [r.classId, r] as const));
  return classes.map((c) => {
    const r = byClass.get(c.id);
    return {
      classId: c.id,
      grade: c.grade,
      classNo: c.classNo,
      label: c.label,
      enrolledCount: c.enrolledCount,
      report: r ? toReportDto(r) : null,
    };
  });
}

function toReportDto(r: {
  enrolledCount: number;
  absentKnown: number;
  evacuated: number;
  unconfirmed: number;
  injured: number;
  note: string | null;
  version: number;
  reportedAt: Date;
  reportedBy?: { displayName: string } | null;
}): ClassReportDto {
  return {
    enrolledCount: r.enrolledCount,
    absentKnown: r.absentKnown,
    evacuated: r.evacuated,
    unconfirmed: r.unconfirmed,
    injured: r.injured,
    note: r.note,
    version: r.version,
    reportedAt: r.reportedAt.toISOString(),
    reporterName: r.reportedBy?.displayName ?? null,
  };
}

/** 내가 보고할 학급: 관리자는 전체, 그 외에는 배정(담임·보조)된 학급만 */
export async function myClasses(prisma: PrismaClient, params: { schoolId: string; eventId: string; membershipId: string; role: string }) {
  const event = await loadEvent(prisma, params.schoolId, params.eventId);
  if (params.role === "admin") return classViews(prisma, params.schoolId, event.id, null);
  const assigned = await prisma.classAssignment.findMany({
    where: { membershipId: params.membershipId, duty: { in: ["homeroom", "assist"] } },
    select: { classId: true },
  });
  return classViews(prisma, params.schoolId, event.id, assigned.map((a) => a.classId));
}

// ───────────── A2 학급 보고 ─────────────
export interface ReportInput {
  evacuated: number;
  absentKnown: number;
  injured: number;
  enrolledCount: number;
  enrolledChangeReason: EnrolledChangeReason | null;
  note: string | null;
  expectedVersion: number | null;
}

export async function submitReport(
  prisma: PrismaClient,
  params: {
    schoolId: string;
    eventId: string;
    classId: string;
    actorUserId: string;
    membershipId: string;
    role: string;
    idempotencyKey: string;
    input: ReportInput;
    ip?: string | null;
  },
): Promise<{ report: ClassReportDto; replayed: boolean }> {
  const { input } = params;
  const key = `${params.eventId}:${params.idempotencyKey}`; // 사건 범위로 한정

  // 같은 요청의 재전송(통신 끊김 후 재시도): 이미 저장된 결과를 그대로 돌려줌
  const prior = await prisma.evacuationReportRevision.findUnique({ where: { idempotencyKey: key }, include: { report: true } });
  if (prior) {
    if (prior.report.classId !== params.classId) throw conflict("idempotency_key_reused", "같은 요청 번호가 다른 학급에 사용되었습니다.");
    const current = await prisma.evacuationReport.findUniqueOrThrow({ where: { id: prior.reportId }, include: { reportedBy: { select: { displayName: true } } } });
    return { report: toReportDto(current), replayed: true };
  }

  try {
    return await prisma.$transaction(async (tx) => {
      const event = await loadEvent(tx, params.schoolId, params.eventId);
      if (event.status !== "active") throw conflict("event_closed", "종료된 상황에는 보고할 수 없습니다.");
      const cls = await tx.schoolClass.findFirst({ where: { id: params.classId, schoolId: params.schoolId, active: true } });
      if (!cls) throw notFound("학급을 찾을 수 없습니다.");

      // 권한: 관리자(대리 보고) 또는 이 학급에 배정된 교직원
      let proxy = false;
      if (params.role === "admin") {
        const own = await tx.classAssignment.count({ where: { membershipId: params.membershipId, classId: cls.id } });
        proxy = own === 0;
      } else {
        const assigned = await tx.classAssignment.count({
          where: { membershipId: params.membershipId, classId: cls.id, duty: { in: ["homeroom", "assist"] } },
        });
        if (assigned === 0) throw new AppError(403, "class_not_assigned", "배정된 학급만 보고할 수 있습니다.");
      }

      const existing = await tx.evacuationReport.findUnique({ where: { eventId_classId: { eventId: event.id, classId: cls.id } } });
      const snapshot = existing ? existing.enrolledSnapshot : cls.enrolledCount; // 첫 보고 시점의 학급 재적
      const unconfirmed = input.enrolledCount - input.evacuated - input.absentKnown;
      if (unconfirmed < 0) {
        throw new AppError(422, "sum_mismatch", "대피 확인과 사전 파악 부재의 합이 재적보다 많습니다.");
      }
      if (input.injured > input.enrolledCount) throw new AppError(422, "injured_exceeds", "부상자가 재적보다 많습니다.");
      const changed = snapshot !== null && input.enrolledCount !== snapshot;
      if (changed && !input.enrolledChangeReason) throw new AppError(422, "enrolled_reason_required", "재적을 바꾼 사유를 고르세요.");
      const note = input.note?.trim() || null;

      let report;
      if (!existing) {
        if (input.expectedVersion !== null && input.expectedVersion !== undefined) {
          throw conflict("version_conflict", "보고가 아직 없습니다. 화면을 새로 고친 뒤 다시 보고하세요.");
        }
        report = await tx.evacuationReport.create({
          data: {
            eventId: event.id,
            schoolId: params.schoolId,
            classId: cls.id,
            enrolledSnapshot: snapshot,
            enrolledCount: input.enrolledCount,
            enrolledChangeReason: changed ? input.enrolledChangeReason : null,
            absentKnown: input.absentKnown,
            evacuated: input.evacuated,
            unconfirmed,
            injured: input.injured,
            note,
            version: 1,
            reportedById: params.actorUserId,
          },
          include: { reportedBy: { select: { displayName: true } } },
        });
      } else {
        if (input.expectedVersion !== existing.version) {
          const current = await tx.evacuationReport.findUniqueOrThrow({ where: { id: existing.id }, include: { reportedBy: { select: { displayName: true } } } });
          throw conflict("version_conflict", "다른 사람이 먼저 보고를 수정했습니다. 최신 내용을 확인한 뒤 다시 보고하세요.", { current: toReportDto(current) });
        }
        // 동시에 두 요청이 같은 버전으로 들어와도 하나만 성공(조건부 갱신)
        const { count } = await tx.evacuationReport.updateMany({
          where: { id: existing.id, version: existing.version },
          data: {
            enrolledCount: input.enrolledCount,
            enrolledChangeReason: changed ? input.enrolledChangeReason : null,
            absentKnown: input.absentKnown,
            evacuated: input.evacuated,
            unconfirmed,
            injured: input.injured,
            note,
            version: existing.version + 1,
            reportedById: params.actorUserId,
            reportedAt: new Date(),
          },
        });
        if (count === 0) throw conflict("version_conflict", "다른 사람이 먼저 보고를 수정했습니다. 다시 시도하세요.");
        report = await tx.evacuationReport.findUniqueOrThrow({ where: { id: existing.id }, include: { reportedBy: { select: { displayName: true } } } });
      }

      await tx.evacuationReportRevision.create({
        data: {
          reportId: report.id,
          version: report.version,
          enrolledCount: report.enrolledCount,
          enrolledChangeReason: report.enrolledChangeReason,
          absentKnown: report.absentKnown,
          evacuated: report.evacuated,
          unconfirmed: report.unconfirmed,
          injured: report.injured,
          note: report.note,
          changeReason: proxy ? "관리자 대리 보고" : null,
          idempotencyKey: key,
          changedById: params.actorUserId,
        },
      });
      await writeAudit(tx, {
        schoolId: params.schoolId,
        actorUserId: params.actorUserId,
        action: existing ? "report.updated" : "report.created",
        targetType: "evacuation_report",
        targetId: report.id,
        after: { classId: cls.id, version: report.version, evacuated: report.evacuated, unconfirmed: report.unconfirmed, injured: report.injured, proxy },
        ip: params.ip,
      });
      return { report: toReportDto(report), replayed: false };
    });
  } catch (error) {
    // 같은 학급 첫 보고가 동시에 들어온 경우 등
    if (isUniqueViolation(error)) throw conflict("version_conflict", "다른 사람이 먼저 보고했습니다. 화면을 새로 고친 뒤 다시 보고하세요.");
    throw error;
  }
}

// ───────────── A3 상황판·종료 ─────────────
export async function getBoard(prisma: PrismaClient, params: { schoolId: string; eventId: string }) {
  const event = await loadEvent(prisma, params.schoolId, params.eventId);
  const [view, classes] = await Promise.all([toEventView(prisma, event), classViews(prisma, params.schoolId, event.id, null)]);
  return { event: view, serverTime: new Date().toISOString(), classes };
}

export function summarize(classes: ClassReportViewDto[]) {
  const s = { totalClasses: classes.length, reportedClasses: 0, enrolledTotal: 0, evacuated: 0, absentKnown: 0, unconfirmed: 0, injured: 0, pendingStudents: 0, unknownEnrolledClasses: 0 };
  for (const c of classes) {
    if (c.report) {
      s.reportedClasses++;
      s.enrolledTotal += c.report.enrolledCount;
      s.evacuated += c.report.evacuated;
      s.absentKnown += c.report.absentKnown;
      s.unconfirmed += c.report.unconfirmed;
      s.injured += c.report.injured;
    } else if (c.enrolledCount !== null) {
      s.enrolledTotal += c.enrolledCount;
      s.pendingStudents += c.enrolledCount;
    } else {
      s.unknownEnrolledClasses++;
    }
  }
  return { ...s, unreportedClasses: s.totalClasses - s.reportedClasses };
}

export async function closeEvent(
  prisma: PrismaClient,
  params: { schoolId: string; eventId: string; actorUserId: string; confirmClose?: boolean; ip?: string | null },
) {
  return prisma.$transaction(async (tx) => {
    const event = await loadEvent(tx, params.schoolId, params.eventId);
    if (event.status !== "active") throw conflict("event_closed", "이미 종료된 상황입니다.");
    if (event.mode === "real" && params.confirmClose !== true) {
      throw new AppError(400, "confirm_required", "실제 상황 종료는 명시적 확인이 필요합니다.");
    }
    const classes = await classViews(tx, params.schoolId, event.id, null);
    const summary = summarize(classes);
    const closed = await tx.disasterEvent.update({
      where: { id: event.id },
      data: { status: "closed", closedAt: new Date(), closedById: params.actorUserId },
    });
    // 종료 시점 최종 집계(보고서 초안의 근거). 보고 원본은 그대로 보존됩니다.
    await writeAudit(tx, {
      schoolId: params.schoolId,
      actorUserId: params.actorUserId,
      action: "event.closed",
      targetType: "disaster_event",
      targetId: event.id,
      after: { mode: event.mode, durationSec: Math.round((closed.closedAt!.getTime() - event.startedAt.getTime()) / 1000), summary },
      ip: params.ip,
    });
    return { event: await toEventView(tx, closed), summary };
  });
}
