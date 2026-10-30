// Beta PILOT 2 Phase 1-6: 학교 관리자 권한 이양(HTTP, 테스트 스키마)
// - 현재 학교 관리자만, 최근 비밀번호 재확인, 같은 학교 승인·활성 교직원에게만
// - 한 트랜잭션에서 교대(관리자 수 그대로), 동시 요청은 1건만, 실패 시 전부 취소
// - 이양 후: 새 관리자는 학교 관리 가능, 기존 관리자는 담임(담임 배정 있음)/교직원, 학급 보고·대리 지정 권한은 배정·지정 그대로
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { Server } from "node:http";
import { randomUUID } from "node:crypto";
import type { PrismaClient } from "@prisma/client";
import { createTestClient, getTestDatabaseUrl, resetTestData } from "./test-db";

const PASSWORD = "transfer-test-password-1234";
let prisma: PrismaClient;
let server: Server;
let base = "";
const school: Record<"a" | "b" | "c" | "d", string> = { a: "", b: "", c: "", d: "" };
const U: Record<string, string> = {};
const M: Record<string, string> = {};
const cookie: Record<string, string> = {};
const ip: Record<string, string> = {};
const C: Record<string, string> = {};
let eventA = "";
let delegationA3 = "";

async function call(who: string, method: string, path: string, body?: unknown, headers: Record<string, string> = {}) {
  const res = await fetch(`${base}/api${path}`, {
    method,
    headers: { cookie: cookie[who] ?? "", "x-forwarded-for": ip[who] ?? "198.51.100.99", ...(method === "GET" ? {} : { "content-type": "application/json" }), ...headers },
    body: method === "GET" ? undefined : JSON.stringify(body ?? {}),
  });
  const text = await res.text();
  return { status: res.status, body: (text ? JSON.parse(text) : {}) as Record<string, any> };
}
const transfer = (who: string, schoolKey: "a" | "b" | "c" | "d", targetKey: string, extra: Record<string, unknown> = {}) =>
  call(who, "POST", `/schools/${school[schoolKey]}/admin-transfer`, { targetMembershipId: M[targetKey], confirm: true, ...extra });
const roleOf = async (key: string) => (await prisma.schoolMembership.findUniqueOrThrow({ where: { id: M[key]! } })).role;
const enrolled = 25;
const report = (who: string, classKey: string) =>
  call(who, "PUT", `/schools/${school.a}/events/${eventA}/reports/${C[classKey]}`, { evacuated: enrolled, absentKnown: 0, injured: 0, enrolledCount: enrolled, enrolledChangeReason: null, note: null, expectedVersion: null }, { "idempotency-key": randomUUID() });

