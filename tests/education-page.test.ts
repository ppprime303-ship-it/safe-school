// STEP 4 안전교육 자료 안내 화면 — 컴포넌트 렌더링(react-dom/server로 HTML만 확인, DB 없음)
// 실제 클릭·화면 폭(320~1366px) 확인은 tools/ui-checks/education_ui.py(Playwright)로 합니다.
import { describe, expect, it } from "vitest";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { EDUCATION_TEXT, EducationResourcesView, ResourceCard } from "../client/src/pages/education/EducationResourcesPage";
import { EDUCATION_ALLOWED_HOSTS, EDUCATION_RESOURCES } from "../client/src/data/educationResources";
import { EMPTY_FILTER, type ResourceFilter } from "../client/src/lib/educationResources";
import { navItemsFor } from "../client/src/components/layout/AppShell";

const view = (initialFilter: ResourceFilter = EMPTY_FILTER) => renderToStaticMarkup(createElement(EducationResourcesView, { initialFilter }));
const cards = (html: string) => (html.match(/data-testid="edu-card"/g) ?? []).length;
const links = (html: string) => [...html.matchAll(/<a [^>]*data-testid="edu-external-link"[^>]*>/g)].map((m) => m[0]);

describe("안전교육 자료 화면", () => {
  it("제목·안내 문구·필수 출처 문구·기록하지 않음 안내", () => {
    const html = view();
    expect(html).toContain(EDUCATION_TEXT.title);
    expect(html).toContain("안전교육에 필요한 공식 교육자료를 찾아보세요.");
    expect(html).toContain("교육자료는 해당 기관의 공식 사이트에서 제공됩니다. 자료의 최신 내용과 이용 조건은 원문 사이트에서 확인해 주세요.");
    expect(html).toContain("교육 이수나 실적을 기록하지 않고");
    expect(html).toContain("외부 사이트의 자료 내용을 검색하지 않습니다");
    expect(html).toContain("자료 제공 기관 목록");
    expect(html).toContain("외부 사이트 이용 안내");
  });

  it("처음에는 전체 카드, 필터 초기화 단추 없음", () => {
    const html = view();
    expect(cards(html)).toBe(2);
    expect(html).not.toContain("필터 초기화");
    expect(html).toMatch(/aria-pressed="true"[^>]*>전체</);
  });

  it("카드 항목: 사이트명·운영 기관·영역·자료 유형·활용 안내·확인일", () => {
    const html = view();
    for (const r of EDUCATION_RESOURCES) {
      expect(html).toContain(r.name);
      expect(html).toContain(`운영 기관 · ${r.operator}`);
      expect(html).toContain(`링크 확인일 ${r.verifiedAt}`);
    }
    expect(html).toContain("제공 자료");
    expect(html).toContain("안전교육 영역");
    expect(html).toContain("활용 안내");
  });

  it("외부 링크는 새 탭 + noopener noreferrer, 확인한 공식 주소만", () => {
    const a = links(view());
    expect(a.length).toBe(3); // 학교안전지원시스템(자료실·홈페이지) + 국민안전교육플랫폼
    for (const tag of a) {
      expect(tag).toContain('target="_blank"');
      expect(tag).toContain('rel="noopener noreferrer"');
      expect(tag).toMatch(/href="https:\/\/(www\.schoolsafe24\.or\.kr|kasem\.safekorea\.go\.kr)\//);
      expect(tag).toContain("새 창에서 열림");
    }
  });

  it("영역 필터: 응급처치 → 1곳, 필터 초기화 표시, 선택 영역 강조", () => {
    const html = view({ ...EMPTY_FILTER, area: "firstaid" });
    expect(cards(html)).toBe(1);
    expect(html).toContain("학교안전지원시스템");
    expect(html).not.toContain(">국민안전교육플랫폼</h3>");
    expect(html).toContain("필터 초기화");
    expect(html).toMatch(/aria-pressed="true"[^>]*>응급처치/);
  });

  it("영역별 찾는 방법(근거 있는 경우만): 국민안전교육플랫폼 폭력예방 → '범죄안전' 안내", () => {
    const html = view({ ...EMPTY_FILTER, area: "violence" });
    expect(cards(html)).toBe(2);
    expect(html).toContain("분류 이름은 &#x27;범죄안전&#x27;");
  });

  it("학교급 필터 선택 표시", () => {
    const html = view({ ...EMPTY_FILTER, level: "high" });
    expect(html).toMatch(/aria-pressed="true"[^>]*>고등학교/);
    expect(cards(html)).toBe(2);
  });

  it("검색 결과 없음 → '현재 확인된 자료가 없습니다' + 초기화, 카드 없음", () => {
    const html = view({ ...EMPTY_FILTER, query: "없는검색어xyz" });
    expect(cards(html)).toBe(0);
    expect(html).toContain('data-testid="edu-empty"');
    expect(html).toContain("현재 확인된 자료가 없습니다");
    expect(html).toContain("필터 초기화");
    expect(html).toContain('data-testid="edu-count">0<');
  });

  it("확인된 자료가 없는 영역·학교급 조합 → 빈 안내(자료가 있는 것처럼 표시하지 않음)", () => {
    const only = [{ ...EDUCATION_RESOURCES[1]!, levels: ["elementary" as const] }];
    const html = renderToStaticMarkup(createElement(EducationResourcesView, { resources: only, initialFilter: { ...EMPTY_FILTER, level: "high" } }));
    expect(cards(html)).toBe(0);
    expect(html).toContain("선택한 조건에 맞는 공식 자료 제공처를 아직 확인하지 못했습니다.");
  });

  it("허용되지 않은 주소는 링크를 만들지 않고 '링크 확인 필요'로 막음", () => {
    const bad = { ...EDUCATION_RESOURCES[1]!, url: "javascript:alert(1)" };
    const html = renderToStaticMarkup(createElement(ResourceCard, { resource: bad, allowedHosts: EDUCATION_ALLOWED_HOSTS, selectedArea: "all" }));
    expect(html).not.toContain("javascript:");
    expect(html).not.toContain("<a ");
    expect(html).toContain('data-testid="edu-blocked-link"');
    const other = { ...EDUCATION_RESOURCES[1]!, url: "https://kasem.safekorea.go.kr.evil.example/" };
    expect(renderToStaticMarkup(createElement(ResourceCard, { resource: other, allowedHosts: EDUCATION_ALLOWED_HOSTS, selectedArea: "all" }))).not.toContain("<a ");
  });

  it("카드 목록: 모바일 1열, 768px 이상 2열", () => {
    expect(view()).toMatch(/<ul class="grid grid-cols-1 gap-4 md:grid-cols-2">/);
  });

  it("입력 칸은 검색어만(개인정보 입력 칸 없음)", () => {
    const html = view();
    const inputs = html.match(/<input [^>]*>/g) ?? [];
    expect(inputs.length).toBe(1);
    expect(inputs[0]).toContain('type="search"');
    expect(html).not.toContain("<form");
  });
});

describe("메뉴 연결", () => {
  it("모든 역할에 같은 '안전교육 자료' 메뉴(권한 무관), 모바일은 머리글", () => {
    for (const caps of [[], ["board.view", "drilllog.view", "members.manage", "classes.manage"]]) {
      const items = navItemsFor("s1", caps);
      const edu = items.find((i) => i.href === "/s/s1/education");
      expect(edu).toMatchObject({ label: "안전교육 자료", icon: "book", mobile: "header", shortLabel: "교육자료" });
    }
  });
  it("학교를 고르지 않았으면 메뉴 없음, 기존 하단 메뉴 항목 수는 그대로", () => {
    expect(navItemsFor(null, null).some((i) => i.href.endsWith("/education"))).toBe(false);
    const bottom = (caps: string[]) => navItemsFor("s1", caps).filter((i) => i.mobile !== "header").map((i) => i.label);
    expect(bottom([])).toEqual(["학급 보고", "경보", "학교 선택"]);
    expect(bottom(["board.view", "drilllog.view", "members.manage", "classes.manage"])).toEqual(["상황판", "학급 보고", "경보", "훈련일지", "교직원", "학급", "학교"]);
  });
});
