// STEP 5 학교 시설 안전점검 법령·지침·매뉴얼 안내: 타입·관할 교육청 판정·최근 제정/개정·검색/필터(순수 함수, DB·서버 없음)
// - 안내 데이터는 client/src/data/facilityResources.ts 에서 관리합니다.
// - 표시 우선순위(국가 공통 → 관할 교육청 → 다른 교육청 → 공공기관)는 '찾아보기 순서'일 뿐이며, 법적 효력·적용 여부를 판정하지 않습니다.
// - 날짜는 모두 'YYYY-MM-DD' 문자열. 공포일·시행일·확인일을 섞지 않습니다(확인일은 최신성 판정에 쓰지 않음).
import { isSafeExternalUrl } from "./educationResources";

export { isSafeExternalUrl };

/** 시설 점검 분야 */
export const FACILITY_AREAS = [
  { id: "building", label: "건축물·구조 안전" },
  { id: "fire", label: "소방·피난시설" },
  { id: "utility", label: "전기·기계·가스" },
  { id: "playground", label: "어린이놀이시설" },
  { id: "environment", label: "환경·위생" },
  { id: "disaster", label: "재난 대비" },
  { id: "general", label: "종합 시설관리" },
  { id: "other", label: "기타" },
] as const;
export type FacilityAreaId = (typeof FACILITY_AREAS)[number]["id"];
export const FACILITY_AREA_LABEL = Object.fromEntries(FACILITY_AREAS.map((a) => [a.id, a.label])) as Record<FacilityAreaId, string>;

/** 시·도교육청(교육부 '시·도교육청' 안내 기준). aliases: 학교 정보에 남아 있을 수 있는 이전·다른 표기 */
export interface EduOffice {
  id: string;
  name: string;
  short: string;
  homepage: string;
  aliases: string[];
  note?: string;
}

/** 자료 유형 */
export const SOURCE_TYPES = {
  law: { label: "법률", group: "법령" },
  decree: { label: "시행령", group: "법령" },
  rule: { label: "시행규칙", group: "법령" },
  notice: { label: "고시", group: "법령" },
  guideline: { label: "지침", group: "지침" },
  manual: { label: "매뉴얼", group: "매뉴얼" },
  board: { label: "자료실·게시판", group: "기관 안내" },
  homepage: { label: "기관 홈페이지", group: "기관 안내" },
  department: { label: "담당 부서 안내", group: "기관 안내" },
} as const;
export type SourceType = keyof typeof SOURCE_TYPES;

/**
 * 확인 등급
 *  A: 원문과 발행 정보까지 직접 확인 / B: 공식 자료실과 자료 제목 확인 / C: 공식 기관 홈페이지·담당 부서·자료실 위치만 확인
 *  (D: 확인하지 못함 — 데이터에 넣지 않고 docs/step5/official-sources.md 미확인 목록에만 기록)
 */
export type Verification = "A" | "B" | "C";
export const VERIFICATION_LABEL: Record<Verification, string> = {
  A: "원문·발행 정보 확인",
  B: "공식 자료·제목 확인",
  C: "공식 기관 안내(자료 미확인)",
};

/** 제정·개정 이력 한 건(공식 원문 연혁에서 확인한 것만) */
export interface Revision {
  kind: "enacted" | "amended" | "amended_by_other" | "full_amended";
  /** 공포·발령·발표일 */
  promulgatedAt?: string;
  /** 시행일 */
  effectiveAt?: string;
  /** 법률·대통령령·고시 번호 등 */
  number?: string;
}
export const REVISION_KIND_LABEL: Record<Revision["kind"], string> = {
  enacted: "제정",
  amended: "일부개정",
  full_amended: "전부개정",
  amended_by_other: "타법개정",
};

export type Tier = "national" | "office" | "public";

export interface FacilityResource {
  id: string;
  title: string;
  organization: string;
  sourceType: SourceType;
  tier: Tier;
  /** tier=office 일 때 제공 교육청 */
  officeId?: string;
  facilityAreas: FacilityAreaId[];
  description: string;
  /** 공식 원문으로 연결할 주소 */
  officialUrl: string;
  /**
   * officialUrl 종류
   *  current: 국가법령정보센터 '현행' 바로가기 / version: 특정 판(확인한 판) / direct: 확인한 자료 원문(파일·게시물)
   *  board: 확인한 자료실·게시판 / home: 기관 홈페이지·부서 안내
   */
  urlKind: "current" | "version" | "direct" | "board" | "home";
  /** 확인한 판(특정 버전) 주소 — officialUrl 이 현행 바로가기일 때 보조로 */
  versionUrl?: string;
  /** 링크·내용 확인일 */
  verifiedAt: string;
  verification: Verification;
  /** 최신 판부터(공식 연혁에서 확인한 범위). 없으면 제정·개정 정보 미확인 */
  revisions: Revision[];
  /** 폐지·실효·대체일(확인 시). 지나면 과거 자료 */
  supersededAt?: string;
  /** 적용 대상·지역 설명 */
  appliesTo: string;
  /** 적용 시 주의사항 */
  applicabilityNote: string;
  /** 찾는 방법·위치 */
  howTo: string;
  keywords: string[];
  relatedIds?: string[];
}

