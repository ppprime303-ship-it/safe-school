// STEP 7-D 가입·이메일 인증 HTTP 통합 테스트(실제 Express 앱 + 테스트 스키마)
// - 가입 선점 방지: 가입 요청만으로는 비밀번호가 저장되지 않고, 코드를 가진 메일 소유자가 인증할 때 확정
// - 메일 발송 불가·실패 시 계정·코드·발송 한도가 남지 않음
// - 중복 가입·재전송·동시 요청, 코드 만료·횟수 제한
// 메일은 모의 발송(console)만 쓰고, 실패는 Resend 주소로 가는 fetch 만 가짜 응답으로 바꿔 확인합니다(실제 발송 없음).
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import type { Server } from "node:http";
import type { PrismaClient } from "@prisma/client";
import { createTestClient, getTestDatabaseUrl, resetTestData } from "./test-db";

let server: Server;
let base = "";
let prisma: PrismaClient;
let ipSeq = 0;
const realFetch = globalThis.fetch;
const MAIL_KEYS = ["MAIL_PROVIDER", "MAIL_API_KEY", "MAIL_FROM"] as const;
const savedMail = Object.fromEntries(MAIL_KEYS.map((k) => [k, process.env[k]]));

beforeAll(async () => {
  process.env.DATABASE_URL = getTestDatabaseUrl();
  prisma = createTestClient();
  const { createApp } = await import("../server/src/app");
  const http = await import("node:http");
  const app = await createApp({ mode: "test", trustProxyHops: 1 });
  server = http.createServer(app);
  await new Promise<void>((r) => server.listen(0, "127.0.0.1", () => r()));
  const addr = server.address();
  base = `http://127.0.0.1:${typeof addr === "object" && addr ? addr.port : 0}`;
});
afterAll(async () => {
  await new Promise<void>((r) => server.close(() => r()));
  await prisma.$disconnect();
});
beforeEach(async () => {
  await resetTestData(prisma);
  setMail({ MAIL_PROVIDER: "console" });
  ipSeq++; // 테스트마다 다른 접속 IP(요청 제한 15분 30회와 무관하게)
});
afterEach(() => {
  vi.restoreAllMocks();
  setMail(savedMail);
});

function setMail(env: Partial<Record<(typeof MAIL_KEYS)[number], string | undefined>>) {
  for (const k of MAIL_KEYS) if (env[k] === undefined) delete process.env[k]; else process.env[k] = env[k];
}

async function call(path: string, body: unknown) {
  const res = await realFetch(`${base}/api${path}`, {
    method: "POST",
    headers: { "content-type": "application/json", "x-forwarded-for": `203.0.113.${ipSeq % 250}` },
    body: JSON.stringify(body),
  });
  const text = await res.text();
  return { status: res.status, body: (text ? JSON.parse(text) : {}) as Record<string, any>, cookie: res.headers.get("set-cookie") };
}

const EMAIL = "teacher@school.example";
const signup = (password = "owner-password-1234", displayName = "가상 교사") => call("/auth/signup", { email: EMAIL, displayName, password });
const verify = (code: string, password = "owner-password-1234", extra: Record<string, unknown> = {}) =>
  call("/auth/verify-email", { email: EMAIL, code, password, deviceKind: "personal", ...extra });
const login = (password: string) => call("/auth/login", { email: EMAIL, password, deviceKind: "personal" });
/** 1분 재발송 간격을 기다리지 않도록 기존 코드의 발급 시각을 앞당김 */
const ageCodes = (ms = 61_000) =>
  prisma.emailVerification.updateMany({ data: { createdAt: new Date(Date.now() - ms) } });
const otherCode = (code: string) => (code === "000000" ? "111111" : "000000");

