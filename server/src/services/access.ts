// STEP 3-D 기능 권한 검사: 승인된 소속(resolveSchoolAccess) + 직책·업무(member_duties) → 권한 합산(shared/permissions.ts)
// - 소속이 아니면 404, 승인 대기 403(기존과 같음)
// - 권한이 없으면 403. 업무가 종료(회수)되면 다음 요청부터 바로 권한이 사라집니다.
import type { Prisma, PrismaClient } from "@prisma/client";
import { forbidden } from "../errors.js";
import { resolveSchoolAccess } from "./membership.js";
import { CAPABILITY_LABEL, capabilitiesFor, type Capability, type MemberRole, type StaffDuty } from "../../../shared/permissions.js";

type Db = PrismaClient | Prisma.TransactionClient;

export async function activeDuties(db: Db, membershipId: string): Promise<StaffDuty[]> {
  const rows = await db.memberDuty.findMany({ where: { membershipId, endedAt: null }, select: { duty: true } });
  return rows.map((r: { duty: StaffDuty }) => r.duty);
}

export async function resolveAccess(prisma: PrismaClient, params: { userId: string; schoolId: string; need?: Capability | Capability[] }) {
  const membership = await resolveSchoolAccess(prisma, { userId: params.userId, schoolId: params.schoolId });
  const duties = await activeDuties(prisma, membership.id);
  const caps = capabilitiesFor(membership.role as MemberRole, duties);
  const need = params.need === undefined ? [] : Array.isArray(params.need) ? params.need : [params.need];
  const missing = need.filter((c) => !caps.includes(c));
  if (missing.length > 0) {
    throw forbidden(`이 작업 권한(${missing.map((c) => CAPABILITY_LABEL[c]).join(", ")})이 없습니다. 학교 앱 운영담당에게 문의하세요.`);
  }
  return { membership, duties, caps, can: (c: Capability) => caps.includes(c) };
}

/** 학교에 '운영 권한'(교직원 승인)을 가진 승인된 교직원 수: 기존 관리자 + 앱 운영담당(중복 제외) */
export async function countOperators(db: Db, schoolId: string, excludeMembershipId?: string, excludeDutyId?: string): Promise<number> {
  const admins = await db.schoolMembership.findMany({
    where: { schoolId, status: "approved", role: "admin", ...(excludeMembershipId ? { id: { not: excludeMembershipId } } : {}) },
    select: { id: true },
  });
  const ops = await db.memberDuty.findMany({
    where: {
      schoolId,
      duty: "app_operator",
      endedAt: null,
      ...(excludeDutyId ? { id: { not: excludeDutyId } } : {}),
      membership: { status: "approved", ...(excludeMembershipId ? { id: { not: excludeMembershipId } } : {}) },
    },
    select: { membershipId: true },
  });
  return new Set([...admins.map((a: { id: string }) => a.id), ...ops.map((o: { membershipId: string }) => o.membershipId)]).size;
}
