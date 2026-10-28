// 최초 학교 등록과 관리자 자격 확인
//
// 정책
// - 학교 기본정보는 학교알리미 목록에서 가져오며 신청자가 다시 입력하지 않습니다.
// - 학교알리미 학교코드로 중복 등록을 막습니다(이미 등록된 학교면 '가입 신청'으로 안내).
// - 첫 신청자라고 관리자 권한을 자동으로 주지 않습니다. 학교와 신청자 소속은 '관리자 승인 대기'로 남고,
//   SAFE SCHOOL 운영자가 자격(예: 공문, 학교 대표전화 확인)을 확인해 승인해야 학교 공간이 활성화됩니다.
import type { Prisma, PrismaClient } from "@prisma/client";
import { randomBytes } from "node:crypto";
import { AppError, conflict, forbidden, isUniqueViolation, notFound } from "../errors.js";
import { writeAudit } from "./audit.js";
import { saveBasicInfoSnapshot } from "./publicData.js";

function newSlug(): string {
  return `s-${randomBytes(5).toString("hex")}`; // 추측하기 어려운 공개 페이지 주소
}

export async function applyForSchoolRegistration(
  prisma: PrismaClient,
  params: { userId: string; externalCode: string; applicantPosition?: string; ip?: string | null },
) {
  const user = await prisma.user.findUnique({ where: { id: params.userId } });
  if (!user || user.status !== "active") throw forbidden("사용할 수 없는 계정입니다.");
  if (!user.emailVerifiedAt) throw forbidden("이메일 인증을 먼저 완료하세요.");

  const already = await prisma.schoolExternalId.findUnique({
    where: { source_externalCode: { source: "schoolinfo", externalCode: params.externalCode } },
    include: { school: { select: { id: true, name: true, status: true } } },
  });
  if (already) {
    throw conflict("school_already_registered", "이미 등록된 학교입니다. 학교 가입 신청을 진행하세요.", {
      schoolId: already.school.id,
      schoolStatus: already.school.status,
    });
  }

  const entry = await prisma.schoolDirectoryEntry.findUnique({
    where: { source_externalCode: { source: "schoolinfo", externalCode: params.externalCode } },
  });
  if (!entry) throw notFound("학교 목록에서 찾을 수 없습니다. 학교 검색을 다시 해 주세요.");
  if (entry.closed) throw new AppError(422, "school_closed", "폐교로 표시된 학교는 등록할 수 없습니다.");

  try {
    return await prisma.$transaction(async (tx) => {
      const school = await tx.school.create({
        data: {
          name: entry.name,
          slug: newSlug(),
          schoolKindCode: entry.kindCode,
          address: entry.address,
          eduOfficeName: entry.eduOfficeName,
          infoSource: "schoolinfo",
          infoSyncedAt: entry.syncedAt,
          status: "pending_verification",
        },
      });
      await tx.schoolExternalId.create({
        data: { schoolId: school.id, source: "schoolinfo", externalCode: entry.externalCode },
      });
      const membership = await tx.schoolMembership.create({
        data: { schoolId: school.id, userId: user.id, role: "admin", status: "pending" },
      });
      const registration = await tx.schoolRegistration.create({
        data: {
          schoolId: school.id,
          applicantUserId: user.id,
          applicantPosition: params.applicantPosition?.trim() || null,
          status: "pending_verification",
        },
      });
      await saveBasicInfoSnapshot(tx, {
        schoolId: school.id,
        kindCode: entry.kindCode ?? "",
        sidoCode: entry.sidoCode,
        row: entry.raw as Prisma.JsonObject,
      });
      await writeAudit(tx, {
        schoolId: school.id,
        actorUserId: user.id,
        action: "school.registration_applied",
        targetType: "school_registration",
        targetId: registration.id,
        after: { externalCode: entry.externalCode, name: entry.name, position: registration.applicantPosition },
        ip: params.ip,
      });
      return { school, membership, registration };
    });
  } catch (error) {
    // 두 사람이 동시에 같은 학교를 신청한 경우
    if (isUniqueViolation(error)) {
      throw conflict("school_already_registered", "방금 다른 교직원이 이 학교를 등록했습니다. 학교 가입 신청을 진행하세요.");
    }
    throw error;
  }
}

