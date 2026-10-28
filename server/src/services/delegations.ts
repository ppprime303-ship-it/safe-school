// 2026-10-28 v0.1 대리 보고: 담당 교사가 보고할 수 없을 때, 그 사건(훈련) 동안만 같은 학교 교직원에게 학급 보고를 맡깁니다.
//
// 원칙
// - 보고가 늦다는 이유만으로 교사의 상태(실종·부상)를 판단하지 않습니다. 사유는 '연락 미확인·보고 불가·관리자 판단'뿐이며
//   지정은 발령 권한(event.issue)을 가진 사람이 직접 합니다(자동 지정 없음).
// - 후보 순서는 '제안'일 뿐입니다. 초등: 학년부장 → 교감 / 중·고: 부담임 → 학년부장. 학교 비상 계획에 따라 관리자가 다른 사람을 고를 수 있습니다.
//   · 부담임 = 그 학급에 '보조(assist)'로 배정된 교직원(관리자가 확정한 정보)
//   · 교감 = 운영자 확인을 거친 교감 직책
//   · 학년부장 = 아직 가입 신청 정보(미확정)뿐이라 '신청 정보 기준'으로 표시
// - 학급마다 따로 보고합니다. 대리 담당이 여러 학급을 맡아도 숫자를 합치지 않습니다(보고는 학급 단위 그대로).
// - 사건·학급당 유효한 지정은 1건. 재지정·복귀·회수·사건 종료 때 ended_at 을 남겨 이력을 보존합니다.
// - 원 담당과 대리가 동시에 보고해도 기존 버전 확인(expectedVersion·조건부 갱신)이 덮어쓰기를 막습니다.
import type { DelegationReason, Prisma, PrismaClient } from "@prisma/client";
import { AppError, conflict, isUniqueViolation, notFound } from "../errors.js";
import { writeAudit } from "./audit.js";

type Db = PrismaClient | Prisma.TransactionClient;

export const DELEGATION_REASON_LABEL: Record<DelegationReason, string> = {
  unreachable: "연락 미확인",
  unable: "보고 불가",
  admin_decision: "관리자 판단",
};

const ELEMENTARY = new Set(["02"]);

/** 사건·학급의 유효한 대리 지정이 이 소속에 있는지(보고 권한 검사용) */
export async function hasActiveDelegation(db: Db, params: { eventId: string; classId: string; membershipId: string }) {
  return (await db.eventReportDelegation.count({ where: { eventId: params.eventId, classId: params.classId, delegateMembershipId: params.membershipId, endedAt: null } })) > 0;
}

/** 이 소속이 대리 담당인 학급 ID(진행 중 사건) */
export async function delegatedClassIds(db: Db, params: { eventId: string; membershipId: string }) {
  const rows = await db.eventReportDelegation.findMany({ where: { eventId: params.eventId, delegateMembershipId: params.membershipId, endedAt: null }, select: { classId: true } });
  return rows.map((r) => r.classId);
}

async function loadActiveEvent(db: Db, schoolId: string, eventId: string) {
  const event = await db.disasterEvent.findFirst({ where: { id: eventId, schoolId } });
  if (!event) throw notFound("상황을 찾을 수 없습니다.");
  if (event.status !== "active") throw conflict("event_closed", "종료된 상황에는 대리 담당을 지정할 수 없습니다.");
  return event;
}

const memberLabel = { id: true, role: true, user: { select: { displayName: true } } } satisfies Prisma.SchoolMembershipSelect;

