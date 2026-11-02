// SMTP 발송(새 의존성 없음). Gmail은 465 포트 TLS, 인증서 검증을 끄는 설정은 두지 않습니다.
// - 오류에는 단계와 SMTP 응답 코드만 담습니다(비밀번호·받는 주소·본문·응답 원문 없음).
// - 제목·본문은 base64로 보내 머리글 주입과 줄 처리 문제를 막습니다.
import { randomBytes } from "node:crypto";
import type { Duplex } from "node:stream";
import tls from "node:tls";

export interface SmtpConfig {
  host: string;
  port: number;
  user: string;
  pass: string;
}
export interface SmtpMessage {
  from: string;
  fromName: string;
  to: string;
  subject: string;
  text: string;
}
export type SmtpConnect = (cfg: SmtpConfig) => Duplex;
export type SmtpFailure = "connect" | "timeout" | "auth" | "rejected" | "protocol" | "invalid_address";

export class SmtpError extends Error {
  constructor(
    public readonly kind: SmtpFailure,
    public readonly code?: number,
  ) {
    super(`SMTP ${kind}${code ? ` ${code}` : ""}`);
  }
}

const ADDRESS = /^[^\s<>"',;:\\]+@[^\s<>"',;:\\]+\.[^\s<>"',;:\\]+$/;
const MAX_REPLY = 16 * 1024;

const defaultConnect: SmtpConnect = (cfg) => tls.connect({ host: cfg.host, port: cfg.port, servername: cfg.host, minVersion: "TLSv1.2" });

const encodedWord = (s: string) => `=?UTF-8?B?${Buffer.from(s, "utf8").toString("base64")}?=`;

/** 메시지 원문(DATA 내용). 본문 base64라 줄 첫 글자 마침표 문제가 없습니다. */
export function buildMessage(m: SmtpMessage, now = new Date()): string {
  const domain = m.from.split("@")[1];
  const body = Buffer.from(m.text, "utf8").toString("base64").replace(/(.{76})/g, "$1\r\n");
  return [
    `From: ${encodedWord(m.fromName)} <${m.from}>`,
    `To: <${m.to}>`,
    `Subject: ${encodedWord(m.subject)}`,
    `Date: ${now.toUTCString().replace("GMT", "+0000")}`,
    `Message-ID: <${randomBytes(16).toString("hex")}@${domain}>`,
    "MIME-Version: 1.0",
    "Content-Type: text/plain; charset=UTF-8",
    "Content-Transfer-Encoding: base64",
    "",
    body,
  ].join("\r\n");
}

export async function sendSmtp(cfg: SmtpConfig, m: SmtpMessage, options: { connect?: SmtpConnect; timeoutMs?: number } = {}): Promise<void> {
  if (!ADDRESS.test(m.from) || !ADDRESS.test(m.to)) throw new SmtpError("invalid_address");
  const socket = (options.connect ?? defaultConnect)(cfg);
  const timeoutMs = options.timeoutMs ?? 15_000;
  let buffer = "";
  let waiter: { resolve: (code: number) => void; reject: (e: SmtpError) => void } | null = null;
  let failure: SmtpError | null = null;
  const fail = (e: SmtpError) => {
    failure ??= e;
    waiter?.reject(failure);
    waiter = null;
  };
  const drain = () => {
    if (!waiter) return;
    // 여러 줄 응답은 "250-..." 뒤 마지막 "250 ..." 줄로 끝납니다.
    for (;;) {
      const at = buffer.indexOf("\r\n");
      if (at < 0) {
        if (buffer.length > MAX_REPLY) fail(new SmtpError("protocol"));
        return;
      }
      const line = buffer.slice(0, at);
      buffer = buffer.slice(at + 2);
      if (!/^\d{3}[ -]/.test(line) && !/^\d{3}$/.test(line)) return fail(new SmtpError("protocol"));
      if (line[3] !== "-") {
        const w = waiter;
        waiter = null;
        w.resolve(Number(line.slice(0, 3)));
        return;
      }
    }
  };
  socket.on("data", (d: Buffer) => {
    buffer += d.toString("latin1");
    drain();
  });
  socket.on("error", () => fail(new SmtpError("connect")));
  socket.on("close", () => fail(new SmtpError("connect")));
  const timer = setTimeout(() => fail(new SmtpError("timeout")), timeoutMs);
  const reply = () =>
    new Promise<number>((resolve, reject) => {
      if (failure) return reject(failure);
      waiter = { resolve, reject };
      drain();
    });
  const expect = async (ok: number[], kind: SmtpFailure = "rejected") => {
    const code = await reply();
    if (!ok.includes(code)) throw new SmtpError(kind, code);
  };
  const say = (line: string) => socket.write(`${line}\r\n`);
  try {
    await expect([220], "protocol");
    say("EHLO safe-school");
    await expect([250], "protocol");
    say(`AUTH PLAIN ${Buffer.from(`\0${cfg.user}\0${cfg.pass}`, "utf8").toString("base64")}`);
    await expect([235], "auth");
    say(`MAIL FROM:<${m.from}>`);
    await expect([250]);
    say(`RCPT TO:<${m.to}>`);
    await expect([250, 251]);
    say("DATA");
    await expect([354]);
    socket.write(`${buildMessage(m)}\r\n.\r\n`);
    await expect([250]);
    say("QUIT");
    await reply().catch(() => undefined); // 메일은 이미 접수됨. 종료 응답이 없어도 실패가 아님
  } finally {
    clearTimeout(timer);
    socket.removeAllListeners("close");
    socket.on("error", () => undefined);
    socket.end();
  }
}
