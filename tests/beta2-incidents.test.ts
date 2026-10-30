// Beta PILOT 2 Phase 3-A: 현장 상황 공유(HTTP, 테스트 스키마, 가상 교직원·가상 상황만)
// - 실제 재난·모의훈련 모두 제보(훈련은 소재 미수집 유지), 사건별 분리, 다른 학교 404
// - 유사 제보 제안(막지 않음), 후속 정보 추가 전용, 본문 덮어쓰기 금지(DB), 처리 상태는 대응 담당자만·충돌 409
// - 종료와 제보 경합 시 종료 뒤 저장 없음, 종료 후 작성·추가·상태 변경 409, 조회 유지
// - 일반 교직원 응답에 작성자 이름 없음, 감사 기록에 설명·후속 내용 없음
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { Server } from "node:http";
import { randomUUID } from "node:crypto";
import type { PrismaClient } from "@prisma/client";
import { createTestClient, getTestDatabaseUrl, resetTestData } from "./test-db";

const PASSWORD = "incident-test-password-1234";
let prisma: PrismaClient;
let server: Server;
let base = "";
const school: Record<"a" | "b", string> = { a: "", b: "" };
const U: Record<string, string> = {};
const M: Record<string, string> = {};
const cookie: Record<string, string> = {};
const ip: Record<string, string> = {};
let drillA = "";
let realA = "";
const I: Record<string, string> = {};

async function call(who: string, method: string, path: string, body?: unknown, headers: Record<string, string> = {}) {
  const res = await fetch(`${base}/api${path}`, {
    method,
    headers: { cookie: cookie[who] ?? "", "x-forwarded-for": ip[who] ?? "198.51.100.131", ...(method === "GET" ? {} : { "content-type": "application/json" }), ...headers },
    body: method === "GET" ? undefined : JSON.stringify(body ?? {}),
  });
  const text = await res.text();
  return { status: res.status, body: (text ? JSON.parse(text) : {}) as Record<string, any>, raw: text };
}
const A = (p: string) => `/schools/${school.a}${p}`;
const key = () => ({ "idempotency-key": randomUUID() });
const report = (who: string, eventId: string, body: Record<string, unknown>, k = key()) => call(who, "POST", A(`/events/${eventId}/incidents`), body, k);
const glass = { type: "hazard", placeCategory: "stairs", placeDetail: "본관 2층", description: "계단에 깨진 유리 파편이 흩어져 있습니다" };
const light = { type: "facility_damage", placeCategory: "gym", placeDetail: null, description: "체육관 천장 조명이 떨어졌습니다" };

beforeAll(async () => {
  process.env.DATABASE_URL = getTestDatabaseUrl();
  prisma = createTestClient();
  await resetTestData(prisma);
  const { hashPassword } = await import("../server/src/security/password");
  const { grantDutyByPlatformOperator } = await import("../server/src/services/duties");
  const passwordHash = await hashPassword(PASSWORD);
  const now = new Date();
  for (const k of ["a", "b"] as const) {
    school[k] = (await prisma.school.create({ data: { slug: `incident-${k}`, name: `가상 제보학교 ${k.toUpperCase()}`, isDemo: true, status: "active", activatedAt: now } })).id;
  }
  const people: { key: string; k: "a" | "b"; role: "admin" | "homeroom" | "staff" }[] = [
    { key: "adminA", k: "a", role: "admin" },
    { key: "principalA", k: "a", role: "staff" },
    { key: "safetyA", k: "a", role: "staff" },
    { key: "opA", k: "a", role: "staff" },
    { key: "staffA", k: "a", role: "staff" },
    { key: "staffA2", k: "a", role: "homeroom" },
    { key: "adminB", k: "b", role: "admin" },
    { key: "staffB", k: "b", role: "staff" },
  ];
  for (const [i, p] of people.entries()) {
    const user = await prisma.user.create({ data: { email: `${p.key.toLowerCase()}@incident.safeschool.invalid`, displayName: `가상 ${p.key}`, passwordHash, emailVerifiedAt: now } });
    U[p.key] = user.id;
    M[p.key] = (await prisma.schoolMembership.create({ data: { schoolId: school[p.k], userId: user.id, role: p.role, status: "approved", approvalMethod: "roster", approvedAt: now } })).id;
    ip[p.key] = `203.0.113.${60 + i}`;
  }
  for (const [k, duty] of [["principalA", "principal"], ["safetyA", "safety_officer"], ["opA", "app_operator"]] as const) {
    await grantDutyByPlatformOperator(prisma, { membershipId: M[k]!, duty, operator: "제보 테스트", verificationMethod: "테스트" });
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
      body: JSON.stringify({ email: `${p.key.toLowerCase()}@incident.safeschool.invalid`, password: PASSWORD, deviceKind: "personal" }),
    });
    expect(res.status).toBe(200);
    cookie[p.key] = res.headers.get("set-cookie")!.split(";")[0]!;
  }
  const issued = await call("adminA", "POST", A("/events"), { primaryType: "fire", mode: "drill" });
  expect(issued.status).toBe(201);
  drillA = issued.body.event.id;
});

