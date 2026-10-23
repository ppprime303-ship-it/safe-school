// STEP 4 안전교육 자료 안내 — 정적 안내 데이터·검색/필터·외부 링크 안전 검사(순수 함수, DB 없음)
import { describe, expect, it } from "vitest";
import { EDUCATION_ALLOWED_HOSTS, EDUCATION_RESOURCES } from "../client/src/data/educationResources";
import {
  EDUCATION_AREAS,
  EMPTY_FILTER,
  SCHOOL_LEVELS,
  countBy,
  filterResources,
  isFilterActive,
  isSafeExternalUrl,
  validateResources,
  type EducationResource,
} from "../client/src/lib/educationResources";

const ids = (list: EducationResource[]) => list.map((r) => r.id);
const HOSTS = EDUCATION_ALLOWED_HOSTS;

describe("안내 데이터(공식 사이트 목록)", () => {
  it("등록 데이터 점검 오류 0(필수 항목·영역·학교급·주소·확인일)", () => {
    expect(validateResources(EDUCATION_RESOURCES, HOSTS)).toEqual([]);
  });

  it("공식 URL 정확성: 확인한 주소와 정확히 일치", () => {
    const byId = Object.fromEntries(EDUCATION_RESOURCES.map((r) => [r.id, r]));
    expect(byId.schoolsafe24!.url).toBe("https://www.schoolsafe24.or.kr/front/rpstr/rpstrList.do?menuSn=181&upperMenuSn=148");
    expect(byId.schoolsafe24!.homeUrl).toBe("https://www.schoolsafe24.or.kr/");
    expect(byId.schoolsafe24!.operator).toBe("학교안전공제중앙회");
    expect(byId.kasem!.url).toBe("https://kasem.safekorea.go.kr/");
    expect(byId.kasem!.operator).toBe("행정안전부");
    expect([...HOSTS]).toEqual(["www.schoolsafe24.or.kr", "kasem.safekorea.go.kr"]);
  });

  it("확인하지 못한 영역은 연결하지 않음(국민안전교육플랫폼: 약물·직업안전·응급처치 없음)", () => {
    const kasem = EDUCATION_RESOURCES.find((r) => r.id === "kasem")!;
    expect(kasem.areas).not.toContain("addiction");
    expect(kasem.areas).not.toContain("occupational");
    expect(kasem.areas).not.toContain("firstaid");
  });

  it("7대 영역 이름은 교육부 표준안 이름 그대로", () => {
    expect(EDUCATION_AREAS.map((a) => a.label)).toEqual(["생활안전", "교통안전", "폭력예방 및 신변보호", "약물 및 사이버중독 예방", "재난안전", "직업안전", "응급처치"]);
    expect(SCHOOL_LEVELS.map((l) => l.label)).toEqual(["유치원", "초등학교", "중학교", "고등학교"]);
  });
});

describe("안전하지 않은 URL 차단", () => {
  it("허용 도메인의 https 주소만 통과", () => {
    expect(isSafeExternalUrl("https://www.schoolsafe24.or.kr/", HOSTS)).toBe(true);
    expect(isSafeExternalUrl("https://kasem.safekorea.go.kr/ptlCont.do?url=x", HOSTS)).toBe(true);
  });
  it.each([
    ["javascript 주소", "javascript:alert(1)"],
    ["data 주소", "data:text/html,<script>alert(1)</script>"],
    ["http(암호화 없음)", "http://www.schoolsafe24.or.kr/"],
    ["비슷한 다른 도메인", "https://www.schoolsafe24.or.kr.evil.example/"],
    ["허용 목록 밖", "https://example.com/"],
    ["하위 도메인 위장", "https://evil.kasem.safekorea.go.kr/"],
    ["사용자 정보 포함", "https://user:pw@www.schoolsafe24.or.kr/"],
    ["다른 포트", "https://www.schoolsafe24.or.kr:8443/"],
    ["앞뒤 공백", " https://www.schoolsafe24.or.kr/"],
    ["상대 경로", "/front/rpstr/rpstrList.do"],
    ["빈 값", ""],
  ])("%s 거부", (_n, url) => {
    expect(isSafeExternalUrl(url, HOSTS)).toBe(false);
  });
  it("허용되지 않은 주소가 들어간 데이터는 점검에서 걸림", () => {
    const bad = { ...EDUCATION_RESOURCES[0]!, id: "bad", url: "javascript:alert(1)" };
    expect(validateResources([bad], HOSTS)).toContain("bad: 허용되지 않은 주소");
  });
});

