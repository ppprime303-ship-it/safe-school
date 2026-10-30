// Beta PILOT 2 Phase 2-A: 교직원 앱 내 알림·소재 보고·집계(HTTP, 테스트 스키마, 가상 교직원만)
// - 알림: 실제 재난·모의훈련 모두 승인 교직원별 1건, 본인만 확인, 생성 ≠ 전달
// - 소재: 실제 재난·진행 중에만 본인이 보고(모의훈련 403·DB 행 없음), 판 번호·이력·재전송, 종료 후 409(종료 경합 포함)
// - 집계: 요약은 누구나(개인 정보 없음), 상세는 학교 관리자·교장·교감·안전업무 담당(등록 직책)만, 대상 변동(승인·회수) 반영
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { Server } from "node:http";
import { randomUUID } from "node:crypto";
import type { PrismaClient } from "@prisma/client";
import { createTestClient, getTestDatabaseUrl, resetTestData } from "./test-db";

const PASSWORD = "presence-test-password-1234";
let prisma: PrismaClient;
let server: Server;
let base = "";
const school: Record<"a" | "b", string> = { a: "", b: "" };
const U: Record<string, string> = {};
const M: Record<string, string> = {};
const cookie: Record<string, string> = {};
const ip: Record<string, string> = {};
let classA1 = "";
let drillA = "";
let realA = "";
const DUTY: Record<string, string> = {};

async function call(who: string, method: string, path: string, body?: unknown, headers: Record<string, string> = {}) {
  const res = await fetch(`${base}/api${path}`, {
    method,
    headers: { cookie: cookie[who] ?? "", "x-forwarded-for": ip[who] ?? "198.51.100.121", ...(method === "GET" ? {} : { "content-type": "application/json" }), ...headers },
    body: method === "GET" ? undefined : JSON.stringify(body ?? {}),
  });
  const text = await res.text();
  return { status: res.status, body: (text ? JSON.parse(text) : {}) as Record<string, any>, raw: text };
}
const A = (p = "") => `/schools/${school.a}${p}`;
const put = (who: string, eventId: string, body: Record<string, unknown>, key = randomUUID()) => call(who, "PUT", A(`/events/${eventId}/presence/me`), body, { "idempotency-key": key });
const onCampus = (over: Record<string, unknown> = {}) => ({ location: "on_campus", placeCategory: "classroom", placeDetail: "3학년 2반", availability: "available", expectedVersion: null, ...over });
const offCampus = (over: Record<string, unknown> = {}) => ({ location: "off_campus", availability: "unavailable", expectedVersion: null, ...over });
const approvedActiveA = () => prisma.schoolMembership.count({ where: { schoolId: school.a, status: "approved", user: { status: "active" } } });

