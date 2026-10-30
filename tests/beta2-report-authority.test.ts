// Beta PILOT 2 Phase 1-3: 공식 학급 대피 보고 권한(HTTP, 테스트 스키마)
// - 보고(생성·수정)는 이 학급 담임 또는 이 사건·학급의 유효한 대리 담당만
// - 학교 관리자·안전업무 담당·일반 교직원·보조(assist) 배정은 그 자체로는 보고 불가
// - 대리 지정: 같은 학교 승인 교직원만, 자기 지정 불가, 동시 지정 1건만, 해제·종료 즉시 권한 철회, 다른 사건·학교에 재사용 불가
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { Server } from "node:http";
import { randomUUID } from "node:crypto";
import type { PrismaClient } from "@prisma/client";
import { createTestClient, getTestDatabaseUrl, resetTestData } from "./test-db";

const PASSWORD = "authority-test-password-1234";
let prisma: PrismaClient;
let server: Server;
let base = "";
const school: Record<"a" | "b", string> = { a: "", b: "" };
const U: Record<string, string> = {};
const M: Record<string, string> = {};
const cookie: Record<string, string> = {};
const ip: Record<string, string> = {};
const C: Record<string, string> = {}; // a1(담임 teacherA), a2(보조 assistA), a3(담임 없음), b1
let event1 = "";

async function call(who: string, method: string, path: string, body?: unknown, headers: Record<string, string> = {}) {
  const res = await fetch(`${base}/api${path}`, {
    method,
    headers: { cookie: cookie[who] ?? "", "x-forwarded-for": ip[who] ?? "198.51.100.88", ...(method === "GET" ? {} : { "content-type": "application/json" }), ...headers },
    body: method === "GET" ? undefined : JSON.stringify(body ?? {}),
  });
  const text = await res.text();
  return { status: res.status, body: (text ? JSON.parse(text) : {}) as Record<string, any> };
}

const S = (k: "a" | "b") => `/schools/${school[k]}`;
const enrolled: Record<string, number> = { a1: 25, a2: 26, a3: 27, b1: 24 };
const body = (classKey: string, over: Record<string, unknown> = {}) => ({
  evacuated: enrolled[classKey]! - 1, absentKnown: 1, injured: 0, enrolledCount: enrolled[classKey]!, enrolledChangeReason: null, note: null, expectedVersion: null, ...over,
});
const report = (who: string, eventId: string, classKey: string, over: Record<string, unknown> = {}, k: "a" | "b" = "a") =>
  call(who, "PUT", `${S(k)}/events/${eventId}/reports/${C[classKey]}`, body(classKey, over), { "idempotency-key": randomUUID() });
const delegate = (who: string, eventId: string, classKey: string, delegateKey: string, extra: Record<string, unknown> = {}) =>
  call(who, "POST", `${S("a")}/events/${eventId}/classes/${C[classKey]}/delegation`, { delegateMembershipId: M[delegateKey], reason: "unreachable", ...extra });
const myClasses = async (who: string, eventId: string) =>
  ((await call(who, "GET", `${S("a")}/events/${eventId}/my-classes`)).body.classes as { classId: string; responsibility: string }[]).map((c) => [c.classId, c.responsibility]);