// ─── 관할 교육청 판정 ──────────────────────────────────────────────

const norm = (s: string) => s.replace(/\s+/g, "").trim();

/** 학교 정보의 교육청 이름 → 교육청 ID. 정확히 일치(공백 무시)하는 이름·이전 표기만 인정, 학교명·주소로 추측하지 않음 */
export function officeIdFromName(offices: readonly EduOffice[], name: string | null | undefined): string | null {
  if (!name || !norm(name)) return null;
  const n = norm(name);
  const hit = offices.find((o) => norm(o.name) === n || o.aliases.some((a) => norm(a) === n));
  return hit?.id ?? null;
}

export type HomeOfficeSource = "school" | "user";
export interface HomeOffice {
  officeId: string | null;
  source: HomeOfficeSource | null;
}

/**
 * 내 학교 관할 교육청: ① 학교 정보(학교알리미 등록 정보의 교육청명) ② 이 기기에서 사용자가 직접 고른 지역 ③ 없음.
 * GPS·IP·학교명·재난 경보용 소재지는 쓰지 않습니다.
 */
export function resolveHomeOffice(offices: readonly EduOffice[], schoolEduOfficeName: string | null | undefined, userSelectedId: string | null | undefined): HomeOffice {
  const fromSchool = officeIdFromName(offices, schoolEduOfficeName);
  if (fromSchool) return { officeId: fromSchool, source: "school" };
  if (userSelectedId && offices.some((o) => o.id === userSelectedId)) return { officeId: userSelectedId, source: "user" };
  return { officeId: null, source: null };
}

/** 화면 구분: 국가 공통 / 내 관할 교육청 / 다른 교육청(타 지역 참고) / 공공기관 참고 */
export type Category = "national" | "home" | "other" | "public";
export const CATEGORY_LABEL: Record<Category, string> = {
  national: "국가 공통",
  home: "우리 관할",
  other: "타 지역 참고",
  public: "공공기관 참고",
};
export function categoryOf(r: FacilityResource, homeOfficeId: string | null): Category {
  if (r.tier === "national") return "national";
  if (r.tier === "public") return "public";
  return homeOfficeId && r.officeId === homeOfficeId ? "home" : "other";
}

// ─── 시행 상태·최근 제정/개정 ─────────────────────────────────────

/** 날짜 문자열 차이(일). 둘 다 YYYY-MM-DD */
export function daysBetween(from: string, to: string): number {
  return Math.round((Date.parse(`${to}T00:00:00Z`) - Date.parse(`${from}T00:00:00Z`)) / 86_400_000);
}

export const latestRevision = (r: FacilityResource): Revision | null => r.revisions[0] ?? null;

/**
 * 자료 상태
 *  past: 폐지·대체일이 지남 / scheduled: 가장 최근 판의 시행일이 아직 오지 않음(시행 예정 개정 있음 — 현재 기준은 이전 판)
 *  in_force: 확인한 최근 판이 시행 중 / unknown: 제정·개정 정보 미확인(현행 여부는 원문에서 확인)
 */
export type ResourceStatus = "past" | "scheduled" | "in_force" | "unknown";
export function statusOf(r: FacilityResource, today: string): ResourceStatus {
  if (r.supersededAt && r.supersededAt <= today) return "past";
  const rev = latestRevision(r);
  if (!rev?.effectiveAt) return "unknown";
  return rev.effectiveAt > today ? "scheduled" : "in_force";
}
export const STATUS_LABEL: Record<ResourceStatus, string> = {
  past: "과거 자료",
  scheduled: "시행 예정 개정 있음",
  in_force: "시행 중",
  unknown: "현행 여부 원문 확인",
};

/** 최근으로 보는 기간(일): 공포일 또는 시행일이 오늘 기준 이 기간 안이거나, 시행일이 앞으로 다가오는 경우 */
export const RECENT_WINDOW_DAYS = 365;

export interface RecentChange {
  resource: FacilityResource;
  revision: Revision;
  category: Category;
  /** 시행 중 / 시행 예정 */
  phase: "in_force" | "scheduled";
  badge: "신규 제정" | "최근 개정";
  /** 정렬 그룹(작을수록 먼저) */
  rank: number;
  /** 정렬 기준일(공포일 우선, 없으면 시행일) */
  date: string;
}

