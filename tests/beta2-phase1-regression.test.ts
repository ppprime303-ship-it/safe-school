// Beta PILOT 2 Phase 1-7: 남은 대리 보고 보안 시나리오와 관리자 이양 후 권한(HTTP, 테스트 스키마)
// 1) 진행 중 상황에서 담임 배정 해제 → 보고 권한 즉시 사라짐
// 2) 대리 담당 재지정 → 이전 대리 담당 즉시 철회, 새 대리 담당만 보고
// 3) 대리 담당의 학교 소속 회수 → 세션 무효·보고 차단, 대리 지정 종료 기록(membership_revoked), 보고 이력 보존
// 4) 업무(앱 운영담당·안전업무 담당)를 가진 관리자가 이양한 뒤 남는 권한, 마지막 관리자 보호, 되돌리기
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { Server } from "node:http";
import { randomUUID } from "node:crypto";
import type { PrismaClient } from "@prisma/client";
import { createTestClient, getTestDatabaseUrl, resetTestData } from "./test-db";

const PASSWORD = "phase17-test-password-1234";
let prisma: PrismaClient;
let server: Server;
let base = "";
const school: Record<"a" | "t", string> = { a: "", t: "" };
const U: Record<string, string> = {};
const M: Record<string, string> = {};
const cookie: Record<string, string> = {};
const ip: Record<string, string> = {};
const C: Record<string, string> = {};
let eventA = "";
const ENROLLED = 22;

async function call(who: string, method: string, path: string, body?: unknown, headers: Record<string, string> = {}) {
  const res = await fetch(`${base}/api${path}`, {
    method,
    headers: { cookie: cookie[who] ?? "", "x-forwarded-for": ip[who] ?? "198.51.100.111", ...(method === "GET" ? {} : { "content-type": "application/json" }), ...headers },
    body: method === "GET" ? undefined : JSON.stringify(body ?? {}),
  });
  const text = await res.text();
  return { status: res.status, body: (text ? JSON.parse(text) : {}) as Record<string, any> };
}
async function login(key: string) {
  const res = await fetch(`${base}/api/auth/login`, {
    method: "POST",
    headers: { "content-type": "application/json", "x-forwarded-for": ip[key]! },
    body: JSON.stringify({ email: `${key.toLowerCase()}@phase17.safeschool.invalid`, password: PASSWORD, deviceKind: "personal" }),
  });
  expect(res.status).toBe(200);
  cookie[key] = res.headers.get("set-cookie")!.split(";")[0]!;
}
const A = () => `/schools/${school.a}`;
const report = (who: string, classKey: string, expectedVersion: number | null = null) =>
  call(who, "PUT", `${A()}/events/${eventA}/reports/${C[classKey]}`, { evacuated: ENROLLED - 1, absentKnown: 0, injured: 0, enrolledCount: ENROLLED, enrolledChangeReason: null, note: null, expectedVersion }, { "idempotency-key": randomUUID() });
const versionOf = async (classKey: string) => (await prisma.evacuationReport.findFirst({ where: { eventId: eventA, classId: C[classKey]! } }))?.version ?? null;
const capsIn = async (who: string, schoolKey: "a" | "t") =>
  ((await call(who, "GET", "/auth/me")).body.memberships as { school: { id: string }; capabilities: string[] }[]).find((m) => m.school.id === school[schoolKey])!.capabilities;

