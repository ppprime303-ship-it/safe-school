// STEP A P0-1 경보 수집 상태(경보함): 공식/모의 구분, 한 번도 성공 못 함·실패·지연·정상, 외부 API 장애 중 재난 대응 유지
// 공식 공급자는 실제 어댑터(MoisCbsSource)에 가짜 HTTP 응답을 넣어 확인합니다(실제 외부 호출 없음).
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from "vitest";
import type { Server } from "node:http";
import type { PrismaClient } from "@prisma/client";
import { createTestClient, getTestDatabaseUrl, resetTestData } from "./test-db";
import { collectOnce } from "../server/src/alerts/collector";
import { MockAlertSource } from "../server/src/alerts/providers";
import { MoisCbsSource } from "../server/src/alerts/moisCbs";
import { classifyFeedError, getAlertFeedStatus, setConfiguredAlertSources, staleAfterMs } from "../server/src/alerts/feedStatus";
import { closeEvent, getBoard, issueEvent, submitReport } from "../server/src/services/events";

let prisma: PrismaClient;
const MIN = 60_000;
const OFFICIAL = { provider: "mois_cbs" as const, isMock: false, intervalMs: 5 * MIN };
const MOCK = { provider: "mock" as const, isMock: true, intervalMs: MIN };
const noSleep = { minIntervalMs: 0, sleep: async () => {} };

type Resp = { ok: boolean; status: number; json(): Promise<unknown> };
const reply = (status: number, body: unknown): Resp => ({ ok: status >= 200 && status < 300, status, json: async () => body });
const nowKst = () => {
  const k = new Date(Date.now() + 9 * 3600_000);
  const p = (n: number) => String(n).padStart(2, "0");
  return `${k.getUTCFullYear()}/${p(k.getUTCMonth() + 1)}/${p(k.getUTCDate())} ${p(k.getUTCHours())}:${p(k.getUTCMinutes())}:00`;
};
const cbs = (sn: number) => ({ SN: sn, CRT_DT: nowKst(), MSG_CN: "[가상 시험] 인천 남동구 호우 대비", RCPTN_RGN_NM: "인천광역시 남동구", EMRG_STEP_NM: "안전안내" });
const official = (r: Resp | (() => Promise<Resp>)) => new MoisCbsSource("test-key-not-real", typeof r === "function" ? r : async () => r);

beforeAll(() => {
  process.env.DATABASE_URL = getTestDatabaseUrl();
  prisma = createTestClient();
});
beforeEach(async () => {
  await resetTestData(prisma);
  setConfiguredAlertSources([]);
});
afterAll(async () => {
  setConfiguredAlertSources([]);
  await prisma.$disconnect();
});

describe("오류 종류 분류(화면에는 원문 대신 종류만)", () => {
  it.each([
    ["공식 재난문자 API 호출 제한(429) — 다음 주기에 다시 시도", "rate_limited"],
    ["공식 재난문자 API 결과 코드 22: LIMITED_NUMBER_OF_SERVICE_REQUESTS_EXCEEDS_ERROR", "rate_limited"],
    ["공식 재난문자 API 결과 코드 30: SERVICE KEY IS NOT REGISTERED", "rejected"],
    ["공식 재난문자 API 응답 오류(HTTP 403)", "rejected"],
    ["공식 재난문자 API 응답 오류(HTTP 503)", "server_error"],
    ["The operation was aborted due to timeout", "timeout"],
    ["공식 재난문자 API 응답에 body 배열이 없습니다(형식 확인 필요).", "format"],
    ["fetch failed", "network"],
    ["무엇인가 이상함", "unknown"],
  ])("%s → %s", (msg, kind) => {
    expect(classifyFeedError(msg)).toBe(kind);
  });
});

