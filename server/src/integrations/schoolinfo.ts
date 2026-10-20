// 학교알리미(초·중등 교육정보 공시서비스) 공식 OpenAPI 연동
//
// 확인한 사항(2026-10-20, 학교알리미 API 제공목록 페이지)
// - 요청 주소: https://www.schoolinfo.go.kr/openApi.do (REST, JSON)
// - 학교기본정보 apiType=0, 요청인자 apiKey(필수)·apiType(필수)·schulKndCode(필수)·sidoCode·sggCode(선택)
// - 응답: { resultCode: 'success'|'fail', resultMsg, list: [...] }
//
// 확인이 필요한 사항(공식 개발자 활용가이드 PDF로 대조해야 함)
// - 학년별·학급별 학생수 apiType=09 와 열 이름(COL_C1 학급수, COL_S1 학생수 …)은 공개 오픈소스 구현에서 확인한 값입니다.
// - 시도 코드표(SIDO_CODES)도 같은 출처입니다.
// - 응답에 '공시 기준일' 필드가 있는지 확인되지 않아, 기준일은 있으면 저장하고 없으면 비워 둡니다.
//
// 이 API는 학년별 합계만 제공합니다. 학급별 학생 수를 임의로 나누지 않습니다.

import { createHash } from "node:crypto";

export const SCHOOLINFO_BASE_URL = "https://www.schoolinfo.go.kr/openApi.do";

export const SCHOOL_KIND_CODES = {
  "02": "초등학교",
  "03": "중학교",
  "04": "고등학교",
  "05": "특수학교",
  "06": "그외학교",
  "07": "각종학교",
} as const;
export type SchoolKindCode = keyof typeof SCHOOL_KIND_CODES;

// 확인 필요: 공식 코드표와 대조 전
export const SIDO_CODES: Record<string, string> = {
  "11": "서울특별시",
  "26": "부산광역시",
  "27": "대구광역시",
  "28": "인천광역시",
  "29": "광주광역시",
  "30": "대전광역시",
  "31": "울산광역시",
  "36": "세종특별자치시",
  "41": "경기도",
  "43": "충청북도",
  "44": "충청남도",
  "46": "전라남도",
  "47": "경상북도",
  "48": "경상남도",
  "50": "제주특별자치도",
  "51": "강원특별자치도",
  "52": "전북특별자치도",
};

export const API_TYPE_BASIC_INFO = "0";
export const API_TYPE_GRADE_CLASS_STUDENTS = "09"; // 확인 필요

export type SchoolinfoRow = Record<string, unknown>;

export interface SchoolinfoQuery {
  apiType: string;
  schulKndCode: string;
  sidoCode?: string;
  sggCode?: string;
  pbanYr?: number;
}

export interface SchoolinfoClient {
  fetch(query: SchoolinfoQuery): Promise<{ rows: SchoolinfoRow[]; sourceUrl: string }>;
}

export class SchoolinfoError extends Error {
  constructor(
    message: string,
    public readonly kind: "not_configured" | "network" | "http" | "api" | "format",
  ) {
    super(message);
  }
}

// 인증키를 뺀 출처 주소(저장·표시용)
export function buildSourceUrl(query: SchoolinfoQuery): string {
  const url = new URL(SCHOOLINFO_BASE_URL);
  url.searchParams.set("apiType", query.apiType);
  url.searchParams.set("schulKndCode", query.schulKndCode);
  if (query.sidoCode) url.searchParams.set("sidoCode", query.sidoCode);
  if (query.sggCode) url.searchParams.set("sggCode", query.sggCode);
  if (query.pbanYr) url.searchParams.set("pbanYr", String(query.pbanYr));
  return url.toString();
}

export function createSchoolinfoClient(options: {
  apiKey: string | undefined;
  timeoutMs?: number;
  fetchImpl?: typeof fetch;
}): SchoolinfoClient {
  const fetchImpl = options.fetchImpl ?? fetch;
  const timeoutMs = options.timeoutMs ?? 15000;
  return {
    async fetch(query) {
      if (!options.apiKey) {
        throw new SchoolinfoError("학교알리미 인증키(SCHOOLINFO_API_KEY)가 설정되지 않았습니다.", "not_configured");
      }
      const sourceUrl = buildSourceUrl(query);
      const url = new URL(sourceUrl);
      url.searchParams.set("apiKey", options.apiKey);

      let response: Response;
      try {
        response = await fetchImpl(url, { signal: AbortSignal.timeout(timeoutMs), headers: { Accept: "application/json" } });
      } catch (error) {
        throw new SchoolinfoError(`학교알리미에 연결할 수 없습니다: ${(error as Error).message}`, "network");
      }
      if (!response.ok) {
        throw new SchoolinfoError(`학교알리미 응답 오류(HTTP ${response.status})`, "http");
      }
      let body: unknown;
      try {
        body = await response.json();
      } catch {
        throw new SchoolinfoError("학교알리미 응답을 해석할 수 없습니다(JSON 아님).", "format");
      }
      const result = body as { resultCode?: string; resultMsg?: string; list?: unknown };
      if (result.resultCode !== "success") {
        throw new SchoolinfoError(`학교알리미 오류: ${result.resultMsg ?? "알 수 없음"}`, "api");
      }
      if (!Array.isArray(result.list)) {
        throw new SchoolinfoError("학교알리미 응답에 list가 없습니다.", "format");
      }
      return { rows: result.list as SchoolinfoRow[], sourceUrl };
    },
  };
}

