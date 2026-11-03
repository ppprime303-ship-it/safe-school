// STEP 7 공식 긴급재난문자(행정안전부, 재난안전데이터 공유플랫폼) 공급자 어댑터
//
// 공식 명세(공유플랫폼 데이터 228 '오픈 API', 2026-11-02 확인)
//   - GET https://www.safetydata.go.kr/V2/api/DSSP-IF-00247
//   - 요청: serviceKey(필수), numOfRows, pageNo, returnType(json·xml), crtDt(조회시작일자 YYYYMMDD), rgnNm(시도·시군구명)
//   - 응답 항목: SN, CRT_DT, MSG_CN, RCPTN_RGN_NM, EMRG_STEP_NM(긴급재난·안전안내·위급재난), DST_SE_NM, REG_YMD, MDFCN_YMD, RCPTN_RGN_ID, EMRG_STEP_ID, DST_SE_ID
//   - 오류: 32 UNREGISTERED IP ERROR(등록되지 않은 IP), 30 등록되지 않은 서비스키, 31 기한 만료, 22 호출 제한, 33 서비스키 없음, 34 여러 서비스키 등
// 실제 응답 확인(2026-11-03, 등록 서버 IP에서 1회 — docs/integrations/mois-cbs-verified-2026-11-03.md):
//   HTTP 200, 결과 코드 00, 최상위 header·numOfRows·pageNo·totalCount·body(배열), 항목 필드 11개(필수 누락 없음),
//   SN 24/24 고유, CRT_DT 'YYYY/MM/DD HH:mm:ss'. 응답 순서는 일정하지 않음 → 수집기가 발송 시각으로 정렬(collector.ts), 중복은 (공급자, SN)으로 거름
// 아직 확인하지 못한 것: 인천 지역 표기의 실제 매칭(응답에 인천 0건), 전국 문자 표기, rgnNm 조회 방식, 실시간 전달 지연, 정정·취소 표기
// 명세에 정정·재송출·취소 구분 항목은 없습니다. 재송출은 내용 해시로 묶고, 정정·취소는 본문으로 사람이 판단합니다.
//
// 원칙
// - 공식 원문은 raw 로 그대로 보존(수정하지 않음). 발송 시각(CRT_DT)과 수집 시각(received_at, DB 기본값)을 구분합니다.
// - 형식이 맞지 않는 항목은 버리고 건수를 기록합니다(추측으로 채우지 않음). 응답 전체가 형식과 다르면 수집 실패로 남깁니다.
// - 인증키는 오류·로그에 남기지 않습니다(collector.sanitizeError 가 serviceKey= 값을 가림).
// - 이 어댑터는 경보를 '받아 저장'만 합니다. 학교 재난 발령·학부모 발송을 자동으로 하지 않습니다(collector 원칙 그대로).
import type { AlertSeverity } from "@prisma/client";
import { parseAreas } from "./region.js";
import type { AlertSource, FetchResult, NormalizedAlert } from "./providers.js";

export const MOIS_CBS_CONTRACT = {
  endpoint: "https://www.safetydata.go.kr/V2/api/DSSP-IF-00247",
  /** 조회시작일자(공식 명세) */
  dateParam: "crtDt",
  numOfRows: 100,
  maxPages: 5,
  issuer: "행정안전부(긴급재난문자)",
  verified: true as boolean, // 요청·인증·응답 계약을 실제 응답으로 확인(2026-11-03). 지역 매칭·지연은 미확인 — 위 설명
} as const;

export interface MoisCbsRecord {
  SN?: unknown;
  CRT_DT?: unknown;
  MSG_CN?: unknown;
  RCPTN_RGN_NM?: unknown;
  EMRG_STEP_NM?: unknown;
  DST_SE_NM?: unknown;
  [k: string]: unknown;
}

