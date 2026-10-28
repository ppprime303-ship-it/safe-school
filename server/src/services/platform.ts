// STEP D 플랫폼 운영관리자: 권한 확인·부여·회수, 신규 학교 등록 승인 목록·상세, 감사 이력
//
// 원칙
// - 학교 관리자와 완전히 분리된 권한입니다. 운영관리자는 신규 학교 '등록 신청'만 다루며 학교 내부 데이터(학급·보고·안내문)에는
//   접근하지 않습니다(학교 업무 API는 여전히 resolveSchoolAccess 의 소속 검사를 거침).
// - 권한은 요청마다 DB에서 다시 확인합니다(세션에 저장하지 않음 → 회수 즉시 차단).
// - 부여·회수는 서버 셸 CLI(scripts/operator.ts)로만 합니다. 웹 API·가입 경로에는 부여 기능이 없습니다.
// - 승인·반려는 CLI 와 같은 reviewSchoolRegistration(원자 처리·자기 승인 금지·감사 로그)을 그대로 씁니다.
import type { Prisma, PrismaClient } from "@prisma/client";
import { AppError, conflict, notFound } from "../errors.js";
import { issueEmailCode } from "../auth/emailCode.js";
import { MANUAL_CODE_TTL_MS, mailMode } from "../mail/mailer.js";
import { writeAudit } from "./audit.js";

type Db = PrismaClient | Prisma.TransactionClient;

/** 유효한(회수되지 않은) 운영관리자 + 활성·이메일 인증 계정일 때만 true */
export async function isPlatformOperator(db: Db, userId: string): Promise<boolean> {
  const row = await db.platformOperator.findFirst({
    where: { userId, revokedAt: null, user: { status: "active", emailVerifiedAt: { not: null } } },
    select: { id: true },
  });
  return !!row;
}

const label = (v: string, name: string, max: number) => {
  const t = v.trim();
  if (!t || t.length > max) throw new AppError(400, "bad_request", `${name}을(를) 1~${max}자로 적으세요.`);
  return t;
};

export async function grantPlatformOperator(prisma: PrismaClient, params: { email: string; by: string; reason: string }) {
  const by = label(params.by, "처리자 이름", 50);
  const reason = label(params.reason, "부여 사유", 200);
  const user = await prisma.user.findUnique({ where: { email: params.email.trim().toLowerCase() } });
  if (!user) throw notFound("해당 이메일의 계정이 없습니다(먼저 가입·이메일 인증이 필요합니다).");
  if (user.status !== "active" || !user.emailVerifiedAt) throw new AppError(422, "user_not_verified", "이메일 인증을 마친 활성 계정에만 부여할 수 있습니다.");
  try {
    return await prisma.$transaction(async (tx) => {
      const row = await tx.platformOperator.create({ data: { userId: user.id, grantedBy: by, grantReason: reason } });
      await writeAudit(tx, { action: "platform.operator_granted", targetType: "user", targetId: user.id, after: { by, reason } });
      return row;
    });
  } catch (error) {
    if ((error as { code?: string }).code === "P2002") throw conflict("already_operator", "이미 운영관리자 권한이 있는 계정입니다.");
    throw error;
  }
}

export async function revokePlatformOperator(prisma: PrismaClient, params: { email: string; by: string; reason: string }) {
  const by = label(params.by, "처리자 이름", 50);
  const reason = label(params.reason, "회수 사유", 200);
  const user = await prisma.user.findUnique({ where: { email: params.email.trim().toLowerCase() } });
  if (!user) throw notFound("해당 이메일의 계정이 없습니다.");
  return prisma.$transaction(async (tx) => {
    const r = await tx.platformOperator.updateMany({
      where: { userId: user.id, revokedAt: null },
      data: { revokedAt: new Date(), revokedBy: by, revokeReason: reason },
    });
    if (r.count === 0) throw conflict("not_operator", "운영관리자 권한이 없는 계정입니다.");
    await writeAudit(tx, { action: "platform.operator_revoked", targetType: "user", targetId: user.id, after: { by, reason } });
    return { revoked: r.count };
  });
}

/**
 * 수동 전달 모드(MAIL_PROVIDER=manual)에서 운영자가 가입자에게 보낼 인증코드를 발급합니다(CLI 전용).
 * 코드는 반환값으로만 운영자 화면에 한 번 보이고 DB에는 해시만 남습니다. 운영자는 자신의 메일함에서 그 주소로 직접 보냅니다.
 * 이메일 '인증 완료'는 가입자가 코드를 입력했을 때만 기록됩니다(운영자 발급만으로는 인증되지 않음).
 */
export async function issueManualEmailCode(prisma: PrismaClient, params: { email: string; by: string }) {
  const by = label(params.by, "처리자 이름", 50);
  if (mailMode() !== "manual") throw new AppError(409, "not_manual_mode", "메일 수동 전달 모드(MAIL_PROVIDER=manual)에서만 사용합니다.");
  const user = await prisma.user.findUnique({ where: { email: params.email.trim().toLowerCase() } });
  if (!user) throw notFound("해당 이메일로 가입 신청한 계정이 없습니다.");
  if (user.emailVerifiedAt) throw conflict("already_verified", "이미 이메일 인증을 마친 계정입니다.");
  if (user.status !== "active") throw new AppError(422, "user_inactive", "사용할 수 없는 계정입니다.");
  const { code } = await issueEmailCode(prisma, { userId: user.id, purpose: "signup", ttlMs: MANUAL_CODE_TTL_MS });
  await writeAudit(prisma, { action: "user.email_code_issued_manually", targetType: "user", targetId: user.id, after: { by, ttlHours: MANUAL_CODE_TTL_MS / 3600_000 } });
  return { code, email: user.email, expiresAt: new Date(Date.now() + MANUAL_CODE_TTL_MS) };
}