describe("가입 선점(사전 계정 탈취) 방지", () => {
  it("가입 요청만으로는 비밀번호가 저장되지 않고 로그인할 수 없음", async () => {
    const s = await signup();
    expect(s.status).toBe(201);
    expect(s.body.delivery).toBe("test_console");
    expect(s.body.devCode).toMatch(/^\d{6}$/);
    const user = await prisma.user.findUniqueOrThrow({ where: { email: EMAIL } });
    expect(user.passwordHash).toBeNull();
    expect(user.emailVerifiedAt).toBeNull();
    expect((await login("owner-password-1234")).status).toBe(401);
  });

  it("남이 먼저 가입해 둔 이메일: 소유자가 인증할 때 정한 비밀번호만 유효, 선점자 비밀번호·이름은 남지 않음", async () => {
    await signup("attacker-password-5678", "선점자");
    await ageCodes();
    const again = await signup("owner-password-1234", "실제 소유자");
    expect(again.status).toBe(201); // 새 가입과 같은 응답(가입 신청 여부를 드러내지 않음)
    expect(Object.keys(again.body).sort()).toEqual(["delivery", "devCode", "email", "ok"]);

    const v = await verify(again.body.devCode, "owner-password-1234", { displayName: "실제 소유자" });
    expect(v.status).toBe(200);
    expect(v.cookie).toMatch(/^ss_session=/);
    expect((await login("attacker-password-5678")).status).toBe(401);
    expect((await login("owner-password-1234")).status).toBe(200);
    expect((await prisma.user.findUniqueOrThrow({ where: { email: EMAIL } })).displayName).toBe("실제 소유자");
  });

  it("인증 전 재가입은 계정·비밀번호를 바꾸지 않음(1분 안이면 429)", async () => {
    await signup("first-password-1234", "처음 이름");
    const again = await signup("second-password-1234", "다른 이름");
    expect(again.status).toBe(429);
    const user = await prisma.user.findUniqueOrThrow({ where: { email: EMAIL } });
    expect(user.displayName).toBe("처음 이름");
    expect(user.passwordHash).toBeNull();
  });

  it("인증된 이메일로 다시 가입 → 409, 기존 비밀번호 유지", async () => {
    const s = await signup();
    await verify(s.body.devCode);
    const dup = await signup("other-password-1234");
    expect(dup.status).toBe(409);
    expect(dup.body.code).toBe("email_in_use");
    expect((await login("owner-password-1234")).status).toBe(200);
  });

  it("인증 시 비밀번호 없거나 짧으면 400(코드 시도 횟수 차감 없음)", async () => {
    const s = await signup();
    expect((await call("/auth/verify-email", { email: EMAIL, code: s.body.devCode })).status).toBe(400);
    expect((await verify(s.body.devCode, "short")).status).toBe(400);
    const rec = await prisma.emailVerification.findFirstOrThrow();
    expect(rec.attempts).toBe(0);
    expect((await verify(s.body.devCode)).status).toBe(200);
  });

  it("이미 인증된 계정에 인증 요청 → 409, 비밀번호 바뀌지 않음", async () => {
    const s = await signup();
    await verify(s.body.devCode);
    const again = await verify(s.body.devCode, "changed-password-1234");
    expect(again.status).toBe(409);
    expect((await login("owner-password-1234")).status).toBe(200);
  });

  it("기존(수정 전) 인증 전 계정: 맞는 비밀번호로 로그인하면 403 email_not_verified, 인증하면 새 비밀번호로 교체", async () => {
    const { hashPassword } = await import("../server/src/security/password");
    await prisma.user.create({ data: { email: EMAIL, displayName: "기존", passwordHash: await hashPassword("legacy-password-1234") } });
    const l = await login("legacy-password-1234");
    expect(l.status).toBe(403);
    expect(l.body.code).toBe("email_not_verified");
    const r = await call("/auth/resend-code", { email: EMAIL });
    expect((await verify(r.body.devCode, "owner-password-1234")).status).toBe(200);
    expect((await login("legacy-password-1234")).status).toBe(401);
    expect((await login("owner-password-1234")).status).toBe(200);
  });
});

