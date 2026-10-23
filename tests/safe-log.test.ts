// STEP 3-E 서버 오류 로그 개인정보 가림(순수 — DB 없음)
import { describe, expect, it } from "vitest";
import { maskSensitive, safeErrorSummary } from "../server/src/security/safeLog.js";

describe("서버 오류 로그 요약", () => {
  it("이메일·전화번호를 가림", () => {
    expect(maskSensitive("가입 실패 teacher01@school.example.kr 010-1234-5678")).toBe("가입 실패 [이메일 가림] [전화번호 가림]");
  });

  it("Prisma 호출 내용(요청 값)을 버리고 이름·코드·위치만 남김", () => {
    const e = new Error("\nInvalid `prisma.user.create()` invocation:\n{\n  data: {\n    email: \"kim@example.com\",\n    displayName: \"김가상\"\n  }\n}\nUnknown argument `foo`.");
    (e as Error & { code?: string }).code = "P2009";
    const s = safeErrorSummary(e);
    expect(s).toContain("Error(P2009)");
    expect(s).toContain("Prisma 호출 내용 생략");
    expect(s).not.toContain("kim@example.com");
    expect(s).not.toContain("김가상");
  });

  it("메시지 길이 제한, 오류가 아닌 값도 안전하게", () => {
    const s = safeErrorSummary(new Error("가".repeat(1000)));
    expect(s.length < 1200).toBe(true);
    expect(safeErrorSummary({ password: "secret" })).toBe("[알 수 없는 오류 형식: object]");
  });
});