describe("학교급·영역 필터", () => {
  it("필터 없음 → 전체", () => {
    expect(ids(filterResources(EDUCATION_RESOURCES, EMPTY_FILTER))).toEqual(["schoolsafe24", "kasem"]);
    expect(isFilterActive(EMPTY_FILTER)).toBe(false);
  });
  it("영역: 교통안전 → 두 곳, 응급처치 → 학교안전지원시스템만", () => {
    expect(ids(filterResources(EDUCATION_RESOURCES, { ...EMPTY_FILTER, area: "traffic" }))).toEqual(["schoolsafe24", "kasem"]);
    expect(ids(filterResources(EDUCATION_RESOURCES, { ...EMPTY_FILTER, area: "firstaid" }))).toEqual(["schoolsafe24"]);
  });
  it("학교급: 유치원 → 대상 범위에 유치원이 있는 곳만", () => {
    const r = filterResources(EDUCATION_RESOURCES, { ...EMPTY_FILTER, level: "kindergarten" });
    expect(r.every((x) => x.levels.includes("kindergarten"))).toBe(true);
  });
  it("자료가 없는 조합은 빈 목록(있는 것처럼 보이지 않음)", () => {
    const only: EducationResource[] = [{ ...EDUCATION_RESOURCES[1]!, levels: ["elementary"] }];
    expect(filterResources(only, { ...EMPTY_FILTER, level: "high" })).toEqual([]);
    expect(filterResources(only, { ...EMPTY_FILTER, area: "occupational" })).toEqual([]);
  });
  it("필터 단추 숫자: 영역·학교급별 제공처 수", () => {
    const c = countBy(EDUCATION_RESOURCES, EMPTY_FILTER);
    expect(c.area.traffic).toBe(2);
    expect(c.area.occupational).toBe(1);
    expect(c.level.middle).toBe(2);
    // 다른 조건과 함께 계산(응급처치를 고른 상태에서 학교급별 수)
    expect(countBy(EDUCATION_RESOURCES, { ...EMPTY_FILTER, area: "firstaid" }).level.high).toBe(1);
  });
});

describe("검색(등록한 안내 정보만)", () => {
  it("사이트명·주제·영역 이름으로 찾기, 대소문자·공백 무시", () => {
    expect(ids(filterResources(EDUCATION_RESOURCES, { ...EMPTY_FILTER, query: "7대 표준안" }))).toEqual(["schoolsafe24"]);
    expect(ids(filterResources(EDUCATION_RESOURCES, { ...EMPTY_FILTER, query: "국민안전" }))).toEqual(["kasem"]);
    expect(ids(filterResources(EDUCATION_RESOURCES, { ...EMPTY_FILTER, query: "동영상" }))).toEqual(["schoolsafe24", "kasem"]);
    expect(ids(filterResources(EDUCATION_RESOURCES, { ...EMPTY_FILTER, query: "응급처치" }))).toEqual(["schoolsafe24"]);
  });
  it("여러 낱말은 모두 포함해야 함", () => {
    expect(ids(filterResources(EDUCATION_RESOURCES, { ...EMPTY_FILTER, query: "체험관 행정안전부" }))).toEqual(["kasem"]);
  });
  it("검색어 + 필터 함께", () => {
    expect(ids(filterResources(EDUCATION_RESOURCES, { query: "동영상", area: "firstaid", level: "all" }))).toEqual(["schoolsafe24"]);
  });
  it("결과 없음", () => {
    const f = { ...EMPTY_FILTER, query: "없는검색어xyz" };
    expect(filterResources(EDUCATION_RESOURCES, f)).toEqual([]);
    expect(isFilterActive(f)).toBe(true);
  });
});