beforeAll(async () => {
  process.env.DATABASE_URL = getTestDatabaseUrl();
  prisma = createTestClient();
  await resetTestData(prisma);
  const { hashPassword } = await import("../server/src/security/password");
  const { grantDutyByPlatformOperator } = await import("../server/src/services/duties");
  const { currentSchoolYear } = await import("../server/src/services/events");
  const passwordHash = await hashPassword(PASSWORD);
  const now = new Date();
  const year = currentSchoolYear();

  for (const k of ["a", "b"] as const) {
    school[k] = (await prisma.school.create({ data: { slug: `authority-${k}`, name: `가상 보고권한학교 ${k.toUpperCase()}`, isDemo: true, status: "active", activatedAt: now } })).id;
  }
  for (const [key, k, grade, no] of [["a1", "a", 1, 1], ["a2", "a", 1, 2], ["a3", "a", 1, 3], ["b1", "b", 1, 1]] as const) {
    C[key] = (await prisma.schoolClass.create({ data: { schoolId: school[k], schoolYear: year, grade, classNo: no, label: `${grade}학년 ${no}반`, enrolledCount: enrolled[key], enrolledConfirmedAt: now } })).id;
  }
  const people = [
    { key: "adminA", k: "a", role: "admin" },
    { key: "teacherA", k: "a", role: "homeroom" },
    { key: "staffA", k: "a", role: "staff" },
    { key: "assistA", k: "a", role: "staff" },
    { key: "safetyA", k: "a", role: "staff" },
    { key: "pendingA", k: "a", role: "staff", status: "pending" },
    { key: "adminB", k: "b", role: "admin" },
    { key: "staffB", k: "b", role: "staff" },
  ] as const;
  for (const [i, p] of people.entries()) {
    const email = `${p.key.toLowerCase()}@authority.safeschool.invalid`;
    const user = await prisma.user.create({ data: { email, displayName: `가상 ${p.key}`, passwordHash, emailVerifiedAt: now } });
    U[p.key] = user.id;
    const status = "status" in p ? p.status : "approved";
    M[p.key] = (await prisma.schoolMembership.create({ data: { schoolId: school[p.k], userId: user.id, role: p.role, status, ...(status === "approved" ? { approvalMethod: "roster", approvedAt: now } : {}) } })).id;
    ip[p.key] = `203.0.113.${120 + i}`;
  }
  await prisma.classAssignment.create({ data: { membershipId: M.teacherA!, classId: C.a1!, duty: "homeroom" } });
  await prisma.classAssignment.create({ data: { membershipId: M.assistA!, classId: C.a2!, duty: "assist" } });
  await grantDutyByPlatformOperator(prisma, { membershipId: M.safetyA!, duty: "safety_officer", operator: "보고 권한 테스트", verificationMethod: "테스트" });

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
      body: JSON.stringify({ email: `${p.key.toLowerCase()}@authority.safeschool.invalid`, password: PASSWORD, deviceKind: "personal" }),
    });
    expect(res.status).toBe(200);
    cookie[p.key] = res.headers.get("set-cookie")!.split(";")[0]!;
  }

  // 관리자 발령 기능은 그대로(HTTP)
  const issued = await call("adminA", "POST", `${S("a")}/events`, { primaryType: "fire", mode: "drill", evacPlace: "운동장" });
  expect(issued.status).toBe(201);
  event1 = issued.body.event.id;
});

afterAll(async () => {
  await new Promise<void>((r) => server.close(() => r()));
  await prisma.$disconnect();
});

describe("담임·역할별 보고 권한", () => {
  it("담임: 담당 학급 보고 200, 수정 200(판 2), 다른 학급 403", async () => {
    expect((await report("teacherA", event1, "a1")).status).toBe(200);
    const v2 = await report("teacherA", event1, "a1", { evacuated: 24, absentKnown: 0, expectedVersion: 1 });
    expect(v2.status).toBe(200);
    expect(v2.body.report.version).toBe(2);
    expect((await report("teacherA", event1, "a2")).status).toBe(403);
  });

  it("관리자·안전업무 담당·일반 교직원: 미지정 학급 생성 403, 기존 보고 수정도 403", async () => {
    for (const who of ["adminA", "safetyA", "staffA"]) {
      const created = await report(who, event1, "a3");
      expect(created.status).toBe(403);
      expect(created.body.code).toBe("class_not_assigned");
      expect((await report(who, event1, "a1", { expectedVersion: 2 })).status).toBe(403);
    }
    expect(await prisma.evacuationReport.count({ where: { eventId: event1, classId: C.a3! } })).toBe(0);
    expect((await prisma.evacuationReport.findFirstOrThrow({ where: { eventId: event1, classId: C.a1! } })).version).toBe(2);
  });

  it("보조(assist) 배정만으로는 보고 403, 내 학급 목록에도 없음", async () => {
    expect((await report("assistA", event1, "a2")).status).toBe(403);
    expect(await myClasses("assistA", event1)).toEqual([]);
  });

  it("내 학급 목록: 담임은 담임 학급만, 관리자는 담임·대리 학급이 없으면 빈 목록", async () => {
    expect(await myClasses("teacherA", event1)).toEqual([[C.a1, "own"]]);
    expect(await myClasses("adminA", event1)).toEqual([]);
  });

  it("관리자 상황판은 전체 학급 현황 그대로(보고 권한과 무관)", async () => {
    const b = await call("adminA", "GET", `${S("a")}/events/${event1}/board`);
    expect(b.status).toBe(200);
    expect(b.body.scope).toBe("full");
    expect((b.body.classes as unknown[]).length).toBe(3);
  });
});