/** 'YYYY/MM/DD HH:mm:ss', 'YYYY-MM-DD HH:mm:ss', 'YYYYMMDDHHmmss' (한국 시간) → Date. 그 밖은 null */
export function parseKstDateTime(v: unknown): Date | null {
  if (typeof v !== "string") return null;
  const s = v.trim();
  let m = /^(\d{4})[/-](\d{2})[/-](\d{2})[ T](\d{2}):(\d{2})(?::(\d{2}))?(?:\.\d+)?$/.exec(s);
  if (!m) m = /^(\d{4})(\d{2})(\d{2})(\d{2})(\d{2})(\d{2})?$/.exec(s);
  if (!m) return null;
  const [y, mo, d, h, mi, se] = m.slice(1).map((x) => Number(x ?? 0));
  if (mo! < 1 || mo! > 12 || d! < 1 || d! > 31 || h! > 23 || mi! > 59 || (se ?? 0) > 59) return null;
  const t = Date.UTC(y!, mo! - 1, d!, h! - 9, mi!, se ?? 0);
  const date = new Date(t);
  // 존재하지 않는 날짜(2월 30일 등) 거부
  const back = new Date(t + 9 * 3600_000);
  if (back.getUTCDate() !== d || back.getUTCMonth() !== mo! - 1) return null;
  return date;
}

/** 긴급재난문자 단계 → 경보 단계(문자열에 단계 이름이 들어 있을 때만, 모르면 info) */
export function severityOf(step: unknown): AlertSeverity {
  const s = typeof step === "string" ? step : "";
  if (s.includes("위급")) return "emergency";
  if (s.includes("긴급")) return "warning";
  if (s.includes("안전안내")) return "advisory";
  return "info";
}

export function normalizeMoisCbs(r: MoisCbsRecord): NormalizedAlert | null {
  const id = typeof r.SN === "number" || typeof r.SN === "string" ? String(r.SN).trim() : "";
  const body = typeof r.MSG_CN === "string" ? r.MSG_CN.trim() : "";
  const areasRaw = typeof r.RCPTN_RGN_NM === "string" ? r.RCPTN_RGN_NM.trim() : "";
  const issuedAt = parseKstDateTime(r.CRT_DT);
  if (!id || !body || !areasRaw || !issuedAt) return null;
  return {
    externalId: id,
    kind: "disaster_text",
    severity: severityOf(r.EMRG_STEP_NM),
    msgType: "new", // 해제·정정 구분 필드는 명세 확인 전이라 추정하지 않음(본문으로 사람이 판단)
    refExternalId: null,
    issuer: MOIS_CBS_CONTRACT.issuer,
    title: typeof r.DST_SE_NM === "string" && r.DST_SE_NM.trim() ? `[${r.DST_SE_NM.trim()}] 긴급재난문자` : "긴급재난문자",
    body,
    areasRaw,
    areas: parseAreas(areasRaw),
    issuedAt,
    expiresAt: null,
    raw: r,
  };
}

function safeJsonParse(text: string): unknown {
  try {
    return JSON.parse(text);
  } catch {
    return null;
  }
}

/** 한국 날짜 YYYYMMDD(기준 시각에서 days 일 전) */
export function kstYmd(now: Date, daysAgo = 0): string {
  const k = new Date(now.getTime() + 9 * 3600_000 - daysAgo * 86_400_000);
  return `${k.getUTCFullYear()}${String(k.getUTCMonth() + 1).padStart(2, "0")}${String(k.getUTCDate()).padStart(2, "0")}`;
}

export function buildRequestUrl(serviceKey: string, pageNo: number, fromYmd: string): string {
  // 인증키가 이미 URL 인코딩되어 있으면(% 포함) 다시 인코딩하지 않음
  const key = serviceKey.includes("%") ? serviceKey : encodeURIComponent(serviceKey);
  const q = [`serviceKey=${key}`, "returnType=json", `pageNo=${pageNo}`, `numOfRows=${MOIS_CBS_CONTRACT.numOfRows}`, `${MOIS_CBS_CONTRACT.dateParam}=${fromYmd}`];
  return `${MOIS_CBS_CONTRACT.endpoint}?${q.join("&")}`;
}

