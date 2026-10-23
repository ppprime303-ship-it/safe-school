// STEP 5 시설 안전점검 자료 화면 — 컴포넌트 렌더링(react-dom/server, DB 없음)
// 실제 클릭·뒤로 가기·새로고침·6개 화면 폭은 tools/ui-checks/facility_ui.py(Playwright)로 확인합니다.
import { describe, expect, it } from "vitest";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { FACILITY_TEXT, FacilityResourceDetailView, FacilityResourcesView, ResourceTabs, fmtDate, localToday } from "../client/src/pages/facility/FacilityResourcesPage";
import { FACILITY_RESOURCES } from "../client/src/data/facilityResources";
import { EMPTY_FACILITY_FILTER, type FacilityFilter, type FacilityResource } from "../client/src/lib/facilityResources";
import { navItemsFor } from "../client/src/components/layout/AppShell";

const TODAY = "2026-10-23";
const view = (o: { office?: string | null; filter?: Partial<FacilityFilter>; user?: string | null; resources?: FacilityResource[] } = {}) =>
  renderToStaticMarkup(
    createElement(FacilityResourcesView, {
      schoolId: "s1",
      schoolEduOfficeName: o.office ?? null,
      today: TODAY,
      initialFilter: { ...EMPTY_FACILITY_FILTER, ...o.filter },
      initialUserOffice: o.user ?? null,
      ...(o.resources ? { resources: o.resources } : {}),
    }),
  );
const detail = (id: string, homeOfficeId: string | null = "incheon", search = "", resources?: FacilityResource[]) =>
  renderToStaticMarkup(createElement(FacilityResourceDetailView, { schoolId: "s1", resourceId: id, search, homeOfficeId, today: TODAY, ...(resources ? { resources } : {}) }));
const cards = (html: string) => [...html.matchAll(/<a [^>]*data-testid="fac-card" data-category="([a-z]+)"[^>]*href="([^"]+)"|<a [^>]*href="([^"]+)"[^>]*data-testid="fac-card" data-category="([a-z]+)"/g)].map((m) => ({ cat: m[1] ?? m[4], href: m[2] ?? m[3] }));
const sectionOrder = (html: string) => [...html.matchAll(/data-testid="fac-section-(fac-[a-z-]+)"/g)].map((m) => m[1]);
const ext = (html: string) => [...html.matchAll(/<a [^>]*data-testid="fac-external-link"[^>]*>/g)].map((m) => m[0]);