describe("대리 담당 지정·해제", () => {
  let delegationA2 = "";

  it("대리 후보에 지정하는 사람 자신은 없음", async () => {
    const s = await call("adminA", "GET", `${S("a")}/events/${event1}/classes/${C.a3}/delegation-suggestions`);
    expect(s.status).toBe(200);
    const ids = (s.body.candidates as { membershipId: string }[]).map((m) => m.membershipId);
    expect(ids).not.toContain(M.adminA);
    expect(ids).toContain(M.staffA);
  });

  it("관리자 자기 지정 → 403 self_delegation, 지정 기록 없음", async () => {
    const r = await delegate("adminA", event1, "a3", "adminA");
    expect(r.status).toBe(403);
    expect(r.body.code).toBe("self_delegation");
    expect(await prisma.eventReportDelegation.count({ where: { eventId: event1, classId: C.a3! } })).toBe(0);
  });

  it("잘못된 대리 지정: 다른 학교 교직원 404, 승인 대기 404, 그 학급 담임 409, 권한 없는 교직원의 지정 403", async () => {
    expect((await delegate("adminA", event1, "a3", "staffB")).status).toBe(404);
    expect((await delegate("adminA", event1, "a3", "pendingA")).status).toBe(404);
    expect((await delegate("adminA", event1, "a1", "teacherA")).status).toBe(409);
    expect((await delegate("staffA", event1, "a3", "assistA")).status).toBe(403);
    expect((await delegate("teacherA", event1, "a3", "staffA")).status).toBe(403);
  });

  it("정식 지정 후 대리 담당 보고 200(변경 사유 '대리 담당 보고'), 지정된 학급 외에는 403", async () => {
    const d = await delegate("adminA", event1, "a2", "assistA", { basis: "담임 연락 안 됨" });
    expect(d.status).toBe(201);
    delegationA2 = d.body.delegationId;
    expect(await myClasses("assistA", event1)).toEqual([[C.a2, "delegated"]]);
    expect((await report("assistA", event1, "a2")).status).toBe(200);
    expect((await report("assistA", event1, "a3")).status).toBe(403);
    const rev = await prisma.evacuationReportRevision.findFirstOrThrow({ where: { report: { eventId: event1, classId: C.a2! } } });
    expect(rev).toMatchObject({ changedById: U.assistA, changeReason: "대리 담당 보고" });
  });

  it("해제 즉시 보고 403(수정도), 지정·해제 감사 기록과 지정 이력 보존", async () => {
    const e = await call("adminA", "POST", `${S("a")}/events/${event1}/delegations/${delegationA2}/end`, { reason: "returned" });
    expect(e.status).toBe(200);
    expect((await report("assistA", event1, "a2", { expectedVersion: 1 })).status).toBe(403);
    expect(await myClasses("assistA", event1)).toEqual([]);
    const row = await prisma.eventReportDelegation.findUniqueOrThrow({ where: { id: delegationA2 } });
    expect(row).toMatchObject({ delegateMembershipId: M.assistA, assignedById: U.adminA, reason: "unreachable", basis: "담임 연락 안 됨", endedById: U.adminA, endReason: "returned" });
    const actions = (await prisma.auditLog.findMany({ where: { targetId: delegationA2 }, orderBy: { at: "asc" } })).map((l) => l.action);
    expect(actions).toEqual(["report.delegation_assigned", "report.delegation_ended"]);
  });

  it("다른 발령 권한자(안전업무 담당)가 관리자를 지정하면 관리자도 그 학급만 보고 가능(관리자·대리 겸임)", async () => {
    const d = await delegate("safetyA", event1, "a3", "adminA", { reason: "admin_decision" });
    expect(d.status).toBe(201);
    expect((await report("adminA", event1, "a3")).status).toBe(200);
    expect((await report("adminA", event1, "a2", { expectedVersion: 1 })).status).toBe(403);
    expect(await myClasses("adminA", event1)).toEqual([[C.a3, "delegated"]]);
  });

  it("같은 학급 동시 지정: 1건만 성공, 나머지 409(유효 지정 1건)", async () => {
    const issued = await call("adminA", "POST", `${S("a")}/events/${event1}/classes/${C.a2}/delegation`, { delegateMembershipId: M.staffA, reason: "unable" });
    const issued2 = await call("safetyA", "POST", `${S("a")}/events/${event1}/classes/${C.a2}/delegation`, { delegateMembershipId: M.assistA, reason: "unable" });
    expect([issued.status, issued2.status].sort()).toEqual([201, 409]);
    const [x, y] = await Promise.all([
      call("adminA", "POST", `${S("a")}/events/${event1}/classes/${C.a1}/delegation`, { delegateMembershipId: M.staffA, reason: "unable" }),
      call("safetyA", "POST", `${S("a")}/events/${event1}/classes/${C.a1}/delegation`, { delegateMembershipId: M.assistA, reason: "unable" }),
    ]);
    expect([x.status, y.status].sort()).toEqual([201, 409]);
    expect(await prisma.eventReportDelegation.count({ where: { eventId: event1, classId: C.a1!, endedAt: null } })).toBe(1);
  });
});

