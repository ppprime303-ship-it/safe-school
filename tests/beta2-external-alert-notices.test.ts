// 외부 경보 교직원 안내: 수집 → 지역 판정 → 미확인 → 확인 → 재안내·해제(가짜 응답, 실제 외부 호출 없음, safeschool_test만)
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { createServer, type Server } from "node:http";
import type { AddressInfo } from "node:net";
import type { PrismaClient } from "@prisma/client";
import { createTestClient, getTestDatabaseUrl, resetTestData } from "./test-db";
import { createSession, SESSION_COOKIE } from "../server/src/auth/session";
import { collectOnce } from "../server/src/alerts/collector";
import { MoisCbsSource } from "../server/src/alerts/moisCbs";
import { KmaWarningSource, matchKmaZone, toKmaAlerts } from "../server/src/alerts/kmaSource";
import { createKmaWarningClient, parseKmaStatus, parseKmaWarnings, SUPPORTED_ZONE_CODES, zonesForRegion, type KmaWarningClient } from "../server/src/integrations/kmaWarnings";
import { alertProviderErrors, betaEnvironmentErrors } from "../server/src/deploy/environment";
import { listPendingAlertNotices, weatherStatus } from "../server/src/services/alertNotices";
import { listSchoolAlerts, markAlertRead } from "../server/src/services/alerts";

let prisma: PrismaClient;
let server: Server;
let base: string;
const opts = { minIntervalMs: 0, retries: 0 };
const kst = (ms: number) => {
  const d = new Date(Date.now() + 9 * 3600_000 + ms).toISOString();
  return d.slice(0, 16).replace(/\D/g, "");
};
const H = 3600_000;
const row = (o: Record<string, unknown> = {}) => ({ stnId: "109", tmFc: kst(-2 * H), tmSeq: "5", areaCode: "L1110110", areaName: "인천영종", warnVar: "2", warnStress: "1", command: "1", startTime: kst(-H), cancel: "0", ...o });
const body = (items: unknown[]) => JSON.stringify({ response: { header: { resultCode: "00" }, body: { items: { item: items }, totalCount: items.length } } });
const source = (rows: unknown[]): KmaWarningSource => {
  const client: KmaWarningClient = { latest: async () => ({ rows: parseKmaWarnings(body(rows)).rows, rejected: 0, partial: false, fetchedAt: new Date(), error: null, status: null }) };
  return new KmaWarningSource(client);
};
const collect = (rows: unknown[]) => collectOnce(prisma, source(rows), opts);
const cbs = (sn: number, area = "인천광역시 영종구", o: Record<string, unknown> = {}) => {
  const d = new Date(Date.now() + 9 * H);
  const p = (n: number) => String(n).padStart(2, "0");
  return { SN: sn, CRT_DT: `${d.getUTCFullYear()}/${p(d.getUTCMonth() + 1)}/${p(d.getUTCDate())} ${p(d.getUTCHours())}:${p(d.getUTCMinutes())}:00`, MSG_CN: `[가상 시험 ${sn}] 호우 대비`, RCPTN_RGN_NM: area, EMRG_STEP_NM: "긴급재난", ...o };
};
const collectCbs = (rows: unknown[]) => collectOnce(prisma, new MoisCbsSource("test-key-not-real", (async () => ({ ok: true, status: 200, json: async () => ({ header: { resultCode: "00" }, totalCount: rows.length, body: rows }) })) as never), opts);

