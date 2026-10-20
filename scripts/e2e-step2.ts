// STEP 2 전체 흐름 자동 검증(실제 서버 + 실제 DB): npm run e2e:step2
//
// 안전장치
// - 테스트 전용 스키마(safeschool_test)에 서버를 따로 띄웁니다. 개발·운영 데이터에는 접근하지 않습니다.
// - 메일은 모의 발송(MAIL_PROVIDER=console)만 사용하고, 테스트 서버는 NODE_ENV=test 로 실행합니다.
// - 학교알리미는 호출하지 않습니다(가상 학교 1건을 테스트 스키마의 검색 목록에 넣음).
//
// 흐름: 학교 검색 → 최초 등록 신청 → (승인 전 차단) → 운영자 자격 확인 → 관리자 활성화 → 학급 생성·재적 저장
//       → 교직원 가입·이메일 인증 → 중복 등록 거부·가입 신청 → (승인 전 차단) → 관리자 일괄 승인 → 학급 배정
//       → 로그아웃 → 로그인 → 담당 학급 확인 → 세션 없는 요청 차단
import { spawn, execSync, type ChildProcess } from "node:child_process";
import { createTestClient, getTestDatabaseUrl, resetTestData } from "../tests/test-db.js";
import { reviewSchoolRegistration } from "../server/src/services/schoolRegistration.js";

const PORT = Number(process.env.E2E_PORT ?? 5099);
const BASE = `http://127.0.0.1:${PORT}/api`;
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

