// 로그인 세션
// - 쿠키에는 무작위 토큰만 담고, DB에는 그 해시만 저장합니다(DB가 유출돼도 세션 탈취 불가).
// - 개인 기기: 30일(사용하면 연장), 공용 기기: 8시간 + 30분 미사용 시 만료, 브라우저를 닫으면 쿠키 삭제.
// - 권한 회수 시 sessions 행을 지우면 즉시 로그아웃됩니다.
import type { DeviceKind, PrismaClient } from "@prisma/client";
import { createHash, randomBytes } from "node:crypto";
import type { NextFunction, Request, Response } from "express";
import { SESSION_POLICY } from "../../../shared/constants.js";
import { AppError } from "../errors.js";

export const SESSION_COOKIE = "ss_session";
const LAST_SEEN_WRITE_INTERVAL_MS = 5 * 60 * 1000;

export const hashToken = (token: string) => createHash("sha256").update(token).digest("hex");

function computeExpiry(deviceKind: DeviceKind, now = new Date()) {
  const policy = SESSION_POLICY[deviceKind];
  const expiresAt = new Date(now.getTime() + policy.absoluteHours * 3600_000);
  const idleExpiresAt = policy.idleMinutes ? new Date(now.getTime() + policy.idleMinutes * 60_000) : null;
  return { expiresAt, idleExpiresAt };
}

export async function createSession(
  prisma: PrismaClient,
  params: { userId: string; deviceKind: DeviceKind; userAgent?: string | null; ip?: string | null; reauth?: boolean },
) {
  const token = randomBytes(32).toString("base64url");
  const now = new Date();
  const { expiresAt, idleExpiresAt } = computeExpiry(params.deviceKind, now);
  await prisma.session.create({
    data: {
      id: hashToken(token),
      userId: params.userId,
      deviceKind: params.deviceKind,
      expiresAt,
      idleExpiresAt,
      reauthAt: params.reauth ? now : null, // 비밀번호로 막 로그인했다면 재인증한 것으로 봄
      userAgent: params.userAgent?.slice(0, 300) ?? null,
      ip: params.ip ?? null,
    },
  });
  return { token, expiresAt, deviceKind: params.deviceKind };
}

export function setSessionCookie(res: Response, session: { token: string; expiresAt: Date; deviceKind: DeviceKind }) {
  res.cookie(SESSION_COOKIE, session.token, {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax",
    path: "/",
    // 공용 기기는 브라우저 세션 쿠키(창을 닫으면 삭제)
    ...(session.deviceKind === "personal" ? { expires: session.expiresAt } : {}),
  });
}

export function clearSessionCookie(res: Response) {
  res.clearCookie(SESSION_COOKIE, { path: "/" });
}

function readCookie(req: Request, name: string): string | null {
  const header = req.headers.cookie;
  if (!header) return null;
  for (const part of header.split(";")) {
    const [k, ...v] = part.trim().split("=");
    if (k === name) return decodeURIComponent(v.join("="));
  }
  return null;
}

export interface AuthContext {
  userId: string;
  sessionId: string;
  deviceKind: DeviceKind;
  emailVerified: boolean;
  reauthAt: Date | null;
}

declare global {
  // eslint-disable-next-line @typescript-eslint/no-namespace
  namespace Express {
    interface Request {
      auth?: AuthContext;
    }
  }
}

// 모든 /api 요청에서 세션을 읽어 req.auth 에 넣습니다(없거나 만료되면 비움).
export function loadSession(prisma: PrismaClient) {
  return async (req: Request, res: Response, next: NextFunction) => {
    const token = readCookie(req, SESSION_COOKIE);
    if (!token) return next();
    const id = hashToken(token);
    const session = await prisma.session.findUnique({
      where: { id },
      include: { user: { select: { status: true, emailVerifiedAt: true } } },
    });
    const now = new Date();
    const expired =
      !session ||
      session.expiresAt <= now ||
      (session.idleExpiresAt !== null && session.idleExpiresAt <= now) ||
      session.user.status !== "active";
    if (expired) {
      if (session) await prisma.session.delete({ where: { id } }).catch(() => undefined);
      clearSessionCookie(res);
      return next();
    }

    // 사용 기록·만료 연장(잦은 DB 쓰기를 막기 위해 5분에 한 번)
    if (now.getTime() - session.lastSeenAt.getTime() > LAST_SEEN_WRITE_INTERVAL_MS) {
      const policy = SESSION_POLICY[session.deviceKind];
      const data: { lastSeenAt: Date; idleExpiresAt?: Date; expiresAt?: Date } = { lastSeenAt: now };
      if (policy.idleMinutes) data.idleExpiresAt = new Date(now.getTime() + policy.idleMinutes * 60_000);
      if (session.deviceKind === "personal") data.expiresAt = computeExpiry("personal", now).expiresAt;
      await prisma.session.update({ where: { id }, data });
      if (data.expiresAt) setSessionCookie(res, { token, expiresAt: data.expiresAt, deviceKind: "personal" });
    }

    req.auth = {
      userId: session.userId,
      sessionId: id,
      deviceKind: session.deviceKind,
      emailVerified: !!session.user.emailVerifiedAt,
      reauthAt: session.reauthAt,
    };
    next();
  };
}

export function requireAuth(req: Request, _res: Response, next: NextFunction) {
  if (!req.auth) return next(new AppError(401, "unauthenticated", "로그인이 필요합니다."));
  next();
}

export function requireVerified(req: Request, _res: Response, next: NextFunction) {
  if (!req.auth) return next(new AppError(401, "unauthenticated", "로그인이 필요합니다."));
  if (!req.auth.emailVerified) return next(new AppError(403, "email_not_verified", "이메일 인증을 먼저 완료하세요."));
  next();
}

// 관리자 중요 작업(권한 회수 등): 최근 10분 이내 비밀번호 재확인 필요. 재난 발령에는 쓰지 않습니다.
export function requireRecentReauth(req: Request, _res: Response, next: NextFunction) {
  const at = req.auth?.reauthAt;
  if (!at || Date.now() - at.getTime() > SESSION_POLICY.adminReauthMinutes * 60_000) {
    return next(new AppError(403, "reauth_required", "보안을 위해 비밀번호를 다시 입력해 주세요."));
  }
  next();
}
