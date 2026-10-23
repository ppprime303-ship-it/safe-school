// STEP 5 시설 안전점검 자료 — 데이터·관할 판정·최근 제정/개정·필터(순수 함수, DB 없음)
import { describe, expect, it } from "vitest";
import { EDU_OFFICES, FACILITY_ALLOWED_HOSTS, FACILITY_RESOURCES } from "../client/src/data/facilityResources";
import {
  EMPTY_FACILITY_FILTER,
  SOURCE_TYPES,
  areaSummaryOf,
  categoryOf,
  daysBetween,
  facilityFilterFromSearch,
  facilityFilterToSearch,
  filterFacilityResources,
  findFacilityResource,
  groupByCategory,
  isRecent,
  isSafeExternalUrl,
  officeIdFromName,
  recentChanges,
  resolveHomeOffice,
  statusOf,
  validateFacilityData,
  type FacilityResource,
} from "../client/src/lib/facilityResources";

const TODAY = "2026-10-23";
const ids = (l: FacilityResource[]) => l.map((r) => r.id);
const byId = (id: string) => findFacilityResource(FACILITY_RESOURCES, id)!;
const base = byId("act");

describe("데이터 점검", () => {
  it("등록 데이터 오류 0(필수 항목·주소 허용·등급 규칙·법령은 국가법령정보센터)", () => {
    expect(validateFacilityData(FACILITY_RESOURCES, EDU_OFFICES, FACILITY_ALLOWED_HOSTS)).toEqual([]);
  });
  it("교육청 16곳(교육부 시·도교육청 목록 기준, 광주·전남 통합) 모두 탐색 가능", () => {
    expect(EDU_OFFICES.length).toBe(16);
    for (const o of EDU_OFFICES) expect(FACILITY_RESOURCES.some((r) => r.tier === "office" && r.officeId === o.id)).toBe(true);
    expect(officeIdFromName(EDU_OFFICES, "광주광역시교육청")).toBe("jeonnam-gwangju");
    expect(officeIdFromName(EDU_OFFICES, "전라남도교육청")).toBe("jeonnam-gwangju");
  });
  it("법률·시행령·시행규칙·고시 분류와 국가법령정보센터 현행 바로가기", () => {
    const nat = FACILITY_RESOURCES.filter((r) => r.tier === "national");
    expect(nat.map((r) => SOURCE_TYPES[r.sourceType].label)).toEqual(["법률", "시행령", "시행규칙", "고시", "고시", "고시"]);
    for (const r of nat) {
      expect(r.officialUrl.startsWith("https://www.law.go.kr/법령/") || r.officialUrl.startsWith("https://www.law.go.kr/행정규칙/")).toBe(true);
      expect(r.urlKind).toBe("current");
      expect(r.verification).toBe("A");
    }
    expect(byId("act").revisions[0]).toEqual({ kind: "amended", number: "법률 제20181호", promulgatedAt: "2024-02-06", effectiveAt: "2025-02-07" });
  });
  it("C 등급(기관 안내)은 지침·매뉴얼로 등록하지 않고 개정 정보도 없음", () => {
    for (const r of FACILITY_RESOURCES.filter((x) => x.verification === "C")) {
      expect(["board", "homepage", "department"].includes(r.sourceType)).toBe(true);
      expect(r.revisions.length).toBe(0);
    }
    const bad = { ...byId("office-seoul"), sourceType: "manual" as const };
    expect(validateFacilityData([bad], EDU_OFFICES, FACILITY_ALLOWED_HOSTS)).toContain("office-seoul: C 등급은 기관 안내로만");
  });
  it("외부 URL 안전성: 허용 도메인 https만, 법령 주소는 law.go.kr만", () => {
    expect(isSafeExternalUrl("https://www.law.go.kr/법령/교육시설등의안전및유지관리등에관한법률", FACILITY_ALLOWED_HOSTS)).toBe(true);
    for (const u of ["javascript:alert(1)", "http://www.law.go.kr/", "https://law.go.kr.evil.example/", "https://example.com/"]) expect(isSafeExternalUrl(u, FACILITY_ALLOWED_HOSTS)).toBe(false);
    const bad = { ...base, id: "x", officialUrl: "https://www.goe.go.kr/law.pdf" };
    expect(validateFacilityData([bad], EDU_OFFICES, FACILITY_ALLOWED_HOSTS)).toContain("x: 법령은 국가법령정보센터 주소");
  });
});