describe("다른 사건·다른 학교·재전송", () => {
  let event2 = "";

  it("같은 요청 번호를 다른 사람이 쓰면 409(남의 보고를 받아 볼 수 없음), 본인 재전송은 그대로", async () => {
    const key = randomUUID();
    const first = await call("teacherA", "PUT", `${S("a")}/events/${event1}/reports/${C.a1}`, body("a1", { expectedVersion: 2 }), { "idempotency-key": key });
    expect(first.status).toBe(200);
    const again = await call("teacherA", "PUT", `${S("a")}/events/${event1}/reports/${C.a1}`, body("a1", { expectedVersion: 2 }), { "idempotency-key": key });
    expect(again.body.replayed).toBe(true);
    const other = await call("adminA", "PUT", `${S("a")}/events/${event1}/reports/${C.a1}`, body("a1", { expectedVersion: 2 }), { "idempotency-key": key });
    expect(other.status).toBe(409);
    expect(other.body.report).toBeUndefined();
  });

  it("상황 종료(관리자 기능 유지) 시 대리 지정 모두 해제, 다음 사건에는 이전 지정이 쓰이지 않음", async () => {
    expect((await call("adminA", "POST", `${S("a")}/events/${event1}/close`, {})).status).toBe(200);
    expect(await prisma.eventReportDelegation.count({ where: { eventId: event1, endedAt: null } })).toBe(0);
    expect((await prisma.eventReportDelegation.findFirstOrThrow({ where: { eventId: event1, classId: C.a3! } })).endReason).toBe("event_closed");
    const issued = await call("safetyA", "POST", `${S("a")}/events`, { primaryType: "earthquake", mode: "drill" });
    expect(issued.status).toBe(201);
    event2 = issued.body.event.id;
    expect((await report("adminA", event2, "a3")).status).toBe(403);
    expect((await report("staffA", event2, "a1")).status).toBe(403);
    expect(await myClasses("adminA", event2)).toEqual([]);
    expect((await report("teacherA", event2, "a1")).status).toBe(200); // 담임은 새 사건에서도 그대로
  });

  it("다른 학교: B 교직원은 A 사건·학급에 404, A 대리 지정을 B 학교에서 쓸 수 없음", async () => {
    expect((await call("staffB", "PUT", `${S("a")}/events/${event2}/reports/${C.a3}`, body("a3"), { "idempotency-key": randomUUID() })).status).toBe(404);
    const d = await delegate("safetyA", event2, "a3", "staffA");
    expect(d.status).toBe(201);
    expect((await report("staffA", event2, "a3")).status).toBe(200);
    // staffA 는 B 학교 소속이 아님 → B 경로는 404, B 학급 id 를 A 경로로 → 404
    expect((await call("staffA", "PUT", `${S("b")}/events/${event2}/reports/${C.b1}`, body("b1"), { "idempotency-key": randomUUID() })).status).toBe(404);
    expect((await call("staffA", "PUT", `${S("a")}/events/${event2}/reports/${C.b1}`, body("b1"), { "idempotency-key": randomUUID() })).status).toBe(404);
    // B 관리자가 A 사건에 대리 지정 시도 → 404
    expect((await call("adminB", "POST", `${S("b")}/events/${event2}/classes/${C.a3}/delegation`, { delegateMembershipId: M.staffB, reason: "unable" })).status).toBe(404);
  });

  it("기존 보고와 수정 이력 보존(사건 1: 1반 판 3, 2반 판 1, 3반 판 1 — 거부된 요청은 기록 없음)", async () => {
    const reports = await prisma.evacuationReport.findMany({ where: { eventId: event1 }, include: { revisions: { orderBy: { version: "asc" } } } });
    const byClass = Object.fromEntries(reports.map((r) => [r.classId, r]));
    expect(byClass[C.a1!]!.revisions.map((v) => [v.version, v.changedById])).toEqual([[1, U.teacherA], [2, U.teacherA], [3, U.teacherA]]);
    expect(byClass[C.a2!]!.revisions.map((v) => v.changedById)).toEqual([U.assistA]);
    expect(byClass[C.a3!]!.revisions.map((v) => [v.changedById, v.changeReason])).toEqual([[U.adminA, "대리 담당 보고"]]);
    const created = await prisma.auditLog.count({ where: { schoolId: school.a, action: { in: ["report.created", "report.updated"] } } });
    expect(created).toBe(7); // 사건1: 1반 3 + 2반 1 + 3반 1, 사건2: 1반 1 + 3반 1
  });
});
