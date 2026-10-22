// STEP 3-D 직책·업무 지정·종료(겸임 가능, 기록 보존)
// - 앱에서(앱 운영담당·기존 관리자): 안전업무 담당·앱 운영담당만 지정·해제. 교장·교감 직책은 지정 불가, 자기 자신에게 지정 불가
// - 플랫폼 운영자 도구(npm run operator): 교장(1명)·교감(최대 2명) 직책 등록·종료, 업무 지정(최초 운영담당 등)
// - 마지막 운영 권한자(교직원 승인 가능자)가 사라지는 해제는 막음
// - 지정·해제는 모두 감사 기록. 계정은 그대로 두고 권한만 바뀜
import type { Prisma, PrismaClient } from "@prisma/client";
import { AppError, conflict, forbidden, isUniqueViolation, notFound } from "../errors.js";
import { writeAudit } from "./audit.js";
import { countOperators, lockSchoolOperators } from "./access.js";
import { APP_GRANTABLE_DUTIES, DUTY_LABEL, type StaffDuty } from "../../../shared/permissions.js";

type Db = PrismaClient | Prisma.TransactionClient;

function dbGuard(error: unknown): never {
  if (isUniqueViolation(error)) throw conflict("duty_exists", "이미 그 직책·업무를 맡고 있거나, 학교당 인원 한도(교장 1명)를 넘습니다.");
  const text = error instanceof Error ? error.message : String(error);
  if (text.includes("교감은 학교당 최대 2명")) throw conflict("vice_limit", "교감은 학교당 최대 2명까지 등록할 수 있습니다(현재 서비스 정책).");
  if (text.includes("승인된 교직원")) throw conflict("membership_not_approved", "가입이 승인된 교직원에게만 지정할 수 있습니다.");
  if (text.includes("같은 학교 교직원")) throw notFound("교직원을 찾을 수 없습니다.");
  throw error;
}

export async function listDuties(db: Db, schoolId: string) {
  const rows = await db.memberDuty.findMany({
    where: { schoolId },
    include: {
      membership: { select: { id: true, role: true, status: true, user: { select: { displayName: true } } } },
      grantedBy: { select: { displayName: true } },
      endedBy: { select: { displayName: true } },
    },
    orderBy: [{ endedAt: { sort: "desc", nulls: "first" } }, { startedAt: "desc" }],
    take: 300,
  });
  return {
    duties: rows.map((d: any) => ({
      id: d.id,
      membershipId: d.membershipId,
      name: d.membership.user.displayName,
      duty: d.duty,
      label: DUTY_LABEL[d.duty as StaffDuty],
      isActing: d.isActing,
      grantedVia: d.grantedVia,
      grantedBy: d.grantedBy?.displayName ?? d.grantedByLabel ?? null,
      startedAt: d.startedAt.toISOString(),
      endedAt: d.endedAt?.toISOString() ?? null,
      endedBy: d.endedBy?.displayName ?? d.endedByLabel ?? null,
      endReason: d.endReason,
    })),
  };
}

/** 앱에서 업무 지정(안전업무 담당·앱 운영담당). 권한 검사(duties.manage)는 라우트에서 */
export async function grantDutyInApp(
  prisma: PrismaClient,
  params: { schoolId: string; actorUserId: string; membershipId: string; duty: StaffDuty; note?: string | null; ip?: string | null },
) {
  if (!APP_GRANTABLE_DUTIES.includes(params.duty)) {
    throw forbidden("교장·교감 직책은 앱에서 지정할 수 없습니다. 기관 확인 후 플랫폼 운영자가 등록합니다.");
  }
  return prisma.$transaction(async (tx) => {
    const m = await tx.schoolMembership.findFirst({ where: { id: params.membershipId, schoolId: params.schoolId }, select: { id: true, userId: true, status: true } });
    if (!m) throw notFound("교직원을 찾을 수 없습니다.");
    if (m.status !== "approved") throw conflict("membership_not_approved", "가입이 승인된 교직원에게만 지정할 수 있습니다.");
    // 스스로 권한을 늘리지 못하게: 자기 자신에게는 지정 불가(다른 앱 운영담당·관리자 또는 플랫폼 운영자가 지정)
    if (m.userId === params.actorUserId) {
      throw forbidden("자기 자신에게는 업무를 지정할 수 없습니다. 다른 앱 운영담당이나 플랫폼 운영자에게 요청하세요.");
    }
    let created;
    try {
      created = await tx.memberDuty.create({
        data: { schoolId: params.schoolId, membershipId: m.id, duty: params.duty, grantedVia: "school_app", grantedById: params.actorUserId, note: params.note || null },
        select: { id: true },
      });
    } catch (e) {
      dbGuard(e);
    }
    await writeAudit(tx, {
      schoolId: params.schoolId,
      actorUserId: params.actorUserId,
      action: "duty.granted",
      targetType: "membership",
      targetId: m.id,
      after: { dutyId: created.id, duty: params.duty, self: m.userId === params.actorUserId },
      ip: params.ip,
    });
    return { id: created.id };
  });
}

