// STEP 3-B ①~④ 공식 경보 수집·지역 매칭·중복 방지·교직원 경보함 (테스트 전용 DB 스키마, 모의 공급자)
import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { createTestClient, resetTestData } from "./test-db.js";
import { collectOnce } from "../server/src/alerts/collector.js";
import { regroupRebroadcasts } from "../server/src/alerts/grouping.js";
import { MockAlertSource, type AlertSource, type MockAlertInput } from "../server/src/alerts/providers.js";
import { confirmSchoolRegion, getSchoolRegion, listSchoolAlerts, markAlertRead } from "../server/src/services/alerts.js";

const prisma = createTestClient();
let incheon = ""; // 인천광역시 남동구
let busan = ""; // 부산광역시 해운대구
let unknown = ""; // 주소 해석 불가
let adminUser = "";
let staffUser = "";

const minutesAgo = (m: number) => new Date(Date.now() - m * 60_000).toISOString();
const heat = (over: Partial<MockAlertInput> = {}): MockAlertInput => ({
  id: "T-HEAT-1",
  kind: "weather",
  severity: "warning",
  issuer: "기상청(모의)",
  body: "[모의] 인천 폭염경보",
  areas: "인천광역시",
  issuedAt: minutesAgo(30),
  ...over,
});
const source = (list: MockAlertInput[]) => new MockAlertSource(() => list);
const collect = (list: MockAlertInput[]) => collectOnce(prisma, source(list), { minIntervalMs: 0 });

beforeEach(async () => {
  await resetTestData(prisma);
  const now = new Date();
  const school = async (slug: string, name: string, address: string | null) =>
    (await prisma.school.create({ data: { name, slug, address, status: "active", activatedAt: now } })).id;
  incheon = await school("test-incheon", "인천학교", "인천광역시 남동구 안전로 1");
  busan = await school("test-busan", "부산학교", "부산광역시 해운대구 바다로 1");
  unknown = await school("test-unknown", "주소미상학교", "가상시 시험로 1");
  await prisma.school.create({ data: { name: "승인대기학교", slug: "test-pending", address: "인천광역시 남동구 2", status: "pending_verification" } });
  adminUser = (await prisma.user.create({ data: { email: "admin@i.kr", displayName: "관리자", emailVerifiedAt: now } })).id;
  staffUser = (await prisma.user.create({ data: { email: "staff@i.kr", displayName: "교직원", emailVerifiedAt: now } })).id;
});

afterAll(async () => {
  await prisma.$disconnect();
});

describe("① 수집·원문 보존", () => {
  it("모의 경보는 is_mock으로 저장되고 원문은 수정·삭제할 수 없다", async () => {
    const r = await collect([heat()]);
    expect(r).toMatchObject({ status: "success", fetched: 1, inserted: 1, duplicates: 0 });
    const alert = await prisma.officialAlert.findFirstOrThrow();
    expect(alert).toMatchObject({ provider: "mock", isMock: true, body: "[모의] 인천 폭염경보", areasRaw: "인천광역시" });
    await expect(prisma.officialAlert.update({ where: { id: alert.id }, data: { body: "변경" } })).rejects.toBeTruthy();
    await expect(prisma.officialAlert.delete({ where: { id: alert.id } })).rejects.toBeTruthy();
  });

  it("공급자 실패는 재시도 후 실패 기록(인증키는 가림), 이후 성공", async () => {
    let calls = 0;
    const flaky: AlertSource = {
      provider: "mock",
      isMock: true,
      async fetch() {
        calls++;
        if (calls <= 3) throw new Error("timeout https://api.example/x?serviceKey=SECRET123");
        return { alerts: [], nextCursor: "c1" };
      },
    };
    const failed = await collectOnce(prisma, flaky, { minIntervalMs: 0, retries: 2, sleep: async () => {} });
    expect(failed.status).toBe("failed");
    expect(calls).toBe(3);
    const run = await prisma.alertCollectionRun.findUniqueOrThrow({ where: { id: failed.runId } });
    expect(run.errorMessage).toContain("serviceKey=***");
    expect(run.errorMessage).not.toContain("SECRET123");
    const ok = await collectOnce(prisma, flaky, { minIntervalMs: 0, sleep: async () => {} });
    expect(ok.status).toBe("success");
  });

  it("최소 수집 간격 전에는 공급자를 호출하지 않는다(과다 호출 방지)", async () => {
    let calls = 0;
    const counting = new MockAlertSource(() => {
      calls++;
      return [];
    });
    await collectOnce(prisma, counting, { minIntervalMs: 60_000 });
    const second = await collectOnce(prisma, counting, { minIntervalMs: 60_000 });
    expect(second.status).toBe("skipped");
    expect(calls).toBe(1);
  });
});

