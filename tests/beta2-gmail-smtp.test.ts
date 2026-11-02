// Phase 5: Gmail SMTP 어댑터와 이메일 인증(가짜 SMTP 서버, 실제 메일 발송 없음, 가상 주소만, HTTP는 테스트 스키마)
import net from "node:net";
import type { Server as NetServer, Socket } from "node:net";
import type { Server } from "node:http";
import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";
import type { PrismaClient } from "@prisma/client";
import { createTestClient, getTestDatabaseUrl, resetTestData } from "./test-db";
import { buildMessage, sendSmtp, SmtpError, type SmtpConfig, type SmtpConnect } from "../server/src/mail/smtp";
import { mailMode, sendMail, setSmtpConnectForTest } from "../server/src/mail/mailer";
import { betaEnvironmentErrors } from "../server/src/deploy/environment";

const PASS = "fake app pass word";
const cfg: SmtpConfig = { host: "fake.invalid", port: 465, user: "sender@example.invalid", pass: PASS };
const msg = { from: cfg.user, fromName: "SAFE SCHOOL", to: "to@example.invalid", subject: "[SAFE SCHOOL] 이메일 인증코드", text: "인증코드: 123456\n.\n끝" };

type Script = { auth?: string; rcpt?: string; hang?: boolean; greet?: string };
function fakeSmtp(script: Script = {}) {
  const seen: string[] = [];
  const data: string[] = [];
  const server: NetServer = net.createServer((s: Socket) => {
    let buf = "";
    let inData = false;
    let body = "";
    if (script.hang) return;
    s.write(script.greet ?? "220 fake ready\r\n");
    s.on("error", () => undefined);
    s.on("data", (d) => {
      buf += d.toString("latin1");
      for (;;) {
        if (inData) {
          const end = buf.indexOf("\r\n.\r\n");
          if (end < 0) return;
          body += buf.slice(0, end);
          buf = buf.slice(end + 5);
          inData = false;
          data.push(body);
          s.write("250 queued\r\n");
          continue;
        }
        const at = buf.indexOf("\r\n");
        if (at < 0) return;
        const line = buf.slice(0, at);
        buf = buf.slice(at + 2);
        seen.push(line);
        if (line.startsWith("EHLO")) s.write("250-fake\r\n250-AUTH PLAIN\r\n250 8BITMIME\r\n");
        else if (line.startsWith("AUTH")) s.write(script.auth ?? "235 ok\r\n");
        else if (line.startsWith("MAIL")) s.write("250 ok\r\n");
        else if (line.startsWith("RCPT")) s.write(script.rcpt ?? "250 ok\r\n");
        else if (line === "DATA") { s.write("354 go\r\n"); inData = true; }
        else if (line === "QUIT") { s.write("221 bye\r\n"); s.end(); }
      }
    });
  });
  return new Promise<{ connect: SmtpConnect; seen: string[]; data: string[]; close: () => Promise<void> }>((resolve) => {
    server.listen(0, "127.0.0.1", () => {
      const port = (server.address() as net.AddressInfo).port;
      resolve({ connect: () => net.connect(port, "127.0.0.1"), seen, data, close: () => new Promise((r) => server.close(() => r())) });
    });
  });
}
const bodyOf = (raw: string) => Buffer.from(raw.split("\r\n\r\n")[1]!.replace(/\r\n/g, ""), "base64").toString("utf8");

