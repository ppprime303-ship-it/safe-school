// 교직원 계정: 가입 → 이메일 인증 → 로그인. 학교 소속은 routes/schools.ts 에서 따로 신청합니다.
import { Router } from "express";
import { prisma } from "../db.js";
import { AppError, conflict } from "../errors.js";
import { parse } from "../validate.js";
import { issueEmailCode, verifyEmailCode } from "../auth/emailCode.js";
import {
  clearSessionCookie,
  createSession,
  requireAuth,
  setSessionCookie,
} from "../auth/session.js";
import { sendMail } from "../mail/mailer.js";
import { rateLimit } from "../middleware/security.js";
import { hashPassword, verifyPassword } from "../security/password.js";
import { writeAudit } from "../services/audit.js";
import { loginSchema, reauthSchema, resendSchema, signupSchema, verifyEmailSchema } from "../../../shared/schemas.js";

export const authRouter = Router();

const authLimiter = rateLimit({ windowMs: 15 * 60 * 1000, max: 30 });

async function sendSignupCode(userId: string, email: string) {
  const code = await issueEmailCode(prisma, { userId, purpose: "signup" });
  const result = await sendMail({
    to: email,
    subject: "[SAFE SCHOOL] 이메일 인증코드",
    text: `SAFE SCHOOL 인증코드: ${code}\n10분 안에 입력해 주세요. 본인이 요청하지 않았다면 이 메일을 무시하세요.`,
  });
  // 개발 환경에서 메일 설정이 없을 때만 화면 확인용으로 코드를 돌려줍니다(운영에서는 절대 반환하지 않음).
  return result.delivered === "console" && process.env.NODE_ENV !== "production" ? code : undefined;
}

authRouter.post("/auth/signup", authLimiter, async (req, res) => {
  const input = parse(signupSchema, req.body);
  const existing = await prisma.user.findUnique({ where: { email: input.email } });
  if (existing?.emailVerifiedAt) throw conflict("email_in_use", "이미 가입된 이메일입니다. 로그인하세요.");

  const passwordHash = await hashPassword(input.password);
  const user = existing
    ? await prisma.user.update({ where: { id: existing.id }, data: { displayName: input.displayName, passwordHash } })
    : await prisma.user.create({ data: { email: input.email, displayName: input.displayName, passwordHash } });

  const devCode = await sendSignupCode(user.id, user.email);
  res.status(201).json({ ok: true, email: user.email, ...(devCode ? { devCode } : {}) });
});

authRouter.post("/auth/resend-code", authLimiter, async (req, res) => {
  const input = parse(resendSchema, req.body);
  const user = await prisma.user.findUnique({ where: { email: input.email } });
  // 가입 여부를 드러내지 않도록 항상 같은 응답
  if (!user || user.emailVerifiedAt) return res.json({ ok: true });
  const devCode = await sendSignupCode(user.id, user.email);
  res.json({ ok: true, ...(devCode ? { devCode } : {}) });
});

authRouter.post("/auth/verify-email", authLimiter, async (req, res) => {
  const input = parse(verifyEmailSchema, req.body);
  const user = await prisma.user.findUnique({ where: { email: input.email } });
  if (!user) throw new AppError(400, "invalid_code", "인증코드가 맞지 않거나 만료되었습니다.");
  if (!user.emailVerifiedAt) {
    await verifyEmailCode(prisma, { userId: user.id, purpose: "signup", code: input.code });
    await prisma.$transaction([
      prisma.user.update({ where: { id: user.id }, data: { emailVerifiedAt: new Date() } }),
      prisma.userIdentity.upsert({
        where: { provider_providerSubject: { provider: "password", providerSubject: user.id } },
        update: {},
        create: { userId: user.id, provider: "password", providerSubject: user.id },
      }),
    ]);
    await writeAudit(prisma, { actorUserId: user.id, action: "user.email_verified", targetType: "user", targetId: user.id, ip: req.ip });
  } else {
    throw conflict("already_verified", "이미 인증된 이메일입니다. 로그인하세요.");
  }
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
  if (!user || !ok) throw new AppError(401, "invalid_credentials", "이메일 또는 비밀번호가 맞지 않습니다.");
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
          school: { select: { id: true, name: true, status: true, isDemo: true } },
          assignments: { include: { schoolClass: { select: { id: true, label: true, schoolYear: true } } } },
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
    })),
    registrations: user.registrations,
  });
});
