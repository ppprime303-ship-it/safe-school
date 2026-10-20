import { describe, expect, it } from "vitest";
import { hashPassword, verifyPassword } from "../server/src/security/password.js";
import { computeUnconfirmed } from "../shared/constants.js";

describe("비밀번호 해시", () => {
  it("맞는 비밀번호만 통과하고, 원문은 저장 값에 남지 않는다", async () => {
    const stored = await hashPassword("correct-horse-battery");
    expect(stored.startsWith("scrypt$")).toBe(true);
    expect(stored.includes("correct-horse-battery")).toBe(false);
    expect(await verifyPassword("correct-horse-battery", stored)).toBe(true);
    expect(await verifyPassword("wrong-password", stored)).toBe(false);
  });

  it("같은 비밀번호도 매번 다른 해시가 만들어진다(솔트)", async () => {
    expect(await hashPassword("same-password-123")).not.toBe(await hashPassword("same-password-123"));
  });
});

describe("미확인 인원 계산", () => {
  it("미확인 = 보고 재적 − 대피 확인 − 사전 파악 부재", () => {
    expect(computeUnconfirmed({ enrolledCount: 28, evacuated: 25, absentKnown: 1 })).toBe(2);
    expect(computeUnconfirmed({ enrolledCount: 28, evacuated: 28, absentKnown: 0 })).toBe(0);
  });
});