describe("SMTP 어댑터", () => {
  it("정상 발송: 순서·인증값·한글 제목·본문(마침표 줄 포함)", async () => {
    const f = await fakeSmtp();
    await sendSmtp(cfg, msg, { connect: f.connect });
    expect(f.seen.map((l) => l.split(/[ :]/)[0])).toEqual(["EHLO", "AUTH", "MAIL", "RCPT", "DATA", "QUIT"]);
    expect(f.seen[1]).toBe(`AUTH PLAIN ${Buffer.from(`\0${cfg.user}\0${PASS}`).toString("base64")}`);
    expect(f.seen[3]).toBe("RCPT TO:<to@example.invalid>");
    expect(bodyOf(f.data[0]!)).toBe(msg.text);
    expect(f.data[0]).toContain(`Subject: =?UTF-8?B?${Buffer.from(msg.subject).toString("base64")}?=`);
    expect(f.data[0]).not.toContain(PASS);
    await f.close();
  });

  it.each([
    ["인증 실패", { auth: "535 bad credentials secret-echo\r\n" }, "auth", 535],
    ["받는 주소 거부", { rcpt: "550 no user\r\n" }, "rejected", 550],
    ["발송 한도", { rcpt: "452 daily limit\r\n" }, "rejected", 452],
    ["잘못된 인사", { greet: "554 go away\r\n" }, "protocol", 554],
    ["규격 위반 응답", { greet: "garbage\r\n" }, "protocol", undefined],
  ])("%s → 종류·코드만, 응답 원문·비밀번호 없음", async (_n, script, kind, code) => {
    const f = await fakeSmtp(script);
    const e = (await sendSmtp(cfg, msg, { connect: f.connect }).catch((x) => x)) as SmtpError;
    expect(e).toBeInstanceOf(SmtpError);
    expect([e.kind, e.code]).toEqual([kind, code]);
    expect(e.message).not.toMatch(/secret-echo|fake app|to@example/);
    await f.close();
  });

  it("응답 없음 → timeout, 연결 끊김·연결 실패 → connect", async () => {
    const hang = await fakeSmtp({ hang: true });
    await expect(sendSmtp(cfg, msg, { connect: hang.connect, timeoutMs: 100 })).rejects.toMatchObject({ kind: "timeout" });
    await hang.close().catch(() => undefined);
    const refused: SmtpConnect = () => net.connect(1, "127.0.0.1");
    await expect(sendSmtp(cfg, msg, { connect: refused, timeoutMs: 3000 })).rejects.toMatchObject({ kind: "connect" });
  }, 15000);

  it("주소·제목 머리글 주입 차단", async () => {
    let connected = false;
    const never: SmtpConnect = () => { connected = true; throw new Error("no"); };
    for (const to of ["a@b.c\r\nBcc: x@y.z", "a@b.c>,<x@y.z", "not-an-address"]) {
      await expect(sendSmtp(cfg, { ...msg, to }, { connect: never })).rejects.toMatchObject({ kind: "invalid_address" });
    }
    expect(connected).toBe(false);
    const raw = buildMessage({ ...msg, subject: "제목\r\nBcc: x@y.z", text: "a" });
    expect(raw.split("\r\n").filter((l) => /^Bcc:/i.test(l))).toEqual([]);
  });

  it("기본 연결은 인증서 검증을 끄는 옵션을 쓰지 않음", async () => {
    const fs = await import("node:fs");
    expect(fs.readFileSync("server/src/mail/smtp.ts", "utf8")).not.toMatch(/rejectUnauthorized|NODE_TLS_REJECT/);
  });
});

describe("메일 방식", () => {
  const saved = { ...process.env };
  afterEach(() => {
    for (const k of ["MAIL_PROVIDER", "GMAIL_SMTP_USER", "GMAIL_SMTP_APP_PASSWORD", "NODE_ENV"]) process.env[k] = saved[k] ?? "";
    setSmtpConnectForTest(undefined);
  });
  it("인증정보가 하나라도 없으면 gmail 아님(발송 불가, 503 경로)", () => {
    process.env.MAIL_PROVIDER = "gmail";
    process.env.GMAIL_SMTP_USER = cfg.user;
    process.env.GMAIL_SMTP_APP_PASSWORD = " ";
    expect(mailMode()).toBe("none");
    process.env.GMAIL_SMTP_APP_PASSWORD = PASS;
    expect(mailMode()).toBe("gmail");
  });
  it("발송 실패는 502, 로그에 비밀번호·주소 없음. 앱 비밀번호 공백은 제거해 인증", async () => {
    process.env.MAIL_PROVIDER = "gmail";
    process.env.GMAIL_SMTP_USER = cfg.user;
    process.env.GMAIL_SMTP_APP_PASSWORD = PASS;
    const f = await fakeSmtp({ auth: "535 no\r\n" });
    setSmtpConnectForTest(f.connect);
    const logs: string[] = [];
    const original = console.error;
    console.error = (...a: unknown[]) => logs.push(a.join(" "));
    await expect(sendMail({ to: "to@example.invalid", subject: "s", text: "t" })).rejects.toMatchObject({ status: 502, code: "mail_failed" });
    console.error = original;
    expect(f.seen[1]).toBe(`AUTH PLAIN ${Buffer.from(`\0${cfg.user}\0fakeapppassword`).toString("base64")}`);
    expect(logs.join()).toContain("auth 535");
    expect(logs.join()).not.toMatch(/fake|to@example|sender@/);
    await f.close();
  });
  it("Beta 가상 데이터 모드에서는 gmail 시작 거부", () => {
    const env = { DEPLOY_PROFILE: "beta", DEPLOY_DB_SCHEMA: "safeschool_beta", BETA_DATA_MODE: "virtual_test", MAIL_PROVIDER: "gmail" };
    expect(betaEnvironmentErrors("beta", env).join()).toContain("MAIL_PROVIDER=gmail");
  });
});