beforeAll(async () => {
  process.env.DATABASE_URL = getTestDatabaseUrl();
  prisma = createTestClient();
  await resetTestData(prisma);
  const { hashPassword } = await import("../server/src/security/password");
  const { grantDutyByPlatformOperator } = await import("../server/src/services/duties");
  const { currentSchoolYear } = await import("../server/src/services/events");
  const passwordHash = await hashPassword(PASSWORD);
  const now = new Date();
  for (const k of ["a", "t"] as const) {
    school[k] = (await prisma.school.create({ data: { slug: `phase17-${k}`, name: `가상 회귀학교 ${k.toUpperCase()}`, isDemo: true, status: "active", activatedAt: now } })).id;
  }
  for (const no of [1, 2]) {
    C[`a${no}`] = (await prisma.schoolClass.create({ data: { schoolId: school.a, schoolYear: currentSchoolYear(), grade: 3, classNo: no, label: `3학년 ${no}반`, enrolledCount: ENROLLED, enrolledConfirmedAt: now } })).id;
  }
  const people: { key: string; k: "a" | "t"; role: "admin" | "homeroom" | "staff" }[] = [
    { key: "adminA", k: "a", role: "admin" },
    { key: "teacherA", k: "a", role: "homeroom" },
    { key: "deputy1", k: "a", role: "staff" },
    { key: "deputy2", k: "a", role: "staff" },
    { key: "deputy3", k: "a", role: "staff" },
    { key: "adminT", k: "t", role: "admin" },
    { key: "staffT", k: "t", role: "staff" },
  ];
  for (const [i, p] of people.entries()) {
    const user = await prisma.user.create({ data: { email: `${p.key.toLowerCase()}@phase17.safeschool.invalid`, displayName: `가상 ${p.key}`, passwordHash, emailVerifiedAt: now } });
    U[p.key] = user.id;
    M[p.key] = (await prisma.schoolMembership.create({ data: { schoolId: school[p.k], userId: user.id, role: p.role, status: "approved", approvalMethod: "roster", approvedAt: now } })).id;
    ip[p.key] = `203.0.113.${180 + i}`;
  }
  await prisma.classAssignment.create({ data: { membershipId: M.teacherA!, classId: C.a1!, duty: "homeroom" } });
  // 관리자 + 앱 운영담당 + 안전업무 담당(업무는 역할과 별개)
  for (const duty of ["app_operator", "safety_officer"] as const) {
    await grantDutyByPlatformOperator(prisma, { membershipId: M.adminT!, duty, operator: "회귀 테스트", verificationMethod: "테스트" });
  }

  const { createApp } = await import("../server/src/app");
  const http = await import("node:http");
  server = http.createServer(await createApp({ mode: "test", trustProxyHops: 1 }));
  await new Promise<void>((r) => server.listen(0, "127.0.0.1", () => r()));
  const addr = server.address();
  base = `http://127.0.0.1:${typeof addr === "object" && addr ? addr.port : 0}`;
  for (const p of people) await login(p.key);
  const issued = await call("adminA", "POST", `${A()}/events`, { primaryType: "fire", mode: "drill" });
  expect(issued.status).toBe(201);
  eventA = issued.body.event.id;
});

afterAll(async () => {
  await new Promise<void>((r) => server.close(() => r()));
  await prisma.$disconnect();
});

describe("1) 진행 중 상황에서 담임 배정 해제", () => {
  it("배정 해제 직후 수정 보고 403, 내 학급 목록 비어 있음, 기존 보고·이력·감사 보존", async () => {
    expect((await report("teacherA", "a1")).status).toBe(200);
    expect(await versionOf("a1")).toBe(1);
    const r = await call("adminA", "PUT", `${A()}/members/${M.teacherA}/assignments`, { role: "homeroom", assignments: [] });
    expect(r.status).toBe(200);
    const denied = await report("teacherA", "a1", 1);
    expect(denied.status).toBe(403);
    expect(denied.body.code).toBe("class_not_assigned");
    expect((await call("teacherA", "GET", `${A()}/events/${eventA}/my-classes`)).body.classes).toEqual([]);
    expect(await versionOf("a1")).toBe(1);
    expect(await prisma.evacuationReportRevision.count({ where: { report: { classId: C.a1! } } })).toBe(1);
    const log = await prisma.auditLog.findFirstOrThrow({ where: { action: "membership.assignments_set", targetId: M.teacherA! } });
    expect(log.before).toEqual([{ classId: C.a1, duty: "homeroom" }]);
  });
});