describe("메일 발송 불가·실패 시 남는 것 없음", () => {
  it("메일 미설정 → 503, 계정·코드 생성 안 함", async () => {
    setMail({});
    const s = await signup();
    expect(s.status).toBe(503);
    expect(s.body.code).toBe("mail_not_configured");
    expect(await prisma.user.count()).toBe(0);
    expect(await prisma.emailVerification.count()).toBe(0);
  });

  it("재발송도 메일 미설정이면 가입 여부와 관계없이 503", async () => {
    setMail({});
    expect((await call("/auth/resend-code", { email: "nobody@school.example" })).status).toBe(503);
  });

  it("발송 실패(502) → 이번에 만든 계정·코드 삭제, 곧바로 다시 가입 가능(한도 미소모)", async () => {
    setMail({ MAIL_PROVIDER: "resend", MAIL_API_KEY: "test-key", MAIL_FROM: "SAFE SCHOOL <no-reply@school.example>" });
    const spy = vi.spyOn(globalThis, "fetch").mockImplementation(async (input, init) => {
      if (String(input).startsWith("https://api.resend.com/")) return new Response("fail", { status: 500 });
      return realFetch(input, init);
    });
    const s = await signup();
    expect(s.status).toBe(502);
    expect(s.body.code).toBe("mail_failed");
    expect(await prisma.user.count()).toBe(0);
    expect(await prisma.emailVerification.count()).toBe(0);
    expect(spy.mock.calls.some(([u]) => String(u).startsWith("https://api.resend.com/"))).toBe(true);

    setMail({ MAIL_PROVIDER: "console" });
    expect((await signup()).status).toBe(201);
  });

  it("인증 전 기존 계정 재발송 실패 → 계정은 그대로, 코드 삭제(재시도 시 429 아님)", async () => {
    await signup();
    await ageCodes();
    setMail({ MAIL_PROVIDER: "resend", MAIL_API_KEY: "test-key", MAIL_FROM: "SAFE SCHOOL <no-reply@school.example>" });
    vi.spyOn(globalThis, "fetch").mockImplementation(async (input, init) =>
      String(input).startsWith("https://api.resend.com/") ? new Response("fail", { status: 500 }) : realFetch(input, init),
    );
    expect((await call("/auth/resend-code", { email: EMAIL })).status).toBe(502);
    expect(await prisma.user.count()).toBe(1);
    expect(await prisma.emailVerification.count()).toBe(1); // 앞서 보낸 코드 1개만
    vi.restoreAllMocks();
    setMail({ MAIL_PROVIDER: "console" });
    expect((await call("/auth/resend-code", { email: EMAIL })).status).toBe(200);
  });
});

describe("재전송·동시 요청", () => {
  it("없는 이메일·인증된 이메일 재전송 → 같은 200 응답(코드 없음)", async () => {
    const none = await call("/auth/resend-code", { email: "nobody@school.example" });
    expect(none.status).toBe(200);
    expect(none.body).toEqual({ ok: true });
    const s = await signup();
    await verify(s.body.devCode);
    expect((await call("/auth/resend-code", { email: EMAIL })).body).toEqual({ ok: true });
  });

  it("재발송은 1분 간격, 1시간 5회까지", async () => {
    await signup();
    expect((await call("/auth/resend-code", { email: EMAIL })).body.code).toBe("code_resend_too_soon");
    for (let i = 0; i < 4; i++) {
      await ageCodes(61_000 + i * 1000);
      expect((await call("/auth/resend-code", { email: EMAIL })).status).toBe(200);
    }
    await ageCodes();
    const over = await call("/auth/resend-code", { email: EMAIL });
    expect(over.status).toBe(429);
    expect(over.body.code).toBe("code_resend_limit");
  });

  it("새 코드를 받으면 이전 코드는 쓸 수 없음", async () => {
    const s = await signup();
    await ageCodes();
    const r = await call("/auth/resend-code", { email: EMAIL });
    if (r.body.devCode !== s.body.devCode) expect((await verify(s.body.devCode)).status).toBe(400);
    expect((await verify(r.body.devCode)).status).toBe(200);
  });

  it("같은 이메일 동시 가입 10건 → 계정 1개, 코드 1개, 서버 오류 없음", async () => {
    const results = await Promise.all(Array.from({ length: 10 }, () => signup()));
    expect(results.every((r) => r.status === 201 || r.status === 429)).toBe(true);
    expect(results.filter((r) => r.status === 201)).toHaveLength(1);
    expect(await prisma.user.count()).toBe(1);
    expect(await prisma.emailVerification.count()).toBe(1);
  });

  it("동시 재발송 10건 → 코드 1개만 발급", async () => {
    await signup();
    await ageCodes();
    const results = await Promise.all(Array.from({ length: 10 }, () => call("/auth/resend-code", { email: EMAIL })));
    expect(results.filter((r) => r.status === 200)).toHaveLength(1);
    expect(await prisma.emailVerification.count()).toBe(2);
  });

  it("같은 코드로 동시 인증 5건 → 1건만 성공", async () => {
    const s = await signup();
    const results = await Promise.all(Array.from({ length: 5 }, () => verify(s.body.devCode)));
    expect(results.filter((r) => r.status === 200)).toHaveLength(1);
    expect(await prisma.session.count()).toBe(1);
  });
});

