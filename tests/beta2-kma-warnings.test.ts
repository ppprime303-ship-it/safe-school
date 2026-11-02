// 기상특보 어댑터·학교 필터·API(가짜 응답, 실제 외부 호출 없음). 필드와 값은 공식 활용가이드 getPwnCd 예시·코드표 기준
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { createServer, type Server } from "node:http";
import type { AddressInfo } from "node:net";
import type { PrismaClient } from "@prisma/client";
import { createTestClient, getTestDatabaseUrl, resetTestData } from "./test-db";
import { createSession, SESSION_COOKIE } from "../server/src/auth/session";
import { buildKmaWarningUrl, createKmaWarningClient, KmaWarningError, kmaCodeKind, parseKmaWarnings, summarizeWarnings, zonesForRegion } from "../server/src/integrations/kmaWarnings";
import { getSchoolWeatherWarnings, WEATHER_STALE_MS } from "../server/src/services/weatherWarnings";

const KEY = "test-key-not-real";
const NOW = new Date("2026-11-02T03:00:00Z"); // 한국 12:00
const ok = (items: unknown[], total = items.length) => JSON.stringify({ response: { header: { resultCode: "00", resultMsg: "NORMAL_SERVICE" }, body: { dataType: "JSON", items: { item: items }, pageNo: 1, numOfRows: 500, totalCount: total } } });
const row = (o: Record<string, unknown> = {}) => ({ stnId: "109", tmFc: "202611020700", tmSeq: "5", areaCode: "L1110110", areaName: "인천영종", warnVar: "1", warnStress: "0", command: "1", startTime: "202611020800", cancel: "0", ...o });
const reply = (body: string, status = 200) => async () => ({ ok: status < 300, status, text: async () => body });
const client = (body: string, status = 200) => createKmaWarningClient({ serviceKey: KEY, fetchImpl: reply(body, status), now: () => NOW });
const state = (rows: unknown[]) => summarizeWarnings(parseKmaWarnings(ok(rows)).rows, NOW);

describe("공식 응답 해석", () => {
  it("요청 주소: 공식 서비스·필수 인자, 인코딩된 키는 다시 인코딩하지 않음", () => {
    const u = buildKmaWarningUrl("a%2Fb", 2, NOW);
    expect(u.startsWith("https://apis.data.go.kr/1360000/WthrWrnInfoService/getPwnCd?serviceKey=a%2Fb&")).toBe(true);
    expect(u).toContain("numOfRows=500&pageNo=2&dataType=JSON&fromTmFc=20261027&toTmFc=20261102");
    expect(buildKmaWarningUrl("a/b", 1, NOW)).toContain("serviceKey=a%2Fb&");
  });
  it("가이드 예시 값(해제)을 해석하고 항목 하나도 처리", () => {
    const body = JSON.stringify({ response: { header: { resultCode: "00" }, body: { items: { item: { allEndTime: "201706070900", areaCode: "S1322200", areaName: "남해서부동쪽먼바다", cancel: 0, command: 2, endTime: 201706070900, stnId: 108, tmFc: 201706070730, tmSeq: 28, warnStress: 0, warnVar: 6 } }, totalCount: 1 } } });
    const p = parseKmaWarnings(body);
    expect(p.rows).toHaveLength(1);
    const [s] = summarizeWarnings(p.rows, NOW);
    expect(s).toMatchObject({ kind: "풍랑", level: "주의보", status: "released" });
    expect(s!.issuedAt.toISOString()).toBe("2017-06-06T22:30:00.000Z");
  });
  it("특보 없음: 코드 03과 빈 items는 오류가 아님", () => {
    expect(parseKmaWarnings(JSON.stringify({ response: { header: { resultCode: "03" } } })).rows).toEqual([]);
    expect(parseKmaWarnings(JSON.stringify({ response: { header: { resultCode: "00" }, body: { items: "", totalCount: 0 } } })).rows).toEqual([]);
  });
  it.each([
    ["30", "auth"], ["31", "auth"], ["32", "auth"], ["22", "rate_limited"], ["10", "params"], ["99", "server"], ["77", "format"],
  ])("오류 코드 %s → %s", (c, k) => expect(kmaCodeKind(c)).toBe(k));
  it("필수 필드 없는 항목은 버리고, 모두 없으면 형식 오류. 구조가 다르면 형식 오류", () => {
    expect(parseKmaWarnings(ok([row(), { areaCode: "X" }])).rejected).toBe(1);
    expect(() => parseKmaWarnings(ok([{ areaCode: "X" }]))).toThrow(KmaWarningError);
    expect(() => parseKmaWarnings("{}")).toThrow(/response/);
    expect(() => parseKmaWarnings("not json")).toThrow(KmaWarningError);
  });
  it("게이트웨이 XML: 코드만 분류, DTD 거부, 원문 미포함", () => {
    const xml = `<OpenAPI_ServiceResponse><cmmMsgHeader><returnAuthMsg>SERVICE_KEY_IS_NOT_REGISTERED_ERROR</returnAuthMsg><returnReasonCode>30</returnReasonCode><errMsg>${KEY}</errMsg></cmmMsgHeader></OpenAPI_ServiceResponse>`;
    try {
      parseKmaWarnings(xml);
      expect.unreachable();
    } catch (e) {
      expect((e as KmaWarningError).kind).toBe("auth");
      expect((e as Error).message).not.toContain(KEY);
    }
    expect(() => parseKmaWarnings(`<!DOCTYPE x [<!ENTITY a "b">]><r/>`)).toThrow(/DTD/);
  });
});

