// Beta PILOT 2: 성명 입력 규칙과 성명 정정 권한(DB 없이 실행)
import { describe, expect, it } from "vitest";
import { personNameSchema, renameMemberSchema, signupSchema, verifyEmailSchema } from "../shared/schemas";
import { capabilitiesFor } from "../shared/permissions";

describe("성명 입력 규칙(personNameSchema)", () => {
  it.each([
    ["홍길동", "홍길동"],
    ["  남궁 민수  ", "남궁 민수"],
    ["김   철수", "김 철수"],
    ["Kim Min-jun", "Kim Min-jun"],
    ["O'Brien", "O'Brien"],
    ["응우옌·반·안", "응우옌·반·안"],
  ])("통과: %j → %j", (input, out) => {
    expect(personNameSchema.parse(input)).toBe(out);
  });

  it.each(["", " ", "홍", "교사01", "보건쌤!", "홍길동@", "-홍길동", "가".repeat(31)])("거부: %j", (input) => {
    expect(personNameSchema.safeParse(input).success).toBe(false);
  });

  it("가입·인증 요청에 적용, 인증 요청의 성명은 생략 가능(기존 흐름 호환)", () => {
    expect(signupSchema.safeParse({ email: "a@b.kr", displayName: "교사01", password: "password-12345" }).success).toBe(false);
    expect(signupSchema.parse({ email: "a@b.kr", displayName: " 홍길동 ", password: "password-12345" }).displayName).toBe("홍길동");
    expect(verifyEmailSchema.safeParse({ email: "a@b.kr", code: "123456", password: "password-12345" }).success).toBe(true);
    expect(verifyEmailSchema.safeParse({ email: "a@b.kr", code: "123456", password: "password-12345", displayName: "x" }).success).toBe(false);
  });

  it("성명 정정 요청: 새 성명 규칙 + 현재 성명 + 사유 필수", () => {
    expect(renameMemberSchema.safeParse({ displayName: "홍길동", expectedCurrentName: "교사01", reason: "별명 정정" }).success).toBe(true);
    expect(renameMemberSchema.safeParse({ displayName: "홍길동", expectedCurrentName: "교사01", reason: "" }).success).toBe(false);
    expect(renameMemberSchema.safeParse({ displayName: "홍길동", reason: "별명 정정" }).success).toBe(false);
    expect(renameMemberSchema.safeParse({ displayName: "홍길동", expectedCurrentName: "교사01", reason: "별명 정정", email: "x@y.kr", role: "admin" })).toMatchObject({
      success: true,
      data: { displayName: "홍길동", expectedCurrentName: "교사01", reason: "별명 정정" },
    });
    // 성명 외 항목(이메일·역할)은 결과에 남지 않음 — 서비스로 전달되지 않음
    const parsed = renameMemberSchema.parse({ displayName: "홍길동", expectedCurrentName: "교사01", reason: "별명 정정", email: "x@y.kr", role: "admin" });
    expect(Object.keys(parsed).sort()).toEqual(["displayName", "expectedCurrentName", "reason"]);
  });
});

describe("성명 정정 권한(members.rename)", () => {
  it("학교 관리자만", () => {
    expect(capabilitiesFor("admin", [])).toContain("members.rename");
    for (const role of ["homeroom", "staff"] as const)
      for (const duties of [[], ["app_operator"], ["safety_officer"], ["principal"], ["vice_principal"]] as const) {
        expect(capabilitiesFor(role, duties)).not.toContain("members.rename");
      }
  });
});