beforeAll(async () => {
  process.env.DATABASE_URL = getTestDatabaseUrl();
  prisma = createTestClient();
  await resetTestData(prisma);
  const { hashPassword } = await import("../server/src/security/password");
  const { grantDutyByPlatformOperator } = await import("../server/src/services/duties");
  const { currentSchoolYear } = await import("../server/src/services/events");
  const passwordHash = await hashPassword(PASSWORD);
  const now = new Date();
  for (const k of ["a", "b"] as const) {
    school[k] = (await prisma.school.create({ data: { slug: `presence-${k}`, name: `가상 소재학교 ${k.toUpperCase()}`, isDemo: true, status: "active", activatedAt: now } })).id;
  }
  classA1 = (await prisma.schoolClass.create({ data: { schoolId: school.a, schoolYear: currentSchoolYear(), grade: 1, classNo: 1, label: "1학년 1반", enrolledCount: 20, enrolledConfirmedAt: now } })).id;
  const people: { key: string; k: "a" | "b"; role: "admin" | "homeroom" | "staff"; status?: "pending"; position?: string; login?: boolean }[] = [
    { key: "adminA", k: "a", role: "admin" },
    { key: "principalA", k: "a", role: "staff" },
    { key: "viceA", k: "a", role: "staff" },
    { key: "safetyA", k: "a", role: "staff" },
    { key: "opA", k: "a", role: "staff" },
    { key: "teacherA", k: "a", role: "homeroom" },
    { key: "staffA", k: "a", role: "staff" },
    { key: "staffA2", k: "a", role: "staff" },
    { key: "claimedPrincipalA", k: "a", role: "staff", position: "principal" }, // 가입 때 '교장'이라고만 적음(등록 직책 아님)
    { key: "pendingA", k: "a", role: "staff", status: "pending" },
    { key: "adminB", k: "b", role: "admin" },
    { key: "staffB", k: "b", role: "staff" },
  ];
  for (const [i, p] of people.entries()) {
    const email = `${p.key.toLowerCase()}@presence.safeschool.invalid`;
    const user = await prisma.user.create({ data: { email, displayName: `가상 ${p.key}`, passwordHash, emailVerifiedAt: now } });
    U[p.key] = user.id;
    const status = p.status ?? "approved";
    M[p.key] = (
      await prisma.schoolMembership.create({
        data: { schoolId: school[p.k], userId: user.id, role: p.role, status, requestedPosition: p.position ?? null, ...(status === "approved" ? { approvalMethod: "roster", approvedAt: now } : {}) },
      })
    ).id;
    ip[p.key] = `203.0.113.${10 + i}`;
  }
  await prisma.classAssignment.create({ data: { membershipId: M.teacherA!, classId: classA1, duty: "homeroom" } });
  for (const [key, duty] of [["principalA", "principal"], ["viceA", "vice_principal"], ["safetyA", "safety_officer"], ["opA", "app_operator"]] as const) {
    DUTY[key] = ((await grantDutyByPlatformOperator(prisma, { membershipId: M[key]!, duty, operator: "소재 테스트", verificationMethod: "테스트" })) as { id: string }).id;
  }

  const { createApp } = await import("../server/src/app");
  const http = await import("node:http");
  server = http.createServer(await createApp({ mode: "test", trustProxyHops: 1 }));
  await new Promise<void>((r) => server.listen(0, "127.0.0.1", () => r()));
  const addr = server.address();
  base = `http://127.0.0.1:${typeof addr === "object" && addr ? addr.port : 0}`;
  for (const p of people) {
    const res = await fetch(`${base}/api/auth/login`, {
      method: "POST",
      headers: { "content-type": "application/json", "x-forwarded-for": ip[p.key]! },
      body: JSON.stringify({ email: `${p.key.toLowerCase()}@presence.safeschool.invalid`, password: PASSWORD, deviceKind: "personal" }),
    });
    expect(res.status).toBe(200);
    cookie[p.key] = res.headers.get("set-cookie")!.split(";")[0]!;
  }
});

afterAll(async () => {
  await new Promise<void>((r) => server.close(() => r()));
  await prisma.$disconnect();
});

