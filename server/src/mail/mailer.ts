// 메일 발송 어댑터
// - MAIL_PROVIDER=resend 와 MAIL_API_KEY, MAIL_FROM 이 있으면 Resend HTTP API로 발송합니다(미검증: 실제 발송 확인 필요).
// - 설정이 없으면: 개발 환경에서는 서버 로그에 내용을 출력하고, 운영 환경에서는 오류(503)로 알립니다.
import { AppError } from "../errors.js";

export interface MailMessage {
  to: string;
  subject: string;
  text: string;
}

export function mailConfigured(): boolean {
  return process.env.MAIL_PROVIDER === "resend" && !!process.env.MAIL_API_KEY && !!process.env.MAIL_FROM;
}

export async function sendMail(message: MailMessage): Promise<{ delivered: "provider" | "console" }> {
  if (mailConfigured()) {
    const response = await fetch("https://api.resend.com/emails", {
      method: "POST",
      headers: { Authorization: `Bearer ${process.env.MAIL_API_KEY}`, "Content-Type": "application/json" },
      body: JSON.stringify({ from: process.env.MAIL_FROM, to: [message.to], subject: message.subject, text: message.text }),
      signal: AbortSignal.timeout(10000),
    });
    if (!response.ok) {
      console.error("[mail] 발송 실패", response.status, await response.text().catch(() => ""));
      throw new AppError(502, "mail_failed", "인증 메일을 보내지 못했습니다. 잠시 후 다시 시도하세요.");
    }
    return { delivered: "provider" };
  }
  if (process.env.NODE_ENV === "production") {
    throw new AppError(503, "mail_not_configured", "메일 발송이 설정되지 않았습니다. 운영자에게 문의하세요.");
  }
  console.log(`[mail:개발용 출력] 받는 사람: ${message.to}\n제목: ${message.subject}\n${message.text}`);
  return { delivered: "console" };
}
