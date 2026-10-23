// STEP 4 안전교육 자료 안내: 타입·분류·검색/필터·외부 링크 안전 검사(순수 함수, DB·서버 없음)
// - 안내 데이터는 client/src/data/educationResources.ts 에서 따로 관리합니다(링크·설명 수정은 그 파일만).
// - 검색은 SAFE SCHOOL에 등록한 안내 카드의 메타정보만 대상으로 합니다(외부 사이트 내용 검색·크롤링 없음).

/** 학교안전교육 7대 표준안 영역(교육부 학교안전지원시스템 자료실 분류와 같은 이름) */
export const EDUCATION_AREAS = [
  { id: "life", label: "생활안전" },
  { id: "traffic", label: "교통안전" },
  { id: "violence", label: "폭력예방 및 신변보호" },
  { id: "addiction", label: "약물 및 사이버중독 예방" },
  { id: "disaster", label: "재난안전" },
  { id: "occupational", label: "직업안전" },
  { id: "firstaid", label: "응급처치" },
] as const;
export type EducationAreaId = (typeof EDUCATION_AREAS)[number]["id"];

export const SCHOOL_LEVELS = [
  { id: "kindergarten", label: "유치원" },
  { id: "elementary", label: "초등학교" },
  { id: "middle", label: "중학교" },
  { id: "high", label: "고등학교" },
] as const;
export type SchoolLevelId = (typeof SCHOOL_LEVELS)[number]["id"];

/** 카드 배지용 짧은 이름 */
export const AREA_SHORT: Record<EducationAreaId, string> = {
  life: "생활",
  traffic: "교통",
  violence: "폭력예방",
  addiction: "약물·사이버",
  disaster: "재난",
  occupational: "직업",
  firstaid: "응급처치",
};
export const LEVEL_SHORT: Record<SchoolLevelId, string> = { kindergarten: "유", elementary: "초", middle: "중", high: "고" };

export const AREA_LABEL = Object.fromEntries(EDUCATION_AREAS.map((a) => [a.id, a.label])) as Record<EducationAreaId, string>;
export const LEVEL_LABEL = Object.fromEntries(SCHOOL_LEVELS.map((l) => [l.id, l.label])) as Record<SchoolLevelId, string>;

/** 안내 카드 하나(자료 제공 사이트 하나) */
export interface EducationResource {
  id: string;
  /** 사이트명 */
  name: string;
  /** 운영 기관 */
  operator: string;
  /** 제공 자료의 주요 유형(사이트에서 확인한 것만) */
  materialTypes: string[];
  /** 짧은 설명 */
  description: string;
  /** 실제 자료가 있다고 확인한 영역만(억지로 연결하지 않음) */
  areas: EducationAreaId[];
  /** 실제 대상 범위에 근거한 학교급 */
  levels: SchoolLevelId[];
  /** 대상·영역을 그렇게 정한 근거(카드에 작게 표시) */
  basis: string;
  /** 기본 활용 안내 */
  howTo: string;
  /** 영역을 골랐을 때 보여 줄 영역별 찾는 방법(없으면 howTo) */
  areaHowTo?: Partial<Record<EducationAreaId, string>>;
  /** 공식 사이트로 이동할 주소(직접 자료 페이지는 확인된 경우에만, 아니면 기관 홈페이지) */
  url: string;
  /** url 이 확인된 자료실 직접 주소(direct)인지, 기관 홈페이지(home)인지 */
  urlKind: "direct" | "home";
  /** 사이트 안 자료실 위치(메뉴 경로). 확인하지 못했으면 비움 */
  menuPath?: string;
  /** 카드 배지용 영역 요약(없으면 자동: 7개 모두면 '7대 안전교육 영역', 아니면 앞 3개 + '외') */
  areaSummary?: string;
  /** 통일된 기관 아이콘(공식 로고 사용 허가를 확인하지 못해 로고 이미지는 쓰지 않음) */
  symbol: "school" | "shield";
  /** url 이 자료 페이지일 때 기관 홈페이지(선택) */
  homeUrl?: string;
  /** 검색용 추가 낱말(주제 키워드) */
  keywords: string[];
  /** 링크·내용을 마지막으로 확인한 날(YYYY-MM-DD) */
  verifiedAt: string;
}

export interface ResourceFilter {
  query: string;
  area: EducationAreaId | "all";
  level: SchoolLevelId | "all";
}
export const EMPTY_FILTER: ResourceFilter = { query: "", area: "all", level: "all" };

export const isFilterActive = (f: ResourceFilter) => f.query.trim() !== "" || f.area !== "all" || f.level !== "all";

/**
 * 외부 링크 안전 검사: https 만, 사용자·비밀번호 없음, 허용한 공식 도메인(정확히 일치)만.
 * javascript:, data:, http:, 비슷한 이름의 다른 도메인(schoolsafe24.or.kr.evil.com 등)은 거부합니다.
 */
export function isSafeExternalUrl(raw: string, allowedHosts: readonly string[]): boolean {
  if (typeof raw !== "string" || raw.trim() !== raw || raw === "") return false;
  let u: URL;
  try {
    u = new URL(raw);
  } catch {
    return false;
  }
  if (u.protocol !== "https:") return false;
  if (u.username || u.password) return false;
  if (u.port && u.port !== "443") return false;
  return allowedHosts.includes(u.hostname.toLowerCase());
}

const normalize = (s: string) => s.toLowerCase().replace(/\s+/g, "");

/** 검색 대상 문자열: 사이트명·운영 기관·자료 유형·설명·영역 이름·학교급 이름·주제 낱말(외부 내용 아님) */
export function searchableText(r: EducationResource): string {
  return normalize(
    [r.name, r.operator, r.description, r.howTo, ...r.materialTypes, ...r.keywords, ...r.areas.map((a) => AREA_LABEL[a]), ...r.levels.map((l) => LEVEL_LABEL[l])].join(" "),
  );
}

