// Beta PILOT 2: 실명 입력과 학교 관리자의 교직원 표시 성명 정정(HTTP, 테스트 스키마)
// - 성명만 바뀌고 계정 ID·이메일·비밀번호·인증 상태·역할·학급 배정·직책·대리 지정은 그대로
// - 다른 학교 관리자·일반 교직원·앱 운영담당은 거부, 다른 학교에도 소속된 계정은 학교에서 바꾸지 않음
// - 과거 보고는 계정 ID로 남아 '누가 보고했는지'가 유지되고, 바뀌기 전 성명은 감사 기록에 남음
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { Server } from "node:http";
import { randomUUID } from "node:crypto";
import type { PrismaClient } from "@prisma/client";
import { createTestClient, getTestDatabaseUrl, resetTestData } from "./test-db";

const PASSWORD = "rename-test-password-1234";
let prisma: PrismaClient;
let server: Server;
let base = "";
const school: Record<"a" | "b", string> = { a: "", b: "" };
const U: Record<string, string> = {}; // key → userId
const M: Record<string, string> = {}; // key → membershipId (a 학교, multi 는 a 쪽)
const cookie: Record<string, string> = {};
const ip: Record<string, string> = {};
let classA1 = "";
let classA2 = "";
let eventA = "";

async function call(who: string | null, method: string, path: string, body?: unknown, headers: Record<string, string> = {}) {
  const res = await fetch(`${base}/api${path}`, {
    method,
    headers: {
      ...(who && cookie[who] ? { cookie: cookie[who] } : {}),
      "x-forwarded-for": (who && ip[who]) || "198.51.100.77",
      ...(method === "GET" ? {} : { "content-type": "application/json" }),
      ...headers,
    },
    body: method === "GET" ? undefined : JSON.stringify(body ?? {}),
  });
  const text = await res.text();
  return { status: res.status, body: (text ? JSON.parse(text) : {}) as Record<string, any> };
}

async function login(key: string, email: string) {
  const res = await fetch(`${base}/api/auth/login`, {
    method: "POST",
    headers: { "content-type": "application/json", "x-forwarded-for": ip[key]! },
    body: JSON.stringify({ email, password: PASSWORD, deviceKind: "personal" }),
  });
  expect(res.status).toBe(200);
  cookie[key] = res.headers.get("set-cookie")!.split(";")[0]!;
}

const reauth = (who: string) => call(who, "POST", "/auth/reauth", { password: PASSWORD });
const rename = (who: string, schoolKey: "a" | "b", membershipId: string, displayName: string, expectedCurrentName: string, reason = "가입 시 별명 입력") =>
  call(who, "PUT", `/schools/${school[schoolKey]}/members/${membershipId}/display-name`, { displayName, expectedCurrentName, reason });
const nameOf = async (key: string) => (await prisma.user.findUniqueOrThrow({ where: { id: U[key]! } })).displayName;

