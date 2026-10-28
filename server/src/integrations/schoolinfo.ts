// 학교알리미(초·중등 교육정보 공시서비스) 공식 OpenAPI 연동
//
// 확인한 사항(2026-10-20, 학교알리미 API 제공목록 페이지)
// - 요청 주소: https://www.schoolinfo.go.kr/openApi.do (REST, JSON)
// - 학교기본정보 apiType=0, 요청인자 apiKey(필수)·apiType(필수)·schulKndCode(필수)·sidoCode·sggCode(선택)
// - 응답: { resultCode: 'success'|'fail', resultMsg, list: [...] }
//
// 2026-10-27 공식 자료로 다시 확인(학교알리미 OpenAPI 학교기본정보 페이지·시도시군구코드.xlsx·OpenAPI 출력값.xlsx)
// - 요청인자: apiKey(필수)·apiType(필수)·schulKndCode(필수)·sidoCode(선택)·sggCode(선택, 5자리)
//   ※ '2026-01-01 이후 신규 인증키는 시군구 필수' 정책은 위 공식 페이지에서 확인하지 못했습니다(페이지는 '선택').
//     두 경우 모두 동작하도록 API 호출은 항상 시군구 단위로 합니다(services/schoolDirectory.ts).
// - 시도 코드: 2026-07-01 전남광주통합특별시(12) 신설, 광주(29)·전남(46) 삭제 → shared/schoolinfoRegions.ts(공식 코드표에서 생성)
// - apiType 09 '학년별·학급별 학생수', 출력 열: 초·중·고 모두 n학년 = COL_Cn(학급수)·COL_Sn(학생수), 합계 COL_C_SUM·COL_S_SUM
// - 응답에 '공시 기준일' 필드는 출력값 정의에 없어, 기준일은 있으면 저장하고 없으면 비워 둡니다.
//
// 이 API는 학년별 합계만 제공합니다. 학급별 학생 수를 임의로 나누지 않습니다.

import { createHash } from "node:crypto";
import { SCHOOLINFO_SIDO } from "../../../shared/schoolinfoRegions.js";

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

// 공식 코드표(shared/schoolinfoRegions.ts)에서 만듦
export const SIDO_CODES: Record<string, string> = Object.fromEntries(SCHOOLINFO_SIDO);
export const API_TYPE_BASIC_INFO = "0";
export const API_TYPE_GRADE_CLASS_STUDENTS = "09"; // 학년별·학급별 학생수(공식 출력값 정의 확인)

// 응답 필드 검증: 아래 필드는 공식 출력값 정의(2026-10-27)에 있는 항목입니다. 실제 응답에도 있는지는
// 인증키 발급 후 npm run schoolinfo:verify 로 확인하고 docs/data-sources.md 에 기록합니다(아직 실제 호출 없음).
export const EXPECTED_BASIC_FIELDS = ["SCHUL_CODE", "SCHUL_NM", "SCHUL_KND_SC_CODE", "ATPT_OFCDC_ORG_NM", "SCHUL_RDNMA", "ABSCH_YN"] as const;
export const REQUIRED_BASIC_FIELDS = ["SCHUL_CODE", "SCHUL_NM"] as const;
export const EXPECTED_GRADE_FIELDS = ["SCHUL_CODE", "COL_C1", "COL_S1", "COL_C_SUM", "COL_S_SUM"] as const;

/** 학년별 학급수·학생수(apiType 09) 연동은 실제 응답으로 필드를 확인한 뒤에만 켭니다(기본 꺼짐). */
export const isGradeDataEnabled = () => process.env.SCHOOLINFO_GRADE_DATA === "enabled";

/** 응답 행들의 필드 이름(값 제외)과 기대 필드 존재 여부 */
export function inspectFields(rows: SchoolinfoRow[], expected: readonly string[]) {
  const keys = new Set<string>();
  for (const row of rows.slice(0, 20)) Object.keys(row).forEach((k) => keys.add(k));
  return {
    fieldNames: [...keys].sort(),
    present: expected.filter((f) => keys.has(f)),
    missing: expected.filter((f) => !keys.has(f)),
  };
}

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
    public readonly kind: "not_configured" | "network" | "http" | "api" | "format" | "params",
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
        // 원본 오류 메시지에는 요청 주소(인증키 포함)가 들어갈 수 있어 오류 종류만 남깁니다.
        const kind = (error as Error)?.name === "TimeoutError" ? "시간 초과" : "연결 실패";
        throw new SchoolinfoError(`학교알리미에 연결할 수 없습니다(${kind}).`, "network");
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
        // 2026-10-27 실제 응답: 시군구 없이 요청하면 resultCode fail, "시군구 코드(sggCode)는 필수 정보입니다."
        const params = /sggCode|시군구/.test(String(result.resultMsg ?? "")) && /필수/.test(String(result.resultMsg ?? ""));
        throw new SchoolinfoError(`학교알리미 오류: ${result.resultMsg ?? "알 수 없음"}`, params ? "params" : "api");
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

// 학교급별 학년 → 열 번호(공식 출력값 정의: 초·중·고 모두 n학년 = COL_Cn·COL_Sn).
// 2026-10-27 이전에는 중학교 COL_C9~11, 고등학교 COL_C14~16 으로 잘못 읽고 있었음(학년별 자료는 기본 꺼짐이라 사용된 적 없음).
// 특수학교(05)는 학부별로 열 배치가 달라 지원하지 않습니다.
const GRADE_COLUMNS: Record<string, { grade: number; col: number }[]> = {
  "02": [1, 2, 3, 4, 5, 6].map((g) => ({ grade: g, col: g })),
  "03": [1, 2, 3].map((g) => ({ grade: g, col: g })),
  "04": [1, 2, 3].map((g) => ({ grade: g, col: g })),
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
