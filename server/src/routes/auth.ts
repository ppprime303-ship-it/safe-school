// 교직원 계정: 가입 → 이메일 인증 → 로그인. 학교 소속은 routes/schools.ts 에서 따로 신청합니다.
import { capabilitiesFor } from "../../../shared/permissions.js";
import { Router } from "express";
import { prisma } from "../db.js";
import { AppError, conflict, isUniqueViolation } from "../errors.js";
import { parse } from "../validate.js";
import { issueEmailCode, revokeEmailCode, verifyEmailCode } from "../auth/emailCode.js";
import {
  clearSessionCookie,
  createSession,
  requireAuth,
  setSessionCookie,
} from "../auth/session.js";
import { requireMailConfigured, sendMail } from "../mail/mailer.js";
import { rateLimit } from "../middleware/security.js";
import { hashPassword, verifyPassword } from "../security/password.js";
import { writeAudit } from "../services/audit.js";
import { loginSchema, reauthSchema, resendSchema, signupSchema, verifyEmailSchema } from "../../../shared/schemas.js";

export const authRouter = Router();

const authLimiter = rateLimit({ windowMs: 15 * 60 * 1000, max: 30 });

// 코드 발급 → 메일 발송. 발송에 실패하면 방금 만든 코드를 지워(발송 한도 미소모) 오류를 그대로 돌려줍니다.
async function sendSignupCode(userId: string, email: string) {
  const { code, id } = await issueEmailCode(prisma, { userId, purpose: "signup" });
  let result;
  try {
    result = await sendMail({
      to: email,
      subject: "[SAFE SCHOOL] 이메일 인증코드",
      text: `SAFE SCHOOL 인증코드: ${code}\n10분 안에 입력해 주세요. 본인이 요청하지 않았다면 이 메일을 무시하세요.`,
    });
  } catch (error) {
    await revokeEmailCode(prisma, id);
    throw error;
  }
  // 모의 발송(개발·테스트 전용)일 때만 화면 확인용 코드를 돌려줍니다. 실제 메일 발송이나 운영 환경에서는 절대 반환하지 않습니다.
  return result.delivered === "test_console" ? { delivery: result.delivered, devCode: code } : { delivery: result.delivered };
}

// STEP 7-D 가입 선점 방지: 가입 요청은 비밀번호를 저장하지 않습니다. 비밀번호는 메일로 받은 코드를 가진 사람(메일 소유자)이
// verify-email 에서 정합니다. 그래서 남의 이메일로 먼저 가입해 둔 사람의 비밀번호가 계정에 남지 않습니다.
authRouter.post("/auth/signup", authLimiter, async (req, res) => {
  const input = parse(signupSchema, req.body);
  requireMailConfigured(); // 보낼 수 없으면 계정도 만들지 않음
  let user = await prisma.user.findUnique({ where: { email: input.email } });
  if (user?.emailVerifiedAt) throw conflict("email_in_use", "이미 가입된 이메일입니다. 로그인하세요.");

  // 인증 전 계정이 이미 있으면 아무것도 바꾸지 않고 코드만 새로 보냅니다(새 가입과 같은 응답 — 가입 신청 여부를 드러내지 않음).
  let created = false;
  if (!user) {
    try {
      user = await prisma.user.create({ data: { email: input.email, displayName: input.displayName, passwordHash: null } });
      created = true;
    } catch (error) {
      if (!isUniqueViolation(error)) throw error;
      user = await prisma.user.findUniqueOrThrow({ where: { email: input.email } }); // 동시에 같은 이메일로 가입
      if (user.emailVerifiedAt) throw conflict("email_in_use", "이미 가입된 이메일입니다. 로그인하세요.");
    }
  }

  try {
    const sent = await sendSignupCode(user.id, user.email);
    res.status(201).json({ ok: true, email: user.email, ...sent });
  } catch (error) {
    // 이번 요청이 만든 계정은 코드를 보내지 못했으면 남기지 않습니다(인증 전·코드 없음일 때만).
    if (created) await prisma.user.deleteMany({ where: { id: user.id, emailVerifiedAt: null, verifications: { none: {} } } });
    throw error;
  }
});

authRouter.post("/auth/resend-code", authLimiter, async (req, res) => {
  const input = parse(resendSchema, req.body);
  requireMailConfigured(); // 가입 여부와 관계없이 같은 결과
  const user = await prisma.user.findUnique({ where: { email: input.email } });
  // 가입 여부를 드러내지 않도록 항상 같은 응답
  if (!user || user.emailVerifiedAt) return res.json({ ok: true });
  res.json({ ok: true, ...(await sendSignupCode(user.id, user.email)) });
});