describe("코드 소비와 계정 확정 사이 DB 오류", () => {
  it("계정 확정 단계에서 DB 오류 → 코드 소비·인증·감사 기록 모두 취소, 같은 코드로 다시 인증 가능", async () => {
    const s = await signup();
    // 테스트 스키마에만 임시 트리거: 이 계정의 인증 완료(email_verified_at 설정)를 한 번 실패시킴
    await prisma.$executeRawUnsafe(`CREATE OR REPLACE FUNCTION t7d_fail_verify() RETURNS trigger AS $$
      BEGIN RAISE EXCEPTION 't7d simulated failure'; END $$ LANGUAGE plpgsql`);
    await prisma.$executeRawUnsafe(`CREATE TRIGGER t7d_fail_verify BEFORE UPDATE ON users FOR EACH ROW
      WHEN (OLD.email_verified_at IS NULL AND NEW.email_verified_at IS NOT NULL) EXECUTE FUNCTION t7d_fail_verify()`);
    try {
      const failed = await verify(s.body.devCode);
      expect(failed.status).toBe(500);
      expect(failed.cookie).toBeNull();
    } finally {
      await prisma.$executeRawUnsafe(`DROP TRIGGER IF EXISTS t7d_fail_verify ON users`);
      await prisma.$executeRawUnsafe(`DROP FUNCTION IF EXISTS t7d_fail_verify()`);
    }
    const rec = await prisma.emailVerification.findFirstOrThrow();
    expect(rec.consumedAt).toBeNull();
    expect(rec.attempts).toBe(1);
    const user = await prisma.user.findUniqueOrThrow({ where: { email: EMAIL } });
    expect(user.emailVerifiedAt).toBeNull();
    expect(user.passwordHash).toBeNull();
    expect(await prisma.auditLog.count({ where: { action: "user.email_verified" } })).toBe(0);

    expect((await verify(s.body.devCode)).status).toBe(200);
    expect(await prisma.auditLog.count({ where: { action: "user.email_verified" } })).toBe(1);
  });

  it("같은 코드로 다른 비밀번호 동시 인증 → 하나만 확정, 그 비밀번호로만 로그인", async () => {
    const s = await signup();
    const pws = Array.from({ length: 4 }, (_, i) => `racing-password-${i}-1234`);
    const results = await Promise.all(pws.map((pw) => verify(s.body.devCode, pw)));
    const winners = pws.filter((_, i) => results[i]!.status === 200);
    expect(winners).toHaveLength(1);
    for (const pw of pws) expect((await login(pw)).status).toBe(pw === winners[0] ? 200 : 401);
  });
});

describe("인증코드 만료·횟수 제한", () => {
  it("5회 틀리면 맞는 코드도 거부", async () => {
    const s = await signup();
    for (let i = 0; i < 5; i++) expect((await verify(otherCode(s.body.devCode))).status).toBe(400);
    expect((await verify(s.body.devCode)).status).toBe(400);
    expect((await prisma.user.findUniqueOrThrow({ where: { email: EMAIL } })).emailVerifiedAt).toBeNull();
  });

  it("4회 틀린 뒤 5번째에 맞으면 성공", async () => {
    const s = await signup();
    for (let i = 0; i < 4; i++) await verify(otherCode(s.body.devCode));
    expect((await verify(s.body.devCode)).status).toBe(200);
  });

  it("동시에 틀린 코드 20건 → 시도 횟수 5회를 넘지 않고, 이후 맞는 코드도 거부", async () => {
    const s = await signup();
    await Promise.all(Array.from({ length: 20 }, () => verify(otherCode(s.body.devCode))));
    expect((await prisma.emailVerification.findFirstOrThrow()).attempts).toBe(5);
    expect((await verify(s.body.devCode)).status).toBe(400);
  });

  it("10분 지난 코드 거부", async () => {
    const s = await signup();
    await prisma.emailVerification.updateMany({ data: { expiresAt: new Date(Date.now() - 1000) } });
    const v = await verify(s.body.devCode);
    expect(v.status).toBe(400);
    expect(v.body.code).toBe("invalid_code");
  });

  it("없는 이메일 인증 → 같은 invalid_code(가입 여부 비노출)", async () => {
    const v = await call("/auth/verify-email", { email: "nobody@school.example", code: "123456", password: "owner-password-1234" });
    expect(v.status).toBe(400);
    expect(v.body.code).toBe("invalid_code");
  });

  it("코드·비밀번호는 평문으로 저장하지 않음", async () => {
    const s = await signup();
    await verify(s.body.devCode);
    const rec = await prisma.emailVerification.findFirstOrThrow();
    expect(rec.codeHash).not.toContain(s.body.devCode);
    const user = await prisma.user.findUniqueOrThrow({ where: { email: EMAIL } });
    expect(user.passwordHash).not.toContain("owner-password-1234");
  });
});