afterAll(async () => {
  await new Promise<void>((r) => server.close(() => r()));
  await prisma.$disconnect();
});

describe("모의훈련 제보", () => {
  it("훈련 상황 제보 201, 목록에 훈련 표시, 교직원 소재는 여전히 미수집(403, 행 0)", async () => {
    const r = await report("staffA", drillA, glass);
    expect(r.status).toBe(201);
    I.glass = r.body.id;
    const list = await call("staffA2", "GET", A(`/events/${drillA}/incidents`));
    expect(list.status).toBe(200);
    expect(list.body.event).toMatchObject({ mode: "drill", status: "active" });
    expect(list.body.incidents[0]).toMatchObject({ id: I.glass, type: "hazard", placeLabel: "계단 / 본관 2층", status: "received", mine: false });
    expect((await call("staffA", "PUT", A(`/events/${drillA}/presence/me`), { location: "off_campus", availability: "available", expectedVersion: null }, key())).status).toBe(403);
    expect(await prisma.staffPresence.count()).toBe(0);
  });

  it("입력 검증: 1자 설명·전화번호·기타인데 상세 없음·모르는 필드(작성자 지정) → 400, 저장 없음", async () => {
    const bad = [
      { ...glass, description: "유" },
      { ...glass, description: "담임 010-1234-5678 연락" },
      { ...glass, placeCategory: "other", placeDetail: null },
      { ...glass, reporterMembershipId: M.staffA2 },
      { ...glass, location: "on_campus" },
    ];
    for (const b of bad) expect((await report("staffA2", drillA, b)).status).toBe(400);
    expect(await prisma.incidentReport.count()).toBe(1);
  });

  it("같은 요청 번호 재전송은 1건만", async () => {
    const k = key();
    const a = await report("staffA2", drillA, light, k);
    const b = await report("staffA2", drillA, light, k);
    expect(a.status).toBe(201);
    expect(b.status).toBe(200);
    expect(b.body).toMatchObject({ id: a.body.id, replayed: true });
    I.light = a.body.id;
  });
});

describe("유사 제보 제안", () => {
  const q = (o: Record<string, string>) => A(`/events/${drillA}/incidents/similar?${new URLSearchParams(o)}`);

  it("같은 장소·유형·비슷한 설명이면 제안(유리 파편), 다른 장소·유형은 제외(조명)", async () => {
    const r = await call("staffA2", "GET", q({ type: "hazard", placeCategory: "stairs", placeDetail: "본관 2층 계단", description: "계단 유리 파편" }));
    expect(r.status).toBe(200);
    expect(r.body.similar.map((s: { id: string }) => s.id)).toEqual([I.glass]);
    expect(r.body.similar[0].score).toBeGreaterThanOrEqual(4);
    const none = await call("staffA2", "GET", q({ type: "help_needed", placeCategory: "playground", description: "학생이 넘어져 도움 필요" }));
    expect(none.body.similar).toEqual([]);
  });

  it("유사 제보가 있어도 새 제보는 막지 않음(201)", async () => {
    const r = await report("staffA2", drillA, { ...glass, description: "계단 유리 파편 옆 난간도 흔들립니다" });
    expect(r.status).toBe(201);
    I.glass2 = r.body.id;
  });
});

