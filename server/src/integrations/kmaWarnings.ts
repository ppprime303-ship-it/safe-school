// 기상청 기상특보 조회서비스(공공데이터포털 15000415) 특보코드조회 getPwnCd — 읽기 전용 어댑터(서버에서만 호출)
//
// 근거: 공식 활용가이드 '기상청21_기상특보 조회서비스_오픈API활용가이드_260601'(docx·특보구역코드 xlsx)
// - 요청: serviceKey, numOfRows, pageNo(필수), dataType, fromTmFc·toTmFc(년월일 8자리), areaCode, warningType, stnId(선택)
// - 응답: stnId, tmFc, tmSeq, areaCode, areaName, warnVar, warnStress, command, startTime, endTime, allEndTime, cancel
// - 오류 코드: 가이드 첨부 표. 03 은 자료 없음
// 실제 응답 확인(2026-11-02 2회, 2026-11-03 4회 — docs/integrations/kma-warning-verified-2026-11-03.md)
// - 요청 주소·JSON 감싸는 구조 response.header/body.items.item·필드 12개·결과 코드: 실제 응답과 일치(전국 236행, 버린 항목 0)
// - 해제 판정·'특보 없음': 전국 202개 구역·종류 모두 해제로 판정, 같은 시각 공식 현황(getPwnStatus t6) '없음'과 일치
// - 아직 관측하지 못한 것: 발효 중·연장·정정·변경 발표의 실제 응답. 상태 판단은 공식 코드 정의(1 발표·2 해제·3 연장·6 정정·7 변경발표·8 변경해제)에 따른 해석이며,
//   화면은 공식 현황 원문을 함께 보여 줍니다(services/weatherWarnings.ts).
// 원칙: 키가 없으면 호출하지 않음. 저장·학교 재난 발령·알림 없음. 키는 오류·로그·응답에 남기지 않음.
import { kstYmd, parseKstDateTime } from "../alerts/moisCbs.js";
import type { WeatherErrorKind, WeatherWarningStatus } from "../../../shared/weatherWarnings.js";

export const KMA_WARNING_CONTRACT = {
  endpoint: "https://apis.data.go.kr/1360000/WthrWrnInfoService/getPwnCd",
  statusEndpoint: "https://apis.data.go.kr/1360000/WthrWrnInfoService/getPwnStatus",
  source: "기상청 기상특보 조회서비스",
  numOfRows: 500,
  maxPages: 3,
  windowDays: 7,
  verified: true as boolean, // 요청·응답 계약을 실제 응답으로 확인(2026-11-03). 발효 중 응답은 미관측 — 위 설명
} as const;

export class KmaWarningError extends Error {
  constructor(
    message: string,
    public readonly kind: WeatherErrorKind,
    public readonly code?: string,
  ) {
    super(message);
  }
}

/** 공식 표: warnVar·warningType */
export const WARN_VAR: Record<string, string> = { "1": "강풍", "2": "호우", "3": "한파", "4": "건조", "5": "폭풍해일", "6": "풍랑", "7": "태풍", "8": "대설", "9": "황사", "12": "폭염", "13": "열대야" };
export const WARN_STRESS: Record<string, string> = { "0": "주의보", "1": "경보", "2": "중대경보" };

export interface KmaWarningRow {
  areaCode: string;
  areaName: string;
  warnVar: string;
  warnStress: string | null;
  command: string | null;
  tmFc: Date;
  tmSeq: number;
  startTime: Date | null;
  endTime: Date | null;
  allEndTime: Date | null;
  cancelled: boolean;
  raw: unknown;
}

const text = (v: unknown): string => (typeof v === "string" ? v.trim() : typeof v === "number" ? String(v) : "");
const time = (v: unknown) => parseKstDateTime(text(v));

/** 결과 코드 → 오류 종류(공식 표). 0·00 정상, 3·03 자료 없음은 null */
export function kmaCodeKind(code: string): WeatherErrorKind | null {
  const n = Number(code);
  if (n === 0 || n === 3) return null;
  if ([20, 21, 30, 31, 32, 33].includes(n)) return "auth";
  if (n === 22) return "rate_limited";
  if ([10, 11, 12].includes(n)) return "params";
  if ([1, 2, 4, 5, 99].includes(n)) return "server";
  return "format";
}

