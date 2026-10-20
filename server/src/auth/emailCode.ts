// 이메일 인증코드(6자리): 10분 유효, 5회 틀리면 무효, 재발송 60초 간격·1시간 5회
import type { PrismaClient, VerificationPurpose } from "@prisma/client";
import { createHash, randomInt, timingSafeEqual } from "node:crypto";
import { AppError } from "../errors.js";

const CODE_TTL_MS = 10 * 60 * 1000;
const MAX_ATTEMPTS = 5;
const RESEND_INTERVAL_MS = 60 * 1000;
const MAX_PER_HOUR = 5;

const hashCode = (userId: string, code: string) => createHash("sha256").update(`${userId}:${code}`).digest("hex");

export async function issueEmailCode(prisma: PrismaClient, params: { userId: string; purpose: VerificationPurpose }) {
  const since = new Date(Date.now() - 3600_000);
  const recent = await prisma.emailVerification.findMany({
    where: { userId: params.userId, purpose: params.purpose, createdAt: { gte: since } },
    orderBy: { createdAt: "desc" },
  });
  const last = recent[0];
  if (last && Date.now() - last.createdAt.getTime() < RESEND_INTERVAL_MS) {
    throw new AppError(429, "code_resend_too_soon", "인증코드는 1분 뒤에 다시 받을 수 있습니다.");
  }
  if (recent.length >= MAX_PER_HOUR) {
    throw new AppError(429, "code_resend_limit", "인증코드 요청이 너무 많습니다. 1시간 뒤에 다시 시도하세요.");
  }
  const code = String(randomInt(0, 1_000_000)).padStart(6, "0");
  await prisma.emailVerification.create({
    data: {
      userId: params.userId,
      purpose: params.purpose,
      codeHash: hashCode(params.userId, code),
      expiresAt: new Date(Date.now() + CODE_TTL_MS),
    },
  });
  return code;
}

export async function verifyEmailCode(
  prisma: PrismaClient,
  params: { userId: string; purpose: VerificationPurpose; code: string },
): Promise<void> {
  const record = await prisma.emailVerification.findFirst({
    where: { userId: params.userId, purpose: params.purpose, consumedAt: null },
    orderBy: { createdAt: "desc" },
  });
  const invalid = new AppError(400, "invalid_code", "인증코드가 맞지 않거나 만료되었습니다.");
  if (!record || record.expiresAt <= new Date() || record.attempts >= MAX_ATTEMPTS) throw invalid;

  const expected = Buffer.from(record.codeHash, "hex");
  const actual = Buffer.from(hashCode(params.userId, params.code.trim()), "hex");
  if (expected.length !== actual.length || !timingSafeEqual(expected, actual)) {
    await prisma.emailVerification.update({ where: { id: record.id }, data: { attempts: { increment: 1 } } });
    throw invalid;
  }
  await prisma.emailVerification.update({ where: { id: record.id }, data: { consumedAt: new Date() } });
}