/** 응답 본문 최대 크기(정상 응답 100건 × 1쪽의 수십 배 여유). 넘으면 읽기를 멈추고 형식 오류로 처리 */
export const MAX_RESPONSE_BYTES = 1_000_000;

// 실제 fetch 응답은 body·text 를 가집니다. json() 만 있는 가짜 응답(기존 시험)도 그대로 받습니다.
type HttpResponse = {
  ok: boolean;
  status: number;
  json(): Promise<unknown>;
  text?(): Promise<string>;
  body?: ReadableStream<Uint8Array> | null;
};
type FetchLike = (url: string, init: { signal: AbortSignal; headers: Record<string, string> }) => Promise<HttpResponse>;

/** 본문을 최대 크기까지만 읽습니다. 읽을 방법이 없으면 undefined(→ json() 사용) */
async function readLimitedText(res: HttpResponse): Promise<string | undefined> {
  if (res.body && typeof res.body.getReader === "function") {
    const reader = res.body.getReader();
    const chunks: Uint8Array[] = [];
    let size = 0;
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      size += value.byteLength;
      if (size > MAX_RESPONSE_BYTES) {
        await reader.cancel().catch(() => {});
        throw new Error(`공식 재난문자 API 응답이 너무 큽니다(${MAX_RESPONSE_BYTES}바이트 초과, 형식 확인 필요).`);
      }
      chunks.push(value);
    }
    return Buffer.concat(chunks).toString("utf8");
  }
  if (typeof res.text === "function") {
    const text = await res.text();
    if (Buffer.byteLength(text, "utf8") > MAX_RESPONSE_BYTES) throw new Error(`공식 재난문자 API 응답이 너무 큽니다(${MAX_RESPONSE_BYTES}바이트 초과, 형식 확인 필요).`);
    return text;
  }
  return undefined;
}

/**
 * 공공 OpenAPI 게이트웨이의 XML 오류 응답(OpenAPI_ServiceResponse 등)에서 코드·이름만 꺼내 안전한 문장으로 바꿉니다.
 * - XML 파서를 쓰지 않습니다. DTD·ENTITY 선언이 있으면 내용을 해석하지 않고 거부합니다(외부 엔터티 차단).
 * - 꺼내는 값은 숫자 코드(3자리 이하)와 대문자·밑줄 이름(80자 이하)뿐이라 원문(인증키 등)이 기록에 섞이지 않습니다.
 * - 이름(예: UNREGISTERED_IP_ERROR)은 공공데이터포털 표준 오류 이름입니다. 재난안전데이터 공유플랫폼이 같은 이름을
 *   쓰는지는 활용 승인 후 실제 응답으로 확인해야 합니다(분류: feedStatus.classifyFeedError, 모르는 이름은 '알 수 없음').
 */
export function describeXmlGatewayError(xml: string, httpStatus: number): string {
  const head = xml.slice(0, 20_000);
  const http = httpStatus === 200 ? "" : ` HTTP ${httpStatus}`;
  if (/<!DOCTYPE|<!ENTITY/i.test(head)) return `공식 재난문자 API 응답(XML)에 DTD 선언이 있어 처리하지 않았습니다${http}(형식 확인 필요).`;
  const code = /<returnReasonCode>\s*(\d{1,3})\s*<\/returnReasonCode>/.exec(head)?.[1] ?? /<resultCode>\s*(\d{1,3})\s*<\/resultCode>/.exec(head)?.[1];
  const name = /<returnAuthMsg>\s*([A-Z_]{1,80})\s*<\/returnAuthMsg>/.exec(head)?.[1] ?? /<errMsg>\s*([A-Z_ ]{1,80})\s*<\/errMsg>/.exec(head)?.[1]?.trim();
  if (!code && !name) return `공식 재난문자 API가 JSON이 아닌 XML로 응답했습니다${http}(형식 확인 필요).`;
  return `공식 재난문자 API 게이트웨이 오류(XML)${http} 코드 ${code ?? "-"} ${name ?? ""}`.trim();
}