describe("공식 수집 상태", () => {
  it("공식 수집을 켜지 않았으면 not_configured(모의 성공이 있어도 공식 정상으로 보지 않음)", async () => {
    setConfiguredAlertSources([MOCK]);
    await collectOnce(prisma, new MockAlertSource(() => []), noSleep);
    const s = await getAlertFeedStatus(prisma);
    expect(s.official.state).toBe("not_configured");
    expect(s.official.lastSuccessAt).toBeNull();
    expect(s.mock.active).toBe(true);
    expect(s.mock.lastSuccessAt).not.toBeNull();
  });

  it("켰지만 수집 기록이 없으면 never_succeeded", async () => {
    setConfiguredAlertSources([OFFICIAL]);
    const s = await getAlertFeedStatus(prisma);
    expect(s.official).toMatchObject({ state: "never_succeeded", lastSuccessAt: null, lastFailureAt: null, contractVerified: false });
  });

  it("실패만 있으면 never_succeeded + 마지막 실패 종류(응답 없음·시간 초과)", async () => {
    setConfiguredAlertSources([OFFICIAL]);
    const r = await collectOnce(prisma, official(async () => { throw new DOMException("The operation was aborted due to timeout", "TimeoutError"); }), noSleep);
    expect(r.status).toBe("failed");
    const s = await getAlertFeedStatus(prisma);
    expect(s.official).toMatchObject({ state: "never_succeeded", lastSuccessAt: null, lastFailureKind: "timeout" });
    expect(s.official.lastFailureAt).not.toBeNull();
  });

  it("정상 응답 → ok, 저장된 경보는 공식(is_mock=false, mois_cbs)", async () => {
    setConfiguredAlertSources([OFFICIAL]);
    const r = await collectOnce(prisma, official(reply(200, { header: { resultCode: "00" }, totalCount: 1, body: [cbs(1)] })), noSleep);
    expect(r).toMatchObject({ status: "success", inserted: 1 });
    expect(await prisma.officialAlert.findFirstOrThrow()).toMatchObject({ provider: "mois_cbs", isMock: false });
    const s = await getAlertFeedStatus(prisma);
    expect(s.official.state).toBe("ok");
    expect(s.official.lastSuccessAt).not.toBeNull();
  });

  it.each([
    ["제공기관 5xx", reply(503, {}), "server_error"],
    ["인증 오류(결과 코드)", reply(200, { header: { resultCode: "30", resultMsg: "SERVICE KEY IS NOT REGISTERED" } }), "rejected"],
    ["호출 한도 초과", reply(429, {}), "rate_limited"],
    ["응답 형식 변경", reply(200, { header: { resultCode: "00" }, body: { item: [] } }), "format"],
  ])("성공 후 %s → failing(마지막 성공 시각 유지)", async (_n, resp, kind) => {
    setConfiguredAlertSources([OFFICIAL]);
    await collectOnce(prisma, official(reply(200, { body: [] })), noSleep);
    await collectOnce(prisma, official(resp), noSleep);
    const s = await getAlertFeedStatus(prisma);
    expect(s.official).toMatchObject({ state: "failing", lastFailureKind: kind });
    expect(s.official.lastSuccessAt).not.toBeNull();
  });

  it("마지막 성공이 오래되면 stale(수집 간격 3배, 최소 15분)", async () => {
    setConfiguredAlertSources([OFFICIAL]);
    const old = new Date(Date.now() - staleAfterMs(OFFICIAL.intervalMs) - MIN);
    await prisma.alertCollectionRun.create({ data: { provider: "mois_cbs", status: "success", startedAt: old, finishedAt: old } });
    expect((await getAlertFeedStatus(prisma)).official.state).toBe("stale");
    expect(staleAfterMs(MIN)).toBe(15 * MIN);
  });

  it("다시 성공하면 failing → ok", async () => {
    setConfiguredAlertSources([OFFICIAL]);
    await collectOnce(prisma, official(reply(503, {})), noSleep);
    await collectOnce(prisma, official(reply(200, { body: [] })), noSleep);
    expect((await getAlertFeedStatus(prisma)).official.state).toBe("ok");
  });

  it("건너뜀(최소 간격) 기록은 상태에 영향 없음", async () => {
    setConfiguredAlertSources([OFFICIAL]);
    await collectOnce(prisma, official(reply(200, { body: [] })), noSleep);
    await collectOnce(prisma, official(reply(503, {})), { minIntervalMs: 60 * MIN });
    expect((await getAlertFeedStatus(prisma)).official.state).toBe("ok");
  });
});