describe("2) 대리 담당 재지정", () => {
  let first = "";

  it("재지정: 이전 대리 담당은 즉시 403, 새 대리 담당만 200, 이전 지정 'reassigned' 기록과 감사 보존", async () => {
    const d1 = await call("adminA", "POST", `${A()}/events/${eventA}/classes/${C.a2}/delegation`, { delegateMembershipId: M.deputy1, reason: "unreachable" });
    expect(d1.status).toBe(201);
    first = d1.body.delegationId;
    expect((await report("deputy1", "a2")).status).toBe(200);

    // 화면에서 본 현재 지정 id 없이 덮어쓰기 → 409
    expect((await call("adminA", "POST", `${A()}/events/${eventA}/classes/${C.a2}/delegation`, { delegateMembershipId: M.deputy2, reason: "unable" })).status).toBe(409);
    const d2 = await call("adminA", "POST", `${A()}/events/${eventA}/classes/${C.a2}/delegation`, { delegateMembershipId: M.deputy2, reason: "unable", replacesDelegationId: first });
    expect(d2.status).toBe(201);

    expect((await report("deputy1", "a2", 1)).status).toBe(403);
    expect((await call("deputy1", "GET", `${A()}/events/${eventA}/my-classes`)).body.classes).toEqual([]);
    expect((await report("deputy2", "a2", 1)).status).toBe(200);
    expect(await versionOf("a2")).toBe(2);

    const old = await prisma.eventReportDelegation.findUniqueOrThrow({ where: { id: first } });
    expect(old).toMatchObject({ delegateMembershipId: M.deputy1, endedById: U.adminA, endReason: "reassigned" });
    expect(old.endedAt).not.toBeNull();
    expect(await prisma.eventReportDelegation.count({ where: { eventId: eventA, classId: C.a2!, endedAt: null } })).toBe(1);
    const audit = await prisma.auditLog.findFirstOrThrow({ where: { action: "report.delegation_reassigned", targetId: d2.body.delegationId } });
    expect(audit.before).toEqual({ delegateMembershipId: M.deputy1 });
    const revs = await prisma.evacuationReportRevision.findMany({ where: { report: { classId: C.a2! } }, orderBy: { version: "asc" } });
    expect(revs.map((v) => [v.version, v.changedById, v.changeReason])).toEqual([
      [1, U.deputy1, "대리 담당 보고"],
      [2, U.deputy2, "대리 담당 보고"],
    ]);
  });
});

describe("3) 대리 담당의 학교 소속 회수", () => {
  let delegationId = "";

  it("회수 → 세션 즉시 무효(401), 다시 로그인해도 학교 API 403, 보고 차단", async () => {
    const d = await call("adminA", "POST", `${A()}/events/${eventA}/classes/${C.a1}/delegation`, { delegateMembershipId: M.deputy3, reason: "admin_decision" });
    expect(d.status).toBe(201);
    delegationId = d.body.delegationId;
    expect((await report("deputy3", "a1", 1)).status).toBe(200); // 담임 해제된 1반을 대리 담당이 수정(판 2)

    const revoked = await call("adminA", "POST", `${A()}/members/${M.deputy3}/revoke`, {});
    expect(revoked.status).toBe(200);
    expect((await report("deputy3", "a1", 2)).status).toBe(401);
    await login("deputy3");
    const after = await report("deputy3", "a1", 2);
    expect(after.status).toBe(403);
    expect(after.body.code).toBe("membership_inactive");
    expect((await call("deputy3", "GET", `${A()}/events/${eventA}/board`)).status).toBe(403);
  });

  it("대리 지정은 'membership_revoked' 로 종료(행 보존), 상황판에서 빠짐, 보고 이력·감사 보존", async () => {
    const row = await prisma.eventReportDelegation.findUniqueOrThrow({ where: { id: delegationId } });
    expect(row).toMatchObject({ delegateMembershipId: M.deputy3, endedById: U.adminA, endReason: "membership_revoked" });
    expect(row.endedAt).not.toBeNull();
    const board = await call("adminA", "GET", `${A()}/events/${eventA}/board`);
    const c1 = (board.body.classes as { classId: string; delegation: unknown }[]).find((c) => c.classId === C.a1)!;
    expect(c1.delegation).toBeNull();
    const revs = await prisma.evacuationReportRevision.findMany({ where: { report: { classId: C.a1! } }, orderBy: { version: "asc" } });
    expect(revs.map((v) => [v.version, v.changedById])).toEqual([
      [1, U.teacherA],
      [2, U.deputy3],
    ]);
    const log = await prisma.auditLog.findFirstOrThrow({ where: { action: "membership.revoked", targetId: M.deputy3! } });
    expect(log.after).toMatchObject({ sessionsInvalidated: 1, delegationsEnded: 1 });
    expect((await prisma.schoolMembership.findUniqueOrThrow({ where: { id: M.deputy3! } })).status).toBe("revoked");
  });

  it("새 대리 담당은 재지정 절차 없이 바로 지정 가능(회수된 지정이 남아 막지 않음)", async () => {
    const d = await call("adminA", "POST", `${A()}/events/${eventA}/classes/${C.a1}/delegation`, { delegateMembershipId: M.deputy1, reason: "unable" });
    expect(d.status).toBe(201);
    expect((await report("deputy1", "a1", 2)).status).toBe(200);
  });
});