let schoolA: string;
let schoolB: string;
let teacher: { id: string; cookie: string };
let other: { id: string; cookie: string };
const mkSchool = async (slug: string, address: string) => (await prisma.school.create({ data: { slug: `${slug}-${Date.now()}`, name: `가상 ${slug}`, isDemo: true, status: "active", activatedAt: new Date(), address } })).id;
const mkUser = async (key: string, schoolId: string, role = "staff") => {
  const user = await prisma.user.create({ data: { email: `${key}-${Date.now()}@check.safeschool.invalid`, displayName: `가상 ${key}`, passwordHash: "x", emailVerifiedAt: new Date() } });
  await prisma.schoolMembership.create({ data: { schoolId, userId: user.id, role: role as "staff", status: "approved", approvalMethod: "roster", approvedAt: new Date() } });
  return { id: user.id, cookie: `${SESSION_COOKIE}=${(await createSession(prisma, { userId: user.id, deviceKind: "personal" })).token}` };
};
const pending = (userId = teacher.id, schoolId = schoolA, canManageRegion = false) => listPendingAlertNotices(prisma, { schoolId, userId, canManageRegion });
const ack = (matchId: string, userId = teacher.id) => markAlertRead(prisma, { schoolId: schoolA, userId, role: "staff", matchId });

beforeAll(async () => {
  process.env.DATABASE_URL = getTestDatabaseUrl();
  prisma = createTestClient();
  const { createApp } = await import("../server/src/app");
  server = createServer(await createApp({ mode: "test" }));
  await new Promise<void>((r) => server.listen(0, "127.0.0.1", () => r()));
  base = `http://127.0.0.1:${(server.address() as AddressInfo).port}/api`;
});
beforeEach(async () => {
  await resetTestData(prisma);
  schoolA = await mkSchool("nota", "인천광역시 영종구 가상로 1");
  schoolB = await mkSchool("notb", "인천광역시 연수구 가상로 2");
  teacher = await mkUser("teacher", schoolA);
  other = await mkUser("other", schoolB);
});
afterAll(async () => {
  await new Promise((r) => server.close(r));
  await prisma.$disconnect();
});

describe("특보구역 판정(기상청 2026-05-12 구역표)", () => {
  it.each([
    ["영종구", "L1110110"], ["제물포구", "L1110120"], ["연수구", "L1110120"], ["남동구", "L1110120"], ["미추홀구", "L1110120"], ["동구", "L1110120"],
    ["부평구", "L1110130"], ["계양구", "L1110130"], ["서구", "L1110130"], ["서해구", "L1110130"], ["검단구", "L1110130"], ["강화군", "L1010900"], ["옹진군", "L1013600"],
  ])("%s → %s, 인천 전체도 대상", (sigungu, code) => {
    const z = zonesForRegion({ sido: "인천광역시", sigungu })!;
    expect(z.target.has(code)).toBe(true);
    expect(z.target.has("L1110000")).toBe(true);
  });
  it("영종구는 남부·북부 비대상, 옛 중구·모르는 표기는 단정하지 않음, 옹진 서해5도는 미판정", () => {
    expect(matchKmaZone("L1110120", { sido: "인천광역시", sigungu: "영종구" }).result).toBe("non_target");
    expect(matchKmaZone("L1110110", { sido: "인천광역시", sigungu: "중구" }).result).toBe("undetermined");
    expect(matchKmaZone("L1110120", { sido: "인천광역시", sigungu: "중구" }).result).toBe("undetermined");
    expect(matchKmaZone("L1110130", { sido: "인천광역시", sigungu: "중구" }).result).toBe("non_target");
    expect(matchKmaZone("L1014200", { sido: "인천광역시", sigungu: "옹진군" }).result).toBe("undetermined");
    expect(matchKmaZone("L1110120", { sido: "인천광역시", sigungu: null }).result).toBe("undetermined");
    expect(matchKmaZone("L1110110", { sido: "경기도", sigungu: "수원시" }).result).toBe("non_target");
  });
  it("특보 현황 원문: 인천 관련 줄만 원문 그대로, 7일 전 발표 특보 확인 가능", () => {
    const raw = JSON.stringify({ response: { header: { resultCode: "00" }, body: { items: { item: [{ tmFc: "202611010700", tmEf: "202611010800", t6: "o 옛자료 : 인천" }, { tmFc: "202611020700", tmEf: "202611020800", t6: "o 폭염주의보 : 인천(인천남부), 경기도(광명) o 강풍주의보 : 울릉도.독도" }] } } } });
    const s = parseKmaStatus(raw)!;
    expect(s.lines).toEqual(["o 폭염주의보 : 인천(인천남부), 경기도(광명)"]);
    expect(s.at!.toISOString()).toBe("2026-11-01T23:00:00.000Z");
  });
});