describe("발표·발효·해제 상태", () => {
  it("발표 후 발효 중, 발효 전이면 예정", () => {
    expect(state([row()])[0]!.status).toBe("active");
    expect(state([row({ startTime: "202611021800" })])[0]!.status).toBe("scheduled");
    expect(state([row()])[0]!.effectiveAt!.toISOString()).toBe("2026-11-01T23:00:00.000Z");
  });
  it("같은 구역·종류·강도는 마지막 발표 기준: 해제·변경해제·취소는 해제", () => {
    for (const last of [{ command: "2", endTime: "202611021000" }, { command: "8", endTime: "202611021000" }, { command: "1", cancel: "1" }]) {
      const [s] = state([row(), row({ tmFc: "202611020900", tmSeq: "6", startTime: undefined, ...last })]);
      expect(s!.status).toBe("released");
    }
    expect(state([row({ tmFc: "202611020900", tmSeq: "6", command: "2", endTime: "202611021000", startTime: undefined }), row()])[0]!.status).toBe("released");
  });
  it("연장은 발효 유지, 강도 변경은 별개, 전체해제 시각이 지나면 해제, 모르는 코드는 단정하지 않음", () => {
    expect(state([row(), row({ tmFc: "202611020900", tmSeq: "6", command: "3", startTime: undefined })])[0]!.status).toBe("active");
    const change = state([row({ tmFc: "202611020900", command: "8", endTime: "202611020900" }), row({ tmFc: "202611020900", warnStress: "1", command: "7", startTime: "202611020900" })]);
    expect(change.map((w) => [w.level, w.status])).toEqual([["경보", "active"], ["주의보", "released"]]);
    expect(state([row({ allEndTime: "202611021100" })])[0]!.status).toBe("released");
    expect(state([row({ command: "9" })])[0]!.status).toBe("unknown");
    expect(state([row({ warnVar: "99" })])[0]!.kind).toBe("종류 코드 99");
  });
  it("중복 행은 하나로", () => {
    expect(state([row(), row()])).toHaveLength(1);
  });
});

describe("학교 지역 구역", () => {
  it("영종구는 인천영종이 대상, 인천남부·북부는 제외", () => {
    const z = zonesForRegion({ sido: "인천광역시", sigungu: "영종구" })!;
    expect(z.target.has("L1110110")).toBe(true);
    expect(z.target.has("L1110000")).toBe(true);
    expect(z.target.has("L1110120") || z.undetermined.has("L1110120")).toBe(false);
  });
  it("연수구는 인천남부, 옛 중구는 단정하지 않음, 강화·옹진은 자체 구역", () => {
    const z = zonesForRegion({ sido: "인천광역시", sigungu: "연수구" })!;
    expect(z.target.has("L1110120")).toBe(true);
    expect(z.target.has("L1110130") || z.undetermined.has("L1110130")).toBe(false);
    expect(zonesForRegion({ sido: "인천광역시", sigungu: "중구" })!.undetermined.has("L1110120")).toBe(true);
    expect(zonesForRegion({ sido: "인천광역시", sigungu: "강화군" })!.target.has("L1010900")).toBe(true);
    expect(zonesForRegion({ sido: "인천광역시", sigungu: "옹진군" })!.target.has("L1013600")).toBe(true);
  });
  it("그 밖의 시도·소재지 없음은 연결 안 됨", () => {
    expect(zonesForRegion({ sido: "경기도", sigungu: "수원시" })).toBeNull();
    expect(zonesForRegion(null)).toBeNull();
  });
});

