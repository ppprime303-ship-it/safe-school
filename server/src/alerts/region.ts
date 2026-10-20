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
  for (const a of areas) {
    if (!a.sido) {
      unclear = true;
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
  }
  if (unclear) return { result: "undetermined", reason: "경보 지역 표기를 해석하지 못한 부분이 있음 — 관리자 확인 필요" };
  return { result: "non_target", reason: "학교 소재지가 경보 지역에 포함되지 않음" };
}