beforeAll(async () => {
  process.env.DATABASE_URL = getTestDatabaseUrl();
  prisma = createTestClient();
  await resetTestData(prisma);
  const { hashPassword } = await import("../server/src/security/password");
  const { grantDutyByPlatformOperator } = await import("../server/src/services/duties");
  const { issueEvent, submitReport, currentSchoolYear } = await import("../server/src/services/events");
  const { assignDelegate } = await import("../server/src/services/delegations");
  const passwordHash = await hashPassword(PASSWORD);
  const now = new Date();

  for (const k of ["a", "b"] as const) {
    school[k] = (await prisma.school.create({ data: { slug: `rename-${k}`, name: `가상 성명학교 ${k.toUpperCase()}`, isDemo: true, status: "active", activatedAt: now } })).id;
  }
  const year = currentSchoolYear();
  classA1 = (await prisma.schoolClass.create({ data: { schoolId: school.a, schoolYear: year, grade: 1, classNo: 1, label: "1학년 1반", enrolledCount: 20, enrolledConfirmedAt: now } })).id;
  classA2 = (await prisma.schoolClass.create({ data: { schoolId: school.a, schoolYear: year, grade: 1, classNo: 2, label: "1학년 2반", enrolledCount: 21, enrolledConfirmedAt: now } })).id;

  // 기존 가입자처럼 별명·숫자가 든 이름(새 규칙 이전 계정)도 그대로 로그인되어야 함
  const people: { key: string; name: string; school: "a" | "b"; role: "admin" | "homeroom" | "staff"; status?: "approved" | "pending" }[] = [
    { key: "adminA", name: "관리자에이", school: "a", role: "admin" },
    { key: "teacherA", name: "교사01", school: "a", role: "homeroom" },
    { key: "staffA", name: "보건쌤", school: "a", role: "staff" },
    { key: "opA", name: "운영담당", school: "a", role: "staff" },
    { key: "pendingA", name: "대기교사", school: "a", role: "staff", status: "pending" },
    { key: "adminB", name: "관리자비", school: "b", role: "admin" },
    { key: "multi", name: "겸임교사", school: "a", role: "staff" },
  ];
  for (const [i, p] of people.entries()) {
    const user = await prisma.user.create({ data: { email: `${p.key.toLowerCase()}@rename.safeschool.invalid`, displayName: p.name, passwordHash, emailVerifiedAt: now } });
    U[p.key] = user.id;
    M[p.key] = (
      await prisma.schoolMembership.create({
        data: { schoolId: school[p.school], userId: user.id, role: p.role, status: p.status ?? "approved", ...(p.status === "pending" ? {} : { approvalMethod: "roster", approvedAt: now }) },
      })
    ).id;
    ip[p.key] = `203.0.113.${50 + i}`;
  }
  await prisma.schoolMembership.create({ data: { schoolId: school.b, userId: U.multi!, role: "staff", status: "approved", approvalMethod: "roster", approvedAt: now } });
  await prisma.classAssignment.create({ data: { membershipId: M.teacherA!, classId: classA1, duty: "homeroom" } });
  await grantDutyByPlatformOperator(prisma, { membershipId: M.opA!, duty: "app_operator", operator: "성명 정정 테스트", verificationMethod: "테스트" });

  // 정정 전: 진행 중 훈련, 담임 보고 1건, 2반 대리 담당(staffA) 지정
  eventA = (await issueEvent(prisma, { schoolId: school.a, actorUserId: U.adminA!, primaryType: "fire", mode: "drill" })).id;
  await submitReport(prisma, {
    schoolId: school.a,
    eventId: eventA,
    classId: classA1,
    actorUserId: U.teacherA!,
    membershipId: M.teacherA!,
    role: "homeroom",
    idempotencyKey: randomUUID(),
    input: { evacuated: 19, absentKnown: 1, injured: 0, enrolledCount: 20, enrolledChangeReason: null, note: null, expectedVersion: null },
  });
  await assignDelegate(prisma, { schoolId: school.a, eventId: eventA, classId: classA2, actorUserId: U.adminA!, delegateMembershipId: M.staffA!, reason: "unreachable" });

  const { createApp } = await import("../server/src/app");
  const http = await import("node:http");
  server = http.createServer(await createApp({ mode: "test", trustProxyHops: 1 }));
  await new Promise<void>((r) => server.listen(0, "127.0.0.1", () => r()));
  const addr = server.address();
  base = `http://127.0.0.1:${typeof addr === "object" && addr ? addr.port : 0}`;
  for (const p of people) await login(p.key, `${p.key.toLowerCase()}@rename.safeschool.invalid`);
});

afterAll(async () => {
  await new Promise<void>((r) => server.close(() => r()));
  await prisma.$disconnect();
});

describe("실명 입력(가입)과 기존 계정", () => {
  it("가입 요청에 숫자·기호 이름은 400(성명 검증), 메일 설정과 무관하게 계정을 만들지 않음", async () => {
    const r = await call(null, "POST", "/auth/signup", { email: "newbie@rename.safeschool.invalid", displayName: "교사01", password: "new-password-12345" });
    expect(r.status).toBe(400);
    expect(r.body.details.fields.displayName).toBeTruthy();
    expect(await prisma.user.count({ where: { email: "newbie@rename.safeschool.invalid" } })).toBe(0);
  });

  it("새 규칙 이전에 만든 별명·숫자 이름 계정도 로그인·내 정보 정상(beforeAll 로그인 통과)", async () => {
    const me = await call("teacherA", "GET", "/auth/me");
    expect(me.status).toBe(200);
    expect(me.body.user.displayName).toBe("교사01");
  });
});

