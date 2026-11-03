// Beta PILOT 2 T7: 버전 표기와 시범운영 안내(정적 렌더링 + 저장소 문구 검사). 삭제 예정일 안내는 그대로인지 함께 고정
// 2026-11-03 갱신: 상단 배너는 두 줄(제한적 시범운영 중 / 개인정보 입력 금지), 공식 체계 비대체 안내는 별도 영역(로그인 화면·앱 본문 하단)
import fs from "node:fs";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { OfficialSystemNotice, ReleaseNoticeView, RELEASE_LABEL } from "../client/src/components/ui/ReleaseNotice";
import { RELEASE } from "../shared/release";

const render = (mode: "virtual_test" | "school_pilot" | null, compact = false) => renderToStaticMarkup(createElement(ReleaseNoticeView, { mode, compact }));
const OFFICIAL = "실제 학교의 공식 재난 대응 체계, 119 신고, 기존 비상연락망을 대체하지 않습니다.";

describe("시범운영 안내", () => {
  it("제품명·개발 버전·단계 표기", () => {
    expect(RELEASE).toEqual({ product: "SAFE SCHOOL", devVersion: "Beta PILOT 2", stage: "제한적 시범운영 중" });
    expect(RELEASE_LABEL).toBe("SAFE SCHOOL · Beta PILOT 2 · 제한적 시범운영 중");
  });

  it("상단 배너: 모든 모드·크기에서 굵은 제목 + 바로 아래 개인정보 입력 금지, 경고 아이콘, 옛 긴 문구 없음", () => {
    for (const mode of ["virtual_test", "school_pilot", null] as const) {
      for (const compact of [true, false]) {
        const html = render(mode, compact);
        expect(html).toMatch(/<strong[^>]*>제한적 시범운영 중<\/strong><span[^>]*>교직원 및 학생의 개인정보는 입력하지 마세요\.<\/span>/);
        expect(html).toContain("<svg");
        expect(html).toContain('role="note"');
        expect(html).not.toContain("119");
        expect(html).not.toMatch(/승인된 가상 데이터 테스트|실제 학교·교직원·학생 정보|Prototype|Pilot v0\.1|프로토타입/);
      }
    }
    expect(render("virtual_test")).toContain('data-mode="virtual_test"');
  });

  it("공식 체계 비대체 안내는 별도 영역에 유지(로그인 화면·앱 공통 틀)", () => {
    const official = renderToStaticMarkup(createElement(OfficialSystemNotice, {}));
    expect(official).toContain(OFFICIAL);
    expect(official).toContain(RELEASE_LABEL);
    const login = fs.readFileSync("client/src/pages/LoginPage.tsx", "utf8");
    const shell = fs.readFileSync("client/src/components/layout/AppShell.tsx", "utf8");
    expect(login).toContain("<OfficialSystemNotice");
    expect(shell).toContain("<OfficialSystemNotice");
    expect(shell).toContain("<ReleaseNotice compact />");
  });

  it("버전 표기에 배포 시점·배포 완료 표현이 없음", () => {
    expect(JSON.stringify(RELEASE)).not.toMatch(/배포|20\d\d|출시/);
    expect(render("virtual_test")).not.toMatch(/배포|출시/);
  });

  it("옛 안내 컴포넌트·문구가 화면 코드에 남아 있지 않음, 삭제 예정일 안내는 임의로 바꾸지 않음", () => {
    const login = fs.readFileSync("client/src/pages/LoginPage.tsx", "utf8");
    const shell = fs.readFileSync("client/src/components/layout/AppShell.tsx", "utf8");
    expect(login + shell).not.toContain("PrototypeNotice");
    expect(fs.existsSync("client/src/components/ui/PrototypeNotice.tsx")).toBe(false);
    expect(login).toContain("2026년 12월 31일 삭제 예정입니다");
    expect(login).not.toContain("평가 안내문");
  });
});