// ───────────── 응답 해석(순수 함수: 테스트 가능) ─────────────

const str = (value: unknown): string | null => {
  if (value === null || value === undefined) return null;
  const s = String(value).trim();
  return s.length > 0 ? s : null;
};

export function toInt(value: unknown): number | null {
  const s = str(value);
  if (s === null) return null;
  const n = Number(s.replace(/,/g, ""));
  return Number.isFinite(n) ? Math.trunc(n) : null;
}

export interface BasicInfo {
  externalCode: string;
  name: string;
  kindCode: string | null;
  eduOfficeName: string | null;
  eduOfficeCode: string | null;
  address: string | null;
  closed: boolean;
}

export function parseBasicInfo(row: SchoolinfoRow): BasicInfo | null {
  const externalCode = str(row.SCHUL_CODE);
  const name = str(row.SCHUL_NM);
  if (!externalCode || !name) return null;
  return {
    externalCode,
    name,
    kindCode: str(row.SCHUL_KND_SC_CODE),
    eduOfficeName: str(row.ATPT_OFCDC_ORG_NM),
    eduOfficeCode: str(row.ATPT_OFCDC_ORG_CODE),
    address: str(row.SCHUL_RDNMA) ?? str(row.ADRES_BRKDN),
    closed: str(row.ABSCH_YN) === "Y",
  };
}

export interface GradeFigures {
  grade: number;
  classCount: number | null;
  studentCount: number | null;
}

export interface GradeClassStudents {
  grades: GradeFigures[];
  totalClasses: number | null;
  totalStudents: number | null;
  baseDate: string | null; // 응답에 기준일이 있을 때만(형식 YYYY-MM-DD)
}

// 학교급별 학년 → 열 번호(확인 필요: 공식 출력값 엑셀과 대조)
const GRADE_COLUMNS: Record<string, { grade: number; col: number }[]> = {
  "02": [1, 2, 3, 4, 5, 6].map((g) => ({ grade: g, col: g })),
  "03": [1, 2, 3].map((g) => ({ grade: g, col: 8 + g })),
  "04": [1, 2, 3].map((g) => ({ grade: g, col: 13 + g })),
};

const BASE_DATE_FIELDS = ["BASE_DATE", "BASE_DT", "CRTR_YMD", "STDR_YMD"];

function parseBaseDate(row: SchoolinfoRow): string | null {
  for (const field of BASE_DATE_FIELDS) {
    const s = str(row[field]);
    if (!s) continue;
    const digits = s.replace(/[^0-9]/g, "");
    if (digits.length === 8) return `${digits.slice(0, 4)}-${digits.slice(4, 6)}-${digits.slice(6, 8)}`;
  }
  return null;
}

export function parseGradeClassStudents(row: SchoolinfoRow, kindCode: string): GradeClassStudents {
  const columns = GRADE_COLUMNS[kindCode] ?? [];
  const grades = columns
    .map(({ grade, col }) => ({
      grade,
      classCount: toInt(row[`COL_C${col}`]),
      studentCount: toInt(row[`COL_S${col}`]),
    }))
    // 학급도 학생도 없는 학년은 제외(예: 공시값이 비어 있는 경우)
    .filter((g) => (g.classCount ?? 0) > 0 || (g.studentCount ?? 0) > 0);
  return {
    grades,
    totalClasses: toInt(row.COL_C_SUM) ?? toInt(row.COL_SUM_C4),
    totalStudents: toInt(row.COL_S_SUM) ?? toInt(row.COL_SUM_S4),
    baseDate: parseBaseDate(row),
  };
}

// 같은 내용인지 비교하기 위한 해시(키 순서와 무관)
export function hashPayload(payload: unknown): string {
  const stable = (value: unknown): unknown => {
    if (Array.isArray(value)) return value.map(stable);
    if (value && typeof value === "object") {
      return Object.fromEntries(
        Object.keys(value as Record<string, unknown>)
          .sort()
          .map((k) => [k, stable((value as Record<string, unknown>)[k])]),
      );
    }
    return value;
  };
  return createHash("sha256").update(JSON.stringify(stable(payload))).digest("hex");
}