describe("후속 정보·처리 상태", () => {
  it("후속 정보 추가 201(누구나), 최근 활동 갱신, 재전송 1건, 목록에서 위로", async () => {
    const before = (await prisma.incidentReport.findUniqueOrThrow({ where: { id: I.light! } })).lastActivityAt;
    const k = key();
    const u = await call("staffA", "POST", A(`/incidents/${I.light}/updates`), { kind: "change", note: "조명 아래 물이 고이기 시작했습니다" }, k);
    expect(u.status).toBe(201);
    expect((await call("staffA", "POST", A(`/incidents/${I.light}/updates`), { kind: "change", note: "조명 아래 물이 고이기 시작했습니다" }, k)).body.replayed).toBe(true);
    expect(await prisma.incidentUpdate.count({ where: { incidentId: I.light! } })).toBe(1);
    expect((await prisma.incidentReport.findUniqueOrThrow({ where: { id: I.light! } })).lastActivityAt.getTime()).toBeGreaterThan(before.getTime());
    const detail = await call("staffA2", "GET", A(`/incidents/${I.light}`));
    expect(detail.body.incident.updates).toMatchObject([{ kind: "change", note: "조명 아래 물이 고이기 시작했습니다", mine: false }]);
  });

  it("본문 덮어쓰기·후속 정보 수정·삭제는 DB 가 거부", async () => {
    await expect(prisma.incidentReport.update({ where: { id: I.glass! }, data: { description: "바꾼 내용" } })).rejects.toThrow();
    const upd = await prisma.incidentUpdate.findFirstOrThrow({ where: { incidentId: I.light! } });
    await expect(prisma.incidentUpdate.update({ where: { id: upd.id }, data: { note: "바꿈" } })).rejects.toThrow();
    await expect(prisma.incidentUpdate.delete({ where: { id: upd.id } })).rejects.toThrow();
    await expect(prisma.incidentReport.delete({ where: { id: I.glass! } })).rejects.toThrow();
    expect((await prisma.incidentReport.findUniqueOrThrow({ where: { id: I.glass! } })).description).toBe(glass.description);
  });

  it("처리 상태: 일반 교직원·담임·앱 운영담당 403", async () => {
    for (const who of ["staffA", "staffA2", "opA"]) {
      expect((await call(who, "POST", A(`/incidents/${I.glass}/status`), { status: "checking", expectedStatus: "received" })).status).toBe(403);
    }
    expect((await prisma.incidentReport.findUniqueOrThrow({ where: { id: I.glass! } })).status).toBe("received");
  });

  it("처리 상태: 안전업무 담당·교장 변경 200, 오래된 상태 기준 409, 이력 보존", async () => {
    expect((await call("safetyA", "POST", A(`/incidents/${I.glass}/status`), { status: "checking", expectedStatus: "received" })).status).toBe(200);
    const stale = await call("principalA", "POST", A(`/incidents/${I.glass}/status`), { status: "resolved", expectedStatus: "received" });
    expect(stale.status).toBe(409);
    expect(stale.body.code).toBe("status_changed");
    expect((await call("principalA", "POST", A(`/incidents/${I.glass}/status`), { status: "in_progress", expectedStatus: "checking" })).status).toBe(200);
    const hist = await prisma.incidentStatusHistory.findMany({ where: { incidentId: I.glass! }, orderBy: { createdAt: "asc" } });
    expect(hist.map((h) => [h.fromStatus, h.toStatus, h.changedByMembershipId])).toEqual([["received", "checking", M.safetyA], ["checking", "in_progress", M.principalA]]);
  });

  it("작성자 이름: 일반 교직원 응답에는 없음('내 제보'만), 대응 담당자에게는 있음 / 사진 목록은 열람 권한자만", async () => {
    const mine = await call("staffA", "GET", A(`/incidents/${I.glass}`));
    expect(mine.body.incident.mine).toBe(true);
    for (const who of ["staffA", "staffA2"]) {
      const r = await call(who, "GET", A(`/incidents/${I.glass}`));
      expect(r.raw).not.toContain("가상 ");
      expect(r.body.incident).not.toHaveProperty("reporterName");
      expect(r.body.incident).not.toHaveProperty("photos");
      expect(r.body.incident.statusHistory[0]).not.toHaveProperty("changedByName");
    }
    const adm = await call("adminA", "GET", A(`/incidents/${I.glass}`));
    expect(adm.body.incident).toMatchObject({ reporterName: "가상 staffA", photos: [] });
    expect(adm.body.incident.statusHistory[0]).toMatchObject({ changedByName: "가상 safetyA" });
  });

  it("감사 기록에 설명·후속 내용·장소 상세 없음", async () => {
    const logs = await prisma.auditLog.findMany({ where: { action: { startsWith: "incident." } } });
    expect(logs.length).toBeGreaterThanOrEqual(5);
    for (const l of logs) expect(JSON.stringify([l.before, l.after])).not.toMatch(/유리|조명|물이|본관|난간/);
  });
});