/** 업무 종료(해제). 앱에서는 안전업무 담당·앱 운영담당만, 마지막 운영 권한자 보호 */
export async function endDuty(
  prisma: PrismaClient,
  params: { schoolId: string; dutyId: string; reason: string; actorUserId?: string | null; actorLabel?: string | null; via: "school_app" | "platform_operator"; ip?: string | null },
) {
  return prisma.$transaction(async (tx) => {
    await lockSchoolOperators(tx, params.schoolId); // 동시 해제로 운영자가 0명이 되지 않게
    const d = await tx.memberDuty.findFirst({ where: { id: params.dutyId, schoolId: params.schoolId } });
    if (!d) throw notFound("직책·업무 기록을 찾을 수 없습니다.");
    if (d.endedAt) throw conflict("duty_ended", "이미 종료된 직책·업무입니다.");
    if (params.via === "school_app" && !APP_GRANTABLE_DUTIES.includes(d.duty as StaffDuty)) {
      throw forbidden("교장·교감 직책은 앱에서 종료할 수 없습니다. 플랫폼 운영자에게 요청하세요.");
    }
    if (d.duty === "app_operator" && (await countOperators(tx, params.schoolId, undefined, d.id)) === 0) {
      throw conflict("last_operator", "교직원 승인 권한을 가진 마지막 사람입니다. 먼저 다른 앱 운영담당을 지정하세요.");
    }
    const { count } = await tx.memberDuty.updateMany({
      where: { id: d.id, endedAt: null },
      data: { endedAt: new Date(), endedById: params.actorUserId ?? null, endedByLabel: params.actorLabel ?? null, endReason: params.reason },
    });
    if (count === 0) throw conflict("duty_ended", "이미 종료된 직책·업무입니다.");
    await writeAudit(tx, {
      schoolId: params.schoolId,
      actorUserId: params.actorUserId ?? null,
      action: "duty.ended",
      targetType: "membership",
      targetId: d.membershipId,
      before: { dutyId: d.id, duty: d.duty },
      after: { reason: params.reason, via: params.via, by: params.actorLabel ?? undefined },
      ip: params.ip,
    });
    return { id: d.id };
  });
}

/** 플랫폼 운영자 도구 전용: 교장·교감 직책(확인 방법 필수) 또는 업무 등록 */
export async function grantDutyByPlatformOperator(
  prisma: PrismaClient,
  params: { membershipId: string; duty: StaffDuty; operator: string; verificationMethod?: string | null; isActing?: boolean; note?: string | null },
) {
  const position = params.duty === "principal" || params.duty === "vice_principal";
  if (position && !params.verificationMethod?.trim()) throw new AppError(400, "verification_required", "교장·교감 등록에는 확인 방법(--method)이 필요합니다.");
  return prisma.$transaction(async (tx) => {
    const m = await tx.schoolMembership.findUnique({ where: { id: params.membershipId }, select: { id: true, schoolId: true } });
    if (!m) throw notFound("교직원 소속을 찾을 수 없습니다.");
    let created;
    try {
      created = await tx.memberDuty.create({
        data: {
          schoolId: m.schoolId,
          membershipId: m.id,
          duty: params.duty,
          isActing: position ? !!params.isActing : false,
          grantedVia: "platform_operator",
          grantedByLabel: params.operator.slice(0, 50),
          verificationMethod: params.verificationMethod?.trim().slice(0, 100) || null,
          note: params.note || null,
        },
        select: { id: true },
      });
    } catch (e) {
      dbGuard(e);
    }
    await writeAudit(tx, {
      schoolId: m.schoolId,
      action: "duty.granted",
      targetType: "membership",
      targetId: m.id,
      after: { dutyId: created.id, duty: params.duty, via: "platform_operator", by: params.operator, method: params.verificationMethod ?? null, acting: !!params.isActing },
    });
    return { id: created.id, schoolId: m.schoolId };
  });
}