/**
 * 최근 제정·개정: 공식 연혁에서 확인한 판 가운데 공포일·시행일이 최근 RECENT_WINDOW_DAYS 안이거나 시행이 예정된 것.
 * 확인일(verifiedAt)은 쓰지 않습니다. 과거 자료(폐지·대체)는 넣지 않습니다.
 * 정렬: ① 국가 공통·우리 관할 시행 중 ② 국가 공통·우리 관할 시행 예정 ③ 공공기관 ④ 다른 교육청 — 같은 그룹은 최근 날짜 먼저.
 * (중요도·긴급성은 추측하지 않음)
 */
export function recentChanges(list: readonly FacilityResource[], today: string, homeOfficeId: string | null, windowDays = RECENT_WINDOW_DAYS): RecentChange[] {
  const out: RecentChange[] = [];
  for (const r of list) {
    if (statusOf(r, today) === "past") continue;
    for (const rev of r.revisions) {
      const dates = [rev.promulgatedAt, rev.effectiveAt].filter((d): d is string => !!d);
      if (dates.length === 0) continue;
      const scheduled = !!rev.effectiveAt && rev.effectiveAt > today;
      const recent = dates.some((d) => d <= today && daysBetween(d, today) <= windowDays);
      if (!scheduled && !recent) continue;
      const category = categoryOf(r, homeOfficeId);
      const mine = category === "national" || category === "home";
      const rank = mine ? (scheduled ? 2 : 1) : category === "public" ? 3 : 4;
      out.push({
        resource: r,
        revision: rev,
        category,
        phase: scheduled ? "scheduled" : "in_force",
        badge: rev.kind === "enacted" ? "신규 제정" : "최근 개정",
        rank,
        date: rev.promulgatedAt ?? rev.effectiveAt!,
      });
    }
  }
  return out.sort((a, b) => a.rank - b.rank || (a.date < b.date ? 1 : a.date > b.date ? -1 : 0));
}

/** 이 자료에 'NEW'(최근 제정·개정) 표시를 할지 */
export const isRecent = (r: FacilityResource, today: string, windowDays = RECENT_WINDOW_DAYS) =>
  recentChanges([r], today, null, windowDays).length > 0;

// ─── 검색·필터·주소 쿼리 ───────────────────────────────────────────

export interface FacilityFilter {
  query: string;
  /** 제공 기관·지역: 전체 / 전국 공통 / 교육청 ID */
  region: "all" | "national" | string;
  area: FacilityAreaId | "all";
}
export const EMPTY_FACILITY_FILTER: FacilityFilter = { query: "", region: "all", area: "all" };
export const isFacilityFilterActive = (f: FacilityFilter) => f.query.trim() !== "" || f.region !== "all" || f.area !== "all";

const lower = (s: string) => s.toLowerCase().replace(/\s+/g, "");
export function facilitySearchText(r: FacilityResource, offices: readonly EduOffice[]): string {
  const office = offices.find((o) => o.id === r.officeId);
  return lower(
    [r.title, r.organization, r.description, SOURCE_TYPES[r.sourceType].label, ...r.keywords, ...r.facilityAreas.map((a) => FACILITY_AREA_LABEL[a]), office?.name ?? "", office?.short ?? "", ...(office?.aliases ?? [])].join(" "),
  );
}

export function matchesRegion(r: FacilityResource, region: FacilityFilter["region"]): boolean {
  if (region === "all") return true;
  if (region === "national") return r.tier === "national";
  return r.tier === "office" && r.officeId === region;
}

export function filterFacilityResources(list: readonly FacilityResource[], f: FacilityFilter, offices: readonly EduOffice[]): FacilityResource[] {
  const words = f.query.trim().split(/\s+/).map(lower).filter(Boolean);
  return list.filter((r) => {
    if (!matchesRegion(r, f.region)) return false;
    if (f.area !== "all" && !r.facilityAreas.includes(f.area)) return false;
    if (words.length === 0) return true;
    const t = facilitySearchText(r, offices);
    return words.every((w) => t.includes(w));
  });
}

/** 화면 묶음: 국가 공통 → 우리 관할 → 다른 교육청 → 공공기관(같은 묶음 안에서는 데이터 순서) */
export function groupByCategory(list: readonly FacilityResource[], homeOfficeId: string | null): Record<Category, FacilityResource[]> {
  const g: Record<Category, FacilityResource[]> = { national: [], home: [], other: [], public: [] };
  for (const r of list) g[categoryOf(r, homeOfficeId)].push(r);
  return g;
}

