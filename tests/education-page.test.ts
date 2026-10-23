// STEP 4 안전교육 자료 화면 — 컴포넌트 렌더링(react-dom/server로 HTML만 확인, DB 없음)
// 실제 클릭·뒤로 가기·새로고침·화면 폭(320~1366px) 확인은 tools/ui-checks/education_ui.py(Playwright)로 합니다.
import { describe, expect, it } from "vitest";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { EDUCATION_TEXT, EducationResourceDetailView, EducationResourcesView, ResourceSummaryCard } from "../client/src/pages/education/EducationResourcesPage";
import { EDUCATION_ALLOWED_HOSTS, EDUCATION_RESOURCES } from "../client/src/data/educationResources";
import { EMPTY_FILTER, type ResourceFilter } from "../client/src/lib/educationResources";
import { navItemsFor } from "../client/src/components/layout/AppShell";

const view = (initialFilter: ResourceFilter = EMPTY_FILTER) => renderToStaticMarkup(createElement(EducationResourcesView, { schoolId: "s1", initialFilter }));
const detail = (resourceId: string, search = "", resources = EDUCATION_RESOURCES) =>
  renderToStaticMarkup(createElement(EducationResourceDetailView, { schoolId: "s1", resourceId, search, resources }));
const cards = (html: string) => [...html.matchAll(/<a [^>]*data-testid="edu-card"[^>]*>/g)].map((m) => m[0]);
const extLinks = (html: string) => [...html.matchAll(/<a [^>]*data-testid="edu-external-link"[^>]*>/g)].map((m) => m[0]);
const selected = (html: string) => [...html.matchAll(/<option value="([^"]*)" selected="">/g)].map((m) => m[1]);