describe("경보 변환", () => {
  it("인천 구역만 저장 대상, 발표는 new, 해제는 cancel, 호우경보는 warning", () => {
    const alerts = toKmaAlerts(parseKmaWarnings(body([row(), row({ areaCode: "L1010400", areaName: "안산" }), row({ tmFc: kst(-H), tmSeq: "6", command: "2", endTime: kst(-H), startTime: undefined })])).rows);
    expect(alerts).toHaveLength(2);
    expect(alerts[0]).toMatchObject({ kind: "weather", severity: "warning", msgType: "new", issuer: "기상청", title: "호우경보 발표" });
    expect(alerts[1]).toMatchObject({ msgType: "cancel", refExternalId: alerts[0]!.externalId, title: "호우경보 해제" });
  });
  it("상태: 해제 전체 시각·발효 전·모르는 코드", () => {
    const now = new Date();
    expect(weatherStatus({ msgType: "cancel", raw: {} }, now)).toBeNull();
    expect(weatherStatus({ msgType: "new", raw: { command: "1", allEndTime: kst(-H) } }, now)).toBeNull();
    expect(weatherStatus({ msgType: "new", raw: { command: "1", startTime: kst(H) } }, now)).toBe("scheduled");
    expect(weatherStatus({ msgType: "update", raw: { command: "9" } }, now)).toBe("unknown");
  });
});

describe("실제로 아직 관측하지 못한 경우(가짜 응답 회귀)", () => {
  it("특보구역 코드는 공식 코드표의 이름과 일치", () => {
    // 활용가이드 특보구역코드(2026-06-01)
    const official: Record<string, string> = { L1110000: "인천", L1110100: "인천", L1110110: "인천영종", L1110120: "인천남부", L1110130: "인천북부", L1010900: "강화", L1013600: "옹진", L1014000: "서해5도", L1014200: "백령도.대청도", L1014300: "연평도.우도" };
    expect([...SUPPORTED_ZONE_CODES].sort()).toEqual(Object.keys(official).sort());
  });
  it("현황 원문: 줄바꿈 구분·예비특보 없는 응답·자료 없음", () => {
    const wrap = (item: unknown) => JSON.stringify({ response: { header: { resultCode: "00" }, body: { items: { item } } } });
    expect(parseKmaStatus(wrap({ tmFc: "202611020700", t6: "o 호우경보 : 인천(인천영종)\r\no 폭염주의보 : 대구" }))!.lines).toEqual(["o 호우경보 : 인천(인천영종)"]);
    expect(parseKmaStatus(wrap({ tmFc: "202611020700", t6: "o 없음" }))!.lines).toEqual([]);
    expect(parseKmaStatus(JSON.stringify({ response: { header: { resultCode: "03" } } }))).toBeNull();
  });
  it("조회 기간 밖에서 시작된 특보: 연장·정정만 보여도 발효로 안내, 해제만 보이면 안내 없음", async () => {
    await collect([row({ command: "3", startTime: undefined })]);
    expect((await pending()).notices.map((n) => [n.title, n.status])).toEqual([["호우경보 연장", "active"]]);
    await resetTestData(prisma);
    schoolA = await mkSchool("nota", "인천광역시 영종구 가상로 1");
    teacher = await mkUser("teacher", schoolA);
    await collect([row({ command: "2", endTime: kst(-H), startTime: undefined })]);
    expect((await pending()).notices).toHaveLength(0);
  });
  it("취소된 발표는 안내하지 않고, 취소 뒤 재발표는 안내", async () => {
    await collect([row(), row({ tmFc: kst(-90 * 60_000), tmSeq: "6", cancel: "1" })]);
    expect((await pending()).notices).toHaveLength(0);
    await collect([row({ tmFc: kst(-30 * 60_000), tmSeq: "7", startTime: kst(-20 * 60_000) })]);
    expect((await pending()).notices.map((n) => n.status)).toEqual(["active"]);
  });
  it("발효 전 발표는 '발효 예정', 강도 상향은 별도 안내", async () => {
    await collect([row({ startTime: kst(3 * H) })]);
    expect((await pending()).notices[0]).toMatchObject({ status: "scheduled" });
    await ack((await pending()).notices[0]!.matchId);
    await collect([row({ tmFc: kst(-H), tmSeq: "7", warnStress: "2", command: "7", startTime: kst(-H) })]);
    expect((await pending()).notices[0]).toMatchObject({ title: "호우중대경보 변경 발표", priority: "urgent", status: "active" });
  });
});

