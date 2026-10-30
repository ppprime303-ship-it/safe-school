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
  // Beta PILOT 2: 성명 정정(학교 관리자만 — 시연 계정 8개에는 없음)
  { name: "성명 정정", method: "PUT", path: (k) => `${S(k)}/members/${membershipOf[`${k}1`]}/display-name`, cap: "members.rename" },
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

// Beta PILOT 2 Phase 1-1: 상황판 열람(board.view)과 학급 보고 권한 분리, 권한별 응답 분리(B 학교에서만 보고를 만듦 — A 학교 검사와 분리)
// b1 = 앱 운영담당(상세 권한 없음), b2 = 안전업무 담당 + 1학년 1반 담임(상세 권한), b3 = 교장(배정 학급 없음)
describe("Beta PILOT 2 — 상황판 열람과 보고 권한 분리", () => {
  async function getJson(who: string, path: string) {
    const res = await fetch(`${base}/api${path}`, { headers: { cookie: cookieOf[who]!, "x-forwarded-for": ipOf[who]! } });
    return { status: res.status, body: (await res.json()) as Record<string, unknown> & { scope?: string; classes: { classId: string; report: Record<string, unknown> | null; delegation?: unknown }[]; summary: Record<string, unknown> } };
  }
  const reportBody = async (classKey: string, note: string) => {
    const cls = await prisma.schoolClass.findUniqueOrThrow({ where: { id: classOf[classKey]! } });
    const enrolled = cls.enrolledCount!;
    return { evacuated: enrolled - 2, absentKnown: 0, injured: 1, enrolledCount: enrolled, enrolledChangeReason: null, note, expectedVersion: null };
  };
  const MEMO = "학생 이름이 적힌 메모(테스트)";

  it("담임(b2)은 자기 학급 보고 성공", async () => {
    const status = await req("b2", "PUT", `${S("b")}/events/${activeEvent.b}/reports/${classOf["b:1-1"]}`, await reportBody("b:1-1", MEMO), { "idempotency-key": randomUUID() });
    expect(status).toBe(200);
  });

  it("상세 권한 없는 교직원(b1)도 상황판 조회 200, 응답에 메모·보고자·부상·대리 담당 없음", async () => {
    const { status, body } = await getJson("b1", `${S("b")}/events/${activeEvent.b}/board`);
    expect(status).toBe(200);
    expect(body.scope).toBe("summary");
    const raw = JSON.stringify(body);
    expect(raw).not.toContain(MEMO);
    expect(raw).not.toContain("delegat");
    const c11 = body.classes.find((c) => c.classId === classOf["b:1-1"])!;
    expect(c11.report).toMatchObject({ injured: null, note: null, reporterName: null, unconfirmed: 2 });
    expect(body.summary).not.toHaveProperty("injured");
    expect(body.summary).toMatchObject({ reportedClasses: 1 });
  });

  it("상세 권한자(b2)는 같은 상황판에서 메모·부상 인원까지 받음", async () => {
    const { status, body } = await getJson("b2", `${S("b")}/events/${activeEvent.b}/board`);
    expect(status).toBe(200);
    expect(body.scope).toBe("full");
    const c11 = body.classes.find((c) => c.classId === classOf["b:1-1"])!;
    expect(c11.report).toMatchObject({ injured: 1, note: MEMO });
    expect(c11).toHaveProperty("delegation");
    expect(body.summary).toMatchObject({ injured: 1 });
  });

  it("상황판을 볼 수 있어도 배정되지 않은 학급 보고는 403(b1 앱 운영담당, b3 교장), 보고 내용 그대로", async () => {
    for (const who of ["b1", "b3"]) {
      const status = await req(who, "PUT", `${S("b")}/events/${activeEvent.b}/reports/${classOf["b:1-2"]}`, await reportBody("b:1-2", "무단 보고"), { "idempotency-key": randomUUID() });
      expect(status).toBe(403);
    }
    expect(await prisma.evacuationReport.count({ where: { eventId: activeEvent.b, classId: classOf["b:1-2"]! } })).toBe(0);
  });

  it("다른 학교 상황판은 요약도 404(a1 → B, b1 → A)", async () => {
    expect((await getJson("a1", `${S("b")}/events/${activeEvent.b}/board`)).status).toBe(404);
    expect((await getJson("b1", `${S("a")}/events/${activeEvent.a}/board`)).status).toBe(404);
  });
});