describe("학교 관할 교육청", () => {
  it("학교 등록 정보의 교육청명(공백 무시)으로 판정", () => {
    expect(resolveHomeOffice(EDU_OFFICES, "인천광역시교육청", null)).toEqual({ officeId: "incheon", source: "school" });
    expect(resolveHomeOffice(EDU_OFFICES, " 경기도 교육청 ", null)).toEqual({ officeId: "gyeonggi", source: "school" });
  });
  it("학교 정보가 우선(사용자 선택보다 먼저)", () => {
    expect(resolveHomeOffice(EDU_OFFICES, "인천광역시교육청", "busan")).toEqual({ officeId: "incheon", source: "school" });
  });
  it("학교 소재지가 없으면 사용자 선택, 둘 다 없으면 없음(추정하지 않음)", () => {
    expect(resolveHomeOffice(EDU_OFFICES, null, "busan")).toEqual({ officeId: "busan", source: "user" });
    expect(resolveHomeOffice(EDU_OFFICES, null, null)).toEqual({ officeId: null, source: null });
  });
  it("잘못된 값은 안전하게 무시(부분 일치·학교명·알 수 없는 ID 거부)", () => {
    expect(officeIdFromName(EDU_OFFICES, "인천")).toBe(null);
    expect(officeIdFromName(EDU_OFFICES, "인천광역시 미추홀구 가상초등학교")).toBe(null);
    expect(resolveHomeOffice(EDU_OFFICES, "가상교육청", "<script>")).toEqual({ officeId: null, source: null });
  });
  it("구분: 국가 공통 / 우리 관할 / 타 지역 참고 / 공공기관", () => {
    expect(categoryOf(base, "incheon")).toBe("national");
    expect(categoryOf(byId("office-incheon"), "incheon")).toBe("home");
    expect(categoryOf(byId("gyeonggi-safety-manual"), "incheon")).toBe("other");
    expect(categoryOf(byId("gyeonggi-safety-manual"), null)).toBe("other");
    expect(categoryOf(byId("koies"), "incheon")).toBe("public");
  });
  it("관할 교육청 자료 묶음이 따로(다른 교육청은 참고 묶음)", () => {
    const g = groupByCategory(FACILITY_RESOURCES, "incheon");
    expect(ids(g.home)).toEqual(["incheon-facility-law-board", "office-incheon"]);
    expect(g.other.some((r) => r.id === "gyeonggi-safety-manual")).toBe(true);
    expect(g.national.length).toBe(6);
  });
});

describe("시행 상태·최근 제정/개정", () => {
  const rev = (promulgatedAt: string, effectiveAt: string, kind: "enacted" | "amended" = "amended") => ({ kind, promulgatedAt, effectiveAt, number: `t-${promulgatedAt}` });
  const fx = (id: string, revisions: FacilityResource["revisions"], extra: Partial<FacilityResource> = {}): FacilityResource => ({ ...base, id, relatedIds: undefined, revisions, ...extra });

  it("등록 데이터: 최근 개정은 시행령 타법개정(공포 2025-12-30·시행 2026-01-02) 1건", () => {
    const r = recentChanges(FACILITY_RESOURCES, TODAY, "incheon");
    expect(r.map((c) => [c.resource.id, c.revision.number, c.phase, c.badge])).toEqual([["decree", "대통령령 제35948호", "in_force", "최근 개정"]]);
  });
  it("확인일이 최근이어도 개정일이 오래되면 '최근' 아님(공포·시행일만 사용)", () => {
    expect(byId("act").verifiedAt).toBe(TODAY);
    expect(isRecent(byId("act"), TODAY)).toBe(false);
    expect(isRecent(byId("notice-standards"), TODAY)).toBe(false);
  });
  it("오래된 자료·개정 정보 없는 자료에 신규 배지 없음", () => {
    expect(isRecent(fx("old", [rev("2020-01-01", "2020-06-01", "enacted")]), TODAY)).toBe(false);
    expect(isRecent(byId("gyeonggi-safety-manual"), TODAY)).toBe(false);
    expect(daysBetween("2025-10-01", TODAY)).toBe(387);
  });
  it("시행 예정과 시행 중 구분", () => {
    const sched = fx("s", [rev("2026-09-01", "2027-03-01"), rev("2020-01-01", "2020-06-01")]);
    expect(statusOf(sched, TODAY)).toBe("scheduled");
    expect(recentChanges([sched], TODAY, null)[0]!.phase).toBe("scheduled");
    expect(statusOf(byId("act"), TODAY)).toBe("in_force");
    expect(statusOf(byId("office-seoul"), TODAY)).toBe("unknown");
  });
  it("폐지·대체된 자료는 과거 자료, 최근 안내에서 제외", () => {
    const past = fx("p", [rev("2026-08-01", "2026-08-01")], { supersededAt: "2026-10-01" });
    expect(statusOf(past, TODAY)).toBe("past");
    expect(recentChanges([past], TODAY, null)).toEqual([]);
  });
  it("정렬: 우리 학교 관련 시행 중 → 시행 예정 → 공공기관 → 타 지역(같은 묶음은 최근 날짜 먼저)", () => {
    const list = [
      fx("other-new", [rev("2026-10-01", "2026-10-01", "enacted")], { tier: "office", officeId: "busan" }),
      fx("nat-sched", [rev("2026-09-01", "2027-01-01")]),
      fx("home-old", [rev("2026-01-05", "2026-01-05")], { tier: "office", officeId: "incheon" }),
      fx("nat-new", [rev("2026-06-01", "2026-06-01")]),
      fx("pub", [rev("2026-07-01", "2026-07-01")], { tier: "public" }),
    ];
    const r = recentChanges(list, TODAY, "incheon");
    expect(r.map((c) => c.resource.id)).toEqual(["nat-new", "home-old", "nat-sched", "pub", "other-new"]);
    expect(r.find((c) => c.resource.id === "other-new")!.badge).toBe("신규 제정");
  });
  it("등록되면 즉시 상단 대상(정적 데이터에 새 판 추가)", () => {
    const updated = fx("act2", [rev("2026-10-20", "2027-04-21"), ...base.revisions]);
    expect(recentChanges([updated], TODAY, null).map((c) => c.phase)).toEqual(["scheduled"]);
  });
});

