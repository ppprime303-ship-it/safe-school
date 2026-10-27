// STEP 7-D 가상 학교 2곳 × 역할별 권한 행렬, 학교 간 격리·IDOR 회귀 테스트(HTTP, 테스트 스키마)
// - 학교·계정 구성은 심사 시연 계획(buildJudgePlan: 가상 초·중 2곳, 계정 8개)을 그대로 씁니다. 실제 개인정보 없음.
// - 로그인은 실제 /api/auth/login 으로 합니다. 서버에 테스트 전용 인증 우회 코드를 추가하지 않습니다
//   (비밀번호 해시는 judge-demo-setup 과 같은 방식으로 테스트 스키마에만 직접 저장).
// 기대값
// - 자기 학교: 권한(capabilitiesFor)이 있으면 403·404가 아님, 없으면 403
// - 다른 학교 경로: 모든 계정·모든 경로 404(존재 여부 비노출)
// - 자기 학교 경로 + 다른 학교 자원 id(IDOR): 404
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { Server } from "node:http";
import { randomUUID } from "node:crypto";
import type { PrismaClient } from "@prisma/client";
import { createTestClient, getTestDatabaseUrl, resetTestData } from "./test-db";
import { buildJudgePlan, JUDGE_VERIFICATION_NOTE, type JudgeAccountPlan } from "../server/src/deploy/judgeDemo";
import { capabilitiesFor, type Capability } from "../shared/permissions";

const PASSWORD = "matrix-test-password-1234";
const plan = buildJudgePlan();
let server: Server;
let base = "";
let prisma: PrismaClient;

const school: Record<"a" | "b", string> = { a: "", b: "" };
const activeEvent: Record<"a" | "b", string> = { a: "", b: "" };
const drillLog: Record<"a" | "b", string> = { a: "", b: "" };
const classOf: Record<string, string> = {}; // "a:1-1" → classId
const membershipOf: Record<string, string> = {}; // 계정 key → membershipId
const dutyOf: Record<string, string> = {}; // 계정 key → 첫 직책·업무 id
const cookieOf: Record<string, string> = {};
const ipOf: Record<string, string> = {};
const capsOf: Record<string, Capability[]> = Object.fromEntries(plan.accounts.map((a) => [a.key, capabilitiesFor(a.role, a.duties)]));

async function req(who: string, method: string, path: string, body?: unknown, headers: Record<string, string> = {}) {
  const res = await fetch(`${base}/api${path}`, {
    method,
    headers: {
      ...(cookieOf[who] ? { cookie: cookieOf[who] } : {}),
      "x-forwarded-for": ipOf[who] ?? "198.51.100.1",
      ...(method === "GET" ? {} : { "content-type": "application/json" }),
      ...headers,
    },
    body: method === "GET" ? undefined : JSON.stringify(body ?? {}),
  });
  await res.arrayBuffer();
  return res.status;
}