describe("모의훈련: 안내 알림만, 소재는 받지 않음", () => {
  it("훈련 발령 → 승인 교직원 전원 알림 1건씩(대기·다른 학교 제외), 소재 보고 요청 표시 없음", async () => {
    const issued = await call("adminA", "POST", A("/events"), { primaryType: "fire", mode: "drill" });
    expect(issued.status).toBe(201);
    drillA = issued.body.event.id;
    expect(await prisma.staffAlert.count({ where: { eventId: drillA } })).toBe(await approvedActiveA());
    expect(await prisma.staffAlert.count({ where: { eventId: drillA, membershipId: { in: [M.pendingA!, M.staffB!] } } })).toBe(0);
    const mine = await call("staffA", "GET", A("/staff-alerts"));
    expect(mine.status).toBe(200);
    expect(mine.body.unreadCount).toBe(1);
    expect(mine.body.alerts[0]).toMatchObject({ readAt: null, presenceRequested: false, event: { id: drillA, mode: "drill", status: "active" } });
  });

  it("훈련에서 소재 보고 생성 403(정책 오류), 조회·요약·상세 403, 소재 행 0건", async () => {
    const r = await put("staffA", drillA, onCampus());
    expect(r.status).toBe(403);
    expect(r.body.code).toBe("presence_not_collected_for_drill");
    expect((await call("staffA", "GET", A(`/events/${drillA}/presence/me`))).status).toBe(403);
    expect((await call("staffA", "GET", A(`/events/${drillA}/presence/summary`))).status).toBe(403);
    expect((await call("adminA", "GET", A(`/events/${drillA}/presence`))).status).toBe(403);
    expect(await prisma.staffPresence.count({ where: { eventId: drillA } })).toBe(0);
  });

  it("DB 최종 방어선: 훈련 사건에 소재 행을 직접 넣어도 트리거가 거부", async () => {
    await expect(
      prisma.staffPresence.create({ data: { schoolId: school.a, eventId: drillA, membershipId: M.staffA!, location: "off_campus", availability: "available" } }),
    ).rejects.toThrow();
    expect(await prisma.staffPresence.count({ where: { eventId: drillA } })).toBe(0);
  });

  it("요청 본문으로 모드 우회 불가: 발령 수정에 mode 를 넣어도 훈련 그대로, 소재 요청에 mode·소속 id 를 넣으면 400", async () => {
    const patched = await call("adminA", "PATCH", A(`/events/${drillA}`), { mode: "real", message: "모드 변경 시도" });
    expect(patched.status).toBe(200);
    expect((await prisma.disasterEvent.findUniqueOrThrow({ where: { id: drillA } })).mode).toBe("drill");
    expect((await put("staffA", drillA, { ...onCampus(), mode: "real" })).status).toBe(400);
    expect((await put("staffA", drillA, { ...onCampus(), membershipId: M.staffA2 })).status).toBe(400);
    expect(await prisma.staffPresence.count()).toBe(0);
  });

  it("훈련 알림 확인은 본인만(다른 사람·다른 학교 알림 404), 처음 확인 시각 유지, 다시 조회해도 확인 상태 유지", async () => {
    const mine = (await call("staffA", "GET", A("/staff-alerts"))).body.alerts[0];
    const others = await prisma.staffAlert.findFirstOrThrow({ where: { eventId: drillA, membershipId: M.staffA2! } });
    expect((await call("staffA", "POST", A(`/staff-alerts/${others.id}/read`))).status).toBe(404);
    expect((await call("staffB", "POST", `/schools/${school.b}/staff-alerts/${mine.id}/read`)).status).toBe(404);
    expect((await call("staffB", "POST", A(`/staff-alerts/${mine.id}/read`))).status).toBe(404);
    const first = await call("staffA", "POST", A(`/staff-alerts/${mine.id}/read`));
    expect(first.status).toBe(200);
    const again = await call("staffA", "POST", A(`/staff-alerts/${mine.id}/read`));
    expect(again.body.readAt).toBe(first.body.readAt);
    const list = await call("staffA", "GET", A("/staff-alerts"));
    expect(list.body.unreadCount).toBe(0);
    expect((await prisma.staffAlert.findUniqueOrThrow({ where: { id: others.id } })).readAt).toBeNull();
  });

  it("훈련 중 학급 대피 보고·종료·훈련일지는 그대로", async () => {
    const rep = await call("teacherA", "PUT", A(`/events/${drillA}/reports/${classA1}`), { evacuated: 20, absentKnown: 0, injured: 0, enrolledCount: 20, enrolledChangeReason: null, note: null, expectedVersion: null }, { "idempotency-key": randomUUID() });
    expect(rep.status).toBe(200);
    expect((await call("adminA", "POST", A(`/events/${drillA}/close`), {})).status).toBe(200);
    const log = await call("safetyA", "POST", A(`/events/${drillA}/drill-log`), {});
    expect([200, 201]).toContain(log.status);
    expect((await put("staffA", drillA, onCampus())).status).toBe(403); // 종료 후에도 훈련은 소재 없음
    expect(await prisma.staffPresence.count()).toBe(0);
  });
});