describe("성명 정정 권한", () => {
  it("최근 비밀번호 재확인이 없으면 403 reauth_required, 성명 그대로", async () => {
    // 비밀번호 로그인 직후는 재확인한 것으로 보므로(session.ts) 재확인 시각을 1시간 전으로 돌려 확인
    await prisma.session.updateMany({ where: { userId: U.adminA! }, data: { reauthAt: new Date(Date.now() - 3600_000) } });
    const r = await rename("adminA", "a", M.teacherA!, "김담임", "교사01");
    expect(r.status).toBe(403);
    expect(r.body.code).toBe("reauth_required");
    expect(await nameOf("teacherA")).toBe("교사01");
  });

  it("일반 교직원·담임·앱 운영담당(교직원 승인 권한 있음)은 재확인 후에도 403", async () => {
    for (const who of ["staffA", "teacherA", "opA"]) {
      expect((await reauth(who)).status).toBe(200);
      const r = await rename(who, "a", M.adminA!, "바뀐이름", "관리자에이");
      expect(r.status).toBe(403);
    }
    expect(await nameOf("adminA")).toBe("관리자에이");
  });

  it("다른 학교 관리자: 자기 학교 경로로 A 소속 id → 404, A 학교 경로 → 404", async () => {
    expect((await reauth("adminB")).status).toBe(200);
    expect((await rename("adminB", "b", M.teacherA!, "김담임", "교사01")).status).toBe(404);
    expect((await rename("adminB", "a", M.teacherA!, "김담임", "교사01")).status).toBe(404);
    expect(await nameOf("teacherA")).toBe("교사01");
  });

  it("로그인 없이 직접 호출 → 401", async () => {
    expect((await rename("nobody", "a", M.teacherA!, "김담임", "교사01")).status).toBe(401);
  });
});

describe("학교 관리자의 성명 정정", () => {
  let before: Awaited<ReturnType<typeof snapshot>>;
  async function snapshot(key: string) {
    const u = await prisma.user.findUniqueOrThrow({ where: { id: U[key]! } });
    const m = await prisma.schoolMembership.findUniqueOrThrow({ where: { id: M[key]! }, include: { assignments: true, duties: true } });
    const delegations = await prisma.eventReportDelegation.findMany({ where: { delegateMembershipId: M[key]! }, orderBy: { assignedAt: "asc" } });
    const sessions = await prisma.session.count({ where: { userId: U[key]! } });
    return {
      user: { id: u.id, email: u.email, passwordHash: u.passwordHash, emailVerifiedAt: u.emailVerifiedAt?.toISOString(), status: u.status },
      membership: { id: m.id, role: m.role, status: m.status, assignments: m.assignments.map((a) => [a.classId, a.duty]), duties: m.duties.map((d) => [d.duty, d.endedAt]) },
      delegations: delegations.map((d) => [d.id, d.classId, d.endedAt]),
      sessions,
    };
  }

  it("동일 학교 담임 성명 정정 200: 성명만 바뀜(계정 ID·이메일·비밀번호·인증·역할·배정·세션 그대로)", async () => {
    expect((await reauth("adminA")).status).toBe(200);
    before = await snapshot("teacherA");
    const r = await rename("adminA", "a", M.teacherA!, "  김   담임 ", "교사01", "가입 시 별명 입력");
    expect(r.status).toBe(200);
    expect(r.body.displayName).toBe("김 담임"); // 공백 정리
    expect(await nameOf("teacherA")).toBe("김 담임");
    expect(await snapshot("teacherA")).toEqual(before);
  });

  it("감사 기록: 바꾸기 전·후 성명, 사유, 바꾼 사람, 대상 계정", async () => {
    const log = await prisma.auditLog.findFirstOrThrow({ where: { action: "membership.display_name_corrected", targetId: M.teacherA! } });
    expect(log.schoolId).toBe(school.a);
    expect(log.actorUserId).toBe(U.adminA);
    expect(log.before).toEqual({ displayName: "교사01" });
    expect(log.after).toMatchObject({ displayName: "김 담임", userId: U.teacherA, reason: "가입 시 별명 입력" });
  });

  it("과거 보고는 계정 ID로 유지(보고자·수정 이력 그대로), 상황판에는 현재 성명", async () => {
    const report = await prisma.evacuationReport.findFirstOrThrow({ where: { eventId: eventA, classId: classA1 }, include: { revisions: true } });
    expect(report.reportedById).toBe(U.teacherA);
    expect(report.revisions.every((v) => v.changedById === U.teacherA)).toBe(true);
    expect(report.version).toBe(1);
    const board = await call("adminA", "GET", `/schools/${school.a}/events/${eventA}/board`);
    expect(board.status).toBe(200);
    const c1 = (board.body.classes as { classId: string; report: { reporterName: string } | null }[]).find((c) => c.classId === classA1)!;
    expect(c1.report!.reporterName).toBe("김 담임");
  });

  it("대리 담당 교직원 성명 정정 후에도 대리 지정·보고 권한 그대로(지정 학급 200, 다른 학급 403)", async () => {
    const pre = await snapshot("staffA");
    expect((await rename("adminA", "a", M.staffA!, "박보건", "보건쌤", "실명으로 정정")).status).toBe(200);
    expect(await snapshot("staffA")).toEqual(pre);
    const body = (n: number) => ({ evacuated: n, absentKnown: 0, injured: 0, enrolledCount: n, enrolledChangeReason: null, note: null, expectedVersion: null });
    expect((await call("staffA", "PUT", `/schools/${school.a}/events/${eventA}/reports/${classA2}`, body(21), { "idempotency-key": randomUUID() })).status).toBe(200);
    expect((await call("staffA", "PUT", `/schools/${school.a}/events/${eventA}/reports/${classA1}`, { ...body(20), expectedVersion: 1 }, { "idempotency-key": randomUUID() })).status).toBe(403);
    const me = await call("staffA", "GET", "/auth/me");
    expect(me.body.user.displayName).toBe("박보건");
  });

  it("잘못 바꾼 성명은 다시 정정 가능(되돌리기), 감사 기록 2건", async () => {
    expect((await rename("adminA", "a", M.teacherA!, "교사영일", "김 담임", "잘못 정정")).status).toBe(200);
    expect((await rename("adminA", "a", M.teacherA!, "김담임", "교사영일", "앞선 정정 되돌림")).status).toBe(200);
    const logs = await prisma.auditLog.findMany({ where: { action: "membership.display_name_corrected", targetId: M.teacherA! }, orderBy: { at: "asc" } });
    expect(logs.map((l) => (l.before as { displayName: string }).displayName)).toEqual(["교사01", "김 담임", "교사영일"]);
  });

  it("관리자 본인 성명도 같은 절차로 정정 가능(역할 그대로)", async () => {
    expect((await rename("adminA", "a", M.adminA!, "이관리", "관리자에이", "실명으로 정정")).status).toBe(200);
    expect((await prisma.schoolMembership.findUniqueOrThrow({ where: { id: M.adminA! } })).role).toBe("admin");
  });
});