describe("외부 API 장애 중 학교 재난 대응 유지", () => {
  it("공식 수집이 계속 실패해도 발령·학급 보고·상황판·종료가 정상", async () => {
    setConfiguredAlertSources([OFFICIAL]);
    for (let i = 0; i < 3; i++) await collectOnce(prisma, official(async () => { throw new TypeError("fetch failed"); }), noSleep);
    expect((await getAlertFeedStatus(prisma)).official.state).toBe("never_succeeded");

    const now = new Date();
    const school = await prisma.school.create({ data: { name: "가상 장애시험학교", slug: "test-a-outage", status: "active", activatedAt: now } });
    const user = await prisma.user.create({ data: { email: "admin@outage.example", displayName: "가상 관리자", emailVerifiedAt: now } });
    const m = await prisma.schoolMembership.create({ data: { schoolId: school.id, userId: user.id, role: "admin", status: "approved", approvalMethod: "roster", approvedAt: now } });
    const cls = await prisma.schoolClass.create({ data: { schoolId: school.id, schoolYear: now.getFullYear(), grade: 1, classNo: 1, label: "1학년 1반", enrolledCount: 20 } });

    const ev = await issueEvent(prisma, { schoolId: school.id, actorUserId: user.id, primaryType: "fire", mode: "drill" });
    await submitReport(prisma, {
      schoolId: school.id, eventId: ev.id, classId: cls.id, actorUserId: user.id, membershipId: m.id, role: "admin", idempotencyKey: "outage-test-1",
      input: { evacuated: 19, absentKnown: 1, injured: 0, enrolledCount: 20, enrolledChangeReason: null, note: null, expectedVersion: null },
    });
    const board = await getBoard(prisma, { schoolId: school.id, eventId: ev.id });
    expect(JSON.stringify(board)).toContain("19");
    await closeEvent(prisma, { schoolId: school.id, eventId: ev.id, actorUserId: user.id });
    expect((await prisma.disasterEvent.findUniqueOrThrow({ where: { id: ev.id } })).status).toBe("closed");
  });
});

describe("경보함 API(HTTP) — 상태 포함·원문 오류 비노출·학교 격리", () => {
  let server: Server;
  let base = "";
  const cookies: Record<string, string> = {};
  const school: Record<string, string> = {};

  afterEach(async () => {
    if (server) await new Promise<void>((r) => server.close(() => r()));
  });

  it("교직원은 상태(공식 실패·모의 사용)를 받고, 오류 원문·인증키는 응답에 없음. 다른 학교는 404", async () => {
    const { createApp } = await import("../server/src/app");
    const { hashPassword } = await import("../server/src/security/password");
    const http = await import("node:http");
    server = http.createServer(await createApp({ mode: "test", trustProxyHops: 1 }));
    await new Promise<void>((r) => server.listen(0, "127.0.0.1", () => r()));
    const addr = server.address();
    base = `http://127.0.0.1:${typeof addr === "object" && addr ? addr.port : 0}`;

    const now = new Date();
    const passwordHash = await hashPassword("feed-test-password-1234");
    for (const key of ["a", "b"]) {
      school[key] = (await prisma.school.create({ data: { name: `가상 ${key}`, slug: `test-a-feed-${key}`, status: "active", activatedAt: now, address: "인천광역시 남동구 1" } })).id;
      const u = await prisma.user.create({ data: { email: `staff-${key}@feed.example`, displayName: `가상 교직원 ${key}`, passwordHash, emailVerifiedAt: now } });
      await prisma.schoolMembership.create({ data: { schoolId: school[key]!, userId: u.id, role: "staff", status: "approved", approvalMethod: "roster", approvedAt: now } });
      const res = await fetch(`${base}/api/auth/login`, {
        method: "POST",
        headers: { "content-type": "application/json", "x-forwarded-for": `198.51.100.${key === "a" ? 41 : 42}` },
        body: JSON.stringify({ email: `staff-${key}@feed.example`, password: "feed-test-password-1234", deviceKind: "personal" }),
      });
      cookies[key] = res.headers.get("set-cookie")!.split(";")[0]!;
    }

    setConfiguredAlertSources([OFFICIAL, MOCK]);
    await collectOnce(prisma, official(reply(200, { header: { resultCode: "30", resultMsg: "SERVICE KEY IS NOT REGISTERED serviceKey=SHOULD-NOT-LEAK" } })), noSleep);
    await collectOnce(prisma, new MockAlertSource(() => [{ id: "M-1", kind: "weather", severity: "warning", issuer: "기상청(모의)", body: "[모의] 인천 호우", areas: "인천광역시", issuedAt: now.toISOString() }]), noSleep);

    const res = await fetch(`${base}/api/schools/${school.a}/alerts`, { headers: { cookie: cookies.a! } });
    expect(res.status).toBe(200);
    const text = await res.text();
    const body = JSON.parse(text) as { alerts: { alert: { isMock: boolean } }[]; feed: { official: { state: string; lastFailureKind: string }; mock: { active: boolean } } };
    expect(body.feed.official).toMatchObject({ state: "never_succeeded", lastFailureKind: "rejected" });
    expect(body.feed.mock.active).toBe(true);
    expect(body.alerts.every((a) => a.alert.isMock)).toBe(true); // 화면의 경보는 모두 모의 — 공식 경보처럼 저장되지 않음
    expect(text).not.toContain("SHOULD-NOT-LEAK");
    expect(text).not.toContain("SERVICE KEY IS NOT REGISTERED");

    expect((await fetch(`${base}/api/schools/${school.b}/alerts`, { headers: { cookie: cookies.a! } })).status).toBe(404);
  });
});
