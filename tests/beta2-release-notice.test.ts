// Beta PILOT 2 T7: 버전 표기와 시범운영 안내(정적 렌더링 + 저장소 문구 검사). 삭제 예정일 안내는 그대로인지 함께 고정
import fs from "node:fs";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { ReleaseNoticeView, RELEASE_LABEL } from "../client/src/components/ui/ReleaseNotice";
import { RELEASE } from "../shared/release";

const render = (mode: "virtual_test" | "school_pilot" | null, compact = false) => renderToStaticMarkup(createElement(ReleaseNoticeView, { mode, compact }));

describe("시범운영 안내", () => {
  it("제품명·개발 버전·단계 표기, 공식 체계 비대체 문구는 모든 경우에 표시", () => {
    expect(RELEASE).toEqual({ product: "SAFE SCHOOL", devVersion: "Beta PILOT 2", stage: "제한적 시범운영 준비" });
    expect(RELEASE_LABEL).toBe("SAFE SCHOOL · Beta PILOT 2 · 제한적 시범운영 준비");
    for (const mode of ["virtual_test", "school_pilot", null] as const) {
      for (const compact of [true, false]) {
        const html = render(mode, compact);
        expect(html).toContain(RELEASE_LABEL);
        expect(html).toContain("실제 학교의 공식 재난 대응 체계, 119 신고, 기존 비상연락망을 대체하지 않습니다.");
        expect(html).not.toMatch(/Prototype|Pilot v0\.1|프로토타입/);
      }
    }
  });

  it("가상 데이터와 실제 학교를 문구로 구분, 서로의 문구가 섞이지 않음", () => {
    const virtual = render("virtual_test");
    expect(virtual).toContain("승인된 가상 데이터 테스트");
    expect(virtual).toContain("실제 학교·교직원·학생 정보를 입력하지 마세요");
    expect(virtual).not.toContain("실제 학교 시범운영");
    const pilot = render("school_pilot");
    expect(pilot).toContain("실제 학교 시범운영");
    expect(pilot).toContain("학생 개인정보는 입력하지 마세요");
    expect(pilot).not.toContain("가상 데이터");
    const unknown = render(null);
    expect(unknown).not.toContain("가상 데이터");
    expect(unknown).not.toContain("실제 학교 시범운영");
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