describe("조회 클라이언트", () => {
  it("키가 없으면 호출하지 않음", async () => {
    let calls = 0;
    const c = createKmaWarningClient({ serviceKey: " ", fetchImpl: async () => { calls++; throw new Error("no"); } });
    await c.latest();
    expect(calls).toBe(0);
  });
  it("캐시 시간 안에는 다시 호출하지 않음, 지나면 호출", async () => {
    let calls = 0;
    let t = NOW.getTime();
    const c = createKmaWarningClient({ serviceKey: KEY, now: () => new Date(t), fetchImpl: async (u) => { if (u.includes("getPwnCd")) calls++; return { ok: true, status: 200, text: async () => ok([row()]) }; } });
    await c.latest();
    await c.latest();
    expect(calls).toBe(1);
    t += 6 * 60_000;
    await c.latest();
    expect(calls).toBe(2);
  });
  it("여러 쪽을 받고, 상한을 넘으면 일부 표시", async () => {
    const seen: string[] = [];
    const c = createKmaWarningClient({ serviceKey: KEY, now: () => NOW, fetchImpl: async (u) => { if (u.includes("getPwnCd")) seen.push(/pageNo=(\d+)/.exec(u)![1]!); return { ok: true, status: 200, text: async () => ok(Array.from({ length: 500 }, () => row()), 2000) }; } });
    const s = await c.latest();
    expect(seen).toEqual(["1", "2", "3"]);
    expect(s.partial).toBe(true);
  });
  it.each([
    [() => Promise.reject(Object.assign(new Error(`bad ${KEY}`), { name: "TimeoutError" })), "timeout"],
    [() => Promise.reject(new Error(`fetch failed serviceKey=${KEY}`)), "network"],
    [reply("{}", 500), "server"],
    [reply("{}", 403), "auth"],
    [reply(JSON.stringify({ response: { header: { resultCode: "30" } } })), "auth"],
    [reply(JSON.stringify({ response: { header: { resultCode: "22" } } })), "rate_limited"],
  ])("실패 %#: 종류 분류, 재시도 없음, 메시지에 키 없음", async (impl, kind) => {
    let calls = 0;
    const c = createKmaWarningClient({ serviceKey: KEY, now: () => NOW, fetchImpl: (async () => { calls++; return (impl as () => Promise<never>)(); }) as never });
    const s = await c.latest();
    expect(s.error?.kind).toBe(kind);
    expect(s.error?.message).not.toContain(KEY);
    expect(calls).toBe(1);
    await c.latest();
    expect(calls).toBe(1); // 실패 후 잠시 재호출 안 함
  });
  it("실패하면 마지막 정상 자료를 유지", async () => {
    let t = NOW.getTime();
    let fail = false;
    const c = createKmaWarningClient({ serviceKey: KEY, now: () => new Date(t), fetchImpl: async () => { if (fail) throw new Error("x"); return { ok: true, status: 200, text: async () => ok([row()]) }; } });
    await c.latest();
    fail = true;
    t += 6 * 60_000;
    const s = await c.latest();
    expect(s.rows).toHaveLength(1);
    expect(s.fetchedAt!.getTime()).toBe(NOW.getTime());
    expect(s.error?.kind).toBe("network");
  });
});

