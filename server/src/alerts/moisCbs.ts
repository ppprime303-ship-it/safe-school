// STEP 7 공식 긴급재난문자(행정안전부, 재난안전데이터 공유플랫폼) 공급자 어댑터
//
// ⚠ 응답 형식 미확정: 공개 페이지에는 요청 주소·응답 필드 명세가 없어(활용 신청 후 열람), 아래 값은 공개된 제3자 코드에서
//   확인된 이름을 기준으로 한 '가정'입니다. 인증키 발급 후 실제 응답으로 확인하고 CONTRACT 를 고친 뒤에만 연동 완료로 봅니다.
//   - 주소: https://www.safetydata.go.kr/V2/api/DSSP-IF-00247 (제3자 자료)
//   - 요청: serviceKey(대문자 K), returnType=json, pageNo, numOfRows, 조회 시작일(이름 미확정 — DATE_PARAM)
//   - 응답: { header?: {resultCode, resultMsg}, numOfRows?, pageNo?, totalCount?, body: [ {SN, CRT_DT, MSG_CN, RCPTN_RGN_NM, EMRG_STEP_NM?, DST_SE_NM?, ...} ] }
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
  /** 조회 시작일 매개변수 이름(명세 확인 전 가정) */
  dateParam: "crtDt",
  numOfRows: 100,
  maxPages: 5,
  issuer: "행정안전부(긴급재난문자)",
  verified: false as boolean, // 실제 응답으로 확인하면 true 로 바꾸고 docs/step7 기록
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

type FetchLike = (url: string, init: { signal: AbortSignal; headers: Record<string, string> }) => Promise<{ ok: boolean; status: number; json(): Promise<unknown> }>;

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
  ) {
    if (!serviceKey.trim()) throw new Error("MOIS_CBS_SERVICE_KEY 가 비어 있습니다.");
  }

  async fetch(): Promise<FetchResult> {
    const from = kstYmd(this.now(), 1); // 어제부터(자정 전후 누락 방지). 중복은 collector 가 (공급자, SN)으로 거름
    const alerts: NormalizedAlert[] = [];
    let rejected = 0;
    for (let page = 1; page <= MOIS_CBS_CONTRACT.maxPages; page++) {
      const res = await this.http(buildRequestUrl(this.serviceKey, page, from), { signal: AbortSignal.timeout(this.timeoutMs), headers: { Accept: "application/json" } });
      if (res.status === 429) throw new Error("공식 재난문자 API 호출 제한(429) — 다음 주기에 다시 시도");
      if (!res.ok) throw new Error(`공식 재난문자 API 응답 오류(HTTP ${res.status})`);
      const data = (await res.json().catch(() => null)) as { body?: unknown; header?: { resultCode?: unknown; resultMsg?: unknown }; totalCount?: unknown } | null;
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
