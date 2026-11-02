// 기상청 기상특보 조회서비스(공공데이터포털 15000415) 특보코드조회 getPwnCd — 읽기 전용 어댑터(서버에서만 호출)
//
// 근거: 공식 활용가이드 '기상청21_기상특보 조회서비스_오픈API활용가이드_260601'(docx·특보구역코드 xlsx)
// - 요청: serviceKey, numOfRows, pageNo(필수), dataType, fromTmFc·toTmFc(년월일 8자리), areaCode, warningType, stnId(선택)
// - 응답: stnId, tmFc, tmSeq, areaCode, areaName, warnVar, warnStress, command, startTime, endTime, allEndTime, cancel
// - 오류 코드: 가이드 첨부 표. 03 은 자료 없음
// 확인 필요(실제 응답 전 — KMA_WARNING_CONTRACT.verified=false)
// - 가이드 예시는 XML뿐입니다. JSON 감싸는 구조 response.header/body.items.item 은 XML 예시와 같다고 가정합니다.
// - 상태 판단(마지막 발표 기준)은 코드 정의를 바탕으로 한 해석입니다.
// 원칙: 키가 없으면 호출하지 않음. 저장·학교 재난 발령·알림 없음. 키는 오류·로그·응답에 남기지 않음.
import { kstYmd, parseKstDateTime } from "../alerts/moisCbs.js";
import type { WeatherErrorKind, WeatherWarningStatus } from "../../../shared/weatherWarnings.js";

export const KMA_WARNING_CONTRACT = {
  endpoint: "https://apis.data.go.kr/1360000/WthrWrnInfoService/getPwnCd",
  source: "기상청 기상특보 조회서비스",
  numOfRows: 500,
  maxPages: 3,
  windowDays: 7,
  verified: false as boolean, // 실제 응답으로 확인하면 true 로 바꾸고 docs/integrations 에 기록
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
const WARN_VAR: Record<string, string> = { "1": "강풍", "2": "호우", "3": "한파", "4": "건조", "5": "폭풍해일", "6": "풍랑", "7": "태풍", "8": "대설", "9": "황사", "12": "폭염", "13": "열대야" };
const WARN_STRESS: Record<string, string> = { "0": "주의보", "1": "경보", "2": "중대경보" };

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

/** 특보구역 코드는 공식 코드표 기준. 학교 지역 → 구역. 시군구와 인천남부·북부의 경계는 공식 자료에 없어 '미판정'으로 둡니다. */
export function zonesForRegion(region: { sido: string; sigungu: string | null } | null): { target: Set<string>; undetermined: Set<string> } | null {
  if (region?.sido !== "인천광역시") return null;
  const target = new Set(["L1110000", "L1110100"]); // 인천 전체
  const undetermined = new Set<string>();
  const add = (set: Set<string>, ...codes: string[]) => codes.forEach((c) => set.add(c));
  const WEST_SEA = ["L1014000", "L1014200", "L1014300"]; // 서해5도·백령도.대청도·연평도.우도
  switch (region.sigungu) {
    case "영종구":
      add(target, "L1110110");
      break;
    case "강화군":
      add(target, "L1010900");
      break;
    case "옹진군":
      add(target, "L1013600");
      add(undetermined, ...WEST_SEA);
      break;
    case "중구": // 개편 전 이름: 영종 포함 여부를 주소만으로 알 수 없음
      add(undetermined, "L1110110", "L1110120", "L1110130");
      break;
    case null:
      add(undetermined, "L1110110", "L1110120", "L1110130", "L1010900", "L1013600", ...WEST_SEA);
      break;
    default:
      add(undetermined, "L1110120", "L1110130"); // 인천남부·인천북부
  }
  return { target, undetermined };
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

/** 조회 결과를 짧게 캐시합니다. 실패하면 재시도하지 않고 마지막 정상 자료와 오류를 함께 돌려줍니다. */
export function createKmaWarningClient(options: KmaWarningClientOptions): KmaWarningClient {
  const key = options.serviceKey?.trim();
  const http = options.fetchImpl ?? (fetch as unknown as FetchLike);
  const timeoutMs = options.timeoutMs ?? 10_000;
  const ttl = options.cacheTtlMs ?? 5 * 60_000;
  const backoff = options.failureBackoffMs ?? 60_000;
  const now = options.now ?? (() => new Date());
  let snapshot: KmaWarningSnapshot = { rows: [], rejected: 0, partial: false, fetchedAt: null, error: null };
  let lastAttempt = 0;
  let running: Promise<KmaWarningSnapshot> | null = null;

  const page = async (pageNo: number) => {
    let res;
    try {
      res = await http(buildKmaWarningUrl(key!, pageNo, now()), { signal: AbortSignal.timeout(timeoutMs), headers: { Accept: "application/json" } });
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
    return parseKmaWarnings(body);
  };

  const refresh = async (): Promise<KmaWarningSnapshot> => {
    try {
      const rows: KmaWarningRow[] = [];
      let rejected = 0;
      let partial = false;
      for (let p = 1; ; p++) {
        const r = await page(p);
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
      snapshot = { rows, rejected, partial, fetchedAt: now(), error: null };
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