describe("학교별 표시(테스트 DB)", () => {
  let prisma: PrismaClient;
  let school: string;
  const make = async (address: string | null) => (await prisma.school.create({ data: { slug: `kma-${Date.now()}-${Math.floor(Math.random() * 1e6)}`, name: "가상 기상학교", isDemo: true, status: "active", activatedAt: new Date(), address } })).id;

  beforeAll(() => {
    process.env.DATABASE_URL = getTestDatabaseUrl();
    prisma = createTestClient();
  });
  beforeEach(async () => {
    await resetTestData(prisma);
    school = await make("인천광역시 영종구 가상로 1");
  });
  afterAll(async () => {
    await prisma.$disconnect();
  });

  it("키 없음: 연결 안 됨으로 표시, 호출 없음", async () => {
    const r = await getSchoolWeatherWarnings(prisma, school, null, NOW);
    expect(r).toMatchObject({ state: "not_configured", contractVerified: false, warnings: [], region: { sido: "인천광역시", sigungu: "영종구" } });
  });
  it("지역 불일치 구역은 빠지고 대상만, 조회 시각·출처 포함, 키·재난 사건 없음", async () => {
    const before = await prisma.disasterEvent.count();
    const r = await getSchoolWeatherWarnings(prisma, school, client(ok([row(), row({ areaCode: "L1110120", areaName: "인천남부" }), row({ areaCode: "L1010400", areaName: "안산" })])), NOW);
    expect(r.warnings.map((w) => w.areaName)).toEqual(["인천영종"]);
    expect(r).toMatchObject({ state: "ok", stale: false, source: "기상청 기상특보 조회서비스", fetchedAt: NOW.toISOString() });
    expect(JSON.stringify(r)).not.toContain(KEY);
    expect(await prisma.disasterEvent.count()).toBe(before);
  });
  it("경계 미확정 구는 미판정으로 표시", async () => {
    const id = await make("인천광역시 중구 가상로 2");
    const r = await getSchoolWeatherWarnings(prisma, id, client(ok([row({ areaCode: "L1110120", areaName: "인천남부" }), row({ areaCode: "L1110100", areaName: "인천" })])), NOW);
    expect(Object.fromEntries(r.warnings.map((w) => [w.areaName, w.relevance]))).toEqual({ 인천남부: "undetermined", 인천: "target" });
  });
  it("지원 안 되는 지역은 자료를 보여 주지 않음", async () => {
    const id = await make("경기도 수원시 장안구 가상로 3");
    const r = await getSchoolWeatherWarnings(prisma, id, client(ok([row()])), NOW);
    expect(r).toMatchObject({ regionSupported: false, warnings: [] });
  });
  it("첫 조회 실패는 failing(특보 없음과 구분), 인증 실패 종류 전달", async () => {
    const r = await getSchoolWeatherWarnings(prisma, school, client(JSON.stringify({ response: { header: { resultCode: "30" } } })), NOW);
    expect(r).toMatchObject({ state: "failing", errorKind: "auth", fetchedAt: null, warnings: [] });
  });
  it("오래된 자료는 stale 표시", async () => {
    const c = client(ok([row()]));
    await c.latest();
    const r = await getSchoolWeatherWarnings(prisma, school, c, new Date(NOW.getTime() + WEATHER_STALE_MS + 1000));
    expect(r.stale).toBe(true);
    expect((await getSchoolWeatherWarnings(prisma, school, c, NOW)).stale).toBe(false);
  });
});

describe("API", () => {
  let prisma: PrismaClient;
  let server: Server;
  let base: string;
  beforeAll(async () => {
    process.env.DATABASE_URL = getTestDatabaseUrl();
    delete process.env.KMA_WARNING_SERVICE_KEY;
    prisma = createTestClient();
    const { createApp } = await import("../server/src/app");
    const app = await createApp({ mode: "test" });
    server = createServer(app);
    await new Promise<void>((r) => server.listen(0, "127.0.0.1", () => r()));
    base = `http://127.0.0.1:${(server.address() as AddressInfo).port}/api`;
    await resetTestData(prisma);
  });
  afterAll(async () => {
    await new Promise((r) => server.close(r));
    await prisma.$disconnect();
  });
  const session = async (key: string) => {
    const user = await prisma.user.create({ data: { email: `${key}-${Date.now()}@check.safeschool.invalid`, displayName: `가상 ${key}`, passwordHash: "x", emailVerifiedAt: new Date() } });
    return { user, cookie: `${SESSION_COOKIE}=${(await createSession(prisma, { userId: user.id, deviceKind: "personal" })).token}` };
  };
  it("비로그인 401, 다른 학교 사용자 거부, 소속 교직원은 키 없이 not_configured", async () => {
    const school = await prisma.school.create({ data: { slug: `kma-api-${Date.now()}`, name: "가상 기상학교", isDemo: true, status: "active", activatedAt: new Date(), address: "인천광역시 영종구 가상로 1" } });
    const url = `${base}/schools/${school.id}/weather-warnings`;
    expect((await fetch(url)).status).toBe(401);
    const outsider = await session("outsider");
    expect((await fetch(url, { headers: { cookie: outsider.cookie } })).status).toBeGreaterThanOrEqual(403);
    const member = await session("member");
    await prisma.schoolMembership.create({ data: { schoolId: school.id, userId: member.user.id, role: "staff", status: "approved", approvalMethod: "roster", approvedAt: new Date() } });
    const res = await fetch(url, { headers: { cookie: member.cookie } });
    expect(res.status).toBe(200);
    expect(await res.json()).toMatchObject({ state: "not_configured", warnings: [] });
  });
});