describe("② 학교 지역 매칭", () => {
  it("인천 경보는 인천 학교만 대상, 부산은 비대상, 주소 불명은 미판정, 승인 전 학교는 매칭하지 않음", async () => {
    const r = await collect([heat()]);
    expect(r.newTargetMatches).toBe(1);
    const matches = await prisma.schoolAlertMatch.findMany({ select: { schoolId: true, result: true } });
    const by = new Map(matches.map((m) => [m.schoolId, m.result]));
    expect(by.get(incheon)).toBe("target");
    expect(by.get(busan)).toBe("non_target");
    expect(by.get(unknown)).toBe("undetermined");
    expect(matches).toHaveLength(3);
    // 주소에서 자동 추출한 소재지는 '미확인'으로 저장
    expect(await getSchoolRegion(prisma, incheon)).toMatchObject({ region: { sido: "인천광역시", sigungu: "남동구", source: "address_parsed", confirmed: false } });
  });

  it("관리자가 소재지를 확인하면 미판정 경보를 다시 판정하고 감사 기록을 남긴다", async () => {
    await collect([heat()]);
    const r = await confirmSchoolRegion(prisma, { schoolId: unknown, actorUserId: adminUser, sido: "인천", sigungu: "연수구" });
    expect(r).toMatchObject({ sido: "인천광역시", sigungu: "연수구", rematched: 1 });
    const m = await prisma.schoolAlertMatch.findFirstOrThrow({ where: { schoolId: unknown } });
    expect(m.result).toBe("target");
    expect(await prisma.auditLog.count({ where: { action: "region.confirmed", schoolId: unknown } })).toBe(1);
    await expect(confirmSchoolRegion(prisma, { schoolId: unknown, actorUserId: adminUser, sido: "가상도", sigungu: null })).rejects.toMatchObject({
      code: "invalid_sido",
    });
  });
});

describe("③ 중복 방지", () => {
  it("같은 경보 ID 재수신은 저장·알림하지 않는다", async () => {
    await collect([heat()]);
    const again = await collect([heat()]);
    expect(again).toMatchObject({ inserted: 0, duplicates: 1, newTargetMatches: 0 });
    expect(await prisma.officialAlert.count()).toBe(1);
  });

  it("같은 내용의 재송출(다른 ID)은 원문은 저장하되 경보함에서는 한 건으로 묶는다", async () => {
    const r = await collect([heat(), heat({ id: "T-HEAT-2", issuedAt: minutesAgo(20) })]);
    expect(r).toMatchObject({ inserted: 2, newTargetMatches: 1 });
    const { alerts, unreadCount } = await listSchoolAlerts(prisma, { schoolId: incheon, userId: staffUser, role: "staff" });
    expect(alerts).toHaveLength(1);
    expect(alerts[0]).toMatchObject({ rebroadcastCount: 1, alert: { title: null } });
    expect(unreadCount).toBe(1);
  });

  it("해제 경보는 별도 알림으로 오고 원래 경보에 '해제됨'이 표시된다", async () => {
    await collect([heat()]);
    await collect([heat({ id: "T-HEAT-9", msgType: "cancel", refId: "T-HEAT-1", body: "[모의] 폭염경보 해제", severity: "info", issuedAt: minutesAgo(1) })]);
    const { alerts } = await listSchoolAlerts(prisma, { schoolId: incheon, userId: staffUser, role: "staff" });
    expect(alerts.map((a) => [a.alert.msgType, a.cancelled])).toEqual([
      ["cancel", false],
      ["new", true],
    ]);
  });
});

