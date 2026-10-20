// STEP 3-A 재난 발령·학급 보고·상황판·종료 자동 검증(실제 서버 + 실제 DB): npm run e2e:step3
//
// 안전장치
// - 테스트 전용 스키마(safeschool_test)만 사용합니다. 시작할 때 이 스키마의 데이터를 비우므로
//   브라우저 시연 스키마(safeschool_browser_demo)나 운영 스키마(public)와 섞어 쓰지 마세요.
// - 메일은 모의 발송(MAIL_PROVIDER=console)만, 서버는 NODE_ENV=test 로 실행합니다.
// - 학교 등록·가입·승인 흐름은 e2e:step2 가 검증하므로, 여기서는 승인 완료 상태를 DB에 직접 준비합니다.
//
// 구성: 2개 학교(A·B), A 학교 관리자·담임(1-1 배정)·일반 교직원(배정 없음), B 학교 관리자
import { spawn, execSync, type ChildProcess } from "node:child_process";
import { createTestClient, getTestDatabaseUrl, resetTestData } from "../tests/test-db.js";
import { hashPassword } from "../server/src/security/password.js";

const PORT = Number(process.env.E2E_PORT ?? 5098);
const BASE = `http://127.0.0.1:${PORT}/api`;
const PASSWORD = "e2e-step3-password";
let passed = 0;
let failed = 0;

function check(label: string, ok: boolean, detail?: unknown) {
  if (ok) {
    passed++;
    console.log(`  ✓ ${label}`);
  } else {
    failed++;
    console.log(`  ✗ ${label}${detail !== undefined ? ` — ${JSON.stringify(detail)}` : ""}`);
  }
}

class Agent {
  cookie = "";
  async call(method: string, path: string, body?: unknown, extra: Record<string, string> = {}) {
    const headers: Record<string, string> = { "X-Requested-With": "safe-school", ...extra };
    if (body !== undefined) headers["Content-Type"] = "application/json";
    if (this.cookie) headers.Cookie = this.cookie;
    const res = await fetch(`${BASE}${path}`, { method, headers, body: body === undefined ? undefined : JSON.stringify(body) });
    const setCookie = res.headers.get("set-cookie");
    if (setCookie) {
      const pair = setCookie.split(";")[0]!;
      this.cookie = pair.endsWith("=") ? "" : pair;
    }
    const text = await res.text();
    return { status: res.status, body: text ? (JSON.parse(text) as Record<string, any>) : {} };
  }
  async login(email: string) {
    const r = await this.call("POST", "/auth/login", { email, password: PASSWORD, deviceKind: "personal" });
    if (r.status !== 200) throw new Error(`로그인 실패: ${email} (${r.status} ${r.body.code})`);
  }
}

async function waitForServer() {
  for (let i = 0; i < 60; i++) {
    try {
      if ((await fetch(`${BASE}/health`)).ok) return;
    } catch {
      /* 아직 시작 중 */
    }
    await new Promise((r) => setTimeout(r, 500));
  }
  throw new Error("테스트 서버가 30초 안에 시작되지 않았습니다.");
}

const reportBody = (over: Record<string, unknown> = {}) => ({
  evacuated: 26,
  absentKnown: 1,
  injured: 0,
  enrolledCount: 28,
  enrolledChangeReason: null,
  note: null,
  expectedVersion: null,
  ...over,
});