/** 학급 대리 후보: 학교급별 기본 순서 + 같은 학교 승인 교직원 전체(관리자가 직접 고를 수 있게) */
export async function delegationSuggestions(prisma: PrismaClient, params: { schoolId: string; eventId: string; classId: string }) {
  await loadActiveEvent(prisma, params.schoolId, params.eventId);
  const [school, cls] = await Promise.all([
    prisma.school.findUniqueOrThrow({ where: { id: params.schoolId }, select: { schoolKindCode: true } }),
    prisma.schoolClass.findFirst({ where: { id: params.classId, schoolId: params.schoolId, active: true } }),
  ]);
  if (!cls) throw notFound("학급을 찾을 수 없습니다.");
  const approved = await prisma.schoolMembership.findMany({
    where: { schoolId: params.schoolId, status: "approved", user: { status: "active" } },
    select: {
      ...memberLabel,
      requestedDuties: true,
      requestedClass: true,
      assignments: { select: { classId: true, duty: true } },
      duties: { where: { endedAt: null }, select: { duty: true } },
    },
  });
  const original = approved.filter((m) => m.assignments.some((a) => a.classId === cls.id && a.duty === "homeroom"));
  const assist = approved.filter((m) => m.assignments.some((a) => a.classId === cls.id && a.duty === "assist"));
  const gradeHead = approved.filter((m) => m.requestedDuties.includes("grade_head") && (m.requestedClass ?? "").includes(`학년부장 ${cls.grade}학년`));
  const vice = approved.filter((m) => m.duties.some((d) => d.duty === "vice_principal"));
  const elementary = ELEMENTARY.has(school.schoolKindCode ?? "");
  const steps = elementary
    ? [
        { step: "학년부장(신청 정보 기준, 미확정)", members: gradeHead },
        { step: "교감", members: vice },
      ]
    : [
        { step: "부담임", members: assist },
        { step: "학년부장(신청 정보 기준, 미확정)", members: gradeHead },
      ];
  const originalIds = new Set(original.map((m) => m.id));
  const toView = (m: (typeof approved)[number]) => ({ membershipId: m.id, name: m.user.displayName, role: m.role });
  return {
    schoolLevel: elementary ? "elementary" : "secondary",
    original: original.map(toView),
    suggestions: steps.map((s) => ({ step: s.step, members: s.members.filter((m) => !originalIds.has(m.id)).map(toView) })),
    // 후보가 없을 때를 위한 예외: 같은 학교 승인 교직원 중에서 관리자가 직접 지정
    candidates: approved.filter((m) => !originalIds.has(m.id)).map(toView),
  };
}

export async function assignDelegate(
  prisma: PrismaClient,
  params: {
    schoolId: string;
    eventId: string;
    classId: string;
    actorUserId: string;
    delegateMembershipId: string;
    reason: DelegationReason;
    basis?: string;
    /** 재지정일 때 지금 유효한 지정 ID(화면에서 본 것). 모르고 덮어쓰지 않도록 다르면 409 */
    replacesDelegationId?: string;
    ip?: string | null;
  },
) {
  const basis = params.basis?.trim() || null;
  if (basis && basis.length > 200) throw new AppError(400, "bad_request", "지정 근거는 200자 이내로 적으세요.");
  try {
    return await prisma.$transaction(async (tx) => {
      const event = await loadActiveEvent(tx, params.schoolId, params.eventId);
      const cls = await tx.schoolClass.findFirst({ where: { id: params.classId, schoolId: params.schoolId, active: true } });
      if (!cls) throw notFound("학급을 찾을 수 없습니다.");
      // 같은 학교 승인된 활성 교직원만(다른 학교 소속 ID는 존재 여부를 드러내지 않음)
      const delegate = await tx.schoolMembership.findFirst({
        where: { id: params.delegateMembershipId, schoolId: params.schoolId, status: "approved", user: { status: "active" } },
        select: { id: true, userId: true, assignments: { where: { classId: cls.id, duty: "homeroom" }, select: { id: true } } },
      });
      if (!delegate) throw notFound("이 학교의 승인된 교직원이 아닙니다.");
      if (delegate.assignments.length > 0) throw conflict("already_responsible", "이미 이 학급의 담임입니다. 대리 지정이 필요하지 않습니다.");
      const original = await tx.classAssignment.findFirst({ where: { classId: cls.id, duty: "homeroom" }, select: { membershipId: true } });

      const previous = await tx.eventReportDelegation.findFirst({ where: { eventId: event.id, classId: cls.id, endedAt: null } });
      if (previous) {
        if (previous.delegateMembershipId === delegate.id) throw conflict("already_delegated", "이미 이 교직원이 대리 담당입니다.");
        if (params.replacesDelegationId !== previous.id) {
          throw conflict("delegation_exists", "이 학급에는 이미 대리 담당이 지정되어 있습니다. 화면을 새로 고쳐 확인한 뒤 '다른 사람으로 바꾸기'를 하세요.");
        }
        await tx.eventReportDelegation.update({ where: { id: previous.id }, data: { endedAt: new Date(), endedById: params.actorUserId, endReason: "reassigned" } });
      }
      const row = await tx.eventReportDelegation.create({
        data: {
          schoolId: params.schoolId,
          eventId: event.id,
          classId: cls.id,
          delegateMembershipId: delegate.id,
          originalMembershipId: original?.membershipId ?? null,
          reason: params.reason,
          basis,
          assignedById: params.actorUserId,
        },
      });
      await writeAudit(tx, {
        schoolId: params.schoolId,
        actorUserId: params.actorUserId,
        action: previous ? "report.delegation_reassigned" : "report.delegation_assigned",
        targetType: "event_report_delegation",
        targetId: row.id,
        before: previous ? { delegateMembershipId: previous.delegateMembershipId } : undefined,
        after: { eventId: event.id, classId: cls.id, delegateMembershipId: delegate.id, originalMembershipId: row.originalMembershipId, reason: params.reason, basis },
        ip: params.ip,
      });
      return row;
    });
  } catch (error) {
    if (isUniqueViolation(error)) throw conflict("delegation_conflict", "다른 관리자가 방금 이 학급의 대리 담당을 지정했습니다. 새로 고친 뒤 확인하세요.");
    throw error;
  }
}