describe("목록 화면(첫 화면)", () => {
  it("제목·보조 문구·짧은 출처 안내·기록하지 않음 안내", () => {
    const html = view();
    expect(html).toContain(EDUCATION_TEXT.title);
    expect(html).toContain("학교 안전교육에 필요한 공식 자료 제공처를 찾아보세요.");
    expect(html).toContain("교육자료는 각 기관의 공식 사이트에서 제공됩니다.");
    expect(html).toContain("이 화면에서는 교육 이수·실적을 기록하지 않습니다.");
    expect(html).toContain("외부 사이트 내용 검색 아님");
    expect(html).toContain("외부 사이트 이용 안내");
  });

  it("필터: 검색창 + 학교급·영역 드롭다운(칩 단추 없음), 처음엔 '전체'·초기화 없음", () => {
    const html = view();
    expect((html.match(/<select /g) ?? []).length).toBe(2);
    expect(html).not.toContain("aria-pressed");
    expect(selected(html)).toEqual(["all", "all"]);
    expect(html).toContain(">전체 학교급</option>");
    expect(html).toContain(">전체 영역</option>");
    for (const t of ["유치원", "초등학교", "중학교", "고등학교", "생활안전", "교통안전", "폭력예방 및 신변보호", "약물 및 사이버중독 예방", "재난안전", "직업안전", "응급처치"]) expect(html).toContain(`>${t}</option>`);
    expect(html).not.toContain("필터 초기화");
    expect(html).toMatch(/<div class="grid grid-cols-1 gap-3 sm:grid-cols-2">/); // 좁은 화면 세로, 넓으면 나란히
  });

  it("간결한 카드: 아이콘·사이트명·기관·배지 2개·화살표만(긴 설명·근거·확인일·외부 단추 없음)", () => {
    const html = view();
    expect(cards(html).length).toBe(2);
    expect(html).toContain("학교안전지원시스템");
    expect(html).toContain("학교안전공제중앙회");
    expect(html).toContain(">유·초·중·고<");
    expect(html).toContain(">7대 안전교육 영역<");
    expect(html).toContain(">생활·교통·재난 외<");
    for (const hidden of ["활용 안내", "근거", "링크 확인일", "제공 자료", EDUCATION_RESOURCES[0]!.description, "자료 제공 기관 목록"]) expect(html).not.toContain(hidden);
    expect(extLinks(html).length).toBe(0); // 첫 화면에서 외부 사이트로 바로 이동하지 않음
    expect(html).not.toContain("target=\"_blank\"");
  });

  it("카드는 SAFE SCHOOL 안 상세 주소로, 현재 검색어·필터를 붙여 이동", () => {
    const a = cards(view({ query: "동영상", level: "middle", area: "traffic" }));
    expect(a[0]).toContain('href="/s/s1/education/schoolsafe24?q=%EB%8F%99%EC%98%81%EC%83%81&amp;level=middle&amp;area=traffic"');
    expect(cards(view())[1]).toContain('href="/s/s1/education/kasem"');
  });

  it("드롭다운 영역 필터: 응급처치 → 1곳, 선택값 표시, 초기화 표시", () => {
    const html = view({ ...EMPTY_FILTER, area: "firstaid" });
    expect(cards(html).length).toBe(1);
    expect(html).not.toContain("국민안전교육플랫폼");
    expect(selected(html)).toEqual(["all", "firstaid"]);
    expect(html).toContain("필터 초기화");
  });

  it("드롭다운 학교급 + 영역 + 검색어 동시 적용", () => {
    const html = view({ query: "체험관", level: "kindergarten", area: "traffic" });
    expect(selected(html)).toEqual(["kindergarten", "traffic"]);
    expect(cards(html).length).toBe(1);
    expect(html).toContain("국민안전교육플랫폼");
    expect(html).toContain('data-testid="edu-count">1<');
  });

  it("검색 결과 없음 → '현재 확인된 자료가 없습니다' + 초기화, 카드 없음", () => {
    const html = view({ ...EMPTY_FILTER, query: "없는검색어xyz" });
    expect(cards(html).length).toBe(0);
    expect(html).toContain('data-testid="edu-empty"');
    expect(html).toContain(EDUCATION_TEXT.empty);
    expect(html).toContain('data-testid="edu-count">0<');
  });

  it("확인된 자료가 없는 영역·학교급 조합 → 빈 안내(자료가 있는 것처럼 표시하지 않음)", () => {
    const only = [{ ...EDUCATION_RESOURCES[1]!, levels: ["elementary" as const] }];
    const html = renderToStaticMarkup(createElement(EducationResourcesView, { schoolId: "s1", resources: only, initialFilter: { ...EMPTY_FILTER, level: "high" } }));
    expect(cards(html).length).toBe(0);
    expect(html).toContain("선택한 조건에 맞는 공식 자료 제공처를 아직 확인하지 못했습니다.");
  });

  it("카드 목록: 모바일 1열, 768px 이상 2열 / 카드 전체가 링크(안에 다른 단추 없음)", () => {
    const html = view();
    expect(html).toMatch(/<ul class="grid grid-cols-1 gap-3 md:grid-cols-2">/);
    const card = renderToStaticMarkup(createElement(ResourceSummaryCard, { resource: EDUCATION_RESOURCES[0]!, href: "/x" }));
    expect((card.match(/<a /g) ?? []).length).toBe(1);
    expect(card).not.toContain("<button");
    expect(card).toContain("min-h-touch");
    expect(card).toContain("focus-visible:");
    expect(card).toContain("상세 정보 보기");
  });

  it("입력 칸은 검색어만(개인정보 입력 칸 없음)", () => {
    const html = view();
    const inputs = html.match(/<input [^>]*>/g) ?? [];
    expect(inputs.length).toBe(1);
    expect(inputs[0]).toContain('type="search"');
    expect(html).not.toContain("<form");
  });
});