describe("목록 화면", () => {
  it("순서: 제목·필수 안내 → 관할 정보 → 최근 개정 → (필터) → 국가 법령 → 우리 관할 → 전국 교육청 → 공공기관", () => {
    const html = view({ office: "인천광역시교육청" });
    expect(html).toContain(FACILITY_TEXT.title);
    expect(html).toContain(FACILITY_TEXT.required);
    expect(html.indexOf('data-testid="fac-home"')).toBeLessThanOrEqual(html.indexOf("fac-section-fac-recent"));
    expect(sectionOrder(html)).toEqual(["fac-recent", "fac-national", "fac-home-office", "fac-other", "fac-public"]);
  });

  it("관할 교육청: 학교 정보가 있으면 표시하고 우리 관할 자료를 먼저", () => {
    const html = view({ office: "인천광역시교육청" });
    expect(html).toContain("내 학교 관할 교육청: <span");
    expect(html).toContain(">인천광역시교육청</span>");
    expect(html).toContain("학교 등록 정보(학교알리미 교육청명) 기준");
    const c = cards(html);
    expect(c.filter((x) => x.cat === "home").map((x) => x.href)).toEqual(["/s/s1/facility-resources/incheon-facility-law-board", "/s/s1/facility-resources/office-incheon"]);
    expect(c.findIndex((x) => x.cat === "home")).toBeLessThan(c.findIndex((x) => x.cat === "other"));
  });

  it("학교 소재지가 없으면 '학교 지역을 선택해 주세요'와 선택 메뉴, 우리 관할 묶음 없음", () => {
    const html = view();
    expect(html).toContain(FACILITY_TEXT.chooseRegion);
    expect(html).toContain("이 기기에서만 쓰이며 학교 정보는 바뀌지 않습니다");
    expect(html).not.toContain("fac-section-fac-home-office");
    expect(cards(html).some((x) => x.cat === "home")).toBe(false);
  });

  it("사용자가 고른 지역은 '이 기기에서 선택'으로 구분 표시", () => {
    const html = view({ user: "busan" });
    expect(html).toContain("내 학교 관할 교육청(이 기기에서 선택)");
    expect(html).toContain(">부산광역시교육청</span>");
  });

  it("지역 필터(탐색 지역)는 관할 정보와 분리: 경기 탐색 중에도 관할은 인천", () => {
    const html = view({ office: "인천광역시교육청", filter: { region: "gyeonggi" } });
    expect(html).toContain(">인천광역시교육청</span>");
    expect(html).toContain("현재 탐색 중: <strong>경기도교육청</strong>");
    expect(html).toContain("타 지역 참고자료입니다");
    expect(cards(html).every((x) => x.cat === "other")).toBe(true);
    expect(html).toContain("국가 공통 법령 보기"); // 필터로 법령이 빠져도 바로 갈 수 있음
  });

  it("지역 선택지: 전체·전국 공통·교육청 16곳, 관할에는 '(우리 관할)'", () => {
    const html = view({ office: "인천광역시교육청" });
    expect(html).toContain('<option value="national">전국 공통(국가 법령)</option>');
    expect((html.match(/<option value="(seoul|busan|daegu|incheon|jeonnam-gwangju|daejeon|ulsan|sejong|gyeonggi|gangwon|chungbuk|chungnam|jeonbuk|gyeongbuk|gyeongnam|jeju)"/g) ?? []).length).toBe(16);
    expect(html).toContain(">인천광역시교육청 (우리 관할)</option>");
  });

  it("최근 제정·개정: 등록된 확인 자료(시행령 타법개정)만, 공포·시행일 표시", () => {
    const html = view({ office: "인천광역시교육청" });
    expect(html).toContain('data-testid="fac-recent-list"');
    expect((html.match(/data-testid="fac-recent-item"/g) ?? []).length).toBe(1);
    expect(html).toContain("타법개정 · 대통령령 제35948호 · 공포 2025. 12. 30. · 시행 2026. 1. 2.");
    expect(html).toContain("새 법령·지침을 자동으로 감지하지 않습니다");
  });

  it("최근 개정이 없으면 안내 문구(임의 알림 없음)", () => {
    const html = view({ resources: FACILITY_RESOURCES.filter((r) => r.id !== "decree") });
    expect(html).toContain(FACILITY_TEXT.noRecent);
    expect(html).not.toContain('data-testid="fac-recent-item"');
  });

  it("처음에는 법령 3건·타 지역 4건만, 나머지는 '전체 보기'", () => {
    const html = view({ office: "인천광역시교육청" });
    const c = cards(html);
    expect(c.filter((x) => x.cat === "national").length).toBe(3);
    expect(c.filter((x) => x.cat === "other").length).toBe(4);
    expect(html).toContain("법령 전체 보기(6)");
    expect(html).toMatch(/교육청 자료 전체 보기\(\d+\)/);
  });

  it("필터를 쓰면 해당 결과 전부, 결과 없음 안내·초기화", () => {
    expect(cards(view({ filter: { region: "national" } })).length).toBe(6);
    const none = view({ filter: { query: "없는검색어xyz" } });
    expect(none).toContain('data-testid="fac-empty"');
    expect(none).toContain(FACILITY_TEXT.empty);
    expect(none).toContain("필터 초기화");
  });

  it("카드: 내부 상세 주소(현재 검색어·필터 포함), 외부 링크 없음, 최근 개정 배지는 해당 자료만", () => {
    const html = view({ filter: { query: "시행령", area: "general" } });
    expect(cards(html)[0]!.href).toBe("/s/s1/facility-resources/decree?q=%EC%8B%9C%ED%96%89%EB%A0%B9&amp;area=general");
    expect(ext(html).length).toBe(0);
    expect(html).not.toContain('target="_blank"');
    const all = view({ office: "인천광역시교육청", filter: { region: "national" } });
    expect((all.match(/data-testid="fac-new"/g) ?? []).length).toBe(1);
  });

  it("입력 칸은 검색어만(개인정보 입력 없음)", () => {
    const html = view();
    expect((html.match(/<input /g) ?? []).length).toBe(1);
    expect(html).not.toContain("<form");
  });
});