/** 이메일 일부 가림(목록용): ab***@school.kr */
export const maskEmail = (email: string) => email.replace(/^(.{1,2}).*(@.*)$/, "$1***$2");

const registrationInclude = {
  school: {
    select: {
      id: true,
      name: true,
      status: true,
      schoolKindCode: true,
      address: true,
      eduOfficeName: true,
      infoSource: true,
      infoSyncedAt: true,
      externalIds: { select: { source: true, externalCode: true } },
    },
  },
  applicant: { select: { id: true, displayName: true, email: true, emailVerifiedAt: true } },
} satisfies Prisma.SchoolRegistrationInclude;

type RegistrationRow = Prisma.SchoolRegistrationGetPayload<{ include: typeof registrationInclude }>;

function summarize(r: RegistrationRow, fullEmail: boolean) {
  return {
    id: r.id,
    status: r.status,
    createdAt: r.createdAt,
    applicantPosition: r.applicantPosition,
    reviewedBy: r.reviewedBy,
    reviewedAt: r.reviewedAt,
    verificationMethod: r.verificationMethod,
    verificationNote: r.verificationNote,
    school: {
      id: r.school.id,
      name: r.school.name,
      status: r.school.status,
      kindCode: r.school.schoolKindCode,
      address: r.school.address,
      eduOfficeName: r.school.eduOfficeName,
      infoSource: r.school.infoSource,
      infoSyncedAt: r.school.infoSyncedAt,
      externalCode: r.school.externalIds.find((x) => x.source === "schoolinfo")?.externalCode ?? null,
    },
    applicant: {
      id: r.applicant.id,
      displayName: r.applicant.displayName,
      // 목록에는 일부만, 상세(신원 확인 연락용)에는 전체
      email: fullEmail ? r.applicant.email : maskEmail(r.applicant.email),
      emailVerified: !!r.applicant.emailVerifiedAt,
    },
  };
}

export async function listRegistrations(prisma: PrismaClient, params: { status: "pending" | "processed"; limit?: number }) {
  const rows = await prisma.schoolRegistration.findMany({
    where: params.status === "pending" ? { status: "pending_verification" } : { status: { in: ["approved", "rejected", "withdrawn"] } },
    include: registrationInclude,
    orderBy: params.status === "pending" ? { createdAt: "asc" } : { reviewedAt: "desc" },
    take: Math.min(params.limit ?? 100, 200),
  });
  const pendingCount = await prisma.schoolRegistration.count({ where: { status: "pending_verification" } });
  return { registrations: rows.map((r) => summarize(r, false)), pendingCount };
}

export async function getRegistrationDetail(prisma: PrismaClient, id: string) {
  const r = await prisma.schoolRegistration.findUnique({ where: { id }, include: registrationInclude });
  if (!r) throw notFound("등록 신청을 찾을 수 없습니다.");
  // 같은 학교의 이전 신청(반려 후 재신청 등) — 신청자 이름만
  const history = await prisma.schoolRegistration.findMany({
    where: { schoolId: r.schoolId, id: { not: r.id } },
    select: { id: true, status: true, createdAt: true, reviewedAt: true, applicant: { select: { displayName: true } } },
    orderBy: { createdAt: "desc" },
    take: 20,
  });
  const audit = await prisma.auditLog.findMany({
    where: { targetType: "school_registration", targetId: r.id },
    select: { action: true, at: true, after: true, actor: { select: { displayName: true } } },
    orderBy: { at: "asc" },
  });
  return {
    registration: summarize(r, true),
    history: history.map((h) => ({ id: h.id, status: h.status, createdAt: h.createdAt, reviewedAt: h.reviewedAt, applicantName: h.applicant.displayName })),
    audit: audit.map((a) => ({ action: a.action, at: a.at, actorName: a.actor?.displayName ?? null, after: a.after })),
  };
}

/** 운영관리자 감사 이력: 학교 등록·운영관리자 권한·수동 인증코드 발급만(학교 내부 업무 기록은 포함하지 않음) */
export const PLATFORM_AUDIT_ACTIONS = [
  "school.registration_applied",
  "school.registration_approved",
  "school.registration_rejected",
  "platform.operator_granted",
  "platform.operator_revoked",
  "user.email_code_issued_manually",
] as const;

export async function listPlatformAudit(prisma: PrismaClient, params: { limit?: number; before?: Date }) {
  const rows = await prisma.auditLog.findMany({
    where: { action: { in: [...PLATFORM_AUDIT_ACTIONS] }, ...(params.before ? { at: { lt: params.before } } : {}) },
    select: { id: true, action: true, at: true, targetType: true, targetId: true, after: true, actor: { select: { displayName: true } }, school: { select: { name: true } } },
    orderBy: { at: "desc" },
    take: Math.min(params.limit ?? 50, 200),
  });
  return rows.map((a) => ({ id: a.id, action: a.action, at: a.at, targetType: a.targetType, targetId: a.targetId, schoolName: a.school?.name ?? null, actorName: a.actor?.displayName ?? null, after: a.after }));
}