async function main() {
  const testUrl = getTestDatabaseUrl(); // 스키마 이름에 test가 없으면 여기서 중단
  console.log("[e2e:step3] 테스트 스키마에 마이그레이션 적용");
  execSync("npx prisma migrate deploy", { stdio: "ignore", env: { ...process.env, DATABASE_URL: testUrl } });

  const prisma = createTestClient();
  await resetTestData(prisma);
  const now = new Date();
  const year = Number(new Intl.DateTimeFormat("en", { timeZone: "Asia/Seoul", year: "numeric" }).format(now));
  const hash = await hashPassword(PASSWORD);
  const user = (email: string, displayName: string) => prisma.user.create({ data: { email, displayName, passwordHash: hash, emailVerifiedAt: now } });
  const member = (schoolId: string, userId: string, role: "admin" | "homeroom" | "staff") =>
    prisma.schoolMembership.create({ data: { schoolId, userId, role, status: "approved", approvalMethod: "roster", approvedAt: now } });

  const schoolA = await prisma.school.create({ data: { name: "삼단계A초등학교", slug: "e2e3-a", status: "active", activatedAt: now } });
  const schoolB = await prisma.school.create({ data: { name: "삼단계B초등학교", slug: "e2e3-b", status: "active", activatedAt: now } });
  const uAdmin = await user("admin-a@e2e3.test", "A관리자");
  const uTeacher = await user("teacher-a@e2e3.test", "A담임");
  const uStaff = await user("staff-a@e2e3.test", "A교직원");
  const uAdminB = await user("admin-b@e2e3.test", "B관리자");
  await member(schoolA.id, uAdmin.id, "admin");
  const mTeacher = await member(schoolA.id, uTeacher.id, "homeroom");
  await member(schoolA.id, uStaff.id, "staff");
  await member(schoolB.id, uAdminB.id, "admin");
  const cls = (schoolId: string, classNo: number, enrolledCount: number | null) =>
    prisma.schoolClass.create({ data: { schoolId, schoolYear: year, grade: 1, classNo, label: `1학년 ${classNo}반`, enrolledCount } });
  const c11 = await cls(schoolA.id, 1, 28);
  const c12 = await cls(schoolA.id, 2, 30);
  await cls(schoolA.id, 3, null);
  await cls(schoolB.id, 1, 25);
  await prisma.classAssignment.create({ data: { membershipId: mTeacher.id, classId: c11.id, duty: "homeroom" } });

  console.log(`[e2e:step3] 테스트 서버 시작(포트 ${PORT}, NODE_ENV=test, 모의 메일)`);
  const server: ChildProcess = spawn("npx", ["tsx", "server/src/index.ts"], {
    env: { ...process.env, DATABASE_URL: testUrl, NODE_ENV: "test", PORT: String(PORT), MAIL_PROVIDER: "console", SCHOOLINFO_API_KEY: "", SCHOOLINFO_GRADE_DATA: "" },
    stdio: ["ignore", "ignore", "inherit"],
  });

  try {
    await waitForServer();
    const anon = new Agent();
    const admin = new Agent();
    const teacher = new Agent();
    const staff = new Agent();
    const adminB = new Agent();
    await admin.login("admin-a@e2e3.test");
    await teacher.login("teacher-a@e2e3.test");
    await staff.login("staff-a@e2e3.test");
    await adminB.login("admin-b@e2e3.test");
    const A = `/schools/${schoolA.id}`;

    console.log("\n1. 평상시·권한");
    check("로그인 없이 진행 중 상황 조회 → 401", (await anon.call("GET", `${A}/events/active`)).status === 401);
    const idle = await teacher.call("GET", `${A}/events/active`);
    check("평상시 담임 조회 → 진행 중 상황 없음", idle.status === 200 && idle.body.event === null, idle.body);
    const tIssue = await teacher.call("POST", `${A}/events`, { primaryType: "fire", mode: "drill" });
    check("담임은 발령할 수 없음 → 403", tIssue.status === 403, tIssue.body);
    const bIssue = await adminB.call("POST", `${A}/events`, { primaryType: "fire", mode: "drill" });
    check("다른 학교 관리자는 발령할 수 없음 → 404", bIssue.status === 404, bIssue.body);

    console.log("\n2. 훈련 발령");
    const noConfirm = await admin.call("POST", `${A}/events`, { primaryType: "fire", mode: "real" });
    check("실제 상황은 확인 없이 발령 불가 → 400 confirm_required", noConfirm.status === 400 && noConfirm.body.code === "confirm_required", noConfirm.body);
    const issued = await admin.call("POST", `${A}/events`, { primaryType: "fire", mode: "drill", evacPlace: "운동장" });
    check("관리자 훈련 발령 → 201", issued.status === 201 && issued.body.event?.mode === "drill" && issued.body.event?.types?.[0] === "fire", issued.body);
    const eventId = issued.body.event?.id as string;
    const E = `${A}/events/${eventId}`;
    const dup = await admin.call("POST", `${A}/events`, { primaryType: "earthquake", mode: "drill" });
    check("중복 발령 → 409 + 기존 상황 ID", dup.status === 409 && dup.body.code === "event_already_active" && dup.body.details?.eventId === eventId, dup.body);
    const seen = await teacher.call("GET", `${A}/events/active`);
    check("담임 화면에 진행 중 상황 표시", seen.body.event?.id === eventId && seen.body.event?.evacPlace === "운동장", seen.body);
    const bBoard = await adminB.call("GET", `${E}/board`);
    check("다른 학교 관리자는 상황판 접근 불가 → 404", bBoard.status === 404, bBoard.body);

    console.log("\n3. 담당 학급 보고");
    const mine = await teacher.call("GET", `${E}/my-classes`);
    check("담임은 배정된 1-1만 보임", mine.status === 200 && mine.body.classes?.length === 1 && mine.body.classes[0].classId === c11.id, mine.body);
    const staffMine = await staff.call("GET", `${E}/my-classes`);
    check("배정 없는 교직원은 빈 목록", staffMine.status === 200 && staffMine.body.classes?.length === 0, staffMine.body);
    const noKey = await teacher.call("PUT", `${E}/reports/${c11.id}`, reportBody());
    check("요청 번호 없는 보고 거부 → 400", noKey.status === 400 && noKey.body.code === "idempotency_key_required", noKey.body);
    const other = await teacher.call("PUT", `${E}/reports/${c12.id}`, reportBody({ enrolledCount: 30 }), { "Idempotency-Key": "e2e3-other-0001" });
    check("배정되지 않은 학급 보고 → 403", other.status === 403 && other.body.code === "class_not_assigned", other.body);
    const bad = await teacher.call("PUT", `${E}/reports/${c11.id}`, reportBody({ evacuated: 28 }), { "Idempotency-Key": "e2e3-bad-00001" });
    check("합계가 재적 초과 → 422 sum_mismatch", bad.status === 422 && bad.body.code === "sum_mismatch", bad.body);
    const r1 = await teacher.call("PUT", `${E}/reports/${c11.id}`, reportBody(), { "Idempotency-Key": "e2e3-first-0001" });
    check("담임 보고 저장 → 미확인 1명 서버 계산, 보고자 이름", r1.status === 200 && r1.body.report?.unconfirmed === 1 && r1.body.report?.reporterName === "A담임", r1.body);
    const replay = await teacher.call("PUT", `${E}/reports/${c11.id}`, reportBody(), { "Idempotency-Key": "e2e3-first-0001" });
    check("같은 요청 재전송 → 중복 저장 없음", replay.status === 200 && replay.body.replayed === true && replay.body.report?.version === 1, replay.body);
    const proxy = await admin.call("PUT", `${E}/reports/${c11.id}`, reportBody({ evacuated: 27, expectedVersion: 1 }), { "Idempotency-Key": "e2e3-proxy-0001" });
    check("관리자 대리 수정 → 버전 2", proxy.status === 200 && proxy.body.report?.version === 2, proxy.body);
    const stale = await teacher.call("PUT", `${E}/reports/${c11.id}`, reportBody({ evacuated: 25, expectedVersion: 1 }), { "Idempotency-Key": "e2e3-stale-0001" });
    check("이전 버전 기준 수정 → 409 version_conflict(최신 보고 포함)", stale.status === 409 && stale.body.code === "version_conflict" && stale.body.details?.current?.version === 2, stale.body);
    const revisions = await prisma.evacuationReportRevision.count({ where: { report: { eventId } } });
    check("수정 이력 2건 보존", revisions === 2, { revisions });

    console.log("\n4. 상황판");
    const tBoard = await teacher.call("GET", `${E}/board`);
    check("담임은 상황판 접근 불가 → 403", tBoard.status === 403, tBoard.body);
    const board = await admin.call("GET", `${E}/board`);
    const s = board.body.summary;
    check(
      "상황판: 3개 학급 중 1개 보고, 미보고 학생 30명, 재적 미확인 1개 학급",
      board.status === 200 && !!board.body.serverTime && s?.totalClasses === 3 && s?.reportedClasses === 1 && s?.pendingStudents === 30 && s?.unknownEnrolledClasses === 1,
      board.body.summary,
    );
    const typed = await admin.call("POST", `${E}/types`, { type: "earthquake" });
    check("복합재난 유형 추가 → 최초 유형 유지", typed.status === 200 && JSON.stringify(typed.body.event?.types) === JSON.stringify(["fire", "earthquake"]), typed.body);

    console.log("\n5. 종료");
    const tClose = await teacher.call("POST", `${E}/close`, { confirmClose: true });
    check("담임은 종료할 수 없음 → 403", tClose.status === 403, tClose.body);
    const closed = await admin.call("POST", `${E}/close`, {});
    check("훈련 종료 → 최종 집계 반환", closed.status === 200 && closed.body.event?.status === "closed" && closed.body.summary?.reportedClasses === 1, closed.body);
    const after = await teacher.call("PUT", `${E}/reports/${c11.id}`, reportBody({ expectedVersion: 2 }), { "Idempotency-Key": "e2e3-after-0001" });
    check("종료 후 보고 → 409 event_closed", after.status === 409 && after.body.code === "event_closed", after.body);
    const idle2 = await teacher.call("GET", `${A}/events/active`);
    check("종료 후 진행 중 상황 없음", idle2.body.event === null, idle2.body);

    console.log("\n6. 실제 상황(확인 절차)");
    const real = await admin.call("POST", `${A}/events`, { primaryType: "earthquake", mode: "real", confirmReal: true });
    check("실제 상황 발령(확인 포함) → 201", real.status === 201 && real.body.event?.mode === "real", real.body);
    const R = `${A}/events/${real.body.event?.id}`;
    const rNo = await admin.call("POST", `${R}/close`, {});
    check("실제 상황 종료는 확인 없이 불가 → 400", rNo.status === 400 && rNo.body.code === "confirm_required", rNo.body);
    const rYes = await admin.call("POST", `${R}/close`, { confirmClose: true });
    check("실제 상황 종료(확인 포함) → 200", rYes.status === 200 && rYes.body.event?.status === "closed", rYes.body);

    const actions = await prisma.auditLog.findMany({ where: { schoolId: schoolA.id }, select: { action: true } });
    const set = new Set(actions.map((a) => a.action));
    check(
      "발령·보고·대리 수정·유형 추가·종료가 감사 로그에 기록됨",
      ["event.issued_drill", "event.issued_real", "report.created", "report.updated", "event.type_added", "event.closed"].every((a) => set.has(a)),
      [...set],
    );
    await prisma.$disconnect();
  } finally {
    server.kill("SIGTERM");
  }

  console.log(`\n[e2e:step3] 결과: ${passed}개 통과, ${failed}개 실패`);
  process.exitCode = failed > 0 ? 1 : 0;
}

main().catch((error) => {
  console.error("[e2e:step3] 실행 실패:", error instanceof Error ? error.message : error);
  process.exitCode = 1;
});