describe("학교·사건 격리", () => {
  it("다른 학교: B 교직원은 A 목록·상세·제보·후속·상태 모두 404(경로·자원 id 모두)", async () => {
    expect((await call("staffB", "GET", A(`/events/${drillA}/incidents`))).status).toBe(404);
    expect((await call("staffB", "GET", `/schools/${school.b}/events/${drillA}/incidents`)).status).toBe(404);
    expect((await call("staffB", "GET", `/schools/${school.b}/incidents/${I.glass}`)).status).toBe(404);
    expect((await call("staffB", "POST", `/schools/${school.b}/events/${drillA}/incidents`, glass, key())).status).toBe(404);
    expect((await call("staffB", "POST", `/schools/${school.b}/incidents/${I.glass}/updates`, { kind: "info", note: "다른 학교 시도" }, key())).status).toBe(404);
    expect((await call("adminB", "POST", `/schools/${school.b}/incidents/${I.glass}/status`, { status: "resolved", expectedStatus: "in_progress" })).status).toBe(404);
    expect((await prisma.incidentReport.findUniqueOrThrow({ where: { id: I.glass! } })).status).toBe("in_progress");
  });
});

describe("종료 경합·종료 후", () => {
  it("종료와 제보가 동시에 와도 종료 뒤 저장 없음, 종료 후 제보·후속·상태 409, 조회 200", async () => {
    const [close, rep] = await Promise.all([call("adminA", "POST", A(`/events/${drillA}/close`), {}), report("staffA2", drillA, { ...light, description: "체육관 출입문이 열리지 않습니다" })]);
    expect(close.status).toBe(200);
    expect([201, 409]).toContain(rep.status);
    const ev = await prisma.disasterEvent.findUniqueOrThrow({ where: { id: drillA } });
    expect(await prisma.incidentReport.count({ where: { eventId: drillA, createdAt: { gt: ev.closedAt! } } })).toBe(0);
    const late = await report("staffA", drillA, glass);
    expect(late.status).toBe(409);
    expect(late.body.code).toBe("event_closed");
    expect((await call("staffA", "POST", A(`/incidents/${I.light}/updates`), { kind: "info", note: "종료 후 추가 시도" }, key())).status).toBe(409);
    expect((await call("safetyA", "POST", A(`/incidents/${I.glass}/status`), { status: "resolved", expectedStatus: "in_progress" })).status).toBe(409);
    expect((await call("staffA", "GET", A(`/incidents/${I.glass}`))).body.incident.event.status).toBe("closed");
    expect((await call("staffA", "GET", A(`/events/${drillA}/incidents`))).status).toBe(200);
  });

  it("DB 최종 방어선: 종료된 사건에 제보·후속 직접 삽입, 종료 후 상태 변경 모두 거부", async () => {
    await expect(
      prisma.incidentReport.create({ data: { schoolId: school.a, eventId: drillA, reporterMembershipId: M.staffA!, type: "other", placeCategory: "hallway", description: "직접 삽입", idempotencyKey: randomUUID() } }),
    ).rejects.toThrow();
    await expect(prisma.incidentUpdate.create({ data: { incidentId: I.glass!, authorMembershipId: M.staffA!, kind: "info", note: "직접 삽입", idempotencyKey: randomUUID() } })).rejects.toThrow();
    await expect(prisma.incidentReport.update({ where: { id: I.glass! }, data: { status: "resolved" } })).rejects.toThrow();
  });

  it("실제 재난 제보 201, 사건별 분리(훈련 제보가 실제 재난 목록에 없음)", async () => {
    const issued = await call("safetyA", "POST", A("/events"), { primaryType: "earthquake", mode: "real", confirmReal: true });
    expect(issued.status).toBe(201);
    realA = issued.body.event.id;
    const r = await report("staffA", realA, { type: "help_needed", placeCategory: "playground", placeDetail: "남쪽", description: "운동장 남쪽에 도움이 필요한 학생이 있습니다" });
    expect(r.status).toBe(201);
    const list = await call("staffA", "GET", A(`/events/${realA}/incidents`));
    expect(list.body.event.mode).toBe("real");
    expect(list.body.incidents.map((i: { id: string }) => i.id)).toEqual([r.body.id]);
  });
});