beforeAll(async () => {
  process.env.DATABASE_URL = getTestDatabaseUrl();
  prisma = createTestClient();
  await resetTestData(prisma);
  const { hashPassword } = await import("../server/src/security/password");
  const { grantDutyByPlatformOperator } = await import("../server/src/services/duties");
  const { issueEvent, closeEvent, currentSchoolYear } = await import("../server/src/services/events");
  const { createDrillLog } = await import("../server/src/services/drillLogs");
  const year = currentSchoolYear();
  const passwordHash = await hashPassword(PASSWORD);
  const now = new Date();

  for (const s of plan.schools) {
    const row = await prisma.school.create({
      data: { slug: s.slug, name: s.name, isDemo: true, schoolKindCode: s.kindCode, status: "active", activatedAt: now, eduOfficeName: s.eduOfficeName, address: s.address },
    });
    school[s.key] = row.id;
    for (const c of s.classes) {
      const cls = await prisma.schoolClass.create({
        data: { schoolId: row.id, schoolYear: year, grade: c.grade, classNo: c.classNo, label: `${c.grade}학년 ${c.classNo}반`, enrolledCount: c.enrolled, enrolledConfirmedAt: now },
      });
      classOf[`${s.key}:${c.grade}-${c.classNo}`] = cls.id;
    }
  }

  const userOf: Record<string, string> = {};
  for (const [i, a] of plan.accounts.entries()) {
    const user = await prisma.user.create({ data: { email: a.email, displayName: a.displayName, passwordHash, emailVerifiedAt: now } });
    userOf[a.key] = user.id;
    const m = await prisma.schoolMembership.create({
      data: { schoolId: school[a.schoolKey], userId: user.id, role: a.role, status: "approved", approvalMethod: "roster", approvedAt: now },
    });
    membershipOf[a.key] = m.id;
    for (const x of a.assignments)
      await prisma.classAssignment.create({ data: { membershipId: m.id, classId: classOf[`${a.schoolKey}:${x.grade}-${x.classNo}`]!, duty: x.duty } });
    for (const duty of a.duties) {
      const d = await grantDutyByPlatformOperator(prisma, { membershipId: m.id, duty, operator: "STEP 7-D 테스트", verificationMethod: JUDGE_VERIFICATION_NOTE });
      dutyOf[a.key] ??= (d as { id: string }).id;
    }
    ipOf[a.key] = `203.0.113.${100 + i}`;
  }

  // 학교마다: 종료된 모의훈련 1건 + 훈련일지, 진행 중 모의훈련 1건
  for (const key of ["a", "b"] as const) {
    const officer = plan.accounts.find((a) => a.schoolKey === key && a.duties.includes("safety_officer"))!;
    const closed = await issueEvent(prisma, { schoolId: school[key], actorUserId: userOf[officer.key]!, primaryType: "fire", mode: "drill" });
    await closeEvent(prisma, { schoolId: school[key], eventId: closed.id, actorUserId: userOf[officer.key]! });
    drillLog[key] = (await createDrillLog(prisma, { schoolId: school[key], eventId: closed.id, actorUserId: userOf[officer.key]! }) as { id: string }).id;
    activeEvent[key] = (await issueEvent(prisma, { schoolId: school[key], actorUserId: userOf[officer.key]!, primaryType: "earthquake", mode: "drill" })).id;
  }

  const { createApp } = await import("../server/src/app");
  const http = await import("node:http");
  server = http.createServer(await createApp({ mode: "test", trustProxyHops: 1 }));
  await new Promise<void>((r) => server.listen(0, "127.0.0.1", () => r()));
  const addr = server.address();
  base = `http://127.0.0.1:${typeof addr === "object" && addr ? addr.port : 0}`;

  for (const a of plan.accounts) {
    const res = await fetch(`${base}/api/auth/login`, {
      method: "POST",
      headers: { "content-type": "application/json", "x-forwarded-for": ipOf[a.key]! },
      body: JSON.stringify({ email: a.email, password: PASSWORD, deviceKind: "personal" }),
    });
    expect(res.status).toBe(200);
    cookieOf[a.key] = res.headers.get("set-cookie")!.split(";")[0]!;
  }
});

afterAll(async () => {
  await new Promise<void>((r) => server.close(() => r()));
  await prisma.$disconnect();
});

type K = "a" | "b";
interface RouteCase {
  name: string;
  method: "GET" | "POST" | "PUT" | "PATCH";
  path: (k: K) => string;
  /** null = 승인된 소속이면 누구나 */
  cap: Capability | null;
}
const S = (k: K) => `/schools/${school[k]}`;

// 조회: 권한이 있으면 성공해야 함(403·404 아님), 없으면 403
const READS: RouteCase[] = [
  { name: "학급 목록", method: "GET", path: (k) => `${S(k)}/classes`, cap: null },
  { name: "진행 중 상황", method: "GET", path: (k) => `${S(k)}/events/active`, cap: null },
  { name: "경보함", method: "GET", path: (k) => `${S(k)}/alerts`, cap: null },
  { name: "안내문 목록", method: "GET", path: (k) => `${S(k)}/notices`, cap: null },
  { name: "안내문 예시", method: "GET", path: (k) => `${S(k)}/notice-examples`, cap: null },
  { name: "상황판", method: "GET", path: (k) => `${S(k)}/events/${activeEvent[k]}/board`, cap: "board.view" },
  { name: "교직원 목록", method: "GET", path: (k) => `${S(k)}/members`, cap: "members.manage" },
  { name: "학교 소재지", method: "GET", path: (k) => `${S(k)}/region`, cap: "region.manage" },
  { name: "업무 담당자", method: "GET", path: (k) => `${S(k)}/duties`, cap: "duties.manage" },
  { name: "훈련일지 목록", method: "GET", path: (k) => `${S(k)}/drill-logs`, cap: "drilllog.view" },
  { name: "훈련일지 보기", method: "GET", path: (k) => `${S(k)}/drill-logs/${drillLog[k]}`, cap: "drilllog.view" },
  { name: "훈련일지 교직원 선택", method: "GET", path: (k) => `${S(k)}/drill-log-staff`, cap: "drilllog.edit" },
];

