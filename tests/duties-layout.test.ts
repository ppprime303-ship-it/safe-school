// STEP 3-E 회귀: 업무 담당자 행 모바일 배치(겹침·잘림 방지 구조) — DB 없음, react-dom/server로 HTML만 확인
// 실제 픽셀 겹침 측정은 tools/ui-checks/duties_layout.py(Playwright, 320·360·390·430·1366px)로 합니다.
import { describe, expect, it } from "vitest";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { DutyMemberRow, type DutyMember } from "../client/src/pages/admin/DutiesSection";

const member = (duties: DutyMember["duties"], name = "남궁가상선생님(6학년부장)"): DutyMember => ({ id: "m1", role: "homeroom", user: { displayName: name, email: "m1@demo.invalid" }, duties });
const render = (m: DutyMember, isSelf = false) => renderToStaticMarkup(createElement("ul", null, createElement(DutyMemberRow, { member: m, isSelf, onEnd: () => {}, onGrant: () => {} })));
const buttons = (html: string) => [...html.matchAll(/<button[^>]*class="([^"]*)"[^>]*>([\s\S]*?)<\/button>/g)].map((x) => ({ cls: x[1]!, text: x[2]!.replace(/<[^>]+>/g, "").trim() }));

describe("업무 담당자 행(모바일 배치)", () => {
  it("이름·현재 업무·단추 영역이 분리되고, 단추 영역은 모바일 1열(640px 이상 2열, PC 가로)", () => {
    const html = render(member([{ id: "d1", duty: "safety_officer", isActing: false, grantedVia: "school_app" }]));
    expect(html).toContain('aria-label="남궁가상선생님(6학년부장) 현재 업무"');
    expect(html).toMatch(/class="mt-2 grid grid-cols-1 gap-2 sm:grid-cols-2 lg:mt-0 lg:flex/);
    // 이름은 단추와 같은 줄에서 공간을 다투지 않음(이전: 이름·배지·단추가 한 flex 줄에 섞여 겹침)
    expect(html).not.toMatch(/<li[^>]*class="[^"]*\bflex-wrap\b/);
  });

  it("단추는 전체 폭·줄바꿈 허용(긴 한글이 밖으로 나가지 않음), 해제=빨간 테두리·X, 지정=남색 테두리·더하기", () => {
    const b = buttons(render(member([{ id: "d1", duty: "safety_officer", isActing: false, grantedVia: "school_app" }])));
    expect(b.map((x) => x.text)).toEqual(["안전업무 담당 해제", "앱 운영담당 지정"]);
    for (const x of b) {
      expect(x.cls).toContain("w-full");
      expect(x.cls).toContain("whitespace-normal");
      expect(x.cls).toContain("min-h-touch");
      expect(x.cls).toContain("lg:w-auto");
    }
    expect(b[0]!.cls).toContain("border-danger");
    expect(b[0]!.cls).toContain("text-danger");
    expect(b[1]!.cls).toContain("border-brand");
    expect(b[0]!.cls).not.toContain("border-brand");
  });

  it("겸임(두 업무 모두): 해제 단추 2개, 지정 단추 없음", () => {
    const b = buttons(render(member([
      { id: "d1", duty: "safety_officer", isActing: false, grantedVia: "school_app" },
      { id: "d2", duty: "app_operator", isActing: false, grantedVia: "school_app" },
    ])));
    expect(b.map((x) => x.text)).toEqual(["안전업무 담당 해제", "앱 운영담당 해제"]);
  });

  it("본인: 지정 단추 없음(자기 지정 금지 정책 유지), 업무 없음 표시", () => {
    const html = render(member([], "가상 담당"), true);
    expect(buttons(html)).toHaveLength(0);
    expect(html).toContain("본인은 다른 담당자가 지정");
    expect(html).toContain("지정된 업무 없음");
  });
});
