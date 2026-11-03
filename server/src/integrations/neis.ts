// 나이스 교육정보 개방 포털 Open API(교육부·KERIS) — 공개 교육정보 전용 어댑터(서버에서만 호출)
//
// 나이스 '업무 시스템'(학생·교직원 행정정보)과 다릅니다. 여기서는 누구나 조회할 수 있는 공개 데이터(학교기본정보)만 읽고,
// 학생·교직원 개인정보는 보내지도 받지도 않습니다(docs/data-sources.md).
//
// 2026-10-27 공식 포털 데이터셋 명세(selectOpenApiMeta)로 확인
// - 주소: https://open.neis.go.kr/hub/schoolInfo · 기본인자 KEY(필수)·Type·pIndex·pSize(최대 1,000 — ERROR-336)
// - 인증키 없이 부르면 샘플 5건만 나옵니다 → 이 어댑터는 인증키가 없으면 아예 호출하지 않습니다(샘플을 실제 자료로 오인 방지).
// - 신청인자(모두 선택): ATPT_OFCDC_SC_CODE(시도교육청코드)·SD_SCHUL_CODE(행정표준코드)·SCHUL_NM(학교명)·SCHUL_KND_SC_NM·LCTN_SC_NM·FOND_SC_NM
// - 결과 코드: INFO-000 정상, INFO-200 자료 없음, ERROR-290·INFO-300 인증, ERROR-337 일별 트래픽 초과, ERROR-500·600·601 서버,
//   ERROR-300·310·333·336 요청 오류
// 2026-11-03 인증키 실호출(E10, 사용자 실행)로 확인: 정상 응답의 감싸는 구조 { schoolInfo: [ { head: [...] }, { row: [...] } ] }
// 확인 필요(verified=true 는 정상 응답 구조까지만 뜻합니다 — docs/integrations/api-status-2026-11-02.md)
// - 같은 호출에서 100행 중 2행이 행 형식 검사로 제외됨. 원인 미확인(건수만 기록, 호출한 첫 쪽 범위)
// - 자료 없음·오류의 { RESULT: { CODE, MESSAGE } } 구조는 실제 응답으로 확인하지 않았습니다.
// - 일별 트래픽 한도 수치(공개 안 됨) → NEIS_DAILY_LIMIT 로 이 서버 안에서 먼저 막습니다(기본 900회, 한국 날짜 기준).
// - 시도교육청 코드표(전남광주통합특별시 출범 후 포함) → 하드코딩하지 않고 응답의 코드·이름 쌍만 씁니다.
import { z } from "zod";

export const NEIS_CONTRACT = {
  endpoint: "https://open.neis.go.kr/hub",
  schoolInfo: "schoolInfo",
  maxPageSize: 1000,
  verified: true as boolean, // 정상 응답의 감싸는 구조 확인(2026-11-03). 행 제외 원인은 별개로 미확인(위 설명)
} as const;

export type NeisErrorKind = "not_configured" | "auth" | "rate_limited" | "server" | "params" | "http" | "timeout" | "network" | "format";

export class NeisError extends Error {
  constructor(
    message: string,
    public readonly kind: NeisErrorKind,
    public readonly code?: string,
  ) {
    super(message);
  }
}

/** 결과 코드 → 오류 종류(INFO-000·INFO-200 은 오류 아님) */
export function neisCodeKind(code: string): NeisErrorKind | null {
  if (code === "INFO-000" || code === "INFO-200" || code === "INFO-100") return null;
  if (code === "ERROR-290" || code === "INFO-300") return "auth";
  if (code === "ERROR-337") return "rate_limited";
  if (["ERROR-500", "ERROR-600", "ERROR-601"].includes(code)) return "server";
  if (["ERROR-300", "ERROR-310", "ERROR-333", "ERROR-336"].includes(code)) return "params";
  return "format";
}

// 학교기본정보 한 행(필요한 필드만 검사, 나머지는 원문 보존)
const schoolRowSchema = z
  .object({
    ATPT_OFCDC_SC_CODE: z.string().trim().min(1),
    ATPT_OFCDC_SC_NM: z.string().trim().optional().nullable(),
    SD_SCHUL_CODE: z.string().trim().min(1),
    SCHUL_NM: z.string().trim().min(1),
    SCHUL_KND_SC_NM: z.string().trim().optional().nullable(),
    LCTN_SC_NM: z.string().trim().optional().nullable(),
    JU_ORG_NM: z.string().trim().optional().nullable(),
    FOND_SC_NM: z.string().trim().optional().nullable(),
    ORG_RDNMA: z.string().trim().optional().nullable(),
    LOAD_DTM: z.string().trim().optional().nullable(),
  })
  .passthrough();