// 변경: 데이터를 바꾸지 않도록 '권한 없음 403'과 '다른 학교 404'만 확인(빈 본문 — 권한 검사가 입력 검사보다 먼저)
const WRITES: RouteCase[] = [
  { name: "발령", method: "POST", path: (k) => `${S(k)}/events`, cap: "event.issue" },
  { name: "종료", method: "POST", path: (k) => `${S(k)}/events/${activeEvent[k]}/close`, cap: "event.close" },
  { name: "가입 승인", method: "POST", path: (k) => `${S(k)}/members/approve`, cap: "members.manage" },
  { name: "가입 거절", method: "POST", path: (k) => `${S(k)}/members/reject`, cap: "members.manage" },
  { name: "재적 수정", method: "PUT", path: (k) => `${S(k)}/classes/enrollment`, cap: "classes.manage" },
  { name: "학급 구조 적용", method: "POST", path: (k) => `${S(k)}/classes/apply-structure`, cap: "classes.manage" },
  { name: "학교 소재지 수정", method: "PUT", path: (k) => `${S(k)}/region`, cap: "region.manage" },
  { name: "업무 지정", method: "POST", path: (k) => `${S(k)}/duties`, cap: "duties.manage" },
  { name: "훈련일지 만들기", method: "POST", path: (k) => `${S(k)}/events/${activeEvent[k]}/drill-log`, cap: "drilllog.edit" },
  { name: "훈련일지 수정", method: "PATCH", path: (k) => `${S(k)}/drill-logs/${drillLog[k]}`, cap: "drilllog.edit" },
];

const other = (k: K): K => (k === "a" ? "b" : "a");
const label = (a: JudgeAccountPlan) => `${a.key}(${a.roleLabel})`;

describe("가상 학교 2곳 계정 8개 — 계획과 실제 권한 일치", () => {
  it.each(plan.accounts.map((a) => [label(a), a] as const))("%s: must 포함, mustNot 제외", (_n, a) => {
    for (const c of a.must) expect(capsOf[a.key]).toContain(c);
    for (const c of a.mustNot) expect(capsOf[a.key]).not.toContain(c);
  });

  it.each(plan.accounts.map((a) => [label(a), a] as const))("%s: 내 정보에 자기 학교 소속만", async (_n, a) => {
    const res = await fetch(`${base}/api/auth/me`, { headers: { cookie: cookieOf[a.key]! } });
    const me = (await res.json()) as { memberships: { school: { id: string } }[] };
    expect(me.memberships.map((m) => m.school.id)).toEqual([school[a.schoolKey]]);
  });
});

describe("자기 학교 — 역할별 권한 행렬", () => {
  const cases = plan.accounts.flatMap((a) => READS.map((r) => [`${label(a)} ${r.name}`, a, r] as const));
  it.each(cases)("조회 %s", async (_n, a, r) => {
    const status = await req(a.key, r.method, r.path(a.schoolKey));
    if (r.cap === null || capsOf[a.key]!.includes(r.cap)) expect([403, 404]).not.toContain(status);
    else expect(status).toBe(403);
  });

  const writes = plan.accounts.flatMap((a) => WRITES.filter((w) => w.cap && !capsOf[a.key]!.includes(w.cap)).map((w) => [`${label(a)} ${w.name}`, a, w] as const));
  it.each(writes)("권한 없는 변경 → 403: %s", async (_n, a, w) => {
    expect(await req(a.key, w.method, w.path(a.schoolKey))).toBe(403);
  });
});

describe("학교 간 격리 — 다른 학교 경로는 모두 404", () => {
  const cases = plan.accounts.flatMap((a) => [...READS, ...WRITES].map((r) => [`${label(a)} → ${r.method} ${r.name}`, a, r] as const));
  it.each(cases)("%s", async (_n, a, r) => {
    expect(await req(a.key, r.method, r.path(other(a.schoolKey)))).toBe(404);
  });

  it("관리 기능 경로도 다른 학교 소속 id로는 404(회수·배정·업무 해제)", async () => {
    // a1 = A 앱 운영담당: B 학교 경로
    expect(await req("a1", "POST", `${S("b")}/members/${membershipOf.b2}/revoke`)).toBe(404);
    expect(await req("a1", "PUT", `${S("b")}/members/${membershipOf.b2}/assignments`, { assignments: [] })).toBe(404);
    expect(await req("a1", "POST", `${S("b")}/duties/${dutyOf.b2}/end`, { reason: "격리 시험" })).toBe(404);
  });
});

