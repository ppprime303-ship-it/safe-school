// 학교 소재지·경보 지역 정규화와 매칭(순수 함수, 테스트 대상)
// 원칙: 확실하지 않으면 '대상'으로 단정하지 않고 '미판정'으로 남겨 관리자가 확인하게 합니다.
//       단, 학교 지역이 확실하고 경보 지역이 확실히 다르면 '비대상'입니다.

export interface Area {
  sido: string | null; // 정규화된 시도 이름, "전국", 또는 해석 불가(null)
  sigungu: string | null; // null = 시도 전체
  raw: string;
}

export interface Region {
  sido: string;
  sigungu: string | null;
}

export const NATIONWIDE = "전국";

// 시도 공식 이름과 흔한 표기(2024년 이후 명칭 기준: 강원특별자치도, 전북특별자치도)
const SIDO: Record<string, string[]> = {
  서울특별시: ["서울", "서울시"],
  부산광역시: ["부산", "부산시"],
  대구광역시: ["대구", "대구시"],
  인천광역시: ["인천", "인천시"],
  광주광역시: ["광주", "광주시"], // 경기도 광주시와 구별: 시도 위치(첫 단어)에서만 해석
  대전광역시: ["대전", "대전시"],
  울산광역시: ["울산", "울산시"],
  세종특별자치시: ["세종", "세종시"],
  경기도: ["경기"],
  강원특별자치도: ["강원", "강원도"],
  충청북도: ["충북"],
  충청남도: ["충남"],
  전북특별자치도: ["전북", "전라북도"],
  전라남도: ["전남"],
  경상북도: ["경북"],
  경상남도: ["경남"],
  제주특별자치도: ["제주", "제주도"],
};
const SIDO_LOOKUP = new Map<string, string>();
for (const [name, aliases] of Object.entries(SIDO)) {
  SIDO_LOOKUP.set(name, name);
  for (const a of aliases) SIDO_LOOKUP.set(a, name);
}
/** 시군구가 없는 시도(시도 전체가 하나의 지역) */
const NO_SIGUNGU = new Set(["세종특별자치시"]);

// STEP C: 2026-07-01 행정구역 개편 지역(근거: 학교알리미 공식 코드표 shared/schoolinfoRegions.ts, docs/devlog/2026-10-27.md 12-3)
// - 재난문자가 이 지역을 옛 이름·새 이름 중 무엇으로 보내는지는 실제 응답으로 확인하지 않았습니다.
// - 옛 구와 새 구의 경계 대응도 확인하지 않았으므로 '같은 곳/다른 곳'을 단정하지 않습니다(매핑 없음).
//   · 같은 시기의 서로 다른 이름(옛-옛, 새-새)은 서로 다른 지역이 확실 → 기존 규칙(비대상)
//   · 옛 이름과 새 이름이 섞이면 → '비대상'으로 단정하지 않고 '미판정'(경보 누락 방지)
const REORGANIZED_SIGUNGU: Record<string, { before: readonly string[]; after: readonly string[] }> = {
  인천광역시: { before: ["중구", "동구", "서구"], after: ["제물포구", "영종구", "서해구", "검단구"] },
};
/** 통합 출범한 시도의 새 이름 → 통합 이전 시도: 시도 목록에 넣지 않고(옛 시도와 '다른 시도'로 오판 방지)
 *  이전 시도 학교의 미판정 근거로만 씁니다. 그 밖의 시도 학교에는 해당하지 않습니다(통합 범위는 시도 단위로 확정). */
const REORGANIZED_SIDO: Record<string, readonly string[]> = {
  전남광주통합특별시: ["광주광역시", "전라남도"],
};

/** 같은 시도 안에서 한쪽은 개편 전 이름, 다른 쪽은 개편 후 이름인지 */
function isMixedReorgSigungu(sido: string, a: string, b: string): boolean {
  const r = REORGANIZED_SIGUNGU[sido];
  if (!r) return false;
  const x = a.split(" ")[0]!;
  const y = b.split(" ")[0]!;
  return (r.before.includes(x) && r.after.includes(y)) || (r.after.includes(x) && r.before.includes(y));
}

/** 경보 지역 원문에 통합 시도의 새 이름이 있으면 그 통합 이전 시도 목록, 없으면 null */
function reorganizedSidoPredecessors(raw: string): readonly string[] | null {
  const name = Object.keys(REORGANIZED_SIDO).find((n) => raw.includes(n));
  return name ? REORGANIZED_SIDO[name]! : null;
}

export const REORG_UNDETERMINED_REASON = "행정구역 개편(2026-07-01) 전후 지역 이름이 섞여 있어 대상 여부를 단정할 수 없음 — 관리자 확인 필요";