describe("③-2 경보를 먼저 받고 학교 소재지를 나중에 확인한 경우(2026-10-21 시연에서 발견)", () => {
  const confirmUnknown = () => confirmSchoolRegion(prisma, { schoolId: unknown, actorUserId: adminUser, sido: "인천광역시", sigungu: "남동구" });
  const list = (role = "staff", userId = staffUser) => listSchoolAlerts(prisma, { schoolId: unknown, userId, role });

  it("재판정 때도 같은 내용 재송출을 한 건으로 묶고, 해제 경보는 대표 경보에 '해제됨'으로 표시된다", async () => {
    await collect([heat(), heat({ id: "T-HEAT-2", issuedAt: minutesAgo(20) })]);
    expect((await list("admin", adminUser)).alerts.filter((a) => a.result === "undetermined")).toHaveLength(2);
    const r = await confirmUnknown();
    expect(r).toMatchObject({ rematched: 2, regrouped: 1 });
    const after = await list();
    expect(after.alerts).toHaveLength(1);
    expect(after.alerts[0]).toMatchObject({ rebroadcastCount: 1, cancelled: false });
    const dup = await prisma.schoolAlertMatch.findFirstOrThrow({ where: { schoolId: unknown, duplicateOfAlertId: { not: null } }, include: { alert: true } });
    expect(dup.alert.externalId).toBe("T-HEAT-2"); // 나중에 발령된 쪽이 재송출

    await collect([heat({ id: "T-HEAT-9", msgType: "cancel", refId: "T-HEAT-1", body: "[모의] 폭염경보 해제", severity: "info", issuedAt: minutesAgo(1) })]);
    const withCancel = await list();
    expect(withCancel.alerts.map((a) => [a.alert.msgType, a.cancelled, a.rebroadcastCount])).toEqual([
      ["cancel", false, 0],
      ["new", true, 1],
    ]);
  });

  it("소재지를 다시 확인하거나 같은 경보를 다시 받아도 중복이 생기지 않는다", async () => {
    await collect([heat(), heat({ id: "T-HEAT-2", issuedAt: minutesAgo(20) })]);
    await confirmUnknown();
    await expect(confirmUnknown()).resolves.toMatchObject({ rematched: 0, regrouped: 0 });
    const again = await collect([heat(), heat({ id: "T-HEAT-2", issuedAt: minutesAgo(20) })]);
    expect(again).toMatchObject({ inserted: 0, duplicates: 2 });
    expect((await list()).alerts).toHaveLength(1);
    expect(await prisma.auditLog.count({ where: { action: "region.confirmed", schoolId: unknown } })).toBe(2);
  });

  it("해제 경보가 재송출 쪽 경보를 가리켜도 대표 경보에 '해제됨'이 표시된다", async () => {
    await collect([heat(), heat({ id: "T-HEAT-2", issuedAt: minutesAgo(20) })]);
    await confirmUnknown();
    await collect([heat({ id: "T-HEAT-9", msgType: "cancel", refId: "T-HEAT-2", body: "[모의] 폭염경보 해제", severity: "info", issuedAt: minutesAgo(1) })]);
    expect((await list()).alerts.find((a) => a.alert.msgType === "new")?.cancelled).toBe(true);
  });

  it("재송출 경보를 읽어도 묶음 전체가 읽음으로 보인다(사용자별 유지)", async () => {
    await collect([heat(), heat({ id: "T-HEAT-2", issuedAt: minutesAgo(20) })]);
    await confirmUnknown();
    const dup = await prisma.schoolAlertMatch.findFirstOrThrow({ where: { schoolId: unknown, duplicateOfAlertId: { not: null } } });
    await prisma.alertRead.create({ data: { userId: staffUser, matchId: dup.id } });
    expect((await list()).unreadCount).toBe(0);
    expect((await list("admin", adminUser)).unreadCount).toBe(1);
  });

  it("이미 따로 저장된 기존 데이터도 원문을 바꾸지 않고 정리할 수 있다(점검 → 적용 → 재실행 0건)", async () => {
    await collect([heat(), heat({ id: "T-HEAT-2", issuedAt: minutesAgo(20) })]);
    await confirmUnknown();
    // 수정 전 버전이 남긴 상태 재현: 재송출 묶음이 풀린 채 '대상' 2건
    await prisma.schoolAlertMatch.updateMany({ where: { schoolId: unknown }, data: { duplicateOfAlertId: null } });
    expect((await list()).alerts).toHaveLength(2);
    const alertsBefore = await prisma.officialAlert.findMany({ orderBy: { externalId: "asc" } });
    expect(await regroupRebroadcasts(prisma, unknown, { dryRun: true })).toHaveLength(1);
    expect((await list()).alerts).toHaveLength(2); // 점검만으로는 바뀌지 않음
    expect(await regroupRebroadcasts(prisma, unknown)).toHaveLength(1);
    expect((await list()).alerts).toHaveLength(1);
    expect(await regroupRebroadcasts(prisma, unknown)).toHaveLength(0);
    expect(await prisma.officialAlert.findMany({ orderBy: { externalId: "asc" } })).toEqual(alertsBefore);
    // 다른 학교 판정은 건드리지 않음
    expect((await listSchoolAlerts(prisma, { schoolId: incheon, userId: staffUser, role: "staff" })).alerts).toHaveLength(1);
  });
});

