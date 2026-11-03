// 외부 경보 '확인' 저장 실패 안내: 서버 연결 실패와 서버 거절을 구분해 보여 주는지 확인합니다. DB·외부 호출 없음.
import { readFileSync } from "node:fs";
import { afterEach, describe, expect, it, vi } from "vitest";
import { api, describeError } from "../client/src/lib/api";

const read = (p: string) => readFileSync(new URL(`../${p}`, import.meta.url), "utf8");
const failure = async (fetchStub: () => Promise<Response>) => {
  vi.stubGlobal("fetch", vi.fn(fetchStub));
  return api("POST", "/schools/s/alerts/m/read", {}).catch((e: unknown) => e);
};

afterEach(() => vi.unstubAllGlobals());

describe("경보 확인 저장 실패 안내", () => {
  it("서버가 꺼져 있으면 연결 실패로 안내한다", async () => {
    const e = await failure(() => Promise.reject(new TypeError("Failed to fetch")));
    expect(describeError(e).message).toBe("서버에 연결할 수 없습니다. 통신 상태를 확인하세요.");
  });

  it("서버가 거절하면 서버의 이유를 그대로 안내한다", async () => {
    const e = await failure(async () => new Response(JSON.stringify({ code: "not_found", message: "경보를 찾을 수 없습니다." }), { status: 404 }));
    expect(describeError(e).message).toBe("경보를 찾을 수 없습니다.");
  });

  it("서버 오류는 연결 실패와 다른 문구로 안내한다", async () => {
    const e = await failure(async () => new Response(JSON.stringify({ code: "internal_error", message: "서버 오류가 발생했습니다. 잠시 후 다시 시도하세요." }), { status: 500 }));
    expect(describeError(e).message).toBe("서버 오류가 발생했습니다. 잠시 후 다시 시도하세요.");
  });

  it("안내 창은 실패 원인을 화면에 표시한다", () => {
    const src = read("client/src/components/layout/ExternalAlertNotice.tsx");
    expect(src).toContain("setSaveError(describeError(e).message)");
    expect(src).toContain("확인을 저장하지 못했습니다. {saveError}");
    expect(src).not.toContain("다시 눌러 주세요");
  });
});

describe("안내 창 시연 스크립트", () => {
  const ps = read("scripts/preview/alert-popup-demo.ps1");

  it("서버 시작 전에 창을 유지하라고 알리고, 종료되면 코드와 시각을 남긴다", () => {
    const start = ps.indexOf("npx tsx server/src/index.ts");
    expect(ps.indexOf("닫거나 Ctrl+C를 누르지 마세요")).toBeGreaterThan(-1);
    expect(ps.indexOf("닫거나 Ctrl+C를 누르지 마세요")).toBeLessThan(start);
    expect(ps.indexOf("임시 서버가 종료되었습니다(코드 $LASTEXITCODE")).toBeGreaterThan(start);
  });

  it("테스트 DB 대상 검사와 UTF-8 BOM(PowerShell 5.1 한글)을 유지한다", () => {
    expect(ps).toContain('$u.AbsolutePath -ne "/safeschool_test"');
    expect(readFileSync(new URL("../scripts/preview/alert-popup-demo.ps1", import.meta.url)).subarray(0, 3)).toEqual(Buffer.from([0xef, 0xbb, 0xbf]));
  });
});