describe("안내 흐름", () => {
  it("새 호우경보(우선)·대설주의보(일반)·재난문자: 각각 안내, 출처·조회 시각, 재난 자동 발령 없음", async () => {
    const before = await prisma.disasterEvent.count();
    await collect([row(), row({ warnVar: "8", warnStress: "0", tmSeq: "6" })]);
    await collectCbs([cbs(1)]);
    const { notices, activeEvent } = await pending();
    expect(activeEvent).toBe(false);
    expect(notices).toHaveLength(3);
    const weather = notices.filter((n) => n.kind === "weather");
    expect(weather.find((n) => n.title === "호우경보 발표")).toMatchObject({ priority: "urgent", status: "active", issuer: "기상청", areasRaw: "인천영종", sourceLabel: "기상청 기상특보 조회서비스", verified: true, isMock: false }); // 2026-11-03 실제 응답으로 계약 확인
    expect(weather.find((n) => n.title === "대설주의보 발표")).toMatchObject({ priority: "normal" });
    expect(notices.find((n) => n.kind === "disaster_text")).toMatchObject({ body: "[가상 시험 1] 호우 대비", sourceLabel: "행정안전부 긴급재난문자", status: "issued", verified: true }); // 2026-11-03 계약 확인
    expect(notices.every((n) => n.lastCollectedAt)).toBe(true);
    expect(await prisma.disasterEvent.count()).toBe(before);
    expect(await prisma.staffAlert.count()).toBe(0);
  });
  it("관련 없는 지역은 안내하지 않음(기상특보·재난문자)", async () => {
    await collect([row({ areaCode: "L1110120", areaName: "인천남부" })]);
    await collectCbs([cbs(2, "부산광역시 해운대구")]);
    expect((await pending()).notices).toHaveLength(0);
    // 인천남부는 연수구 학교 대상
    expect((await pending(other.id, schoolB)).notices.map((n) => n.title)).toEqual(["호우경보 발표"]);
  });
  it("같은 경보 재조회는 저장·안내가 늘지 않음", async () => {
    const r1 = await collect([row()]);
    const r2 = await collect([row()]);
    expect([r1.inserted, r2.inserted, r2.duplicates]).toEqual([1, 0, 1]);
    expect((await pending()).notices).toHaveLength(1);
  });
  it("확인하면 다시 뜨지 않고, 재로그인·재조회에도 유지, 다른 교직원은 별도", async () => {
    await collect([row()]);
    const colleague = await mkUser("colleague", schoolA);
    const [n] = (await pending()).notices;
    const res = await fetch(`${base}/schools/${schoolA}/alerts/${n!.matchId}/read`, { method: "POST", headers: { cookie: teacher.cookie, "content-type": "application/json" }, body: "{}" });
    expect(res.status).toBe(200);
    const again = await createSession(prisma, { userId: teacher.id, deviceKind: "personal" });
    const list = await fetch(`${base}/schools/${schoolA}/alerts/pending`, { headers: { cookie: `${SESSION_COOKIE}=${again.token}` } });
    expect((await list.json()).notices).toEqual([]);
    await collect([row()]);
    expect((await pending()).notices).toHaveLength(0);
    expect((await pending(colleague.id)).notices).toHaveLength(1);
  });
  it("새 경보는 별도 안내", async () => {
    await collect([row()]);
    await ack((await pending()).notices[0]!.matchId);
    await collect([row({ warnVar: "8", warnStress: "0", tmSeq: "7" })]);
    expect((await pending()).notices.map((n) => n.title)).toEqual(["대설주의보 발표"]);
  });
  it("정정·변경은 재안내, 연장은 확인했으면 다시 알리지 않음, 미확인이면 최신만", async () => {
    await collect([row()]);
    await ack((await pending()).notices[0]!.matchId);
    await collect([row(), row({ tmFc: kst(-90 * 60_000), tmSeq: "6", command: "3", startTime: undefined })]);
    expect((await pending()).notices).toHaveLength(0);
    await collect([row({ tmFc: kst(-H), tmSeq: "7", command: "6", startTime: undefined })]);
    expect((await pending()).notices.map((n) => n.title)).toEqual(["호우경보 정정"]);
    const colleague = await mkUser("colleague", schoolA);
    expect((await pending(colleague.id)).notices.map((n) => n.title)).toEqual(["호우경보 정정"]);
  });
  it("해제: 미확인 안내가 사라지고 해제를 새 경보처럼 띄우지 않음, 경보함에는 해제됨", async () => {
    await collect([row()]);
    await collect([row(), row({ tmFc: kst(-H), tmSeq: "6", command: "2", endTime: kst(-H), startTime: undefined })]);
    expect((await pending()).notices).toHaveLength(0);
    const { alerts } = await listSchoolAlerts(prisma, { schoolId: schoolA, userId: teacher.id, role: "staff" });
    expect(alerts.find((a) => a.alert.msgType === "new")?.cancelled).toBe(true);
    // 해제 뒤 같은 특보의 새 발표는 다시 안내
    await collect([row({ tmFc: kst(-30 * 60_000), tmSeq: "7", startTime: kst(-20 * 60_000) })]);
    expect((await pending()).notices).toHaveLength(1);
  });
  it("재난문자: 24시간 지난 경보·재송출은 안내하지 않음", async () => {
    const old = new Date(Date.now() - 25 * H + 9 * H);
    const p = (n: number) => String(n).padStart(2, "0");
    await collectCbs([cbs(3, "인천광역시 영종구", { CRT_DT: `${old.getUTCFullYear()}/${p(old.getUTCMonth() + 1)}/${p(old.getUTCDate())} ${p(old.getUTCHours())}:00:00` })]);
    expect((await pending()).notices).toHaveLength(0);
    await collectCbs([cbs(4), cbs(5, "인천광역시 영종구", { MSG_CN: "[가상 시험 4] 호우 대비" })]);
    expect((await pending()).notices).toHaveLength(1);
  });
  it("미판정 구역은 관리자에게만", async () => {
    const zh = await mkSchool("notc", "인천광역시 중구 가상로 3");
    const staff = await mkUser("zhstaff", zh);
    await collect([row()]);
    expect((await pending(staff.id, zh, false)).notices).toHaveLength(0);
    expect((await pending(staff.id, zh, true)).notices[0]).toMatchObject({ relevance: "undetermined" });
  });
  it("학교 사건 진행 중이면 activeEvent 로 알림(화면을 막지 않는 안내용)", async () => {
    await collect([row()]);
    const admin = await mkUser("adm", schoolA, "admin");
    const r = await fetch(`${base}/schools/${schoolA}/events`, { method: "POST", headers: { cookie: admin.cookie, "content-type": "application/json" }, body: JSON.stringify({ primaryType: "fire", mode: "drill" }) });
    expect(r.status).toBeLessThan(300);
    expect((await pending()).activeEvent).toBe(true);
  });
});