describe("IDOR — 자기 학교 경로에 다른 학교 자원 id", () => {
  // b2 = B 안전업무 담당 + 1학년 1반 담임, b1 = B 앱 운영담당
  it("상황판·내 학급·종료: A 학교 상황 id → 404", async () => {
    expect(await req("b2", "GET", `${S("b")}/events/${activeEvent.a}/board`)).toBe(404);
    expect(await req("b2", "GET", `${S("b")}/events/${activeEvent.a}/my-classes`)).toBe(404);
    expect(await req("b2", "POST", `${S("b")}/events/${activeEvent.a}/close`, {})).toBe(404);
  });

  it("학급 보고: A 상황 id 또는 A 학급 id → 404", async () => {
    const report = { evacuated: 20, absentKnown: 0, injured: 0, enrolledCount: 20, enrolledChangeReason: null, note: null, expectedVersion: null };
    const key = () => ({ "idempotency-key": randomUUID() });
    expect(await req("b2", "PUT", `${S("b")}/events/${activeEvent.a}/reports/${classOf["b:1-1"]}`, report, key())).toBe(404);
    expect(await req("b2", "PUT", `${S("b")}/events/${activeEvent.b}/reports/${classOf["a:1-1"]}`, report, key())).toBe(404);
    expect(await req("b2", "PUT", `${S("b")}/events/${activeEvent.a}/reports/${classOf["a:1-1"]}`, report, key())).toBe(404);
  });

  it("훈련일지 보기·내려받기: A 훈련일지 id → 404", async () => {
    expect(await req("b2", "GET", `${S("b")}/drill-logs/${drillLog.a}`)).toBe(404);
    expect(await req("b2", "GET", `${S("b")}/drill-logs/${drillLog.a}/export.hwpx`)).toBe(404);
  });

  it("교직원 배정·회수·업무 해제: A 소속·학급·업무 id → 404, A 데이터 그대로", async () => {
    expect(await req("b1", "PUT", `${S("b")}/members/${membershipOf.a2}/assignments`, { assignments: [] })).toBe(404);
    expect(
      await req("b1", "PUT", `${S("b")}/members/${membershipOf.b2}/assignments`, { assignments: [{ classId: classOf["a:1-1"], duty: "homeroom" }] }),
    ).toBe(404);
    expect(await req("b1", "POST", `${S("b")}/members/${membershipOf.a2}/revoke`, {})).toBe(404);
    expect(await req("b1", "POST", `${S("b")}/duties/${dutyOf.a1}/end`, { reason: "IDOR 시험" })).toBe(404);

    expect((await prisma.schoolMembership.findUniqueOrThrow({ where: { id: membershipOf.a2! } })).status).toBe("approved");
    expect((await prisma.memberDuty.findUniqueOrThrow({ where: { id: dutyOf.a1! } })).endedAt).toBeNull();
    expect(await prisma.classAssignment.count({ where: { membershipId: membershipOf.b2!, classId: classOf["a:1-1"]! } })).toBe(0);
  });

  it("A 학교 상황은 여전히 진행 중(B 계정 요청으로 바뀌지 않음)", async () => {
    expect((await prisma.disasterEvent.findUniqueOrThrow({ where: { id: activeEvent.a } })).status).toBe("active");
    expect(await prisma.evacuationReport.count({ where: { eventId: activeEvent.a } })).toBe(0);
  });
});

describe("소속 상태", () => {
  it("승인 대기 소속 → 403, 소속 없음 → 404", async () => {
    const now = new Date();
    const pending = await prisma.user.create({ data: { email: "pending@judge.safeschool.invalid", displayName: "대기 교직원(가상)", passwordHash: (await prisma.user.findFirstOrThrow({ where: { email: plan.accounts[0]!.email } })).passwordHash, emailVerifiedAt: now } });
    await prisma.schoolMembership.create({ data: { schoolId: school.a, userId: pending.id, role: "staff", status: "pending" } });
    ipOf.pending = "203.0.113.200";
    const res = await fetch(`${base}/api/auth/login`, {
      method: "POST",
      headers: { "content-type": "application/json", "x-forwarded-for": ipOf.pending },
      body: JSON.stringify({ email: pending.email, password: PASSWORD, deviceKind: "personal" }),
    });
    cookieOf.pending = res.headers.get("set-cookie")!.split(";")[0]!;
    expect(await req("pending", "GET", `${S("a")}/classes`)).toBe(403);
    expect(await req("pending", "GET", `${S("b")}/classes`)).toBe(404);
  });
});