describe("실제 재난: 알림과 본인 소재 보고", () => {
  it("실제 재난 발령 → 알림 1건씩, 진행 중 재발령 409로 알림 중복 없음, 소재 보고 요청 표시", async () => {
    const issued = await call("adminA", "POST", A("/events"), { primaryType: "earthquake", mode: "real", confirmReal: true });
    expect(issued.status).toBe(201);
    realA = issued.body.event.id;
    expect((await call("safetyA", "POST", A("/events"), { primaryType: "fire", mode: "real", confirmReal: true })).status).toBe(409);
    expect(await prisma.staffAlert.count({ where: { eventId: realA } })).toBe(await approvedActiveA());
    const mine = await call("staffA", "GET", A("/staff-alerts"));
    expect(mine.body.alerts[0]).toMatchObject({ presenceRequested: true, event: { id: realA, mode: "real" } });
    expect(await prisma.staffAlert.count({ where: { membershipId: M.staffA! } })).toBe(2); // 훈련 1 + 실제 1(사건별 독립)
  });

  it("최초 보고 200(판 1, 위치 '교실 / 3학년 2반'), 수정 200(판 2, 교외는 위치 없음), 이력 2건", async () => {
    const first = await put("staffA", realA, onCampus());
    expect(first.status).toBe(200);
    expect(first.body.presence).toMatchObject({ version: 1, location: "on_campus", placeLabel: "교실 / 3학년 2반", availability: "available" });
    const second = await put("staffA", realA, offCampus({ expectedVersion: 1 }));
    expect(second.status).toBe(200);
    expect(second.body.presence).toMatchObject({ version: 2, location: "off_campus", placeCategory: null, placeDetail: null, placeLabel: null });
    const hist = await prisma.staffPresenceHistory.findMany({ where: { presence: { membershipId: M.staffA! } }, orderBy: { version: "asc" } });
    expect(hist.map((h) => [h.version, h.location, h.placeDetail])).toEqual([[1, "on_campus", "3학년 2반"], [2, "off_campus", null]]);
    const me = await call("staffA", "GET", A(`/events/${realA}/presence/me`));
    expect(me.body).toMatchObject({ eventStatus: "active", presence: { version: 2 } });
  });

  it("오래된 판 409(덮어쓰지 않음), 같은 요청 번호 재전송은 본인에게만 같은 결과, 동시 수정 1건만", async () => {
    const stale = await put("staffA", realA, onCampus({ expectedVersion: 1 }));
    expect(stale.status).toBe(409);
    expect(stale.body.code).toBe("version_conflict");
    const key = randomUUID();
    const a = await put("staffA", realA, onCampus({ placeCategory: "staff_room", placeDetail: null, expectedVersion: 2 }), key);
    expect(a.status).toBe(200);
    const replay = await put("staffA", realA, onCampus({ placeCategory: "staff_room", placeDetail: null, expectedVersion: 2 }), key);
    expect(replay.body.replayed).toBe(true);
    expect((await put("staffA2", realA, onCampus(), key)).status).toBe(409);
    const [x, y] = await Promise.all([put("staffA", realA, offCampus({ expectedVersion: 3 })), put("staffA", realA, offCampus({ expectedVersion: 3 }))]); // 같은 내용 — 결과가 어느 쪽이든 같게
    expect([x.status, y.status].sort()).toEqual([200, 409]);
    expect((await prisma.staffPresence.findFirstOrThrow({ where: { membershipId: M.staffA!, eventId: realA } })).version).toBe(4);
    expect(await prisma.staffPresenceHistory.count({ where: { presence: { membershipId: M.staffA! } } })).toBe(4);
  });

  it("입력 검증: 교내 장소 없음·기타인데 상세 없음·교외에 위치·전화번호·41자 → 400, 대상 지정 필드 거부", async () => {
    const bad = [
      onCampus({ placeCategory: null }),
      onCampus({ placeCategory: "other", placeDetail: null }),
      offCampus({ placeCategory: "classroom" }),
      onCampus({ placeDetail: "010-1234-5678" }),
      onCampus({ placeDetail: "가".repeat(41) }),
      { ...onCampus(), userId: U.staffA2 },
    ];
    for (const b of bad) expect((await put("staffA2", realA, b)).status).toBe(400);
    expect(await prisma.staffPresence.count({ where: { membershipId: M.staffA2! } })).toBe(0);
  });

  it("다른 학교·다른 사건 경로: B 교직원이 A 사건 보고 404, A 교직원이 B 경로 404, 승인 대기 403", async () => {
    expect((await call("staffB", "PUT", A(`/events/${realA}/presence/me`), onCampus(), { "idempotency-key": randomUUID() })).status).toBe(404);
    expect((await call("staffA", "PUT", `/schools/${school.b}/events/${realA}/presence/me`, onCampus(), { "idempotency-key": randomUUID() })).status).toBe(404);
    expect((await call("adminB", "GET", `/schools/${school.b}/events/${realA}/presence/summary`)).status).toBe(404);
    expect((await call("pendingA", "PUT", A(`/events/${realA}/presence/me`), onCampus(), { "idempotency-key": randomUUID() })).status).toBe(403);
  });

  it("감사 기록에는 위치 내용이 없음(사건·판 번호만)", async () => {
    const logs = await prisma.auditLog.findMany({ where: { action: { in: ["presence.reported", "presence.updated"] } } });
    expect(logs.length).toBe(4);
    for (const l of logs) expect(JSON.stringify([l.before, l.after])).not.toMatch(/3학년|교실|classroom|staff_room|on_campus|off_campus/);
  });
});

