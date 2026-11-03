// STEP A P0-3 나이스 교육정보 개방 포털 어댑터 — 가짜 HTTP 응답만 사용(실제 호출 없음, '연동 코드 준비' 단계)
import { describe, expect, it } from "vitest";
import {
  buildSchoolInfoUrl,
  createNeisClient,
  matchNeisCandidates,
  NEIS_CONTRACT,
  NeisError,
  neisCodeKind,
  parseSchoolInfoResponse,
  redactNeisKey,
  type NeisSchool,
} from "../server/src/integrations/neis";

type Resp = { ok: boolean; status: number; json(): Promise<unknown> };
const reply = (status: number, body: unknown): Resp => ({ ok: status >= 200 && status < 300, status, json: async () => body });
const row = (over: Record<string, unknown> = {}) => ({
  ATPT_OFCDC_SC_CODE: "X10",
  ATPT_OFCDC_SC_NM: "가상광역시교육청",
  SD_SCHUL_CODE: "9990001",
  SCHUL_NM: "가상안전초등학교",
  SCHUL_KND_SC_NM: "초등학교",
  LCTN_SC_NM: "가상광역시",
  JU_ORG_NM: "가상교육지원청",
  FOND_SC_NM: "공립",
  ORG_RDNMA: "가상광역시 안전로 1",
  LOAD_DTM: "20260301",
  ...over,
});
const ok = (rows: unknown[], code = "INFO-000") => ({
  schoolInfo: [{ head: [{ list_total_count: rows.length }, { RESULT: { CODE: code, MESSAGE: "정상 처리되었습니다." } }] }, { row: rows }],
});
const KEY = "test-neis-key-not-real";
const client = (http: (url: string) => Promise<Resp>, extra: Partial<Parameters<typeof createNeisClient>[0]> = {}) => {
  const calls: string[] = [];
  const c = createNeisClient({
    apiKey: KEY,
    fetchImpl: async (url) => (calls.push(url), http(url)),
    sleep: async () => {},
    minIntervalMs: 0,
    ...extra,
  });
  return { c, calls };
};

describe("공식 명세 반영", () => {
  it("요청 주소: /hub/schoolInfo, Type=json, pSize 최대 1,000, 학교명은 SCHUL_NM, 키는 KEY", () => {
    const u = new URL(buildSchoolInfoUrl({ name: "가상 초", officeCode: "X10" }, 1, 5000, "k&v"));
    expect(`${u.origin}${u.pathname}`).toBe("https://open.neis.go.kr/hub/schoolInfo");
    expect(Object.fromEntries(u.searchParams)).toEqual({ KEY: "k&v", Type: "json", pIndex: "1", pSize: "1000", ATPT_OFCDC_SC_CODE: "X10", SCHUL_NM: "가상 초" });
    expect(NEIS_CONTRACT.verified).toBe(true); // 정상 응답 구조 확인(2026-11-03). 행 제외 원인은 별개
  });
  it.each([
    ["INFO-000", null],
    ["INFO-200", null],
    ["ERROR-290", "auth"],
    ["INFO-300", "auth"],
    ["ERROR-337", "rate_limited"],
    ["ERROR-500", "server"],
    ["ERROR-600", "server"],
    ["ERROR-336", "params"],
    ["ERROR-999", "format"],
  ])("결과 코드 %s → %s", (code, kind) => {
    expect(neisCodeKind(code)).toBe(kind);
  });
});

describe("응답 해석·검증", () => {
  it("정상 응답 → 학교 목록(필요 필드만 정리)", () => {
    const r = parseSchoolInfoResponse(ok([row()]));
    expect(r.total).toBe(1);
    expect(r.schools[0]).toEqual({
      officeCode: "X10", officeName: "가상광역시교육청", schoolCode: "9990001", name: "가상안전초등학교", kindName: "초등학교",
      sidoName: "가상광역시", jurisdiction: "가상교육지원청", foundation: "공립", address: "가상광역시 안전로 1", updatedAt: "20260301",
    });
  });
  it("자료 없음(INFO-200) → 빈 목록(오류 아님)", () => {
    expect(parseSchoolInfoResponse({ RESULT: { CODE: "INFO-200", MESSAGE: "해당하는 데이터가 없습니다." } }).schools).toEqual([]);
  });
  it("필수 필드 없는 행은 버리고 건수만", () => {
    const r = parseSchoolInfoResponse(ok([row(), { SCHUL_NM: "코드 없음" }]));
    expect([r.schools.length, r.rejected]).toEqual([1, 1]);
  });
  it.each([
    ["schoolInfo 없음", { other: [] }],
    ["head·row 없음", { schoolInfo: [{ foo: 1 }] }],
    ["행이 모두 형식 불일치", ok([{ NAME: "바뀐 필드" }])],
    ["JSON 객체 아님", "text"],
  ])("응답 형식 변경(%s) → format", (_n, body) => {
    expect(() => parseSchoolInfoResponse(body)).toThrowError(expect.objectContaining({ kind: "format" }));
  });
});