describe("가입 흐름(가짜 SMTP, 테스트 스키마)", () => {
  let prisma: PrismaClient;
  let server: Server;
  let base = "";
  let smtp: Awaited<ReturnType<typeof fakeSmtp>>;
  const saved = { ...process.env };
  const EMAIL = "gmail-flow@example.invalid";
  const post = async (p: string, body: unknown) => {
    const r = await fetch(`${base}/api${p}`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) });
    const text = await r.text();
    return { status: r.status, cookie: r.headers.get("set-cookie"), body: text.startsWith("{") ? JSON.parse(text) : {} };
  };
  const codeFrom = (raw: string) => /\d{6}/.exec(bodyOf(raw))![0];

  beforeAll(async () => {
    process.env.DATABASE_URL = getTestDatabaseUrl();
    prisma = createTestClient();
    await resetTestData(prisma);
    process.env.MAIL_PROVIDER = "gmail";
    process.env.GMAIL_SMTP_USER = cfg.user;
    process.env.GMAIL_SMTP_APP_PASSWORD = PASS;
    smtp = await fakeSmtp();
    setSmtpConnectForTest(smtp.connect);
    const { createApp } = await import("../server/src/app");
    const http = await import("node:http");
    server = http.createServer(await createApp({ mode: "test", trustProxyHops: 1 }));
    await new Promise<void>((r) => server.listen(0, "127.0.0.1", () => r()));
    const addr = server.address();
    base = `http://127.0.0.1:${typeof addr === "object" && addr ? addr.port : 0}`;
  }, 30000);
  afterAll(async () => {
    setSmtpConnectForTest(undefined);
    for (const k of ["MAIL_PROVIDER", "GMAIL_SMTP_USER", "GMAIL_SMTP_APP_PASSWORD"]) process.env[k] = saved[k] ?? "";
    await new Promise<void>((r) => server.close(() => r()));
    await smtp.close();
    await prisma.$disconnect();
  });

  it("가입: 메일 발송, 응답에 코드 없음, DB에 평문 코드 없음, 인증 전 로그인 불가", async () => {
    const r = await post("/auth/signup", { email: EMAIL, displayName: "가상 교사", password: "owner-password-1234" });
    expect(r.status).toBe(201);
    expect(r.body.delivery).toBe("email");
    expect(r.body).not.toHaveProperty("devCode");
    const code = codeFrom(smtp.data.at(-1)!);
    const row = await prisma.emailVerification.findFirstOrThrow({});
    expect(row.codeHash).not.toContain(code);
    expect((await post("/auth/login", { email: EMAIL, password: "owner-password-1234", deviceKind: "personal" })).status).toBe(401);
  });

  it("틀린 코드 400, 재발송은 60초 간격 429, 5회 틀리면 맞는 코드도 거부", async () => {
    const code = codeFrom(smtp.data.at(-1)!);
    const wrong = code === "000000" ? "000001" : "000000";
    const verify = (c: string) => post("/auth/verify-email", { email: EMAIL, code: c, password: "owner-password-1234", deviceKind: "personal" });
    expect((await post("/auth/resend-code", { email: EMAIL })).status).toBe(429);
    for (let i = 0; i < 5; i++) expect((await verify(wrong)).status).toBe(400);
    expect((await verify(code)).status).toBe(400);
    expect((await prisma.user.findUniqueOrThrow({ where: { email: EMAIL } })).emailVerifiedAt).toBeNull();
  });

  it("새 코드로 인증 → 로그인 가능, 코드 재사용 불가, 학교 소속은 자동으로 생기지 않음", async () => {
    await prisma.emailVerification.updateMany({ data: { createdAt: new Date(Date.now() - 120_000) } });
    expect((await post("/auth/resend-code", { email: EMAIL })).status).toBe(200);
    const code = codeFrom(smtp.data.at(-1)!);
    const ok = await post("/auth/verify-email", { email: EMAIL, code, password: "owner-password-1234", deviceKind: "personal" });
    expect(ok.status).toBe(200);
    expect((await post("/auth/verify-email", { email: EMAIL, code, password: "other-password-1234", deviceKind: "personal" })).status).toBe(409);
    const login = await post("/auth/login", { email: EMAIL, password: "owner-password-1234", deviceKind: "personal" });
    expect(login.status).toBe(200);
    const me = await fetch(`${base}/api/auth/me`, { headers: { cookie: login.cookie!.split(";")[0]! } });
    expect((await me.json()).memberships).toEqual([]);
  });

  it("발송 실패 시 계정·코드를 남기지 않음(502)", async () => {
    const bad = await fakeSmtp({ auth: "535 no\r\n" });
    setSmtpConnectForTest(bad.connect);
    const r = await post("/auth/signup", { email: "gmail-fail@example.invalid", displayName: "가상 교사", password: "owner-password-1234" });
    expect(r.status).toBe(502);
    expect(await prisma.user.count({ where: { email: "gmail-fail@example.invalid" } })).toBe(0);
    setSmtpConnectForTest(smtp.connect);
    await bad.close();
  });
});