describe("집계와 상세 권한", () => {
  it("요약(일반 교직원): 숫자만 — 성명·위치·소속 id 없음, 합계 일치", async () => {
    expect((await put("teacherA", realA, onCampus({ placeCategory: "playground", placeDetail: "남쪽 출입구", availability: "unsure" }))).status).toBe(200);
    const r = await call("staffA2", "GET", A(`/events/${realA}/presence/summary`));
    expect(r.status).toBe(200);
    const target = await approvedActiveA();
    expect(r.body.summary).toMatchObject({ targetCount: target, respondedCount: 2, notRespondedCount: target - 2, onCampus: 1, offCampus: 1, unsure: 1 });
    const s = r.body.summary;
    expect(s.onCampus + s.offCampus).toBe(s.respondedCount);
    expect(s.available + s.unavailable + s.unsure).toBe(s.respondedCount);
    expect(r.raw).not.toMatch(/가상 |남쪽|운동장|playground|membershipId/);
    expect(Object.keys(r.body).sort()).toEqual(["eventId", "eventStatus", "scope", "summary"]);
  });

  it("상세: 일반 교직원·담임·앱 운영담당·가입 때 '교장'이라고만 적은 사용자 403", async () => {
    for (const who of ["staffA2", "teacherA", "opA", "claimedPrincipalA"]) {
      expect((await call(who, "GET", A(`/events/${realA}/presence`))).status).toBe(403);
      expect((await call(who, "GET", A(`/events/${realA}/presence/members/${M.staffA}/history`))).status).toBe(403);
    }
  });

  it("상세: 학교 관리자·교장·교감·안전업무 담당 200 — 개인별 소재·미응답자 명단·장소별·이력", async () => {
    for (const who of ["adminA", "principalA", "viceA", "safetyA"]) {
      const r = await call(who, "GET", A(`/events/${realA}/presence`));
      expect(r.status).toBe(200);
      expect(r.body.notResponded.length).toBe(r.body.summary.notRespondedCount);
      const teacher = (r.body.people as { membershipId: string; presence: { placeLabel: string } | null }[]).find((p) => p.membershipId === M.teacherA)!;
      expect(teacher.presence!.placeLabel).toBe("운동장 / 남쪽 출입구");
      expect(r.body.byPlace).toEqual([{ placeCategory: "playground", count: 1 }]);
    }
    const h = await call("safetyA", "GET", A(`/events/${realA}/presence/members/${M.staffA}/history`));
    expect(h.status).toBe(200);
    expect(h.body.history.map((x: { version: number }) => x.version)).toEqual([1, 2, 3, 4]);
  });

  it("다른 학교 관리자는 A 상세 404", async () => {
    expect((await call("adminB", "GET", A(`/events/${realA}/presence`))).status).toBe(404);
  });

  it("대상 변동: 진행 중 승인된 교직원은 대상·미응답에 추가, 회수된 교직원 응답은 집계에서 빠지되 행은 보존", async () => {
    const before = (await call("adminA", "GET", A(`/events/${realA}/presence`))).body.summary;
    expect((await call("adminA", "POST", A("/members/approve"), { membershipIds: [M.pendingA] })).status).toBe(200);
    expect((await put("staffA2", realA, offCampus())).status).toBe(200);
    const mid = (await call("adminA", "GET", A(`/events/${realA}/presence`))).body;
    expect(mid.summary).toMatchObject({ targetCount: before.targetCount + 1, respondedCount: before.respondedCount + 1, notRespondedCount: before.notRespondedCount });
    expect(await prisma.staffAlert.count({ where: { eventId: realA, membershipId: M.pendingA! } })).toBe(1);

    expect((await call("adminA", "POST", A(`/members/${M.staffA2}/revoke`), {})).status).toBe(200);
    const after = (await call("adminA", "GET", A(`/events/${realA}/presence`))).body;
    expect(after.summary).toMatchObject({ targetCount: mid.summary.targetCount - 1, respondedCount: mid.summary.respondedCount - 1 });
    expect(after.excludedResponses).toBe(1);
    expect(await prisma.staffPresence.count({ where: { membershipId: M.staffA2! } })).toBe(1);
    expect(await prisma.staffPresenceHistory.count({ where: { presence: { membershipId: M.staffA2! } } })).toBe(1);
  });

  it("교감 직책 해제 즉시 상세 403", async () => {
    const { endDuty } = await import("../server/src/services/duties");
    await endDuty(prisma, { schoolId: school.a, dutyId: DUTY.viceA!, reason: "전보(테스트)", actorLabel: "플랫폼 운영자(테스트)", via: "platform_operator" });
    expect((await call("viceA", "GET", A(`/events/${realA}/presence`))).status).toBe(403);
    expect((await call("viceA", "GET", A(`/events/${realA}/presence/summary`))).status).toBe(200);
  });
});