describe("상세 화면", () => {
  it("구성: 돌아가기·기관 아이콘·사이트명·기관·소개·자료 유형·학교급·영역(전체)·찾는 방법·자료실 위치·확인일·이용 안내·방문 단추", () => {
    const r = EDUCATION_RESOURCES[0]!;
    const html = detail("schoolsafe24");
    for (const t of ["목록으로 돌아가기", r.name, `운영 기관 · ${r.operator}`, r.description, "제공 교육자료 유형", "추천 학교급", "관련 안전교육 영역", "교육자료를 찾는 방법", "자료실 위치", "안전교육 &gt; 자료실", `링크 확인일 ${r.verifiedAt}`, "외부 사이트 이용 안내", "공식 사이트 방문"])
      expect(html).toContain(t);
    for (const t of ["생활안전", "교통안전", "폭력예방 및 신변보호", "약물 및 사이버중독 예방", "재난안전", "직업안전", "응급처치"]) expect(html).toContain(`>${t}</li>`);
    expect(html).toContain("확인된 공식 자료실로 바로 연결");
  });

  it("공식 사이트 방문: 강조 단추 하나, 새 탭 + noopener noreferrer, 확인한 주소", () => {
    const a = extLinks(detail("schoolsafe24"));
    expect(a.length).toBe(1);
    expect(a[0]).toContain('href="https://www.schoolsafe24.or.kr/front/rpstr/rpstrList.do?menuSn=181&amp;upperMenuSn=148"');
    expect(a[0]).toContain('target="_blank"');
    expect(a[0]).toContain('rel="noopener noreferrer"');
    // 기관 홈페이지는 보조 글자 링크(같은 보안 속성)
    const home = detail("schoolsafe24").match(/<a [^>]*data-testid="edu-home-link"[^>]*>/)![0];
    expect(home).toContain('href="https://www.schoolsafe24.or.kr/"');
    expect(home).toContain('rel="noopener noreferrer"');
  });

  it("자료실 주소를 확인하지 못한 기관: 홈페이지 연결이라고 밝히고, 영역별 찾는 방법(범죄안전) 표시", () => {
    const html = detail("kasem");
    expect(html).toContain("기관 홈페이지로 연결");
    expect(html).toContain("메뉴 주소를 확인하지 못해");
    expect(html).toContain("분류 이름은 &#x27;범죄안전&#x27;");
    expect(html).not.toContain('data-testid="edu-home-link"');
    expect(extLinks(html)[0]).toContain('href="https://kasem.safekorea.go.kr/"');
  });

  it("없는 기관 ID → '찾는 자료 제공처가 없습니다' + 목록으로(외부 링크 없음)", () => {
    const html = detail("no-such-site");
    expect(html).toContain('data-testid="edu-not-found"');
    expect(extLinks(html).length).toBe(0);
    expect(html).toContain('href="/s/s1/education"');
  });

  it("목록으로 돌아가기: 받은 검색어·필터 유지, 알 수 없는 값은 버림", () => {
    expect(detail("kasem", "?q=%EC%B2%B4%ED%97%98%EA%B4%80&level=kindergarten&area=traffic")).toMatch(
      /href="\/s\/s1\/education\?q=%EC%B2%B4%ED%97%98%EA%B4%80&amp;level=kindergarten&amp;area=traffic" data-testid="edu-back"/,
    );
    expect(detail("kasem", "?level=college&area=%3Cscript%3E&evil=1")).toMatch(/href="\/s\/s1\/education" data-testid="edu-back"/);
  });

  it("허용되지 않은 주소는 링크를 만들지 않고 '링크 확인 필요'로 막음", () => {
    for (const url of ["javascript:alert(1)", "https://kasem.safekorea.go.kr.evil.example/"]) {
      const html = detail("kasem", "", [{ ...EDUCATION_RESOURCES[1]!, url }]);
      expect(html).not.toContain("javascript:");
      expect(extLinks(html).length).toBe(0);
      expect(html).toContain('data-testid="edu-blocked-link"');
    }
    expect(EDUCATION_ALLOWED_HOSTS.length).toBe(2);
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