export interface NeisSchool {
  officeCode: string; // 시도교육청코드
  officeName: string | null;
  schoolCode: string; // 행정표준코드(SD_SCHUL_CODE)
  name: string;
  kindName: string | null;
  sidoName: string | null;
  jurisdiction: string | null; // 관할조직명(교육지원청)
  foundation: string | null;
  address: string | null;
  updatedAt: string | null; // LOAD_DTM(수정일자) 원문
}

export interface NeisSchoolQuery {
  name?: string; // SCHUL_NM
  officeCode?: string; // ATPT_OFCDC_SC_CODE
  schoolCode?: string; // SD_SCHUL_CODE
}

const nz = (v: string | null | undefined) => (v && v.trim() ? v.trim() : null);

/** 응답 본문 → 행 목록. 형식이 다르면 NeisError(format), 결과 코드가 오류면 해당 종류. 형식이 맞지 않는 행은 버리고 건수만 셉니다. */
export function parseSchoolInfoResponse(body: unknown): { schools: NeisSchool[]; rejected: number; total: number | null } {
  if (!body || typeof body !== "object") throw new NeisError("나이스 응답이 JSON 객체가 아닙니다.", "format");
  const top = body as Record<string, unknown>;

  // 자료 없음·오류: { RESULT: { CODE, MESSAGE } }
  const bare = top.RESULT as { CODE?: unknown; MESSAGE?: unknown } | undefined;
  if (bare && typeof bare.CODE === "string") {
    const kind = neisCodeKind(bare.CODE);
    if (kind) throw new NeisError(`나이스 결과 코드 ${bare.CODE.slice(0, 12)}: ${String(bare.MESSAGE ?? "").slice(0, 80)}`, kind, bare.CODE);
    return { schools: [], rejected: 0, total: 0 };
  }

  const blocks = top[NEIS_CONTRACT.schoolInfo];
  if (!Array.isArray(blocks)) throw new NeisError("나이스 응답에 schoolInfo 배열이 없습니다(형식 확인 필요).", "format");
  const head = (blocks.find((b) => b && typeof b === "object" && "head" in b) as { head?: unknown } | undefined)?.head;
  const rowsBlock = (blocks.find((b) => b && typeof b === "object" && "row" in b) as { row?: unknown } | undefined)?.row;
  if (!Array.isArray(head) || !Array.isArray(rowsBlock)) throw new NeisError("나이스 응답에 head·row 가 없습니다(형식 확인 필요).", "format");

  let total: number | null = null;
  for (const h of head) {
    if (h && typeof h === "object") {
      const rec = h as { list_total_count?: unknown; RESULT?: { CODE?: unknown; MESSAGE?: unknown } };
      if (typeof rec.list_total_count === "number") total = rec.list_total_count;
      if (rec.RESULT && typeof rec.RESULT.CODE === "string") {
        const kind = neisCodeKind(rec.RESULT.CODE);
        if (kind) throw new NeisError(`나이스 결과 코드 ${rec.RESULT.CODE.slice(0, 12)}: ${String(rec.RESULT.MESSAGE ?? "").slice(0, 80)}`, kind, rec.RESULT.CODE);
      }
    }
  }

  const schools: NeisSchool[] = [];
  let rejected = 0;
  for (const row of rowsBlock) {
    const r = schoolRowSchema.safeParse(row);
    if (!r.success) {
      rejected++;
      continue;
    }
    const d = r.data;
    schools.push({
      officeCode: d.ATPT_OFCDC_SC_CODE,
      officeName: nz(d.ATPT_OFCDC_SC_NM),
      schoolCode: d.SD_SCHUL_CODE,
      name: d.SCHUL_NM,
      kindName: nz(d.SCHUL_KND_SC_NM),
      sidoName: nz(d.LCTN_SC_NM),
      jurisdiction: nz(d.JU_ORG_NM),
      foundation: nz(d.FOND_SC_NM),
      address: nz(d.ORG_RDNMA),
      updatedAt: nz(d.LOAD_DTM),
    });
  }
  // 행이 있는데 하나도 맞지 않으면 명세 변경으로 봄
  if (rowsBlock.length > 0 && schools.length === 0) throw new NeisError("나이스 응답 행의 형식이 예상과 다릅니다(필수 필드 없음).", "format");
  return { schools, rejected, total };
}