describe("④ 교직원 경보함", () => {
  it("교직원은 대상 경보만, 관리자는 미판정 경보도 본다", async () => {
    await collect([heat(), heat({ id: "T-UNCLEAR", body: "[모의] 지역 불명", areas: "어딘가 일대", issuedAt: minutesAgo(5) })]);
    const staff = await listSchoolAlerts(prisma, { schoolId: incheon, userId: staffUser, role: "staff" });
    expect(staff.alerts.map((a) => a.result)).toEqual(["target"]);
    const admin = await listSchoolAlerts(prisma, { schoolId: incheon, userId: adminUser, role: "admin" });
    expect(admin.alerts.map((a) => a.result).sort()).toEqual(["target", "undetermined"]);
    expect(admin.unreadCount).toBe(1); // 미판정은 읽지 않음 수에 넣지 않음
  });

  it("읽음 상태는 사용자별이고, 다른 학교 경보는 읽음 처리할 수 없다", async () => {
    await collect([heat()]);
    const { alerts } = await listSchoolAlerts(prisma, { schoolId: incheon, userId: staffUser, role: "staff" });
    await markAlertRead(prisma, { schoolId: incheon, userId: staffUser, role: "staff", matchId: alerts[0]!.matchId });
    await markAlertRead(prisma, { schoolId: incheon, userId: staffUser, role: "staff", matchId: alerts[0]!.matchId }); // 두 번 눌러도 1건
    expect((await listSchoolAlerts(prisma, { schoolId: incheon, userId: staffUser, role: "staff" })).unreadCount).toBe(0);
    expect((await listSchoolAlerts(prisma, { schoolId: incheon, userId: adminUser, role: "admin" })).unreadCount).toBe(1);
    await expect(markAlertRead(prisma, { schoolId: busan, userId: staffUser, role: "staff", matchId: alerts[0]!.matchId })).rejects.toMatchObject({ status: 404 });
    // 비대상 학교 경보함에는 없음
    expect((await listSchoolAlerts(prisma, { schoolId: busan, userId: staffUser, role: "admin" })).alerts).toHaveLength(0);
  });

  it("경보 수집은 학교 재난 발령을 자동으로 만들지 않는다", async () => {
    await collect([heat({ severity: "emergency" })]);
    expect(await prisma.disasterEvent.count()).toBe(0);
  });
});