export class MoisCbsSource implements AlertSource {
  readonly provider = "mois_cbs" as const;
  readonly isMock = false;
  /** 마지막 수집에서 형식이 맞지 않아 버린 항목 수(운영 로그·점검용) */
  lastRejected = 0;
  constructor(
    private readonly serviceKey: string,
    private readonly http: FetchLike = fetch as unknown as FetchLike,
    private readonly now: () => Date = () => new Date(),
    private readonly timeoutMs = 10_000,
    /** 주기당 최대 쪽 수. 운영 수집은 일일 호출 한도 때문에 1쪽(index.ts) */
    private readonly maxPages: number = MOIS_CBS_CONTRACT.maxPages,
  ) {
    if (!serviceKey.trim()) throw new Error("MOIS_CBS_SERVICE_KEY 가 비어 있습니다.");
  }

  async fetch(): Promise<FetchResult> {
    const from = kstYmd(this.now(), 1); // 어제부터(자정 전후 누락 방지). 중복은 collector 가 (공급자, SN)으로 거름
    const alerts: NormalizedAlert[] = [];
    let rejected = 0;
    for (let page = 1; page <= this.maxPages; page++) {
      const res = await this.http(buildRequestUrl(this.serviceKey, page, from), { signal: AbortSignal.timeout(this.timeoutMs), headers: { Accept: "application/json" } });
      if (res.status === 429) throw new Error("공식 재난문자 API 호출 제한(429) — 다음 주기에 다시 시도");
      if (!res.ok) {
        // 게이트웨이가 HTTP 오류와 함께 XML 오류 본문을 주면 그 코드·이름으로 더 정확히 기록
        const errText = await readLimitedText(res).catch(() => undefined);
        if (errText?.trimStart().startsWith("<")) throw new Error(describeXmlGatewayError(errText, res.status));
        throw new Error(`공식 재난문자 API 응답 오류(HTTP ${res.status})`);
      }
      const text = await readLimitedText(res);
      if (text !== undefined && text.trimStart().startsWith("<")) throw new Error(describeXmlGatewayError(text, res.status));
      const parsed = text === undefined ? await res.json().catch(() => null) : safeJsonParse(text);
      const data = parsed as { body?: unknown; header?: { resultCode?: unknown; resultMsg?: unknown }; totalCount?: unknown } | null;
      if (!data || typeof data !== "object") throw new Error("공식 재난문자 API 응답이 JSON이 아닙니다(형식 확인 필요).");
      const code = data.header?.resultCode;
      if (code !== undefined && code !== null && !["00", "0", 0].includes(code as never)) {
        throw new Error(`공식 재난문자 API 결과 코드 ${String(code).slice(0, 10)}: ${String(data.header?.resultMsg ?? "").slice(0, 80)}`);
      }
      if (!Array.isArray(data.body)) {
        // 새 문자가 없을 때 body 가 비거나 빠질 수 있음 → 첫 페이지에서 body 가 없으면 형식 불일치로 봄
        if (page === 1 && data.body !== undefined && data.body !== null) throw new Error("공식 재난문자 API 응답에 body 배열이 없습니다(형식 확인 필요).");
        break;
      }
      for (const r of data.body as MoisCbsRecord[]) {
        const n = r && typeof r === "object" ? normalizeMoisCbs(r) : null;
        if (n) alerts.push(n);
        else rejected++;
      }
      const total = typeof data.totalCount === "number" ? data.totalCount : Number(data.totalCount ?? NaN);
      if (data.body.length < MOIS_CBS_CONTRACT.numOfRows || (Number.isFinite(total) && page * MOIS_CBS_CONTRACT.numOfRows >= total)) break;
    }
    this.lastRejected = rejected;
    return { alerts, nextCursor: null };
  }
}
