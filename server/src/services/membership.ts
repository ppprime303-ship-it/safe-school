// 교직원 학교 가입·승인·배정·권한 회수, 그리고 서버 측 학교 접근 검증
import type { AssignmentDuty, MemberRole, PrismaClient } from "@prisma/client";
import { AppError, badRequest, conflict, forbidden, notFound } from "../errors.js";
import { writeAudit } from "./audit.js";
import { countOperators } from "./access.js";

// ───────────── 접근 검증(모든 학교 업무 API가 사용) ─────────────
// 승인된 소속 + 활성 학교 + (필요 시) 역할이 모두 맞아야 통과합니다.
// 다른 학교 자원은 존재 여부를 드러내지 않도록 404로 응답합니다.
export async function resolveSchoolAccess(
  prisma: PrismaClient,
  params: { userId: string; schoolId: string; roles?: MemberRole[]; allowPendingSchool?: boolean },
) {
  const membership = await prisma.schoolMembership.findUnique({
    where: { schoolId_userId: { schoolId: params.schoolId, userId: params.userId } },
    include: { school: true, user: { select: { status: true } } },
  });
  if (!membership) throw notFound("학교를 찾을 수 없습니다.");
  if (membership.user.status !== "active") throw forbidden("사용할 수 없는 계정입니다.");
  if (membership.status === "pending") {
    throw new AppError(403, "membership_pending", "학교 관리자의 가입 승인을 기다리고 있습니다.");
  }
  if (membership.status !== "approved") throw new AppError(403, "membership_inactive", "이 학교에 대한 권한이 없습니다.");
  if (membership.school.status !== "active" && !params.allowPendingSchool) {
    throw new AppError(403, "school_not_active", "학교 등록이 아직 승인되지 않았습니다(관리자 자격 확인 대기).");
  }
  if (params.roles && !params.roles.includes(membership.role)) throw forbidden("이 작업은 학교 관리자만 할 수 있습니다.");
  return membership;
}

// ───────────── 후속 교직원 가입 신청 ─────────────
export async function requestToJoinSchool(
  prisma: PrismaClient,
  params: { userId: string; schoolId: string; requestedRole: "homeroom" | "staff"; ip?: string | null },
) {
  const user = await prisma.user.findUnique({ where: { id: params.userId } });
  if (!user || user.status !== "active") throw forbidden("사용할 수 없는 계정입니다.");
  if (!user.emailVerifiedAt) throw forbidden("이메일 인증을 먼저 완료하세요.");
  if (!["homeroom", "staff"].includes(params.requestedRole)) throw badRequest("신청할 수 있는 역할은 담임 또는 교직원입니다.");

  const school = await prisma.school.findUnique({ where: { id: params.schoolId } });
  if (!school) throw notFound("학교를 찾을 수 없습니다.");

  const existing = await prisma.schoolMembership.findUnique({
    where: { schoolId_userId: { schoolId: school.id, userId: user.id } },
  });
  if (existing) {
    if (existing.status === "pending" || existing.status === "approved") return { membership: existing, created: false };
    if (existing.status === "revoked") throw conflict("membership_revoked", "권한이 회수된 계정입니다. 학교 관리자에게 문의하세요.");
    // 거절된 경우 다시 신청 가능
    const membership = await prisma.schoolMembership.update({
      where: { id: existing.id },
      data: { status: "pending", role: params.requestedRole, approvalMethod: null, approvedAt: null, approvedById: null },
    });
    await writeAudit(prisma, { schoolId: school.id, actorUserId: user.id, action: "membership.requested", targetType: "membership", targetId: membership.id, ip: params.ip });
    return { membership, created: true };
  }

  const membership = await prisma.schoolMembership.create({
    data: { schoolId: school.id, userId: user.id, role: params.requestedRole, status: "pending" },
  });
  await writeAudit(prisma, { schoolId: school.id, actorUserId: user.id, action: "membership.requested", targetType: "membership", targetId: membership.id, ip: params.ip });
  return { membership, created: true };
}

// ───────────── 관리자: 가입 신청 일괄 승인·거절 ─────────────
export async function decideMemberships(
  prisma: PrismaClient,
  params: { schoolId: string; actorUserId: string; membershipIds: string[]; decision: "approve" | "reject"; ip?: string | null },
) {
  if (params.membershipIds.length === 0) throw badRequest("선택한 신청이 없습니다.");
  if (params.membershipIds.length > 200) throw badRequest("한 번에 200명까지 처리할 수 있습니다.");
  return prisma.$transaction(async (tx) => {
    const targets = await tx.schoolMembership.findMany({
      where: { id: { in: params.membershipIds }, schoolId: params.schoolId, status: "pending" },
      select: { id: true, userId: true, role: true },
    });
    const now = new Date();
    if (targets.length > 0) {
      await tx.schoolMembership.updateMany({
        where: { id: { in: targets.map((t) => t.id) } },
        data:
          params.decision === "approve"
            ? { status: "approved", approvalMethod: "manual", approvedById: params.actorUserId, approvedAt: now }
            : { status: "rejected" },
      });
    }
    await writeAudit(tx, {
      schoolId: params.schoolId,
      actorUserId: params.actorUserId,
      action: params.decision === "approve" ? "membership.approved" : "membership.rejected",
      targetType: "membership",
      after: { ids: targets.map((t) => t.id) },
      ip: params.ip,
    });
    // 이미 처리됐거나 다른 학교 신청은 건너뜀
    return { processed: targets.length, skipped: params.membershipIds.length - targets.length };
  });
}