// Phase 1-2: 직책·업무가 전혀 없는 일반 교직원·담임(테스트 전용 가상 계정, B 학교)
describe("Beta PILOT 2 — 업무 없는 일반 교직원·담임의 상황판·보고", () => {
  beforeAll(async () => {
    const now = new Date();
    const { passwordHash } = await prisma.user.findFirstOrThrow({ where: { email: plan.accounts[0]!.email } });
    const make = async (key: string, role: "staff" | "homeroom", ip: string, homeroomOf?: string) => {
      const user = await prisma.user.create({ data: { email: `${key}@judge.safeschool.invalid`, displayName: `가상 ${key}`, passwordHash, emailVerifiedAt: now } });
      const m = await prisma.schoolMembership.create({ data: { schoolId: school.b, userId: user.id, role, status: "approved", approvalMethod: "roster", approvedAt: now } });
      if (homeroomOf) await prisma.classAssignment.create({ data: { membershipId: m.id, classId: classOf[homeroomOf]!, duty: "homeroom" } });
      ipOf[key] = ip;
      const res = await fetch(`${base}/api/auth/login`, {
        method: "POST",
        headers: { "content-type": "application/json", "x-forwarded-for": ip },
        body: JSON.stringify({ email: user.email, password: PASSWORD, deviceKind: "personal" }),
      });
      expect(res.status).toBe(200);
      cookieOf[key] = res.headers.get("set-cookie")!.split(";")[0]!;
    };
    await make("plainStaff", "staff", "203.0.113.210");
    await make("plainTeacher", "homeroom", "203.0.113.211", "b:1-3");
  });

  const board = async (who: string, eventId: string, schoolKey: K = "b") => {
    const res = await fetch(`${base}/api${S(schoolKey)}/events/${eventId}/board`, { headers: { cookie: cookieOf[who]!, "x-forwarded-for": ipOf[who]! } });
    return { status: res.status, body: (await res.json()) as { scope?: string; classes?: { report: Record<string, unknown> | null }[]; summary?: Record<string, unknown> } };
  };
  const body = (enrolled: number) => ({ evacuated: enrolled, absentKnown: 0, injured: 0, enrolledCount: enrolled, enrolledChangeReason: null, note: null, expectedVersion: null });
  const enrolledOf = async (classKey: string) => (await prisma.schoolClass.findUniqueOrThrow({ where: { id: classOf[classKey]! } })).enrolledCount!;

  it("권한 계산: 업무 없는 교직원·담임은 board.view 만(상세·발령 없음)", () => {
    expect(capabilitiesFor("staff", [])).toEqual(["board.view"]);
    expect(capabilitiesFor("homeroom", [])).toEqual(["board.view"]);
  });

  it("일반 교직원·담임: 자기 학교 진행 중 상황판 200 요약, 메모·보고자·부상 없음", async () => {
    for (const who of ["plainStaff", "plainTeacher"]) {
      const { status, body: b } = await board(who, activeEvent.b);
      expect(status).toBe(200);
      expect(b.scope).toBe("summary");
      expect(JSON.stringify(b)).not.toContain("학생 이름이 적힌 메모");
      expect(JSON.stringify(b)).not.toContain("delegat");
      for (const c of b.classes!) if (c.report) expect(c.report).toMatchObject({ injured: null, note: null, reporterName: null });
      expect(b.summary).not.toHaveProperty("injured");
    }
  });

  it("종료된 상황의 상황판도 요약(상세 항목 없음)", async () => {
    const closed = await prisma.drillLog.findUniqueOrThrow({ where: { id: drillLog.b } });
    const { status, body: b } = await board("plainStaff", closed.eventId);
    expect(status).toBe(200);
    expect(b.scope).toBe("summary");
  });

  it("다른 학교 상황판 404", async () => {
    expect((await board("plainStaff", activeEvent.a, "a")).status).toBe(404);
  });

  it("담임은 자기 학급 보고 200, 다른 학급 403 / 일반 교직원은 어느 학급도 403", async () => {
    const own = await req("plainTeacher", "PUT", `${S("b")}/events/${activeEvent.b}/reports/${classOf["b:1-3"]}`, body(await enrolledOf("b:1-3")), { "idempotency-key": randomUUID() });
    expect(own).toBe(200);
    const otherClass = await req("plainTeacher", "PUT", `${S("b")}/events/${activeEvent.b}/reports/${classOf["b:1-4"]}`, body(await enrolledOf("b:1-4")), { "idempotency-key": randomUUID() });
    expect(otherClass).toBe(403);
    for (const k of ["b:1-3", "b:1-4"]) {
      const s = await req("plainStaff", "PUT", `${S("b")}/events/${activeEvent.b}/reports/${classOf[k]}`, body(await enrolledOf(k)), { "idempotency-key": randomUUID() });
      expect(s).toBe(403);
    }
    expect(await prisma.evacuationReport.count({ where: { eventId: activeEvent.b, classId: classOf["b:1-4"]! } })).toBe(0);
  });

  it("일반 교직원은 발령·종료·대리 지정 403", async () => {
    expect(await req("plainStaff", "POST", `${S("b")}/events`, { primaryType: "fire", mode: "drill" })).toBe(403);
    expect(await req("plainStaff", "POST", `${S("b")}/events/${activeEvent.b}/close`, {})).toBe(403);
    expect(await req("plainStaff", "GET", `${S("b")}/events/${activeEvent.b}/classes/${classOf["b:1-4"]}/delegation-suggestions`)).toBe(403);
  });

  it("발령 정보 수정에 주민등록번호 형태 → 400, 사건 정보 그대로", async () => {
    const before = await prisma.disasterEvent.findUniqueOrThrow({ where: { id: activeEvent.b } });
    expect(await req("b2", "PATCH", `${S("b")}/events/${activeEvent.b}`, { message: "김OO 010101-3123456 확인" })).toBe(400);
    expect(await req("b2", "POST", `${S("b")}/events`, { primaryType: "fire", mode: "drill", evacPlace: "990101-1234567" })).toBe(400);
    const after = await prisma.disasterEvent.findUniqueOrThrow({ where: { id: activeEvent.b } });
    expect(after.message).toBe(before.message);
    expect(await prisma.disasterEvent.count({ where: { schoolId: school.b, status: "active" } })).toBe(1);
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