/** 인증키를 뺀 요청 주소(캐시 키·기록용) */
export function buildSchoolInfoUrl(query: NeisSchoolQuery, page = 1, pageSize = 100, key?: string): string {
  const url = new URL(`${NEIS_CONTRACT.endpoint}/${NEIS_CONTRACT.schoolInfo}`);
  if (key) url.searchParams.set("KEY", key);
  url.searchParams.set("Type", "json");
  url.searchParams.set("pIndex", String(page));
  url.searchParams.set("pSize", String(Math.min(Math.max(1, pageSize), NEIS_CONTRACT.maxPageSize)));
  if (query.officeCode) url.searchParams.set("ATPT_OFCDC_SC_CODE", query.officeCode);
  if (query.schoolCode) url.searchParams.set("SD_SCHUL_CODE", query.schoolCode);
  if (query.name) url.searchParams.set("SCHUL_NM", query.name);
  return url.toString();
}

/** 오류·기록 문장에서 인증키(KEY=…)를 가림 */
export const redactNeisKey = (text: string, key?: string) => {
  const masked = text.replace(/(\bKEY=)[^&\s]+/gi, "$1***");
  return key ? masked.split(key).join("***") : masked; // 제공기관 메시지가 키를 그대로 되돌려 주는 경우까지
};

type FetchLike = (url: string, init: { signal: AbortSignal }) => Promise<{ ok: boolean; status: number; json(): Promise<unknown>; headers?: { get(name: string): string | null } }>;

export interface NeisClientOptions {
  apiKey: string | undefined;
  fetchImpl?: FetchLike;
  timeoutMs?: number;
  /** 같은 요청 결과 캐시 시간(학교기본정보는 자주 바뀌지 않음). 기본 12시간 */
  cacheTtlMs?: number;
  cacheMaxEntries?: number;
  /** 이 서버에서 하루(한국 날짜)에 부를 수 있는 최대 횟수. 공식 한도 수치는 확인 필요 */
  dailyLimit?: number;
  /** 연속 호출 최소 간격 */
  minIntervalMs?: number;
  /** 연결 실패·시간 초과·5xx 재시도 횟수(인증·요청 오류·한도 초과는 재시도 안 함) */
  retries?: number;
  now?: () => Date;
  sleep?: (ms: number) => Promise<void>;
}

export interface NeisClient {
  searchSchools(query: NeisSchoolQuery): Promise<{ schools: NeisSchool[]; rejected: number; cached: boolean; fetchedAt: Date }>;
  usage(): { day: string; calls: number; limit: number };
}

const kstDay = (d: Date) => new Date(d.getTime() + 9 * 3600_000).toISOString().slice(0, 10);