/** 게이트웨이 XML 오류에서 숫자 코드만 꺼냄(DTD 거부, 원문을 기록에 넣지 않음) */
function throwFromXml(xml: string): never {
  const head = xml.slice(0, 20_000);
  if (/<!DOCTYPE|<!ENTITY/i.test(head)) throw new KmaWarningError("기상특보 응답(XML)에 DTD 선언이 있어 처리하지 않았습니다.", "format");
  const code = /<returnReasonCode>\s*(\d{1,3})\s*<\/returnReasonCode>/.exec(head)?.[1] ?? /<resultCode>\s*(\d{1,3})\s*<\/resultCode>/.exec(head)?.[1];
  if (!code) throw new KmaWarningError("기상특보 응답이 JSON이 아닙니다.", "format");
  const kind = kmaCodeKind(code);
  if (!kind) throw new KmaWarningError("기상특보가 JSON 요청에 XML로 응답했습니다.", "format");
  throw new KmaWarningError(`기상특보 결과 코드 ${code}`, kind, code);
}

export function parseKmaWarnings(raw: string): { rows: KmaWarningRow[]; rejected: number; total: number | null; received: number } {
  if (raw.trimStart().startsWith("<")) throwFromXml(raw);
  let data: unknown;
  try {
    data = JSON.parse(raw);
  } catch {
    throw new KmaWarningError("기상특보 응답을 해석할 수 없습니다.", "format");
  }
  const res = (data as { response?: { header?: { resultCode?: unknown }; body?: { items?: unknown; totalCount?: unknown } } } | null)?.response;
  if (!res || typeof res !== "object") throw new KmaWarningError("기상특보 응답에 response가 없습니다(형식 확인 필요).", "format");
  const code = text(res.header?.resultCode);
  if (!code) throw new KmaWarningError("기상특보 응답에 결과 코드가 없습니다(형식 확인 필요).", "format");
  const kind = kmaCodeKind(code);
  if (kind) throw new KmaWarningError(`기상특보 결과 코드 ${code.slice(0, 4)}`, kind, code);
  if (Number(code) === 3) return { rows: [], rejected: 0, total: 0, received: 0 };

  const items = res.body?.items;
  const item = items && typeof items === "object" ? (items as { item?: unknown }).item : undefined;
  const list: unknown[] = Array.isArray(item) ? item : item && typeof item === "object" ? [item] : [];
  const rows: KmaWarningRow[] = [];
  let rejected = 0;
  for (const r of list) {
    const o = (r ?? {}) as Record<string, unknown>;
    const tmFc = time(o.tmFc);
    const areaCode = text(o.areaCode);
    const areaName = text(o.areaName);
    const warnVar = text(o.warnVar);
    if (!tmFc || !areaCode || !areaName || !warnVar) {
      rejected++;
      continue;
    }
    rows.push({
      areaCode,
      areaName,
      warnVar,
      warnStress: text(o.warnStress) || null,
      command: text(o.command) || null,
      tmFc,
      tmSeq: Number(text(o.tmSeq)) || 0,
      startTime: time(o.startTime),
      endTime: time(o.endTime),
      allEndTime: time(o.allEndTime),
      cancelled: text(o.cancel) === "1",
      raw: o,
    });
  }
  if (list.length > 0 && rows.length === 0) throw new KmaWarningError("기상특보 항목의 형식이 예상과 다릅니다(필수 필드 없음).", "format");
  const total = Number(text(res.body?.totalCount));
  return { rows, rejected, total: Number.isFinite(total) ? total : null, received: list.length };
}

export interface KmaWarningState {
  key: string;
  areaCode: string;
  areaName: string;
  kind: string;
  level: string | null;
  status: WeatherWarningStatus;
  issuedAt: Date;
  effectiveAt: Date | null;
  releasedAt: Date | null;
}