/** 학교급·영역·검색어를 모두 만족하는 안내 카드만(조건이 맞지 않으면 빈 목록 — 있는 것처럼 보이지 않게) */
export function filterResources(list: readonly EducationResource[], f: ResourceFilter): EducationResource[] {
  const words = f.query.trim().split(/\s+/).map(normalize).filter(Boolean);
  return list.filter((r) => {
    if (f.area !== "all" && !r.areas.includes(f.area)) return false;
    if (f.level !== "all" && !r.levels.includes(f.level)) return false;
    if (words.length === 0) return true;
    const text = searchableText(r);
    return words.every((w) => text.includes(w));
  });
}

/** 영역별·학교급별로 확인된 제공처 수(필터 단추 옆 숫자, '0'이면 자료가 없다는 뜻) */
export function countBy(list: readonly EducationResource[], f: ResourceFilter) {
  const area = Object.fromEntries(EDUCATION_AREAS.map((a) => [a.id, filterResources(list, { ...f, area: a.id }).length])) as Record<EducationAreaId, number>;
  const level = Object.fromEntries(SCHOOL_LEVELS.map((l) => [l.id, filterResources(list, { ...f, level: l.id }).length])) as Record<SchoolLevelId, number>;
  return { area, level };
}

/** 카드 배지: 학교급 요약(유·초·중·고) */
export function levelSummary(r: EducationResource): string {
  return SCHOOL_LEVELS.filter((l) => r.levels.includes(l.id)).map((l) => LEVEL_SHORT[l.id]).join("·");
}

/** 카드 배지: 영역 요약(전체 목록은 상세 페이지에서) */
export function areaSummary(r: EducationResource): string {
  if (r.areaSummary) return r.areaSummary;
  if (r.areas.length === EDUCATION_AREAS.length) return "7대 안전교육 영역";
  const shown = r.areas.slice(0, 3).map((a) => AREA_SHORT[a]).join("·");
  return r.areas.length > 3 ? `${shown} 외` : shown;
}

export function findResource(list: readonly EducationResource[], id: string): EducationResource | null {
  return list.find((r) => r.id === id) ?? null;
}

/**
 * 검색어·필터 ↔ 주소 쿼리(?q=&level=&area=) — 상세에서 돌아오거나 새로고침·뒤로 가기 때 상태 복원.
 * 알 수 없는 값은 '전체'로, 검색어는 50자까지만(화면 입력 제한과 같음).
 */
export function filterFromSearch(search: string): ResourceFilter {
  const p = new URLSearchParams(search);
  const level = p.get("level");
  const area = p.get("area");
  return {
    query: (p.get("q") ?? "").slice(0, 50),
    level: SCHOOL_LEVELS.some((l) => l.id === level) ? (level as SchoolLevelId) : "all",
    area: EDUCATION_AREAS.some((a) => a.id === area) ? (area as EducationAreaId) : "all",
  };
}

export function filterToSearch(f: ResourceFilter): string {
  const p = new URLSearchParams();
  if (f.query.trim()) p.set("q", f.query.trim());
  if (f.level !== "all") p.set("level", f.level);
  if (f.area !== "all") p.set("area", f.area);
  const s = p.toString();
  return s ? `?${s}` : "";
}

/** 안내 데이터 점검(테스트·화면에서 사용): 문제 목록을 돌려줍니다. */
export function validateResources(list: readonly EducationResource[], allowedHosts: readonly string[]): string[] {
  const errors: string[] = [];
  const ids = new Set<string>();
  const areaIds = new Set<string>(EDUCATION_AREAS.map((a) => a.id));
  const levelIds = new Set<string>(SCHOOL_LEVELS.map((l) => l.id));
  for (const r of list) {
    if (ids.has(r.id)) errors.push(`${r.id}: id 중복`);
    ids.add(r.id);
    for (const k of ["name", "operator", "description", "basis", "howTo"] as const) if (!r[k]?.trim()) errors.push(`${r.id}: ${k} 비어 있음`);
    if (r.materialTypes.length === 0) errors.push(`${r.id}: 자료 유형 없음`);
    if (r.areas.length === 0) errors.push(`${r.id}: 영역 없음`);
    if (r.levels.length === 0) errors.push(`${r.id}: 학교급 없음`);
    for (const a of r.areas) if (!areaIds.has(a)) errors.push(`${r.id}: 알 수 없는 영역 ${a}`);
    for (const l of r.levels) if (!levelIds.has(l)) errors.push(`${r.id}: 알 수 없는 학교급 ${l}`);
    for (const a of Object.keys(r.areaHowTo ?? {})) if (!r.areas.includes(a as EducationAreaId)) errors.push(`${r.id}: 영역 안내(${a})가 있으나 영역 목록에 없음`);
    if (!isSafeExternalUrl(r.url, allowedHosts)) errors.push(`${r.id}: 허용되지 않은 주소`);
    if (r.homeUrl !== undefined && !isSafeExternalUrl(r.homeUrl, allowedHosts)) errors.push(`${r.id}: 허용되지 않은 홈페이지 주소`);
    if (r.urlKind === "home" && r.homeUrl !== undefined && r.homeUrl !== r.url) errors.push(`${r.id}: 홈페이지 연결인데 homeUrl 이 다름`);
    if (!/^[a-z0-9-]+$/.test(r.id)) errors.push(`${r.id}: id 형식(영문 소문자·숫자·-)`);
    if (!/^\d{4}-\d{2}-\d{2}$/.test(r.verifiedAt)) errors.push(`${r.id}: 확인일 형식 오류`);
  }
  return errors;
}