// ───────────── 관리자: 담당 학급·업무 배정(교체) ─────────────
export async function setAssignments(
  prisma: PrismaClient,
  params: {
    schoolId: string;
    actorUserId: string;
    membershipId: string;
    role?: "homeroom" | "staff";
    assignments: { classId: string; duty: AssignmentDuty }[];
    ip?: string | null;
  },
) {
  return prisma.$transaction(async (tx) => {
    const membership = await tx.schoolMembership.findFirst({
      where: { id: params.membershipId, schoolId: params.schoolId },
      include: { assignments: true },
    });
    if (!membership) throw notFound("교직원을 찾을 수 없습니다.");
    if (membership.status !== "approved") throw conflict("membership_not_approved", "가입이 승인된 교직원만 배정할 수 있습니다.");

    const classIds = [...new Set(params.assignments.map((a) => a.classId))];
    const validCount = await tx.schoolClass.count({ where: { id: { in: classIds }, schoolId: params.schoolId } });
    if (validCount !== classIds.length) throw notFound("이 학교의 학급이 아닌 항목이 있습니다.");

    const before = membership.assignments.map((a) => ({ classId: a.classId, duty: a.duty }));
    await tx.classAssignment.deleteMany({ where: { membershipId: membership.id } });
    if (params.assignments.length > 0) {
      await tx.classAssignment.createMany({
        data: params.assignments.map((a) => ({ membershipId: membership.id, classId: a.classId, duty: a.duty })),
        skipDuplicates: true,
      });
    }
    if (params.role && membership.role !== "admin") {
      await tx.schoolMembership.update({ where: { id: membership.id }, data: { role: params.role } });
    }
    await writeAudit(tx, {
      schoolId: params.schoolId,
      actorUserId: params.actorUserId,
      action: "membership.assignments_set",
      targetType: "membership",
      targetId: membership.id,
      before,
      after: { role: params.role ?? membership.role, assignments: params.assignments },
      ip: params.ip,
    });
    return { assigned: params.assignments.length };
  });
}

// ───────────── 관리자: 권한 회수(세션 즉시 무효화) ─────────────
export async function revokeMembership(
  prisma: PrismaClient,
  params: { schoolId: string; actorUserId: string; membershipId: string; actorRole?: MemberRole; ip?: string | null },
) {
  return prisma.$transaction(async (tx) => {
    const membership = await tx.schoolMembership.findFirst({ where: { id: params.membershipId, schoolId: params.schoolId } });
    if (!membership) throw notFound("교직원을 찾을 수 없습니다.");
    if (membership.userId === params.actorUserId) throw conflict("cannot_revoke_self", "자기 자신의 권한은 회수할 수 없습니다.");
    // STEP 3-D: 플랫폼 운영자가 자격을 확인한 학교 관리자(admin)는 다른 관리자만 회수할 수 있음(앱 운영담당은 불가)
    if (membership.role === "admin" && params.actorRole && params.actorRole !== "admin") {
      throw forbidden("학교 관리자의 권한은 다른 학교 관리자만 회수할 수 있습니다.");
    }
    // STEP 3-D: 교장·교감 직책(플랫폼 운영자가 기관 확인 후 등록)이 있는 계정은 앱에서 회수하지 않음 — 직책 종료는 플랫폼 운영자 도구로
    const position = await tx.memberDuty.count({ where: { membershipId: membership.id, endedAt: null, duty: { in: ["principal", "vice_principal"] } } });
    if (position > 0) {
      throw forbidden("교장·교감 직책이 등록된 계정은 앱에서 회수할 수 없습니다. 전보·퇴직 등은 플랫폼 운영자에게 직책 종료를 요청하세요.");
    }
    if (membership.role === "admin") {
      const otherAdmins = await tx.schoolMembership.count({
        where: { schoolId: params.schoolId, role: "admin", status: "approved", id: { not: membership.id } },
      });
      if (otherAdmins === 0) throw conflict("last_admin", "마지막 관리자의 권한은 회수할 수 없습니다.");
    }
    // STEP 3-D: 교직원 승인 권한을 가진 사람이 한 명도 남지 않게 되는 회수 방지
    if (membership.status === "approved" && (await countOperators(tx, params.schoolId)) > 0 && (await countOperators(tx, params.schoolId, membership.id)) === 0) {
      throw conflict("last_operator", "교직원 승인 권한을 가진 마지막 사람의 권한은 회수할 수 없습니다. 먼저 다른 앱 운영담당을 지정하세요.");
    }
    await tx.schoolMembership.update({ where: { id: membership.id }, data: { status: "revoked", revokedAt: new Date() } });
    await tx.classAssignment.deleteMany({ where: { membershipId: membership.id } });
    // STEP 3-D: 진행 중인 직책·업무도 함께 종료(기록은 보존)
    const endedDuties = await tx.memberDuty.updateMany({
      where: { membershipId: membership.id, endedAt: null },
      data: { endedAt: new Date(), endedById: params.actorUserId, endReason: "교직원 권한 회수" },
    });
    const { count } = await tx.session.deleteMany({ where: { userId: membership.userId } });
    await writeAudit(tx, {
      schoolId: params.schoolId,
      actorUserId: params.actorUserId,
      action: "membership.revoked",
      targetType: "membership",
      targetId: membership.id,
      after: { sessionsInvalidated: count, dutiesEnded: endedDuties.count },
      ip: params.ip,
    });
    return { sessionsInvalidated: count };
  });
}