/** 구역·종류·강도별 마지막 발표로 현재 상태를 정합니다(같은 발표의 중복 행은 하나로). 공식 코드: 1 발표·2 해제·3 연장·6 정정·7 변경발표·8 변경해제 */
export function summarizeWarnings(rows: KmaWarningRow[], now: Date): KmaWarningState[] {
  const groups = new Map<string, KmaWarningRow[]>();
  for (const r of rows) {
    const key = `${r.areaCode}|${r.warnVar}|${r.warnStress ?? ""}`;
    groups.set(key, [...(groups.get(key) ?? []), r]);
  }
  const out: KmaWarningState[] = [];
  for (const [key, list] of groups) {
    list.sort((a, b) => a.tmFc.getTime() - b.tmFc.getTime() || a.tmSeq - b.tmSeq);
    const last = list[list.length - 1]!;
    const effectiveAt = [...list].reverse().find((r) => r.startTime)?.startTime ?? null;
    const releasedBy = last.cancelled || last.command === "2" || last.command === "8" ? (last.endTime ?? last.allEndTime ?? last.tmFc) : last.allEndTime && last.allEndTime <= now ? last.allEndTime : null;
    let status: WeatherWarningStatus;
    if (releasedBy) status = "released";
    else if (!["1", "3", "6", "7"].includes(last.command ?? "")) status = "unknown";
    else status = effectiveAt && effectiveAt > now ? "scheduled" : "active";
    out.push({
      key,
      areaCode: last.areaCode,
      areaName: last.areaName,
      kind: WARN_VAR[last.warnVar] ?? `종류 코드 ${last.warnVar.slice(0, 4)}`,
      level: last.warnStress ? (WARN_STRESS[last.warnStress] ?? null) : null,
      status,
      issuedAt: last.tmFc,
      effectiveAt,
      releasedAt: releasedBy,
    });
  }
  const order: Record<WeatherWarningStatus, number> = { active: 0, unknown: 1, scheduled: 2, released: 3 };
  return out.sort((a, b) => order[a.status] - order[b.status] || b.issuedAt.getTime() - a.issuedAt.getTime());
}

// 구역 경계 근거: 기상청 보도자료 2026-05-12 '지역별 특보구역 세분화'(2026-06-01 시행)
//   인천영종 = 중구 운북·중산·운남·운서·을왕·남북·덕교·무의동 / 인천남부 = 동·미추홀·연수·남동구, 중구(영종 제외) / 인천북부 = 서·부평·계양구
//   백령도.대청도 = 옹진군 백령·대청면 / 연평도.우도 = 옹진군 연평면, 강화군 서도면 우도
// 2026-07-01 개편 이름: 영종구(옛 중구 영종), 제물포구(옛 중구 내륙·동구), 서해구·검단구(옛 서구). 실제 응답 구역명은 확인 전입니다.
const INCHEON_ZONE: Record<string, string> = {
  영종구: "L1110110",
  동구: "L1110120", 제물포구: "L1110120", 미추홀구: "L1110120", 연수구: "L1110120", 남동구: "L1110120",
  서구: "L1110130", 서해구: "L1110130", 검단구: "L1110130", 부평구: "L1110130", 계양구: "L1110130",
  강화군: "L1010900", 옹진군: "L1013600",
};
const INCHEON_WHOLE = ["L1110000", "L1110100"];
const INCHEON_MAINLAND = ["L1110110", "L1110120", "L1110130"];
const WEST_SEA = ["L1014000", "L1014200", "L1014300"]; // 서해5도·백령도.대청도·연평도.우도

/** 수집·저장 대상 구역 코드(전국 자료를 저장하지 않음) */
export const SUPPORTED_ZONE_CODES: ReadonlySet<string> = new Set([...INCHEON_WHOLE, ...INCHEON_MAINLAND, "L1010900", "L1013600", ...WEST_SEA]);