beforeAll(async () => {
  process.env.DATABASE_URL = getTestDatabaseUrl();
  prisma = createTestClient();
  await resetTestData(prisma);
  const { hashPassword } = await import("../server/src/security/password");
  const { grantDutyByPlatformOperator } = await import("../server/src/services/duties");
  const { currentSchoolYear, issueEvent } = await import("../server/src/services/events");
  const { assignDelegate } = await import("../server/src/services/delegations");
  const passwordHash = await hashPassword(PASSWORD);
  const now = new Date();
  for (const k of ["a", "b", "c", "d"] as const) {
    school[k] = (await prisma.school.create({ data: { slug: `transfer-${k}`, name: `가상 이양학교 ${k.toUpperCase()}`, isDemo: true, status: "active", activatedAt: now } })).id;
  }
  for (const no of [1, 2, 3]) {
    C[`a${no}`] = (await prisma.schoolClass.create({ data: { schoolId: school.a, schoolYear: currentSchoolYear(), grade: 1, classNo: no, label: `1학년 ${no}반`, enrolledCount: enrolled, enrolledConfirmedAt: now } })).id;
  }
  const people: { key: string; k: "a" | "b" | "c" | "d"; role: "admin" | "homeroom" | "staff"; status?: "pending"; disabled?: boolean; login?: boolean }[] = [
    { key: "adminA", k: "a", role: "admin" },
    { key: "coAdminA", k: "a", role: "admin" },
    { key: "teacherA", k: "a", role: "homeroom" },
    { key: "staffA", k: "a", role: "staff" },
    { key: "opA", k: "a", role: "staff" },
    { key: "pendingA", k: "a", role: "staff", status: "pending", login: false },
    { key: "disabledA", k: "a", role: "staff", disabled: true, login: false },
    { key: "adminB", k: "b", role: "admin" },
    { key: "staffB", k: "b", role: "staff", login: false },
    { key: "adminC", k: "c", role: "admin" },
    { key: "staffC1", k: "c", role: "staff", login: false },
    { key: "staffC2", k: "c", role: "staff", login: false },
    { key: "adminD", k: "d", role: "admin" },
    { key: "staffD", k: "d", role: "staff", login: false },
  ];
  for (const [i, p] of people.entries()) {
    const user = await prisma.user.create({ data: { email: `${p.key.toLowerCase()}@transfer.safeschool.invalid`, displayName: `가상 ${p.key}`, passwordHash, emailVerifiedAt: now } });
    U[p.key] = user.id;
    const status = p.status ?? "approved";
    M[p.key] = (await prisma.schoolMembership.create({ data: { schoolId: school[p.k], userId: user.id, role: p.role, status, ...(status === "approved" ? { approvalMethod: "roster", approvedAt: now } : {}) } })).id;
    ip[p.key] = `203.0.113.${150 + i}`;
  }
  await prisma.classAssignment.create({ data: { membershipId: M.adminA!, classId: C.a1!, duty: "homeroom" } }); // 관리자·담임 겸임
  await prisma.classAssignment.create({ data: { membershipId: M.teacherA!, classId: C.a2!, duty: "homeroom" } });
  await grantDutyByPlatformOperator(prisma, { membershipId: M.opA!, duty: "app_operator", operator: "이양 테스트", verificationMethod: "테스트" });
  await grantDutyByPlatformOperator(prisma, { membershipId: M.adminA!, duty: "principal", operator: "이양 테스트", verificationMethod: "테스트" });

  // 이양 전 진행 중 훈련 + 3반 대리 담당(staffA)
  eventA = (await issueEvent(prisma, { schoolId: school.a, actorUserId: U.adminA!, primaryType: "fire", mode: "drill" })).id;
  delegationA3 = (await assignDelegate(prisma, { schoolId: school.a, eventId: eventA, classId: C.a3!, actorUserId: U.adminA!, delegateMembershipId: M.staffA!, reason: "unreachable" })).id;

  const { createApp } = await import("../server/src/app");
  const http = await import("node:http");
  server = http.createServer(await createApp({ mode: "test", trustProxyHops: 1 }));
  await new Promise<void>((r) => server.listen(0, "127.0.0.1", () => r()));
  const addr = server.address();
  base = `http://127.0.0.1:${typeof addr === "object" && addr ? addr.port : 0}`;
  for (const p of people.filter((x) => x.login !== false)) {
    const res = await fetch(`${base}/api/auth/login`, {
      method: "POST",
      headers: { "content-type": "application/json", "x-forwarded-for": ip[p.key]! },
      body: JSON.stringify({ email: `${p.key.toLowerCase()}@transfer.safeschool.invalid`, password: PASSWORD, deviceKind: "personal" }),
    });
    expect(res.status).toBe(200);
    cookie[p.key] = res.headers.get("set-cookie")!.split(";")[0]!;
  }
  // 로그인 후 비활성화(활성 계정만 대상이 되는지 확인용)
  await prisma.user.update({ where: { id: U.disabledA! }, data: { status: "disabled" } });
});

afterAll(async () => {
  await prisma.$executeRawUnsafe(`DROP TRIGGER IF EXISTS test_fail_admin_transfer ON audit_logs`);
  await prisma.$executeRawUnsafe(`DROP FUNCTION IF EXISTS test_fail_admin_transfer()`);
  await new Promise<void>((r) => server.close(() => r()));
  await prisma.$disconnect();
});