describe("검색·필터·쿼리", () => {
  const f = (o: Partial<typeof EMPTY_FACILITY_FILTER>) => filterFacilityResources(FACILITY_RESOURCES, { ...EMPTY_FACILITY_FILTER, ...o }, EDU_OFFICES);
  it("전국 공통 / 교육청별 / 분야", () => {
    expect(f({ region: "national" }).every((r) => r.tier === "national")).toBe(true);
    expect(ids(f({ region: "gyeonggi" }))).toEqual(["gyeonggi-safety-manual", "office-gyeonggi"]);
    expect(ids(f({ area: "playground" }))).toEqual(["gyeonggi-safety-manual", "cpf"]);
  });
  it("검색: 법령명·매뉴얼명·기관명(교육청 약칭·이전 이름 포함)", () => {
    expect(ids(f({ query: "안전점검 지침" }))).toEqual(["notice-inspection"]);
    expect(ids(f({ query: "매뉴얼" }))).toContain("gyeonggi-safety-manual");
    expect(ids(f({ query: "광주광역시교육청" }))).toEqual(["office-jeonnam-gwangju"]);
  });
  it("복합 필터(검색어+지역+분야) / 결과 없음", () => {
    expect(ids(f({ query: "매뉴얼", region: "gyeonggi", area: "fire" }))).toEqual(["gyeonggi-safety-manual"]);
    expect(f({ region: "seoul", area: "fire" })).toEqual([]);
    expect(f({ query: "없는검색어xyz" })).toEqual([]);
  });
  it("쿼리 왕복, 알 수 없는 값은 '전체', 관할 정보는 쿼리에 없음", () => {
    const q = facilityFilterToSearch({ query: "점검", region: "incheon", area: "fire" });
    expect(q).toBe("?q=%EC%A0%90%EA%B2%80&region=incheon&area=fire");
    expect(facilityFilterFromSearch(q, EDU_OFFICES)).toEqual({ query: "점검", region: "incheon", area: "fire" });
    expect(facilityFilterFromSearch("?region=mars&area=x&home=incheon", EDU_OFFICES)).toEqual(EMPTY_FACILITY_FILTER);
    expect(facilityFilterToSearch(EMPTY_FACILITY_FILTER)).toBe("");
  });
  it("카드 분야 요약은 2개까지", () => {
    expect(areaSummaryOf(byId("gyeonggi-safety-manual"))).toBe("종합 시설관리 · 건축물·구조 안전 외 4");
    expect(areaSummaryOf(byId("office-seoul"))).toBe("시설 분야 확인 필요");
  });
});