export function createNeisClient(options: NeisClientOptions): NeisClient {
  const apiKey = options.apiKey?.trim();
  const http = options.fetchImpl ?? (fetch as unknown as FetchLike);
  const timeoutMs = options.timeoutMs ?? 10_000;
  const ttl = options.cacheTtlMs ?? 12 * 3600_000;
  const maxEntries = options.cacheMaxEntries ?? 200;
  const limit = options.dailyLimit ?? 900;
  const minInterval = options.minIntervalMs ?? 200;
  const retries = options.retries ?? 1;
  const now = options.now ?? (() => new Date());
  const sleep = options.sleep ?? ((ms: number) => new Promise<void>((r) => setTimeout(r, ms)));

  const cache = new Map<string, { at: number; value: { schools: NeisSchool[]; rejected: number } }>();
  let day = kstDay(now());
  let calls = 0;
  let lastCallAt = 0;
  let chain: Promise<unknown> = Promise.resolve(); // 호출을 한 번에 하나씩

  const callOnce = async (url: string) => {
    let res;
    try {
      // Accept 헤더를 보내지 않음: 키 없는 요청 실측에서 Accept: application/json 이면 HTTP 500(HTML), 기본 fetch 는 HTTP 200
      res = await http(url, { signal: AbortSignal.timeout(timeoutMs) });
    } catch (error) {
      const name = (error as { name?: string })?.name;
      if (name === "TimeoutError" || name === "AbortError") throw new NeisError("나이스 응답 시간 초과", "timeout");
      throw new NeisError("나이스에 연결할 수 없습니다.", "network");
    }
    if (res.status === 429) throw new NeisError("나이스 호출 한도 초과(HTTP 429)", "rate_limited");
    // 제공기관 장애(HTML)와 나이스 결과 코드(JSON)를 구분하도록 응답 형식만 기록(본문은 넣지 않음)
    if (res.status >= 500) throw new NeisError(`나이스 서버 오류(HTTP ${res.status}${res.headers?.get("content-type") ? `, ${res.headers.get("content-type")!.split(";")[0]!.slice(0, 40)}` : ""})`, "server");
    if (!res.ok) throw new NeisError(`나이스 응답 오류(HTTP ${res.status})`, "http");
    const body = await res.json().catch(() => {
      throw new NeisError("나이스 응답을 해석할 수 없습니다(JSON 아님).", "format");
    });
    return parseSchoolInfoResponse(body);
  };

  const run = async (query: NeisSchoolQuery) => {
    if (!apiKey) throw new NeisError("나이스 인증키(NEIS_API_KEY)가 설정되지 않았습니다.", "not_configured");
    if (!query.name && !query.officeCode && !query.schoolCode) throw new NeisError("학교명·교육청코드·학교코드 중 하나는 필요합니다.", "params");
    const cacheKey = buildSchoolInfoUrl(query, 1, 100);
    const hit = cache.get(cacheKey);
    if (hit && now().getTime() - hit.at < ttl) return { ...hit.value, cached: true, fetchedAt: new Date(hit.at) };

    const today = kstDay(now());
    if (today !== day) {
      day = today;
      calls = 0;
    }
    let attempt = 0;
    for (;;) {
      if (calls >= limit) throw new NeisError(`이 서버의 나이스 일일 호출 한도(${limit}회)에 도달했습니다.`, "rate_limited");
      const wait = lastCallAt + minInterval - now().getTime();
      if (wait > 0) await sleep(wait);
      calls++;
      lastCallAt = now().getTime();
      try {
        const value = await callOnce(buildSchoolInfoUrl(query, 1, 100, apiKey));
        const at = now().getTime();
        cache.set(cacheKey, { at, value });
        while (cache.size > maxEntries) cache.delete(cache.keys().next().value!);
        return { ...value, cached: false, fetchedAt: new Date(at) };
      } catch (error) {
        const kind = error instanceof NeisError ? error.kind : "network";
        if (attempt < retries && (kind === "timeout" || kind === "network" || kind === "server")) {
          attempt++;
          await sleep(500 * attempt);
          continue;
        }
        if (error instanceof NeisError) throw new NeisError(redactNeisKey(error.message, apiKey), error.kind, error.code);
        throw new NeisError("나이스 호출 중 알 수 없는 오류", "network");
      }
    }
  };

  return {
    searchSchools(query) {
      const p = chain.then(() => run(query));
      chain = p.catch(() => undefined);
      return p;
    },
    usage: () => ({ day, calls, limit }),
  };
}

// ───────────── 학교알리미 학교 ↔ 나이스 학교 대응 후보(자동 연결·덮어쓰기 없음) ─────────────
// 두 기관의 학교 코드 체계가 다르므로(학교알리미 SCHUL_CODE ↔ 나이스 행정표준코드) 이름·주소·교육청을 비교해 '후보'만 냅니다.
// 실제 연결(school_external_ids source='neis')은 관리자가 확인한 뒤에만 합니다(docs/data-sources.md '나이스 연동').
export const normalizeSchoolName = (s: string) => s.replace(/\s+/g, "").replace(/\(.*?\)/g, "").trim();
const normalizeAddr = (s: string | null | undefined) => (s ?? "").replace(/\s+/g, "").replace(/[(),]/g, "");
/** 교육청 이름 비교용: '인천광역시교육청' ↔ '인천광역시교육청' 등 공백·접미 차이만 정리 */
const normalizeOffice = (s: string | null | undefined) => (s ?? "").replace(/\s+/g, "").replace(/교육청$/, "");

export interface SchoolMatchInput {
  name: string;
  eduOfficeName: string | null;
  address: string | null;
}

export function matchNeisCandidates(target: SchoolMatchInput, candidates: NeisSchool[]) {
  const name = normalizeSchoolName(target.name);
  const office = normalizeOffice(target.eduOfficeName);
  const addr = normalizeAddr(target.address);
  return candidates
    .map((c) => {
      const reasons: string[] = [];
      const sameName = normalizeSchoolName(c.name) === name;
      if (sameName) reasons.push("학교명 같음");
      const sameOffice = !!office && normalizeOffice(c.officeName) === office;
      if (sameOffice) reasons.push("시도교육청 같음");
      const sameAddr = !!addr && normalizeAddr(c.address) === addr;
      if (sameAddr) reasons.push("도로명주소 같음");
      const confidence: "high" | "medium" | "low" = sameName && sameOffice && sameAddr ? "high" : sameName && (sameOffice || sameAddr) ? "medium" : "low";
      return { candidate: c, confidence, reasons };
    })
    .filter((m) => m.reasons.includes("학교명 같음"))
    .sort((a, b) => ["high", "medium", "low"].indexOf(a.confidence) - ["high", "medium", "low"].indexOf(b.confidence));
}