describe("격리·권한", () => {
  it("비로그인 401, 다른 학교 교직원은 조회·확인 거부, 확인 기록 없음", async () => {
    await collect([row()]);
    const [n] = (await pending()).notices;
    expect((await fetch(`${base}/schools/${schoolA}/alerts/pending`)).status).toBe(401);
    expect((await fetch(`${base}/schools/${schoolA}/alerts/pending`, { headers: { cookie: other.cookie } })).status).toBeGreaterThanOrEqual(403);
    const res = await fetch(`${base}/schools/${schoolA}/alerts/${n!.matchId}/read`, { method: "POST", headers: { cookie: other.cookie, "content-type": "application/json" }, body: "{}" });
    expect(res.status).toBeGreaterThanOrEqual(403);
    const cross = await fetch(`${base}/schools/${schoolB}/alerts/${n!.matchId}/read`, { method: "POST", headers: { cookie: other.cookie, "content-type": "application/json" }, body: "{}" });
    expect(cross.status).toBe(404);
    expect(await prisma.alertRead.count()).toBe(0);
  });
});

describe("장애와 수집 설정", () => {
  it("특보 현황 조회만 실패해도 구역별 자료는 정상", async () => {
    const c = createKmaWarningClient({ serviceKey: "test-key-not-real", fetchImpl: async (u) => {
      if (u.includes("getPwnStatus")) throw new Error("down");
      return { ok: true, status: 200, text: async () => body([row()]) };
    } });
    const s = await c.latest();
    expect(s.error).toBeNull();
    expect(s.rows).toHaveLength(1);
    expect(s.status).toBeNull();
  });
  it("API 장애: 실패 기록, 키 미노출, 기존 안내 유지, 학교 기능 무관", async () => {
    await collect([row()]);
    const failing = createKmaWarningClient({ serviceKey: "test-key-not-real", fetchImpl: async () => { throw new Error("fetch failed serviceKey=test-key-not-real"); } });
    const r = await collectOnce(prisma, new KmaWarningSource(failing), opts);
    expect(r.status).toBe("failed");
    expect(r.error).not.toContain("test-key-not-real");
    expect((await pending()).notices).toHaveLength(1);
    const res = await fetch(`${base}/schools/${schoolA}/staff-alerts`, { headers: { cookie: teacher.cookie } });
    expect(res.status).toBe(200);
  });
  it("수집 설정: 키 없으면 거부, Beta는 계약 확인된 기상특보만 허용(재난문자는 확인 전 거부), 심사 환경 거부", () => {
    expect(alertProviderErrors("production" as never, { ALERT_PROVIDERS: "kma_warning" }).join()).toContain("KMA_WARNING_SERVICE_KEY");
    expect(alertProviderErrors("production" as never, { ALERT_PROVIDERS: "kma_warning", KMA_WARNING_SERVICE_KEY: "x" })).toEqual([]);
    expect(alertProviderErrors("judge" as never, { ALERT_PROVIDERS: "kma_warning", KMA_WARNING_SERVICE_KEY: "x" }).join()).toContain("심사");
    expect(betaEnvironmentErrors("beta" as never, { ALERT_PROVIDERS: "kma_warning" }).join()).not.toContain("KMA_WARNING_CONTRACT"); // 2026-11-03 계약 확인
    expect(betaEnvironmentErrors("beta" as never, { ALERT_PROVIDERS: "mois_cbs", MOIS_CBS_DAILY_LIMIT: "60" }).join()).not.toContain("MOIS_CBS_CONTRACT"); // 2026-11-03 계약 확인
    expect(betaEnvironmentErrors("beta" as never, { ALERT_PROVIDERS: "mois_cbs" }).join()).toContain("MOIS_CBS_DAILY_LIMIT");
  });
});
