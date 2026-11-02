// 이메일 인증코드 저장 방식: DB가 유출돼도 서버 비밀키 없이는 6자리 코드를 맞춰 볼 수 없어야 함(가상 계정, 테스트 스키마)
import { createHash } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { PrismaClient } from "@prisma/client";
import { createTestClient, getTestDatabaseUrl, resetTestData } from "./test-db";
import { hashEmailCode, issueEmailCode, verifyEmailCode } from "../server/src/auth/emailCode";

const A = { userId: "user-1", purpose: "signup", code: "123456" };
const secret = (s: string) => ({ NODE_ENV: "production", SESSION_SECRET: s });

describe("코드 해시", () => {
  it("비밀키가 다르면 값이 다르고, 사용자 ID만 넣은 SHA-256과 다름", () => {
    const h = hashEmailCode(A, secret("x".repeat(48)));
    expect(h).toMatch(/^[0-9a-f]{64}$/);
    expect(h).not.toBe(hashEmailCode(A, secret("y".repeat(48))));
    expect(h).not.toBe(createHash("sha256").update("user-1:123456").digest("hex"));
    expect(h).not.toBe(createHash("sha256").update("user-1:signup:123456").digest("hex"));
  });
  it("사용자·목적·코드가 바뀌면 값이 다름, 같은 입력은 같은 값", () => {
    const env = secret("x".repeat(48));
    const h = hashEmailCode(A, env);
    expect(hashEmailCode(A, env)).toBe(h);
    for (const o of [{ userId: "user-2" }, { purpose: "reset" }, { code: "123457" }]) expect(hashEmailCode({ ...A, ...o }, env)).not.toBe(h);
  });
  it("운영에서 비밀키가 없으면 처리 거부(503), 개발·테스트는 동작", () => {
    expect(() => hashEmailCode(A, { NODE_ENV: "production" })).toThrowError(expect.objectContaining({ status: 503, code: "code_secret_missing" }));
    expect(hashEmailCode(A, { NODE_ENV: "test" })).toMatch(/^[0-9a-f]{64}$/);
  });
});

describe("저장·확인(기존 규칙 유지)", () => {
  let prisma: PrismaClient;
  let userId = "";
  const saved = process.env.SESSION_SECRET;
  const verify = (code: string) => verifyEmailCode(prisma, { userId, purpose: "signup", code }, async () => "ok");

  beforeAll(async () => {
    process.env.DATABASE_URL = getTestDatabaseUrl();
    process.env.SESSION_SECRET = "a".repeat(48);
    prisma = createTestClient();
    await resetTestData(prisma);
    userId = (await prisma.user.create({ data: { email: "hmac@example.invalid", displayName: "가상 교사" } })).id;
  });
  afterAll(async () => {
    if (saved === undefined) delete process.env.SESSION_SECRET;
    else process.env.SESSION_SECRET = saved;
    await prisma.$disconnect();
  });

  it("DB 값으로 6자리 전수 대입해도 비밀키 없이는 찾을 수 없음(SHA-256 방식과 불일치)", async () => {
    const { code } = await issueEmailCode(prisma, { userId, purpose: "signup" });
    const row = await prisma.emailVerification.findFirstOrThrow({ where: { userId } });
    expect(row.codeHash).toBe(hashEmailCode({ userId, purpose: "signup", code }));
    expect(row.codeHash).not.toBe(createHash("sha256").update(`${userId}:${code}`).digest("hex"));
  });
  it("비밀키가 바뀌면 이전 코드는 거부, 원래 비밀키로는 통과, 사용 후 재사용 불가", async () => {
    const { code } = await (async () => {
      await prisma.emailVerification.deleteMany({ where: { userId } });
      return issueEmailCode(prisma, { userId, purpose: "signup" });
    })();
    process.env.SESSION_SECRET = "b".repeat(48);
    await expect(verify(code)).rejects.toMatchObject({ code: "invalid_code" });
    process.env.SESSION_SECRET = "a".repeat(48);
    await expect(verify(code)).resolves.toBe("ok");
    await expect(verify(code)).rejects.toMatchObject({ code: "invalid_code" });
  });
  it("다섯 번 틀리면 맞는 코드도 거부(시도 제한 유지)", async () => {
    await prisma.emailVerification.deleteMany({ where: { userId } });
    const { code } = await issueEmailCode(prisma, { userId, purpose: "signup" });
    const wrong = code === "000000" ? "000001" : "000000";
    for (let i = 0; i < 5; i++) await expect(verify(wrong)).rejects.toMatchObject({ code: "invalid_code" });
    await expect(verify(code)).rejects.toMatchObject({ code: "invalid_code" });
  });
});