describe("종료 경합과 종료 후", () => {
  it("종료와 소재 보고가 동시에 와도 종료 후 저장 없음, 종료 뒤 보고·수정 409, 조회는 가능", async () => {
    const [close, rep] = await Promise.all([
      call("adminA", "POST", A(`/events/${realA}/close`), { confirmClose: true }),
      put("safetyA", realA, onCampus({ placeCategory: "nurse_room", placeDetail: null })),
    ]);
    expect(close.status).toBe(200);
    expect([200, 409]).toContain(rep.status);
    const ev = await prisma.disasterEvent.findUniqueOrThrow({ where: { id: realA } });
    expect(ev.status).toBe("closed");
    const late = await prisma.staffPresence.count({ where: { eventId: realA, respondedAt: { gt: ev.closedAt! } } });
    expect(late).toBe(0);
    const after = await put("principalA", realA, offCampus());
    expect(after.status).toBe(409);
    expect(after.body.code).toBe("event_closed");
    expect((await put("staffA", realA, offCampus({ expectedVersion: 4 }))).status).toBe(409);
    expect((await call("staffA", "GET", A(`/events/${realA}/presence/me`))).body).toMatchObject({ eventStatus: "closed", presence: { version: 4 } });
    expect((await call("staffA", "GET", A(`/events/${realA}/presence/summary`))).status).toBe(200);
    expect((await call("adminA", "GET", A(`/events/${realA}/presence`))).body.eventStatus).toBe("closed");
    const alerts = await call("staffA", "GET", A("/staff-alerts"));
    expect(alerts.body.alerts.find((a: { event: { id: string } }) => a.event.id === realA)).toMatchObject({ presenceRequested: false, event: { status: "closed" } });
  });

  it("DB 최종 방어선: 종료된 실제 재난에 소재 행을 직접 넣어도 트리거가 거부", async () => {
    await expect(
      prisma.staffPresence.create({ data: { schoolId: school.a, eventId: realA, membershipId: M.principalA!, location: "off_campus", availability: "available" } }),
    ).rejects.toThrow();
  });

  it("관리자 권한 이양 후 상세 권한도 이동(기존 관리자 403, 새 관리자 200)", async () => {
    expect((await call("adminA", "POST", A("/admin-transfer"), { targetMembershipId: M.staffA, confirm: true })).status).toBe(200);
    expect((await call("adminA", "GET", A(`/events/${realA}/presence`))).status).toBe(403);
    expect((await call("staffA", "GET", A(`/events/${realA}/presence`))).status).toBe(200);
  });
});