describe("거부 조건", () => {
  it("최근 비밀번호 재확인 없으면 403 reauth_required, 역할 그대로", async () => {
    await prisma.session.updateMany({ where: { userId: U.adminA! }, data: { reauthAt: new Date(Date.now() - 3600_000) } });
    const r = await transfer("adminA", "a", "teacherA");
    expect(r.status).toBe(403);
    expect(r.body.code).toBe("reauth_required");
    expect(await roleOf("teacherA")).toBe("homeroom");
    expect((await call("adminA", "POST", "/auth/reauth", { password: PASSWORD })).status).toBe(200);
  });

  it("일반 교직원·담임·앱 운영담당(교직원 승인 권한 있음)은 403 — 자기 자신을 관리자로 올리는 요청 포함", async () => {
    for (const who of ["staffA", "teacherA", "opA"]) {
      expect((await transfer(who, "a", who)).status).toBe(403);
      expect((await transfer(who, "a", "staffA")).status).toBe(403);
    }
    expect(await roleOf("staffA")).toBe("staff");
    expect(await roleOf("opA")).toBe("staff");
    expect(await roleOf("teacherA")).toBe("homeroom");
  });

  it("다른 학교: A 관리자가 B 교직원 id → 404, B 관리자가 A 경로 → 404", async () => {
    expect((await transfer("adminA", "a", "staffB")).status).toBe(404);
    expect((await transfer("adminB", "a", "teacherA")).status).toBe(404);
    expect(await roleOf("staffB")).toBe("staff");
  });

  it("승인 대기 409, 비활성 계정 409, 자기 자신 400, 이미 관리자 409, 확인 없음 400", async () => {
    expect((await transfer("adminA", "a", "pendingA")).status).toBe(409);
    expect((await transfer("adminA", "a", "disabledA")).status).toBe(409);
    expect((await transfer("adminA", "a", "adminA")).status).toBe(400);
    expect((await transfer("adminA", "a", "coAdminA")).status).toBe(409);
    expect((await transfer("adminA", "a", "teacherA", { confirm: false })).status).toBe(400);
    expect(await prisma.auditLog.count({ where: { action: "membership.admin_transferred" } })).toBe(0);
    expect(await roleOf("adminA")).toBe("admin");
  });
});

describe("정상 이양(A 학교: 관리자·담임·교장 겸임 → 담임)", () => {
  let before: { assignments: unknown; duties: unknown };

  it("이양 200: 새 관리자 admin, 기존 관리자 담임(담임 배정 있음), 승인 상태·학급 배정·직책 그대로, 관리자 수 그대로", async () => {
    const snap = async () => ({
      assignments: await prisma.classAssignment.findMany({ where: { membershipId: { in: [M.adminA!, M.teacherA!] } }, select: { membershipId: true, classId: true, duty: true }, orderBy: { classId: "asc" } }),
      duties: await prisma.memberDuty.findMany({ where: { membershipId: { in: [M.adminA!, M.teacherA!] } }, select: { membershipId: true, duty: true, endedAt: true } }),
    });
    before = await snap();
    const adminsBefore = await prisma.schoolMembership.count({ where: { schoolId: school.a, role: "admin", status: "approved" } });
    const r = await transfer("adminA", "a", "teacherA");
    expect(r.status).toBe(200);
    expect(r.body).toMatchObject({ newAdminMembershipId: M.teacherA, previousAdminRole: "homeroom" });
    expect(await roleOf("teacherA")).toBe("admin");
    expect(await roleOf("adminA")).toBe("homeroom");
    for (const k of ["adminA", "teacherA"]) expect((await prisma.schoolMembership.findUniqueOrThrow({ where: { id: M[k]! } })).status).toBe("approved");
    expect(await snap()).toEqual(before);
    expect(await prisma.schoolMembership.count({ where: { schoolId: school.a, role: "admin", status: "approved" } })).toBe(adminsBefore);
  });

  it("감사 기록: 전후 역할·대상, 실행자", async () => {
    const log = await prisma.auditLog.findFirstOrThrow({ where: { action: "membership.admin_transferred", schoolId: school.a } });
    expect(log.actorUserId).toBe(U.adminA);
    expect(log.targetId).toBe(M.teacherA);
    expect(log.before).toEqual({ from: { membershipId: M.adminA, role: "admin" }, to: { membershipId: M.teacherA, role: "homeroom" } });
    expect(log.after).toMatchObject({ from: { membershipId: M.adminA, role: "homeroom" }, to: { membershipId: M.teacherA, userId: U.teacherA, role: "admin" } });
  });

  it("새 관리자는 바로 학교 관리 가능(교직원 목록·승인 권한·이양 권한)", async () => {
    expect((await call("teacherA", "GET", `/schools/${school.a}/members`)).status).toBe(200);
    const me = await call("teacherA", "GET", "/auth/me");
    const caps = (me.body.memberships as { school: { id: string }; capabilities: string[] }[]).find((m) => m.school.id === school.a)!.capabilities;
    expect(caps).toEqual(expect.arrayContaining(["members.manage", "admin.transfer", "event.issue", "members.rename"]));
  });

  it("기존 관리자는 바로 관리자 기능 상실(교직원 목록 403, 이양 재요청 403), 교장 직책 권한(발령·상황판 상세)은 유지", async () => {
    expect((await call("adminA", "GET", `/schools/${school.a}/members`)).status).toBe(403);
    expect((await transfer("adminA", "a", "staffA")).status).toBe(403);
    const me = await call("adminA", "GET", "/auth/me");
    const caps = (me.body.memberships as { school: { id: string }; capabilities: string[] }[]).find((m) => m.school.id === school.a)!.capabilities;
    expect(caps).not.toContain("members.manage");
    expect(caps).not.toContain("admin.transfer");
    expect(caps).toEqual(expect.arrayContaining(["event.issue", "board.detail"]));
  });

  it("학급 보고·대리 지정 권한은 배정·지정 그대로(기존 관리자 1반 200, 새 관리자 2반 200·3반 403, 대리 담당 3반 200)", async () => {
    expect((await report("adminA", "a1")).status).toBe(200);
    expect((await report("teacherA", "a2")).status).toBe(200);
    expect((await report("teacherA", "a3")).status).toBe(403);
    expect((await prisma.eventReportDelegation.findUniqueOrThrow({ where: { id: delegationA3 } })).endedAt).toBeNull();
    expect((await report("staffA", "a3")).status).toBe(200);
  });

  it("플랫폼 운영자 권한은 생기지 않음", async () => {
    expect(await prisma.platformOperator.count({ where: { userId: U.teacherA! } })).toBe(0);
    expect((await call("teacherA", "GET", "/platform/approvals")).status).toBe(403);
  });
});

