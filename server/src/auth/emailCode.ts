// 이메일 인증코드(6자리): 10분 유효, 5회 틀리면 무효, 재발송 60초 간격·1시간 5회
// STEP 7-D: 동시 요청 안전
// - 발급: 사용자별 잠금(트랜잭션 advisory lock) 안에서 간격·한도를 검사하므로 동시에 여러 번 요청해도 한도를 넘지 않습니다.
// - 확인: 비교하기 '전에' 시도 횟수를 먼저 차감하므로 동시에 여러 번 넣어도 5회를 넘겨 맞춰 볼 수 없습니다. 맞으면 한 번만 소비됩니다.
// - 메일 발송 실패 시 revokeEmailCode 로 방금 만든 코드를 지워 발송 한도를 소모하지 않습니다.
import type { Prisma, PrismaClient, VerificationPurpose } from "@prisma/client";
import { createHash, randomInt, timingSafeEqual } from "node:crypto";
import { AppError } from "../errors.js";

const CODE_TTL_MS = 10 * 60 * 1000;
const MAX_ATTEMPTS = 5;
const RESEND_INTERVAL_MS = 60 * 1000;
const MAX_PER_HOUR = 5;

const hashCode = (userId: string, code: string) => createHash("sha256").update(`${userId}:${code}`).digest("hex");

export async function issueEmailCode(prisma: PrismaClient, params: { userId: string; purpose: VerificationPurpose; ttlMs?: number }) {
  return prisma.$transaction(async (tx) => {
    await tx.$queryRaw`SELECT 1 AS locked FROM (SELECT pg_advisory_xact_lock(hashtext(${"email_code:" + params.userId}))) AS l`;
    const since = new Date(Date.now() - 3600_000);
    const recent = await tx.emailVerification.findMany({
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
    const record = await tx.emailVerification.create({
      data: {
        userId: params.userId,
        purpose: params.purpose,
        codeHash: hashCode(params.userId, code),
        expiresAt: new Date(Date.now() + (params.ttlMs ?? CODE_TTL_MS)),
      },
    });
    return { code, id: record.id };
  });
}

/** 메일을 보내지 못한 코드를 지웁니다(발송 한도에 넣지 않음). */
export async function revokeEmailCode(prisma: PrismaClient, id: string): Promise<void> {
  await prisma.emailVerification.deleteMany({ where: { id, consumedAt: null } });
}

/**
 * 코드를 확인하고, 맞으면 '코드 소비 + onValid(계정 확정)'를 한 트랜잭션으로 실행합니다.
 * onValid 가 실패(DB 오류 등)하면 소비도 취소되어 같은 코드로 다시 인증할 수 있습니다(차감한 시도 1회는 유지).
 */
export async function verifyEmailCode<T>(
  prisma: PrismaClient,
  params: { userId: string; purpose: VerificationPurpose; code: string },
  onValid: (tx: Prisma.TransactionClient) => Promise<T>,
): Promise<T> {
  const record = await prisma.emailVerification.findFirst({
    where: { userId: params.userId, purpose: params.purpose, consumedAt: null },
    orderBy: { createdAt: "desc" },
  });
  const invalid = new AppError(400, "invalid_code", "인증코드가 맞지 않거나 만료되었습니다.");
  if (!record) throw invalid;

  // 시도 1회를 먼저 차감(조건부 갱신). 만료·소비·횟수 초과면 0건 → 비교하지 않음
  const now = new Date();
  const reserved = await prisma.emailVerification.updateMany({
    where: { id: record.id, consumedAt: null, expiresAt: { gt: now }, attempts: { lt: MAX_ATTEMPTS } },
    data: { attempts: { increment: 1 } },
  });
  if (reserved.count !== 1) throw invalid;

  const expected = Buffer.from(record.codeHash, "hex");
  const actual = Buffer.from(hashCode(params.userId, params.code.trim()), "hex");
  if (expected.length !== actual.length || !timingSafeEqual(expected, actual)) throw invalid;

  return prisma.$transaction(async (tx) => {
    const consumed = await tx.emailVerification.updateMany({ where: { id: record.id, consumedAt: null }, data: { consumedAt: new Date() } });
    if (consumed.count !== 1) throw invalid;
    return onValid(tx);
  });
}