/** 학교 지역 → 특보구역. 주소가 시군구까지만이라 단정할 수 없는 구역은 undetermined(추측하지 않음) */
export function zonesForRegion(region: { sido: string; sigungu: string | null } | null): { target: Set<string>; undetermined: Set<string> } | null {
  if (region?.sido !== "인천광역시") return null;
  const target = new Set(INCHEON_WHOLE);
  const undetermined = new Set<string>();
  const zone = region.sigungu ? INCHEON_ZONE[region.sigungu] : undefined;
  if (zone) target.add(zone);
  if (region.sigungu === "옹진군") WEST_SEA.forEach((c) => undetermined.add(c));
  else if (region.sigungu === "강화군") ["L1014000", "L1014300"].forEach((c) => undetermined.add(c)); // 서도면 우도
  else if (region.sigungu === "중구") ["L1110110", "L1110120"].forEach((c) => undetermined.add(c)); // 개편 전 이름: 영종 여부를 알 수 없음
  else if (!zone) [...INCHEON_MAINLAND, "L1010900", "L1013600", ...WEST_SEA].forEach((c) => undetermined.add(c));
  return { target, undetermined };
}

/** getPwnStatus 특보발효현황 원문 중 인천 관련 구역이 언급된 줄(수정하지 않음). 7일보다 먼저 발표되어 이어지는 특보 확인용 */
const STATUS_KEYWORDS = /인천|강화|옹진|서해5도|백령|대청|연평|우도/;
export function parseKmaStatus(raw: string): { at: Date | null; lines: string[] } | null {
  if (raw.trimStart().startsWith("<")) throwFromXml(raw);
  let data: { response?: { header?: { resultCode?: unknown }; body?: { items?: unknown } } };
  try {
    data = JSON.parse(raw);
  } catch {
    throw new KmaWarningError("기상특보 현황 응답을 해석할 수 없습니다.", "format");
  }
  const code = text(data.response?.header?.resultCode);
  if (!code) throw new KmaWarningError("기상특보 현황 응답에 결과 코드가 없습니다(형식 확인 필요).", "format");
  const kind = kmaCodeKind(code);
  if (kind) throw new KmaWarningError(`기상특보 현황 결과 코드 ${code.slice(0, 4)}`, kind, code);
  const items = data.response?.body?.items;
  const item = items && typeof items === "object" ? (items as { item?: unknown }).item : undefined;
  const list = (Array.isArray(item) ? item : item ? [item] : []) as Record<string, unknown>[];
  const latest = list.map((o) => ({ o, t: time(o.tmFc) })).filter((x) => x.t).sort((a, b) => b.t!.getTime() - a.t!.getTime())[0];
  if (!latest) return null;
  const lines = text(latest.o.t6).split(/\s*(?=\bo\s)/).map((l) => l.trim()).filter((l) => STATUS_KEYWORDS.test(l)).map((l) => l.slice(0, 500));
  return { at: time(latest.o.tmEf) ?? latest.t, lines };
}

type FetchLike = (url: string, init: { signal: AbortSignal; headers: Record<string, string> }) => Promise<{ ok: boolean; status: number; text(): Promise<string> }>;

export interface KmaWarningClientOptions {
  serviceKey: string | undefined;
  fetchImpl?: FetchLike;
  timeoutMs?: number;
  cacheTtlMs?: number;
  failureBackoffMs?: number;
  now?: () => Date;
}

export interface KmaWarningSnapshot {
  rows: KmaWarningRow[];
  rejected: number;
  partial: boolean;
  fetchedAt: Date | null;
  error: KmaWarningError | null;
  status: { at: Date | null; lines: string[] } | null; // 특보 현황 원문. 조회 실패면 null(구역별 자료 표시에는 영향 없음)
}

export interface KmaWarningClient {
  latest(): Promise<KmaWarningSnapshot>;
}

export function buildKmaWarningUrl(serviceKey: string, pageNo: number, now: Date): string {
  // 포털이 주는 인코딩 키(% 포함)는 다시 인코딩하지 않음
  const key = serviceKey.includes("%") ? serviceKey : encodeURIComponent(serviceKey);
  const q = [`serviceKey=${key}`, `numOfRows=${KMA_WARNING_CONTRACT.numOfRows}`, `pageNo=${pageNo}`, "dataType=JSON", `fromTmFc=${kstYmd(now, KMA_WARNING_CONTRACT.windowDays - 1)}`, `toTmFc=${kstYmd(now)}`];
  return `${KMA_WARNING_CONTRACT.endpoint}?${q.join("&")}`;
}

