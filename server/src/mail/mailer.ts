// 메일 발송 어댑터
// - MAIL_PROVIDER=resend + MAIL_API_KEY + MAIL_FROM: Resend HTTP API로 실제 발송(미검증: 실제 수신 확인 필요)
// - MAIL_PROVIDER=console: 개발·테스트 전용 모의 발송. 메일을 보내지 않고 서버 로그에만 남기며,
//   운영(NODE_ENV=production)에서는 설정되어 있어도 거부합니다.
// - MAIL_PROVIDER=manual: 자동 발송 없이 '운영자 수동 전달'. 가입 시 계정만 만들고, 운영자가 CLI(npm run operator -- email-code)로
//   코드를 발급해 자신의 메일함에서 그 주소로 직접 보냅니다. 코드를 받은 사람만 인증할 수 있으므로 이메일 소유 확인은 그대로입니다.
//   (운영자 확인만으로 '인증됨'을 기록하지 않습니다.)
// - 아무것도 설정하지 않으면 발송 불가(503). 실제로 보내지 않았는데 보낸 것처럼 응답하지 않습니다.
import { AppError } from "../errors.js";

export interface MailMessage {
  to: string;
  subject: string;
  text: string;
}

export type MailDelivery = "email" | "test_console";

export function mailMode(): "resend" | "console" | "manual" | "none" {
  const provider = process.env.MAIL_PROVIDER;
  if (provider === "resend" && process.env.MAIL_API_KEY && process.env.MAIL_FROM) return "resend";
  if (provider === "console" && process.env.NODE_ENV !== "production") return "console";
  if (provider === "manual") return "manual";
  return "none";
}

/** 운영자가 수동으로 전달하는 인증코드의 유효 시간(자동 발송 10분보다 김. 코드당 5회 오답 제한은 같음) */
export const MANUAL_CODE_TTL_MS = 24 * 3600_000;

export async function sendMail(message: MailMessage): Promise<{ delivered: MailDelivery }> {
  const mode = mailMode();
  if (mode === "manual") throw new AppError(500, "mail_manual_mode", "수동 전달 모드에서는 자동 메일을 보내지 않습니다.");
  if (mode === "resend") {
    const response = await fetch("https://api.resend.com/emails", {
      method: "POST",
      headers: { Authorization: `Bearer ${process.env.MAIL_API_KEY}`, "Content-Type": "application/json" },
      body: JSON.stringify({ from: process.env.MAIL_FROM, to: [message.to], subject: message.subject, text: message.text }),
      signal: AbortSignal.timeout(10000),
    }).catch(() => null);
    if (!response || !response.ok) {
      console.error("[mail] 발송 실패", response?.status ?? "연결 실패"); // 키·본문은 기록하지 않음
      throw new AppError(502, "mail_failed", "인증 메일을 보내지 못했습니다. 잠시 후 다시 시도하세요.");
    }
    return { delivered: "email" };
  }
  if (mode === "console") {
    // 개발·테스트 전용: 받는 사람 주소는 일부만 기록
    const masked = message.to.replace(/^(.{2}).*(@.*)$/, "$1***$2");
    console.log(`[mail:모의 발송·실제 미발송] 받는 사람 ${masked} · 제목 ${message.subject}`);
    return { delivered: "test_console" };
  }
  throw mailNotConfigured();
}

/** 계정·코드를 만들기 전에 호출: 보낼 수 없으면 아무것도 쓰지 않고 503 */
export function requireMailConfigured(): void {
  if (mailMode() === "none") throw mailNotConfigured();
}

function mailNotConfigured() {
  return new AppError(
    503,
    "mail_not_configured",
    process.env.NODE_ENV === "production"
      ? "메일 발송이 설정되지 않아 인증코드를 보낼 수 없습니다. 운영자에게 문의하세요."
      : "메일 발송이 설정되지 않았습니다. 개발 환경에서는 MAIL_PROVIDER=console 로 모의 발송을 켤 수 있습니다.",
  );
}