// 사용자별 쿠키를 따로 보관하는 간단한 HTTP 클라이언트
class Agent {
  cookie = "";
  async call(method: string, path: string, body?: unknown) {
    const headers: Record<string, string> = { "X-Requested-With": "safe-school" };
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
}

async function waitForServer() {
  for (let i = 0; i < 60; i++) {
    try {
      const r = await fetch(`${BASE}/health`);
      if (r.ok) return;
    } catch {
      /* 아직 시작 중 */
    }
    await new Promise((r) => setTimeout(r, 500));
  }
  throw new Error("테스트 서버가 30초 안에 시작되지 않았습니다.");
}

async function signupAndVerify(agent: Agent, email: string, name: string) {
  const s = await agent.call("POST", "/auth/signup", { email, displayName: name, password: "test-password-1234" });
  check(`${name} 가입 요청(모의 발송, 코드는 테스트에서만 반환)`, s.status === 201 && s.body.delivery === "test_console" && /^\d{6}$/.test(s.body.devCode), s.body);
  const takeover = await agent.call("POST", "/auth/signup", {
    email, displayName: "제3자 변경 시도", password: "attacker-password-5678",
  });
  check(`${name} 미인증 계정 재가입으로 비밀번호 변경 차단`,
    takeover.status === 409 && takeover.body.code === "email_pending_verification",
    { status: takeover.status, code: takeover.body.code });
  const wrong = await agent.call("POST", "/auth/verify-email", { email, code: "000000" === s.body.devCode ? "111111" : "000000", deviceKind: "personal" });
  check(`${name} 틀린 인증코드 거부`, wrong.status === 400 && wrong.body.code === "invalid_code", wrong.body);
  const v = await agent.call("POST", "/auth/verify-email", { email, code: s.body.devCode, deviceKind: "personal" });
  check(`${name} 이메일 인증 → 로그인됨`, v.status === 200 && agent.cookie.startsWith("ss_session="), v.body);
}

async function main() {
  const testUrl = getTestDatabaseUrl(); // 스키마 이름에 test가 없으면 여기서 중단
  console.log("[e2e] 테스트 스키마에 마이그레이션 적용");
  execSync("npx prisma migrate deploy", { stdio: "ignore", env: { ...process.env, DATABASE_URL: testUrl } });

  const prisma = createTestClient();
  await resetTestData(prisma);
  const CODE = "E2E0000001";
  await prisma.schoolDirectoryEntry.create({
    data: { source: "schoolinfo", externalCode: CODE, name: "이투이테스트초등학교", kindCode: "02", eduOfficeName: "가상교육청", address: "가상시 시험로 1", raw: { SCHUL_CODE: CODE, SCHUL_NM: "이투이테스트초등학교", SCHUL_KND_SC_CODE: "02" } },
  });

  console.log(`[e2e] 테스트 서버 시작(포트 ${PORT}, NODE_ENV=test, 모의 메일)`);
  const server: ChildProcess = spawn("npx", ["tsx", "server/src/index.ts"], {
    env: { ...process.env, DATABASE_URL: testUrl, NODE_ENV: "test", PORT: String(PORT), MAIL_PROVIDER: "console", SCHOOLINFO_API_KEY: "", SCHOOLINFO_GRADE_DATA: "" },
    stdio: ["ignore", "ignore", "inherit"],
  });

  try {
    await waitForServer();
    const anon = new Agent();
    const admin = new Agent();
    const teacher = new Agent();

    console.log("\n1. 세션·보안");
    check("로그인 없이 내 정보 요청 → 401", (await anon.call("GET", "/auth/me")).status === 401);
    const form = await fetch(`${BASE}/auth/login`, { method: "POST", headers: { "Content-Type": "application/x-www-form-urlencoded" }, body: "email=a" });
    check("JSON이 아닌 변경 요청 거부(CSRF 대응) → 415", form.status === 415);

    console.log("\n2. 최초 등록자(관리자 후보)");
    await signupAndVerify(admin, "admin@e2e.test", "관리자후보");
    const search = await admin.call("GET", `/school-directory?q=${encodeURIComponent("이투이")}&kind=02`);
    const hit = search.body.results?.find((r: any) => r.externalCode === CODE);
    check("학교명 검색 → 미등록 학교 표시", search.status === 200 && hit && hit.registeredSchool === null, search.body);
    const reg = await admin.call("POST", "/school-registrations", { externalCode: CODE, applicantPosition: "교감" });
    check("최초 학교 등록 신청 → 관리자 승인 대기", reg.status === 201 && reg.body.status === "pending_verification", reg.body);
    const schoolId = reg.body.schoolId as string;
    const blocked = await admin.call("GET", `/schools/${schoolId}/members`);
    check("자격 확인 전 관리자 기능 차단(첫 신청자 자동 권한 없음)", blocked.status === 403 && blocked.body.code === "membership_pending", blocked.body);

    console.log("\n3. 운영자 자격 확인 → 학교 활성화");
    await reviewSchoolRegistration(prisma, { registrationId: reg.body.registrationId, decision: "approve", reviewer: "e2e 운영자", verificationMethod: "테스트" });
    const me1 = await admin.call("GET", "/auth/me");
    const m1 = me1.body.memberships?.[0];
    check("승인 후 관리자·학교 활성", m1?.role === "admin" && m1?.status === "approved" && m1?.school?.status === "active", m1);

    console.log("\n4. 학급 만들기·재적 일괄 저장");
    const year = Number(new Intl.DateTimeFormat("en", { timeZone: "Asia/Seoul", year: "numeric" }).format(new Date()));
    const st = await admin.call("POST", `/schools/${schoolId}/classes/apply-structure`, { schoolYear: year, grades: [{ grade: 1, classCount: 2 }, { grade: 2, classCount: 1 }] });
    check("학년별 학급 수로 학급 3개 생성", st.status === 200 && st.body.created === 3, st.body);
    const cls = await admin.call("GET", `/schools/${schoolId}/classes`);
    const classes = cls.body.classes as { id: string; label: string; enrolledCount: number | null }[];
    check("재적은 미확인(빈 값)으로 시작", classes.every((c) => c.enrolledCount === null), classes);
    const en = await admin.call("PUT", `/schools/${schoolId}/classes/enrollment`, { items: classes.map((c, i) => ({ classId: c.id, enrolledCount: 25 + i })) });
    check("한 번에 3개 학급 재적 저장", en.status === 200 && en.body.updated === 3, en.body);
    const badEn = await admin.call("PUT", `/schools/${schoolId}/classes/enrollment`, { items: [{ classId: classes[0]!.id, enrolledCount: 61 }] });
    check("재적 61명 입력 거부", badEn.status === 400, badEn.body);

    console.log("\n5. 후속 교직원 가입");
    await signupAndVerify(teacher, "teacher@e2e.test", "담임교사");
    const s2 = await teacher.call("GET", `/school-directory?q=${encodeURIComponent("이투이")}&kind=02`);
    check("같은 학교 검색 → '등록된 학교'로 표시", s2.body.results?.[0]?.registeredSchool?.id === schoolId, s2.body);
    const dup = await teacher.call("POST", "/school-registrations", { externalCode: CODE });
    check("같은 학교 중복 등록 거부 → 가입 안내", dup.status === 409 && dup.body.code === "school_already_registered", dup.body);
    const join = await teacher.call("POST", `/schools/${schoolId}/join-requests`, { role: "homeroom" });
    check("기존 학교에 가입 신청 → 승인 대기", join.status === 201 && join.body.status === "pending", join.body);
    const tBlocked = await teacher.call("GET", `/schools/${schoolId}/classes`);
    check("승인 전 학급 데이터 접근 차단", tBlocked.status === 403 && tBlocked.body.code === "membership_pending", tBlocked.body);
    const notAdmin = await teacher.call("GET", `/schools/${schoolId}/members`);
    check("승인 전 관리자 기능 차단", notAdmin.status === 403, notAdmin.body);

    console.log("\n6. 관리자 일괄 승인·배정");
    const pend = await admin.call("GET", `/schools/${schoolId}/members?status=pending`);
    const ids = (pend.body.members as { id: string }[]).map((m) => m.id);
    check("승인 대기 목록에 1명", ids.length === 1, pend.body);
    const appr = await admin.call("POST", `/schools/${schoolId}/members/approve`, { membershipIds: ids });
    check("일괄 승인", appr.status === 200 && appr.body.processed === 1, appr.body);
    const again = await admin.call("POST", `/schools/${schoolId}/members/approve`, { membershipIds: ids });
    check("같은 승인 다시 요청해도 중복 처리 없음", again.body.processed === 0 && again.body.skipped === 1, again.body);
    const asg = await admin.call("PUT", `/schools/${schoolId}/members/${ids[0]}/assignments`, { role: "homeroom", assignments: [{ classId: classes[0]!.id, duty: "homeroom" }] });
    check("담당 학급 배정", asg.status === 200 && asg.body.assigned === 1, asg.body);
    const teacherAdmin = await teacher.call("GET", `/schools/${schoolId}/members`);
    check("담임은 관리자 기능 사용 불가", teacherAdmin.status === 403 && teacherAdmin.body.code === "forbidden", teacherAdmin.body);

    console.log("\n7. 로그아웃 → 로그인");
    await teacher.call("POST", "/auth/logout");
    check("로그아웃 후 401", (await teacher.call("GET", "/auth/me")).status === 401);
    const badLogin = await teacher.call("POST", "/auth/login", { email: "teacher@e2e.test", password: "wrong-password", deviceKind: "shared" });
    check("틀린 비밀번호 거부", badLogin.status === 401 && badLogin.body.code === "invalid_credentials", badLogin.body);
    const login = await teacher.call("POST", "/auth/login", { email: "teacher@e2e.test", password: "test-password-1234", deviceKind: "shared" });
    check("공용 기기로 로그인", login.status === 200, login.body);
    const me2 = await teacher.call("GET", "/auth/me");
    const tm = me2.body.memberships?.[0];
    check("로그인 후 담당 학급 자동 표시", me2.body.deviceKind === "shared" && tm?.status === "approved" && tm?.assignments?.[0]?.class?.id === classes[0]!.id, me2.body);
    const tClasses = await teacher.call("GET", `/schools/${schoolId}/classes`);
    check("승인 후 학급 조회 가능", tClasses.status === 200 && tClasses.body.classes.length === 3, tClasses.body);

    console.log("\n8. 다른 학교 사용자 격리");
    const outsider = new Agent();
    await signupAndVerify(outsider, "outsider@e2e.test", "외부인");
    const iso = await outsider.call("GET", `/schools/${schoolId}/classes`);
    check("소속 없는 사용자 → 404(존재도 숨김)", iso.status === 404, iso.body);

    const sessions = await prisma.session.findMany({ where: { user: { email: "teacher@e2e.test" } }, select: { deviceKind: true, idleExpiresAt: true, expiresAt: true } });
    const shared = sessions.find((s) => s.deviceKind === "shared");
    check(
      "공용 기기 세션: 30분 미사용 만료·8시간 이내 절대 만료",
      !!shared && !!shared.idleExpiresAt && shared.idleExpiresAt.getTime() - Date.now() <= 30 * 60_000 + 5000 && shared.expiresAt.getTime() - Date.now() <= 8 * 3600_000 + 5000,
      shared,
    );
    const audit = await prisma.auditLog.count({ where: { schoolId } });
    check("주요 행위가 감사 로그에 기록됨", audit >= 5, { audit });

    await prisma.$disconnect();
  } finally {
    server.kill("SIGTERM");
  }

  console.log(`\n[e2e] 결과: ${passed}개 통과, ${failed}개 실패`);
  process.exitCode = failed > 0 ? 1 : 0;
}

main().catch((error) => {
  console.error("[e2e] 실행 실패:", error instanceof Error ? error.message : error);
  process.exitCode = 1;
});
