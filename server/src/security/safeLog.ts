// STEP 3-E: 서버 오류 로그에서 개인정보가 새지 않게 줄이는 함수(순수 함수)
// - 처리하지 못한 오류를 통째로 출력하면 Prisma 검증 오류 메시지에 요청 값(이메일·이름·메모 등)이 그대로 들어갈 수 있습니다.
// - 오류 이름·코드·메시지 첫 부분만 남기고, 이메일·전화번호 형태는 가리며, Prisma 호출 내용(Invalid `…` invocation 이후)은 버립니다.
// - 문제 위치를 찾을 수 있도록 스택의 앞부분(파일·줄)은 남깁니다(스택에는 요청 값이 없음).

const EMAIL = /[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}/g;
const PHONE = /\b0\d{1,2}[- .]?\d{3,4}[- .]?\d{4}\b/g;

export function maskSensitive(text: string): string {
  return text.replace(EMAIL, "[이메일 가림]").replace(PHONE, "[전화번호 가림]");
}

export function safeErrorSummary(err: unknown): string {
  if (!(err instanceof Error)) return `[알 수 없는 오류 형식: ${typeof err}]`;
  const code = (err as { code?: unknown }).code;
  let message = err.message ?? "";
  const cut = message.search(/Invalid `[^`]*` invocation/);
  if (cut >= 0) message = message.slice(0, cut) + "(Prisma 호출 내용 생략)";
  message = maskSensitive(message.replace(/\s+/g, " ").trim()).slice(0, 300);
  const stack = (err.stack ?? "")
    .split("\n")
    .slice(1)
    .filter((l) => l.trim().startsWith("at "))
    .slice(0, 5)
    .map((l) => maskSensitive(l.trim()))
    .join(" | ");
  return `${err.name}${typeof code === "string" || typeof code === "number" ? `(${code})` : ""}: ${message}${stack ? ` — ${stack}` : ""}`;
}