/** 주소 쿼리(?q=&region=&area=) — 관할 교육청(학교 소재지)은 쿼리에 넣지 않음 */
export function facilityFilterFromSearch(search: string, offices: readonly EduOffice[]): FacilityFilter {
  const p = new URLSearchParams(search);
  const region = p.get("region");
  const area = p.get("area");
  return {
    query: (p.get("q") ?? "").slice(0, 50),
    region: region === "national" || offices.some((o) => o.id === region) ? region! : "all",
    area: FACILITY_AREAS.some((a) => a.id === area) ? (area as FacilityAreaId) : "all",
  };
}
export function facilityFilterToSearch(f: FacilityFilter): string {
  const p = new URLSearchParams();
  if (f.query.trim()) p.set("q", f.query.trim());
  if (f.region !== "all") p.set("region", f.region);
  if (f.area !== "all") p.set("area", f.area);
  const s = p.toString();
  return s ? `?${s}` : "";
}

export const findFacilityResource = (list: readonly FacilityResource[], id: string) => list.find((r) => r.id === id) ?? null;

/** 카드용 분야 요약: 2개까지 + '외 N' / 없으면 '분야 확인 필요' */
export function areaSummaryOf(r: FacilityResource): string {
  if (r.facilityAreas.length === 0) return "시설 분야 확인 필요";
  const shown = r.facilityAreas.slice(0, 2).map((a) => FACILITY_AREA_LABEL[a]).join(" · ");
  return r.facilityAreas.length > 2 ? `${shown} 외 ${r.facilityAreas.length - 2}` : shown;
}

// ─── 데이터 점검 ───────────────────────────────────────────────────

const DATE = /^\d{4}-\d{2}-\d{2}$/;
export function validateFacilityData(list: readonly FacilityResource[], offices: readonly EduOffice[], allowedHosts: readonly string[]): string[] {
  const errors: string[] = [];
  const ids = new Set<string>();
  const officeIds = new Set(offices.map((o) => o.id));
  const names = new Set<string>();
  for (const o of offices) {
    if (!isSafeExternalUrl(o.homepage, allowedHosts)) errors.push(`교육청 ${o.id}: 홈페이지 주소 허용 안 됨`);
    for (const n of [o.name, ...o.aliases]) {
      if (names.has(norm(n))) errors.push(`교육청 이름 중복: ${n}`);
      names.add(norm(n));
    }
  }
  for (const r of list) {
    if (!/^[a-z0-9-]+$/.test(r.id)) errors.push(`${r.id}: id 형식`);
    if (ids.has(r.id)) errors.push(`${r.id}: id 중복`);
    ids.add(r.id);
    for (const k of ["title", "organization", "description", "appliesTo", "applicabilityNote", "howTo"] as const) if (!r[k]?.trim()) errors.push(`${r.id}: ${k} 비어 있음`);
    if (r.tier === "office" && (!r.officeId || !officeIds.has(r.officeId))) errors.push(`${r.id}: 교육청 자료인데 officeId 없음/알 수 없음`);
    if (r.tier !== "office" && r.officeId) errors.push(`${r.id}: 교육청 자료가 아닌데 officeId 있음`);
    if (!isSafeExternalUrl(r.officialUrl, allowedHosts)) errors.push(`${r.id}: 허용되지 않은 주소`);
    if (r.versionUrl !== undefined && !isSafeExternalUrl(r.versionUrl, allowedHosts)) errors.push(`${r.id}: 허용되지 않은 판 주소`);
    if (!DATE.test(r.verifiedAt)) errors.push(`${r.id}: 확인일 형식`);
    if (r.supersededAt !== undefined && !DATE.test(r.supersededAt)) errors.push(`${r.id}: 대체일 형식`);
    for (const a of r.facilityAreas) if (!FACILITY_AREA_LABEL[a]) errors.push(`${r.id}: 알 수 없는 분야 ${a}`);
    for (const v of r.revisions) for (const d of [v.promulgatedAt, v.effectiveAt]) if (d !== undefined && !DATE.test(d)) errors.push(`${r.id}: 개정일 형식`);
    // 등급 규칙: C(기관 안내)는 법령·지침·매뉴얼로 등록하지 않음, 개정 정보도 넣지 않음
    if (r.verification === "C" && SOURCE_TYPES[r.sourceType].group !== "기관 안내") errors.push(`${r.id}: C 등급은 기관 안내로만`);
    if (r.verification === "C" && r.revisions.length > 0) errors.push(`${r.id}: C 등급에 개정 정보`);
    // 법령 원문은 국가법령정보센터 주소만
    if (SOURCE_TYPES[r.sourceType].group === "법령" && !r.officialUrl.startsWith("https://www.law.go.kr/")) errors.push(`${r.id}: 법령은 국가법령정보센터 주소`);
    for (const rel of r.relatedIds ?? []) if (!list.some((x) => x.id === rel)) errors.push(`${r.id}: 관련 자료 ${rel} 없음`);
  }
  return errors;
}