/** 대리 종료: 원 담당 복귀(returned) 또는 권한 회수(revoked) */
export async function endDelegation(
  prisma: PrismaClient,
  params: { schoolId: string; eventId: string; delegationId: string; actorUserId: string; reason: "returned" | "revoked"; ip?: string | null },
) {
  return prisma.$transaction(async (tx) => {
    const row = await tx.eventReportDelegation.findFirst({ where: { id: params.delegationId, schoolId: params.schoolId, eventId: params.eventId } });
    if (!row) throw notFound("대리 지정을 찾을 수 없습니다.");
    const r = await tx.eventReportDelegation.updateMany({ where: { id: row.id, endedAt: null }, data: { endedAt: new Date(), endedById: params.actorUserId, endReason: params.reason } });
    if (r.count !== 1) throw conflict("delegation_ended", "이미 종료된 대리 지정입니다.");
    await writeAudit(tx, {
      schoolId: params.schoolId,
      actorUserId: params.actorUserId,
      action: "report.delegation_ended",
      targetType: "event_report_delegation",
      targetId: row.id,
      after: { classId: row.classId, delegateMembershipId: row.delegateMembershipId, reason: params.reason },
      ip: params.ip,
    });
    return { ended: true };
  });
}

/** 사건 종료 시 남은 대리 지정을 모두 끝냄(closeEvent 트랜잭션 안에서 호출) */
export async function endDelegationsForEvent(tx: Prisma.TransactionClient, params: { eventId: string; actorUserId: string }) {
  const r = await tx.eventReportDelegation.updateMany({ where: { eventId: params.eventId, endedAt: null }, data: { endedAt: new Date(), endedById: params.actorUserId, endReason: "event_closed" } });
  return r.count;
}

/** 상황판·보고 화면 표시용: 진행 중 대리 지정(학급별) */
export async function activeDelegations(db: Db, params: { schoolId: string; eventId: string }) {
  const rows = await db.eventReportDelegation.findMany({
    where: { schoolId: params.schoolId, eventId: params.eventId, endedAt: null },
    select: { id: true, classId: true, reason: true, basis: true, assignedAt: true, delegate: { select: { id: true, user: { select: { displayName: true } } } } },
  });
  return rows.map((r) => ({ id: r.id, classId: r.classId, reason: r.reason, basis: r.basis, assignedAt: r.assignedAt, delegateMembershipId: r.delegate.id, delegateName: r.delegate.user.displayName }));
}