describe("상세 화면", () => {
  it("법령 상세: 구분·유형·시행 상태·제정/개정 이력·확인일·찾는 방법·주의사항·필수 안내·원문 단추", () => {
    const html = detail("act");
    for (const t of ["교육시설 등의 안전 및 유지관리 등에 관한 법률", "국가 공통", "법률", "시행 중", "법률 제20181호", "공포 2024. 2. 6.", "시행 2025. 2. 7.", "링크 확인일 2026. 10. 23.", "원문·발행 정보 확인", "자료를 찾는 방법", "적용 시 주의사항", "확인일은 SAFE SCHOOL이 링크를 확인한 날이며", FACILITY_TEXT.required])
      expect(html).toContain(t);
    const a = ext(html);
    expect(a.length).toBe(1);
    expect(a[0]).toContain('target="_blank"');
    expect(a[0]).toContain('rel="noopener noreferrer"');
    expect(a[0]).toContain("현행 법령 원문 확인");
    expect(html).toContain('data-testid="fac-version-link"'); // 확인한 판(보조 링크)
  });

  it("타 지역 교육청 자료: 참고용 경고, 원문 직접 링크(B)와 기관 홈페이지 구분", () => {
    const html = detail("gyeonggi-safety-manual", "incheon");
    expect(html).toContain('data-testid="fac-other-note"');
    expect(html).toContain("우리 학교의 의무 지침이 아닐 수 있습니다");
    expect(html).toContain("제정·개정 정보를 확인하지 못했습니다");
    expect(ext(html)[0]).toContain('href="https://www.goe.go.kr/resource/old/BBSMSTR_000000030131/BBS_202401290141003700.pdf"');
    expect(html).toContain('data-testid="fac-home-link"');
  });

  it("관할 교육청 안내(C): 경고 없음, 홈페이지 열기", () => {
    const html = detail("office-incheon", "incheon");
    expect(html).toContain("우리 관할");
    expect(html).not.toContain('data-testid="fac-other-note"');
    expect(html).toContain("공식 기관 안내(자료 미확인)");
    expect(ext(html)[0]).toContain("기관 홈페이지 열기");
  });

  it("시행 예정 개정은 '시행 예정'으로 구분(현행처럼 표시하지 않음)", () => {
    const base = FACILITY_RESOURCES[0]!;
    const sched = { ...base, revisions: [{ kind: "amended" as const, number: "가상 제1호", promulgatedAt: "2026-09-01", effectiveAt: "2027-03-01" }, ...base.revisions] };
    const html = detail("act", null, "", [sched]);
    expect(html).toContain("시행 예정 개정 있음");
    expect(html).toMatch(/시행 2027\. 3\. 1\.<span[^>]*>시행 예정<\/span>/);
  });

  it("없는 자료 ID → 안내 + 목록으로(외부 링크 없음)", () => {
    const html = detail("no-such");
    expect(html).toContain('data-testid="fac-not-found"');
    expect(ext(html).length).toBe(0);
  });

  it("목록으로 돌아가기: 검색어·필터 유지, 알 수 없는 값은 버림", () => {
    expect(detail("act", "incheon", "?q=%EC%A0%90%EA%B2%80&region=national&area=fire")).toContain('href="/s/s1/facility-resources?q=%EC%A0%90%EA%B2%80&amp;region=national&amp;area=fire" data-testid="fac-back"');
    expect(detail("act", "incheon", "?region=mars&x=1")).toContain('href="/s/s1/facility-resources" data-testid="fac-back"');
  });

  it("허용되지 않은 주소는 링크 대신 '링크 확인 필요'", () => {
    const bad = [{ ...FACILITY_RESOURCES[0]!, officialUrl: "javascript:alert(1)", versionUrl: undefined }];
    const html = detail("act", null, "", bad);
    expect(html).not.toContain("javascript:");
    expect(html).toContain('data-testid="fac-blocked-link"');
  });
});

describe("탭·메뉴·날짜", () => {
  it("안전교육 ↔ 시설 자료 탭", () => {
    const html = renderToStaticMarkup(createElement(ResourceTabs, { schoolId: "s1", active: "facility" }));
    expect(html).toContain('href="/s/s1/education"');
    expect(html).toMatch(/aria-current="page"[^>]*>시설 안전점검 자료</);
  });
  it("모든 역할 동일 메뉴: PC 좌측 '시설 안전 자료', 모바일 하단 메뉴는 그대로(머리글 '교육자료'가 두 화면 공유)", () => {
    for (const caps of [[], ["board.view", "members.manage", "classes.manage", "drilllog.view"]]) {
      const items = navItemsFor("s1", caps);
      expect(items.find((i) => i.href === "/s/s1/facility-resources")).toMatchObject({ label: "시설 안전 자료", mobile: "none" });
      expect(items.find((i) => i.href === "/s/s1/education")!.activePrefixes).toEqual(["/s/s1/education", "/s/s1/facility-resources"]);
    }
  });
  it("날짜 표시·오늘 날짜(현지)", () => {
    expect(fmtDate("2026-01-02")).toBe("2026. 1. 2.");
    expect(fmtDate(undefined)).toBe("확인 안 됨");
    expect(localToday(new Date(2026, 9, 3))).toBe("2026-10-03");
  });
});