describe("동시 이양·실패 시 일관성", () => {
  it("같은 관리자가 동시에 두 사람에게 이양 → 1건만 성공, 관리자 1명 유지", async () => {
    const [x, y] = await Promise.all([transfer("adminC", "c", "staffC1"), transfer("adminC", "c", "staffC2")]);
    const statuses = [x.status, y.status].sort();
    expect(statuses[0]).toBe(200);
    expect([403, 409]).toContain(statuses[1]);
    const admins = await prisma.schoolMembership.findMany({ where: { schoolId: school.c, role: "admin" }, select: { id: true } });
    expect(admins).toHaveLength(1);
    expect([M.staffC1, M.staffC2]).toContain(admins[0]!.id);
    expect(await roleOf("adminC")).toBe("staff"); // 담임 배정 없음 → 교직원
    expect(await prisma.auditLog.count({ where: { action: "membership.admin_transferred", schoolId: school.c } })).toBe(1);
  });

  it("처리 중 오류(감사 기록 실패를 테스트 스키마에서만 강제) → 500, 두 사람 역할 모두 그대로, 기록 없음 → 오류 제거 후 정상 이양", async () => {
    await prisma.$executeRawUnsafe(
      `CREATE OR REPLACE FUNCTION test_fail_admin_transfer() RETURNS trigger AS $$ BEGIN IF NEW.action = 'membership.admin_transferred' THEN RAISE EXCEPTION 'test-only failure'; END IF; RETURN NEW; END $$ LANGUAGE plpgsql`,
    );
    await prisma.$executeRawUnsafe(`CREATE TRIGGER test_fail_admin_transfer BEFORE INSERT ON audit_logs FOR EACH ROW EXECUTE FUNCTION test_fail_admin_transfer()`);
    try {
      const r = await transfer("adminD", "d", "staffD");
      expect(r.status).toBe(500);
      expect(await roleOf("adminD")).toBe("admin");
      expect(await roleOf("staffD")).toBe("staff");
      expect(await prisma.auditLog.count({ where: { action: "membership.admin_transferred", schoolId: school.d } })).toBe(0);
    } finally {
      await prisma.$executeRawUnsafe(`DROP TRIGGER IF EXISTS test_fail_admin_transfer ON audit_logs`);
      await prisma.$executeRawUnsafe(`DROP FUNCTION IF EXISTS test_fail_admin_transfer()`);
    }
    expect((await transfer("adminD", "d", "staffD")).status).toBe(200);
    expect(await roleOf("staffD")).toBe("admin");
    expect(await roleOf("adminD")).toBe("staff");
  });
});