describe("호출·오류 처리(가짜 HTTP)", () => {
  it("Accept 헤더를 보내지 않음(키 없는 요청 실측: Accept: application/json 이면 HTTP 500)", async () => {
    const seen: unknown[] = [];
    const c = createNeisClient({
      apiKey: "test-key-not-real",
      fetchImpl: async (_u, init) => {
        seen.push((init as { headers?: unknown }).headers);
        return reply(200, ok([row()]));
      },
    });
    await c.searchSchools({ officeCode: "E10" });
    expect(seen).toHaveLength(1);
    expect(Object.keys((seen[0] ?? {}) as object).map((h) => h.toLowerCase())).not.toContain("accept");
  });
  it("인증키 없음 → 호출하지 않고 not_configured(샘플 5건을 실제로 오인하지 않음)", async () => {
    const calls: string[] = [];
    const c = createNeisClient({ apiKey: "  ", fetchImpl: async (u) => (calls.push(u), reply(200, ok([row()]))) });
    await expect(c.searchSchools({ name: "가상" })).rejects.toMatchObject({ kind: "not_configured" });
    expect(calls).toHaveLength(0);
  });
  it("정상 → 결과, 같은 요청은 캐시(두 번째는 호출 안 함)", async () => {
    const { c, calls } = client(async () => reply(200, ok([row()])));
    const a = await c.searchSchools({ name: "가상안전초등학교" });
    const b = await c.searchSchools({ name: "가상안전초등학교" });
    expect([a.cached, b.cached, calls.length]).toEqual([false, true, 1]);
    expect(b.schools[0]!.schoolCode).toBe("9990001");
  });
  it("캐시 시간이 지나면 다시 호출", async () => {
    let t = Date.UTC(2026, 9, 27, 1);
    const { c, calls } = client(async () => reply(200, ok([row()])), { now: () => new Date(t), cacheTtlMs: 1000 });
    await c.searchSchools({ name: "가" });
    t += 2000;
    await c.searchSchools({ name: "가" });
    expect(calls).toHaveLength(2);
  });
  it("인증 오류(ERROR-290) → auth, 재시도 안 함", async () => {
    const { c, calls } = client(async () => reply(200, { RESULT: { CODE: "ERROR-290", MESSAGE: "인증키가 유효하지 않습니다." } }));
    await expect(c.searchSchools({ name: "가" })).rejects.toMatchObject({ kind: "auth", code: "ERROR-290" });
    expect(calls).toHaveLength(1);
  });
  it("일별 트래픽 초과(ERROR-337) → rate_limited, 재시도 안 함", async () => {
    const { c, calls } = client(async () => reply(200, { RESULT: { CODE: "ERROR-337", MESSAGE: "일별 트래픽 제한" } }));
    await expect(c.searchSchools({ name: "가" })).rejects.toMatchObject({ kind: "rate_limited" });
    expect(calls).toHaveLength(1);
  });
  it("제공기관 5xx → 1회 재시도 후 server", async () => {
    const { c, calls } = client(async () => reply(503, {}));
    await expect(c.searchSchools({ name: "가" })).rejects.toMatchObject({ kind: "server" });
    expect(calls).toHaveLength(2);
  });
  it("응답 없음(시간 초과) → 재시도 후 timeout", async () => {
    const { c, calls } = client(async () => {
      throw new DOMException("The operation was aborted due to timeout", "TimeoutError");
    });
    await expect(c.searchSchools({ name: "가" })).rejects.toMatchObject({ kind: "timeout" });
    expect(calls).toHaveLength(2);
  });
  it("실제 시간 제한 동작(응답이 오지 않으면 timeoutMs 뒤 실패)", async () => {
    const c = createNeisClient({
      apiKey: KEY, timeoutMs: 50, retries: 0, minIntervalMs: 0,
      fetchImpl: (_u, init) => new Promise((_r, reject) => init.signal.addEventListener("abort", () => reject(init.signal.reason))),
    });
    await expect(c.searchSchools({ name: "가" })).rejects.toMatchObject({ kind: "timeout" });
  });
  it("연결 실패 → network, HTTP 429 → rate_limited, HTTP 404 → http", async () => {
    await expect(client(async () => { throw new TypeError("fetch failed"); }).c.searchSchools({ name: "가" })).rejects.toMatchObject({ kind: "network" });
    await expect(client(async () => reply(429, {})).c.searchSchools({ name: "가" })).rejects.toMatchObject({ kind: "rate_limited" });
    await expect(client(async () => reply(404, {})).c.searchSchools({ name: "가" })).rejects.toMatchObject({ kind: "http" });
  });
  it("이 서버의 하루 호출 상한에 닿으면 더 부르지 않음(한국 날짜가 바뀌면 다시)", async () => {
    let t = Date.UTC(2026, 9, 27, 1); // KST 10:00
    const { c, calls } = client(async () => reply(200, ok([row()])), { dailyLimit: 2, cacheTtlMs: 0, now: () => new Date(t) });
    await c.searchSchools({ name: "가" });
    await c.searchSchools({ name: "나" });
    await expect(c.searchSchools({ name: "다" })).rejects.toMatchObject({ kind: "rate_limited" });
    expect(calls).toHaveLength(2);
    t += 15 * 3600_000; // 다음 날 KST 01:00
    await c.searchSchools({ name: "다" });
    expect(c.usage()).toMatchObject({ calls: 1, limit: 2 });
  });
  it("조회 조건 없으면 호출 안 함(params)", async () => {
    const { c, calls } = client(async () => reply(200, ok([])));
    await expect(c.searchSchools({})).rejects.toMatchObject({ kind: "params" });
    expect(calls).toHaveLength(0);
  });
  it("오류 문장에 인증키가 남지 않음", async () => {
    expect(redactNeisKey(`fail ${buildSchoolInfoUrl({ name: "가" }, 1, 10, "SECRET-123")}`)).not.toContain("SECRET-123");
    const { c } = client(async () => reply(200, { RESULT: { CODE: "ERROR-290", MESSAGE: `bad KEY=${KEY}` } }));
    const err = await c.searchSchools({ name: "가" }).catch((e: NeisError) => e);
    expect(String((err as NeisError).message)).not.toContain(KEY);
  });
  it("요청에는 학교명·교육청·학교 코드만(개인정보 항목 없음)", async () => {
    const { c, calls } = client(async () => reply(200, ok([row()])));
    await c.searchSchools({ name: "가상안전초등학교", officeCode: "X10" });
    expect([...new URL(calls[0]!).searchParams.keys()].sort()).toEqual(["ATPT_OFCDC_SC_CODE", "KEY", "SCHUL_NM", "Type", "pIndex", "pSize"]);
  });
});

describe("학교알리미 학교 ↔ 나이스 학교 후보(자동 연결 없음)", () => {
  const n = (over: Partial<NeisSchool>): NeisSchool => ({
    officeCode: "X10", officeName: "가상광역시교육청", schoolCode: "1", name: "가상안전초등학교", kindName: null, sidoName: null,
    jurisdiction: null, foundation: null, address: "가상광역시 안전로 1", updatedAt: null, ...over,
  });
  it("이름·교육청·주소가 모두 같으면 high, 이름만 다르면 후보 아님", () => {
    const r = matchNeisCandidates({ name: "가상안전 초등학교", eduOfficeName: "가상광역시교육청", address: "가상광역시 안전로 1" }, [
      n({ schoolCode: "A" }),
      n({ schoolCode: "B", address: "다른 주소" }),
      n({ schoolCode: "C", name: "다른초등학교" }),
    ]);
    expect(r.map((m) => [m.candidate.schoolCode, m.confidence])).toEqual([["A", "high"], ["B", "medium"]]);
  });
});