export function buildKmaStatusUrl(serviceKey: string): string {
  const key = serviceKey.includes("%") ? serviceKey : encodeURIComponent(serviceKey);
  return `${KMA_WARNING_CONTRACT.statusEndpoint}?serviceKey=${key}&numOfRows=5&pageNo=1&dataType=JSON`;
}

/** 조회 결과를 짧게 캐시합니다. 실패하면 재시도하지 않고 마지막 정상 자료와 오류를 함께 돌려줍니다. */
export function createKmaWarningClient(options: KmaWarningClientOptions): KmaWarningClient {
  const key = options.serviceKey?.trim();
  const http = options.fetchImpl ?? (fetch as unknown as FetchLike);
  const timeoutMs = options.timeoutMs ?? 10_000;
  const ttl = options.cacheTtlMs ?? 270_000; // 수집 주기(기본 5분)보다 조금 짧게
  const backoff = options.failureBackoffMs ?? 60_000;
  const now = options.now ?? (() => new Date());
  let snapshot: KmaWarningSnapshot = { rows: [], rejected: 0, partial: false, fetchedAt: null, error: null, status: null };
  let lastAttempt = 0;
  let running: Promise<KmaWarningSnapshot> | null = null;

  const request = async (url: string) => {
    let res;
    try {
      res = await http(url, { signal: AbortSignal.timeout(timeoutMs), headers: { Accept: "application/json" } });
    } catch (error) {
      const name = (error as { name?: string })?.name;
      if (name === "TimeoutError" || name === "AbortError") throw new KmaWarningError("기상특보 응답 시간 초과", "timeout");
      throw new KmaWarningError("기상특보에 연결할 수 없습니다.", "network");
    }
    const body = await res.text().catch(() => "");
    if (body.trimStart().startsWith("<")) throwFromXml(body);
    if (res.status === 429) throw new KmaWarningError("기상특보 호출 한도 초과(HTTP 429)", "rate_limited");
    if (res.status === 401 || res.status === 403) throw new KmaWarningError(`기상특보 접근 거부(HTTP ${res.status})`, "auth");
    if (res.status >= 500) throw new KmaWarningError(`기상특보 서버 오류(HTTP ${res.status})`, "server");
    if (!res.ok) throw new KmaWarningError(`기상특보 응답 오류(HTTP ${res.status})`, "params");
    return body;
  };

  const refresh = async (): Promise<KmaWarningSnapshot> => {
    try {
      const rows: KmaWarningRow[] = [];
      let rejected = 0;
      let partial = false;
      for (let p = 1; ; p++) {
        const r = parseKmaWarnings(await request(buildKmaWarningUrl(key!, p, now())));
        rows.push(...r.rows);
        rejected += r.rejected;
        const seen = (p - 1) * KMA_WARNING_CONTRACT.numOfRows + r.received;
        const more = r.total !== null ? seen < r.total : r.received === KMA_WARNING_CONTRACT.numOfRows;
        if (!more || r.received === 0) break;
        if (p === KMA_WARNING_CONTRACT.maxPages) {
          partial = true;
          break;
        }
      }
      const status = await request(buildKmaStatusUrl(key!))
        .then(parseKmaStatus)
        .catch(() => null);
      snapshot = { rows, rejected, partial, fetchedAt: now(), error: null, status };
    } catch (error) {
      const safe = error instanceof KmaWarningError ? error : new KmaWarningError("기상특보 조회 중 알 수 없는 오류", "network");
      snapshot = { ...snapshot, error: safe };
    }
    return snapshot;
  };

  return {
    latest() {
      if (!key) return Promise.resolve(snapshot);
      if (running) return running;
      const age = now().getTime() - lastAttempt;
      if (lastAttempt && age < (snapshot.error ? backoff : ttl)) return Promise.resolve(snapshot);
      lastAttempt = now().getTime();
      running = refresh().finally(() => {
        running = null;
      });
      return running;
    },
  };
}