describe("성명 정정 거부 조건", () => {
  it("다른 학교에도 소속된 계정 → 409 multi_school_member, 성명 그대로", async () => {
    const r = await rename("adminA", "a", M.multi!, "최겸임", "겸임교사");
    expect(r.status).toBe(409);
    expect(r.body.code).toBe("multi_school_member");
    expect(await nameOf("multi")).toBe("겸임교사");
  });

  it("승인 대기 교직원 → 409", async () => {
    expect((await rename("adminA", "a", M.pendingA!, "정대기", "대기교사")).status).toBe(409);
  });

  it("화면에서 본 성명과 지금 성명이 다르면 409 name_changed(동시 정정 방지)", async () => {
    const r = await rename("adminA", "a", M.opA!, "한운영", "옛날이름");
    expect(r.status).toBe(409);
    expect(r.body.code).toBe("name_changed");
    expect(await nameOf("opA")).toBe("운영담당");
  });

  it("성명 형식 오류(숫자·한 글자)·사유 없음 → 400, 같은 성명 → 400", async () => {
    expect((await rename("adminA", "a", M.opA!, "한운영1", "운영담당")).status).toBe(400);
    expect((await rename("adminA", "a", M.opA!, "한", "운영담당")).status).toBe(400);
    expect((await rename("adminA", "a", M.opA!, "한운영", "운영담당", "")).status).toBe(400);
    expect((await rename("adminA", "a", M.opA!, "운영담당", "운영담당")).status).toBe(400);
    expect(await nameOf("opA")).toBe("운영담당");
  });

  it("다른 학교 계정 데이터는 그대로", async () => {
    expect(await nameOf("adminB")).toBe("관리자비");
    expect(await prisma.auditLog.count({ where: { action: "membership.display_name_corrected", schoolId: school.b } })).toBe(0);
  });
});