export const SIDO_NAMES = Object.keys(SIDO);

export function normalizeSido(token: string): string | null {
  const t = token.trim();
  if (t === NATIONWIDE) return NATIONWIDE;
  return SIDO_LOOKUP.get(t) ?? null;
}

const isSigunguToken = (t: string) => /^[가-힣]+(시|군|구)$/.test(t);

/** "인천광역시 남동구 ..." → { sido: 인천광역시, sigungu: 남동구 }, "경기도 수원시 장안구 ..." → 수원시 장안구 */
export function parseAddress(address: string | null | undefined): Region | null {
  if (!address) return null;
  const tokens = address.trim().split(/\s+/);
  const sido = normalizeSido(tokens[0] ?? "");
  if (!sido || sido === NATIONWIDE) return null;
  if (NO_SIGUNGU.has(sido)) return { sido, sigungu: null };
  const t1 = tokens[1];
  if (!t1 || !isSigunguToken(t1)) return null; // 시군구를 확정할 수 없으면 추측하지 않음
  const t2 = tokens[2];
  if (t1.endsWith("시") && t2 && /^[가-힣]+구$/.test(t2)) return { sido, sigungu: `${t1} ${t2}` };
  return { sido, sigungu: t1 };
}

/** 경보 지역 문자열 하나(예: "인천광역시 남동구", "인천 전체", "전국")를 정규화 */
export function normalizeArea(raw: string): Area {
  const tokens = raw.trim().split(/\s+/).filter((t) => t && t !== "전체" && t !== "전역");
  const sido = normalizeSido(tokens[0] ?? "");
  if (!sido) return { sido: null, sigungu: null, raw };
  if (sido === NATIONWIDE || NO_SIGUNGU.has(sido)) return { sido, sigungu: null, raw };
  const rest = tokens.slice(1);
  if (rest.length === 0) return { sido, sigungu: null, raw };
  if (!rest.every(isSigunguToken)) return { sido, sigungu: null, raw: raw }; // 아래 matchRegion에서 세부 불명확 처리
  return { sido, sigungu: rest.slice(0, 2).join(" "), raw };
}

/** 쉼표·가운뎃점으로 나열된 지역 원문 → 지역 목록 */
export function parseAreas(areasRaw: string): Area[] {
  return areasRaw
    .split(/[,·\n]/)
    .map((s) => s.trim())
    .filter(Boolean)
    .map(normalizeArea);
}

export type MatchResult = { result: "target" | "non_target" | "undetermined"; reason: string };

export function matchRegion(region: Region | null, areas: Area[]): MatchResult {
  if (areas.some((a) => a.sido === NATIONWIDE)) return { result: "target", reason: "전국 대상 경보" };
  if (!region) return { result: "undetermined", reason: "학교 소재지(시도·시군구)를 확인할 수 없음 — 관리자 확인 필요" };
  if (areas.length === 0) return { result: "undetermined", reason: "경보에 지역 정보가 없음" };

  let unclear = false;
  let reorg = false;
  for (const a of areas) {
    if (!a.sido) {
      const predecessors = reorganizedSidoPredecessors(a.raw);
      if (!predecessors) unclear = true;
      else if (predecessors.includes(region.sido)) reorg = true;
      // 통합 이전 시도가 아닌 학교: 이 지역과 무관(다른 시도와 같은 처리)
      continue;
    }
    if (a.sido !== region.sido) continue;
    if (!a.sigungu) {
      // 시군구 표기가 해석되지 않았는데 원문에 세부 지역이 있으면 단정하지 않음
      const detailed = a.raw.trim().split(/\s+/).filter((t) => t !== "전체" && t !== "전역").length > 1;
      if (detailed) {
        unclear = true;
        continue;
      }
      return { result: "target", reason: `${a.sido} 전체 대상` };
    }
    if (!region.sigungu) {
      if (NO_SIGUNGU.has(region.sido)) return { result: "target", reason: `${region.sido} 대상` };
      unclear = true;
      continue;
    }
    if (region.sigungu === a.sigungu || region.sigungu.startsWith(`${a.sigungu} `)) {
      return { result: "target", reason: `${a.sido} ${a.sigungu} 대상` };
    }
    if (isMixedReorgSigungu(region.sido, region.sigungu, a.sigungu)) reorg = true;
  }
  if (reorg) return { result: "undetermined", reason: REORG_UNDETERMINED_REASON };
  if (unclear) return { result: "undetermined", reason: "경보 지역 표기를 해석하지 못한 부분이 있음 — 관리자 확인 필요" };
  return { result: "non_target", reason: "학교 소재지가 경보 지역에 포함되지 않음" };
}