// SAFE SCHOOL 운영자가 관리자 자격을 확인한 뒤 승인·거절합니다(학교 사용자 권한으로는 호출 불가).
export async function reviewSchoolRegistration(
  prisma: PrismaClient,
  params: {
    registrationId: string;
    decision: "approve" | "reject";
    reviewer: string;
    verificationMethod?: string;
    note?: string;
  },
) {
  if (!params.reviewer.trim()) throw new AppError(400, "bad_request", "확인자(운영자) 이름이 필요합니다.");
  if (params.decision === "approve" && !params.verificationMethod?.trim()) {
    throw new AppError(400, "bad_request", "승인하려면 자격 확인 방법을 적어야 합니다(예: 공문, 학교 대표전화 확인).");
  }

  return prisma.$transaction(async (tx) => {
    const reg = await tx.schoolRegistration.findUnique({ where: { id: params.registrationId } });
    if (!reg) throw notFound("등록 신청을 찾을 수 없습니다.");
    if (reg.status !== "pending_verification") {
      throw conflict("registration_not_pending", `이미 처리된 신청입니다(${reg.status}).`);
    }
    const now = new Date();
    const changed = await tx.schoolRegistration.updateMany({
      where: { id: reg.id, status: "pending_verification" },
      data: {
        status: params.decision === "approve" ? "approved" : "rejected",
        verificationMethod: params.verificationMethod?.trim() || null,
        verificationNote: params.note?.trim() || null,
        reviewedBy: params.reviewer.trim(),
        reviewedAt: now,
      },
    });
    if (changed.count !== 1) throw conflict("registration_not_pending", "이미 처리된 신청입니다.");
    const updated = await tx.schoolRegistration.findUniqueOrThrow({ where: { id: reg.id } });

    if (params.decision === "approve") {
      await tx.school.update({ where: { id: reg.schoolId }, data: { status: "active", activatedAt: now } });
      await tx.schoolMembership.update({
        where: { schoolId_userId: { schoolId: reg.schoolId, userId: reg.applicantUserId } },
        data: { status: "approved", role: "admin", approvalMethod: "bootstrap", approvedAt: now },
      });
    } else {
      // 거절: 신청자 소속만 거절. 학교는 '승인 대기'로 남아 다른 교직원이 다시 신청할 수 있음
      await tx.schoolMembership.update({
        where: { schoolId_userId: { schoolId: reg.schoolId, userId: reg.applicantUserId } },
        data: { status: "rejected" },
      });
    }

    await writeAudit(tx, {
      schoolId: reg.schoolId,
      action: params.decision === "approve" ? "school.registration_approved" : "school.registration_rejected",
      targetType: "school_registration",
      targetId: reg.id,
      after: { reviewer: updated.reviewedBy, method: updated.verificationMethod, note: updated.verificationNote },
    });
    return updated;
  });
}

// 신청자 본인만 승인 대기 중인 학교 최초 등록 신청을 철회할 수 있습니다.
// 학교와 학교알리미 매핑은 유지해 학교 중복 생성 및 과거 이력 소실을 방지합니다.
export async function withdrawSchoolRegistration(
  prisma: PrismaClient,
  params: { registrationId: string; userId: string; ip?: string | null },
) {
  return prisma.$transaction(async (tx) => {
    const registration = await tx.schoolRegistration.findUnique({ where: { id: params.registrationId } });
    if (!registration || registration.applicantUserId !== params.userId) {
      throw notFound("등록 신청을 찾을 수 없습니다.");
    }
    if (registration.status !== "pending_verification") {
      throw conflict("registration_not_pending", "승인 대기 중인 신청만 철회할 수 있습니다.");
    }
    const changed = await tx.schoolRegistration.updateMany({
      where: { id: registration.id, applicantUserId: params.userId, status: "pending_verification" },
      data: { status: "withdrawn" },
    });
    if (changed.count !== 1) throw conflict("registration_not_pending", "이미 처리된 신청입니다.");
    await tx.schoolMembership.updateMany({
      where: { schoolId: registration.schoolId, userId: params.userId, role: "admin", status: "pending" },
      data: { status: "rejected" },
    });
    await writeAudit(tx, {
      schoolId: registration.schoolId,
      actorUserId: params.userId,
      action: "school.registration_withdrawn",
      targetType: "school_registration",
      targetId: registration.id,
      before: { status: "pending_verification" },
      after: { status: "withdrawn" },
      ip: params.ip,
    });
    return { registrationId: registration.id, status: "withdrawn" as const };
  });
}

// 거절된 뒤 같은 학교에 다른 교직원이 다시 신청할 때 사용
export async function reapplyForPendingSchool(
  prisma: PrismaClient,
  params: { userId: string; schoolId: string; applicantPosition?: string },
) {
  const user = await prisma.user.findUnique({ where: { id: params.userId } });
  if (!user || user.status !== "active" || !user.emailVerifiedAt) throw forbidden("이메일 인증을 먼저 완료하세요.");
  const school = await prisma.school.findUnique({ where: { id: params.schoolId } });
  if (!school) throw notFound("학교를 찾을 수 없습니다.");
  if (school.status !== "pending_verification") {
    throw conflict("school_not_pending", "이미 활성화된 학교입니다. 학교 가입 신청을 진행하세요.");
  }
  try {
    return await prisma.$transaction(async (tx) => {
      await tx.schoolMembership.upsert({
        where: { schoolId_userId: { schoolId: school.id, userId: params.userId } },
        update: { role: "admin", status: "pending" },
        create: { schoolId: school.id, userId: params.userId, role: "admin", status: "pending" },
      });
      const registration = await tx.schoolRegistration.create({
        data: { schoolId: school.id, applicantUserId: params.userId, applicantPosition: params.applicantPosition ?? null },
      });
      await writeAudit(tx, {
        schoolId: school.id,
        actorUserId: params.userId,
        action: "school.registration_applied",
        targetType: "school_registration",
        targetId: registration.id,
      });
      return registration;
    });
  } catch (error) {
    if (isUniqueViolation(error)) throw conflict("registration_pending", "이 학교에 이미 처리 대기 중인 등록 신청이 있습니다.");
    throw error;
  }
}