authRouter.post("/auth/verify-email", authLimiter, async (req, res) => {
  const input = parse(verifyEmailSchema, req.body);
  const invalid = new AppError(400, "invalid_code", "인증코드가 맞지 않거나 만료되었습니다.");
  const user = await prisma.user.findUnique({ where: { email: input.email } });
  if (!user) throw invalid;
  if (user.emailVerifiedAt) throw conflict("already_verified", "이미 인증된 이메일입니다. 로그인하세요.");

  const passwordHash = await hashPassword(input.password); // 코드를 소비하기 전에(느린 작업)
  // 코드가 맞을 때만 자격증명을 확정합니다. 코드 소비·계정 확정·감사 기록은 한 트랜잭션(중간 DB 오류 시 모두 취소 → 같은 코드로 재시도 가능).
  // 같은 계정을 동시에 인증해도 한 번만 반영(emailVerifiedAt 조건, 실패한 쪽은 코드 소비도 취소).
  await verifyEmailCode(prisma, { userId: user.id, purpose: "signup", code: input.code }, async (tx) => {
    const updated = await tx.user.updateMany({
      where: { id: user.id, emailVerifiedAt: null },
      data: { emailVerifiedAt: new Date(), passwordHash, ...(input.displayName ? { displayName: input.displayName } : {}) },
    });
    if (updated.count !== 1) throw conflict("already_verified", "이미 인증된 이메일입니다. 로그인하세요.");
    await tx.userIdentity.upsert({
      where: { provider_providerSubject: { provider: "password", providerSubject: user.id } },
      update: {},
      create: { userId: user.id, provider: "password", providerSubject: user.id },
    });
    await writeAudit(tx, { actorUserId: user.id, action: "user.email_verified", targetType: "user", targetId: user.id, ip: req.ip });
  });
  const session = await createSession(prisma, {
    userId: user.id,
    deviceKind: input.deviceKind,
    userAgent: req.headers["user-agent"],
    ip: req.ip,
    reauth: true,
  });
  setSessionCookie(res, session);
  res.json({ ok: true });
});

authRouter.post("/auth/login", authLimiter, async (req, res) => {
  const input = parse(loginSchema, req.body);
  const user = await prisma.user.findUnique({ where: { email: input.email } });
  const ok = !!user?.passwordHash && (await verifyPassword(input.password, user.passwordHash));
  if (!user || !ok) {
    throw new AppError(401, "invalid_credentials", "이메일 또는 비밀번호가 맞지 않습니다. 가입 인증을 마치지 않았다면 '교직원 가입'에서 인증코드를 다시 받으세요.");
  }
  if (user.status !== "active") throw new AppError(403, "account_disabled", "사용할 수 없는 계정입니다.");
  if (!user.emailVerifiedAt) throw new AppError(403, "email_not_verified", "이메일 인증을 먼저 완료하세요.");

  const session = await createSession(prisma, {
    userId: user.id,
    deviceKind: input.deviceKind,
    userAgent: req.headers["user-agent"],
    ip: req.ip,
    reauth: true,
  });
  setSessionCookie(res, session);
  await writeAudit(prisma, { actorUserId: user.id, action: "user.login", targetType: "user", targetId: user.id, after: { deviceKind: input.deviceKind }, ip: req.ip });
  res.json({ ok: true });
});

authRouter.post("/auth/logout", async (req, res) => {
  if (req.auth) await prisma.session.delete({ where: { id: req.auth.sessionId } }).catch(() => undefined);
  clearSessionCookie(res);
  res.json({ ok: true });
});

// 관리자 중요 작업 전 비밀번호 재확인(10분 유효)
authRouter.post("/auth/reauth", requireAuth, authLimiter, async (req, res) => {
  const input = parse(reauthSchema, req.body);
  const user = await prisma.user.findUnique({ where: { id: req.auth!.userId } });
  if (!user?.passwordHash || !(await verifyPassword(input.password, user.passwordHash))) {
    throw new AppError(401, "invalid_credentials", "비밀번호가 맞지 않습니다.");
  }
  await prisma.session.update({ where: { id: req.auth!.sessionId }, data: { reauthAt: new Date() } });
  res.json({ ok: true });
});

authRouter.get("/auth/me", requireAuth, async (req, res) => {
  const user = await prisma.user.findUnique({
    where: { id: req.auth!.userId },
    include: {
      memberships: {
        include: {
          // STEP 5: eduOfficeName(학교알리미 등록 정보의 관할 교육청명, 본인 소속 학교만) — 시설 안전 자료의 관할 교육청 우선 표시용
          school: { select: { id: true, name: true, status: true, isDemo: true, schoolKindCode: true, eduOfficeName: true } },
          assignments: { include: { schoolClass: { select: { id: true, label: true, schoolYear: true } } } },
          duties: { where: { endedAt: null }, select: { duty: true, isActing: true } },
        },
      },
      registrations: { select: { id: true, schoolId: true, status: true, createdAt: true } },
    },
  });
  if (!user) throw new AppError(401, "unauthenticated", "로그인이 필요합니다.");
  res.json({
    user: { id: user.id, email: user.email, displayName: user.displayName, emailVerified: !!user.emailVerifiedAt },
    deviceKind: req.auth!.deviceKind,
    memberships: user.memberships.map((m) => ({
      id: m.id,
      role: m.role,
      status: m.status,
      school: m.school,
      assignments: m.assignments.map((a) => ({ duty: a.duty, class: a.schoolClass })),
      // STEP 3-D: 직책·업무와 합산 권한(화면 표시용 — 서버는 요청마다 다시 검사)
      duties: m.duties.map((d) => d.duty),
      actingDuties: m.duties.filter((d) => d.isActing).map((d) => d.duty),
      capabilities: m.status === "approved" ? capabilitiesFor(m.role, m.duties.map((d) => d.duty)) : [],
    })),
    registrations: user.registrations,
  });
});