describe("4) 업무를 가진 관리자의 이양 후 권한", () => {
  it("이양 전: 관리자 역할 + 앱 운영담당 + 안전업무 담당 권한 합산", async () => {
    expect(await capsIn("adminT", "t")).toEqual(expect.arrayContaining(["admin.transfer", "members.rename", "members.manage", "event.issue", "drilllog.edit"]));
  });

  it("이양 후 기존 관리자: 관리자 역할에만 있는 권한(이양·성명 정정)은 사라지고, 업무 권한(교직원 승인·학급·소재지·업무 지정·발령·상황판 상세·훈련일지 작성)은 유지", async () => {
    expect((await call("adminT", "POST", `/schools/${school.t}/admin-transfer`, { targetMembershipId: M.staffT, confirm: true })).status).toBe(200);
    const caps = await capsIn("adminT", "t");
    for (const lost of ["admin.transfer", "members.rename"]) expect(caps).not.toContain(lost);
    expect(caps).toEqual(expect.arrayContaining(["members.manage", "classes.manage", "region.manage", "duties.manage", "event.issue", "event.close", "board.detail", "drilllog.edit"]));
    expect((await call("adminT", "GET", `/schools/${school.t}/members`)).status).toBe(200); // 앱 운영담당 업무로
    const duties = await prisma.memberDuty.findMany({ where: { membershipId: M.adminT!, endedAt: null }, select: { duty: true } });
    expect(duties.map((d) => d.duty).sort()).toEqual(["app_operator", "safety_officer"]);
  });

  it("마지막 관리자 보호: 앱 운영담당(기존 관리자)은 새 관리자를 회수할 수 없음(403), 관리자 1명 유지", async () => {
    const r = await call("adminT", "POST", `/schools/${school.t}/members/${M.staffT}/revoke`, {});
    expect(r.status).toBe(403);
    expect(await prisma.schoolMembership.count({ where: { schoolId: school.t, role: "admin", status: "approved" } })).toBe(1);
  });

  it("새 관리자가 다시 이양하면 되돌릴 수 있음(기존 관리자 업무는 그대로)", async () => {
    expect((await call("staffT", "POST", `/schools/${school.t}/admin-transfer`, { targetMembershipId: M.adminT, confirm: true })).status).toBe(200);
    expect((await prisma.schoolMembership.findUniqueOrThrow({ where: { id: M.adminT! } })).role).toBe("admin");
    expect((await prisma.schoolMembership.findUniqueOrThrow({ where: { id: M.staffT! } })).role).toBe("staff");
    expect(await prisma.auditLog.count({ where: { action: "membership.admin_transferred", schoolId: school.t } })).toBe(2);
  });
});
