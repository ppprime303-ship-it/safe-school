// STEP 3-B ①~④ 공식 경보(모의) 수집 → 지역 매칭 → 중복 방지 → 교직원 경보함 자동 검증: npm run e2e:step3b
//
// 안전장치: 테스트 전용 스키마(safeschool_test)만 사용하고 시작 시 비웁니다. 시연 스키마와 섞어 쓰지 마세요.
// 모의 공급자만 사용합니다(실제 공식 API 호출 없음). 학부모 발송 기능은 없습니다.
// 구성: 인천(남동구) 학교 A — 관리자·교직원, 부산 학교 B — 관리자
import { execSync } from "node:child_process";
import { createTestClient, getTestDatabaseUrl, resetTestData } from "../tests/test-db.js";
import { hashPassword } from "../server/src/security/password.js";
import { collectOnce } from "../server/src/alerts/collector.js";
import { MOCK_SCENARIOS } from "../server/src/alerts/mockScenarios.js";
import { MockAlertSource } from "../server/src/alerts/providers.js";
import { startTestServer } from "./e2e-server.js";

const PORT = Number(process.env.E2E_PORT ?? 5097);
const BASE = `http://127.0.0.1:${PORT}/api`;
const PASSWORD = "e2e-step3b-password";
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
  async login(email: string) {
    const r = await this.call("POST", "/auth/login", { email, password: PASSWORD, deviceKind: "personal" });
    if (r.status !== 200) throw new Error(`로그인 실패: ${email} (${r.status} ${r.body.code})`);
  }
}

async function main() {
  const testUrl = getTestDatabaseUrl();
  console.log("[e2e:step3b] 테스트 스키마에 마이그레이션 적용");
  execSync("npx prisma migrate deploy", { stdio: "ignore", env: { ...process.env, DATABASE_URL: testUrl } });

  const prisma = createTestClient();
  await resetTestData(prisma);
  const now = new Date();
  const hash = await hashPassword(PASSWORD);
  const user = (email: string, displayName: string) => prisma.user.create({ data: { email, displayName, passwordHash: hash, emailVerifiedAt: now } });
  const member = (schoolId: string, userId: string, role: "admin" | "homeroom" | "staff") =>
    prisma.schoolMembership.create({ data: { schoolId, userId, role, status: "approved", approvalMethod: "roster", approvedAt: now } });
  const schoolA = await prisma.school.create({ data: { name: "경보A초등학교", slug: "e2e3b-a", address: "인천광역시 남동구 시험로 1", status: "active", activatedAt: now } });
  const schoolB = await prisma.school.create({ data: { name: "경보B초등학교", slug: "e2e3b-b", address: "부산광역시 해운대구 시험로 1", status: "active", activatedAt: now } });
  await member(schoolA.id, (await user("admin-a@e2e3b.test", "A관리자")).id, "admin");
  await member(schoolA.id, (await user("staff-a@e2e3b.test", "A교직원")).id, "staff");
  await member(schoolB.id, (await user("admin-b@e2e3b.test", "B관리자")).id, "admin");

  const server = await startTestServer(PORT, { ...process.env, DATABASE_URL: testUrl, NODE_ENV: "test", MAIL_PROVIDER: "console", SCHOOLINFO_API_KEY: "", ALERT_MOCK_FEED: "" });
  try {
    const admin = new Agent();
    const staff = new Agent();
    const adminB = new Agent();
    await admin.login("admin-a@e2e3b.test");
    await staff.login("staff-a@e2e3b.test");
    await adminB.login("admin-b@e2e3b.test");
    const A = `/schools/${schoolA.id}`;
    const B = `/schools/${schoolB.id}`;

    console.log("\n1. 수집 전");
    const empty = await staff.call("GET", `${A}/alerts`);
    check("경보함 비어 있음", empty.status === 200 && empty.body.alerts?.length === 0 && empty.body.unreadCount === 0, empty.body);

    console.log("\n2. 모의 경보 수집(인천 폭염경보 + 같은 내용 재송출 + 부산 경보)");
    const r1 = await collectOnce(prisma, new MockAlertSource(MOCK_SCENARIOS["incheon-heatwave"]!), { minIntervalMs: 0 });
    check("3건 수집·저장", r1.status === "success" && r1.fetched === 3 && r1.inserted === 3, r1);
    const r2 = await collectOnce(prisma, new MockAlertSource(MOCK_SCENARIOS["incheon-heatwave"]!), { minIntervalMs: 0 });
    check("같은 경보 재수신 → 저장 0건·중복 3건", r2.inserted === 0 && r2.duplicates === 3, r2);

    console.log("\n3. 학교별 경보함");
    const a1 = await staff.call("GET", `${A}/alerts`);
    const heat = a1.body.alerts?.[0];
    check("인천 학교 교직원: 폭염경보 1건(재송출 1회 묶음), 읽지 않음 1", a1.body.alerts?.length === 1 && heat?.rebroadcastCount === 1 && a1.body.unreadCount === 1, a1.body);
    check("모의 표시·원문 그대로", heat?.alert?.isMock === true && heat?.alert?.body?.startsWith("[모의 경보]"), heat?.alert);
    const b1 = await adminB.call("GET", `${B}/alerts`);
    check("부산 해운대구 학교: 부산 경보만(인천 경보 없음)", b1.body.alerts?.length === 1 && b1.body.alerts[0].alert.areasRaw === "부산광역시 해운대구", b1.body);
    const cross = await adminB.call("GET", `${A}/alerts`);
    check("다른 학교 경보함 접근 → 404", cross.status === 404, cross.body);

    console.log("\n4. 읽음·소재지");
    const read = await staff.call("POST", `${A}/alerts/${heat?.matchId}/read`, {});
    const a2 = await staff.call("GET", `${A}/alerts`);
    check("읽음 처리 → 읽지 않음 0", read.status === 200 && a2.body.unreadCount === 0, a2.body);
    const a3 = await admin.call("GET", `${A}/alerts`);
    check("읽음은 사용자별(관리자는 여전히 1)", a3.body.unreadCount === 1, a3.body);
    const crossRead = await adminB.call("POST", `${B}/alerts/${heat?.matchId}/read`, {});
    check("다른 학교 경보 읽음 처리 → 404", crossRead.status === 404, crossRead.body);
    const sRegion = await staff.call("GET", `${A}/region`);
    check("교직원은 소재지 설정 접근 불가 → 403", sRegion.status === 403, sRegion.body);
    const region = await admin.call("GET", `${A}/region`);
    check("소재지 자동 추출(인천광역시 남동구, 확인 전)", region.body.region?.sido === "인천광역시" && region.body.region?.sigungu === "남동구" && region.body.region?.confirmed === false, region.body);
    const put = await admin.call("PUT", `${A}/region`, { sido: "인천", sigungu: "남동구" });
    const region2 = await admin.call("GET", `${A}/region`);
    check("관리자 소재지 확인 저장", put.status === 200 && region2.body.region?.confirmed === true && region2.body.region?.source === "admin", region2.body);

    console.log("\n5. 미판정·해제");
    await collectOnce(prisma, new MockAlertSource(MOCK_SCENARIOS["unclear-area"]!), { minIntervalMs: 0 });
    const s5 = await staff.call("GET", `${A}/alerts`);
    const ad5 = await admin.call("GET", `${A}/alerts`);
    check("지역 해석 불가 경보: 교직원에게 안 보임, 관리자에게 미판정으로 보임",
      s5.body.alerts?.every((x: any) => x.result === "target") && ad5.body.alerts?.some((x: any) => x.result === "undetermined"), { staff: s5.body.alerts?.length, admin: ad5.body.alerts?.length });
    await collectOnce(prisma, new MockAlertSource(MOCK_SCENARIOS["incheon-heatwave-cancel"]!), { minIntervalMs: 0 });
    const s6 = await staff.call("GET", `${A}/alerts`);
    check("해제 경보 수신 → 원래 경보에 '해제됨'", s6.body.alerts?.some((x: any) => x.alert.msgType === "cancel") && s6.body.alerts?.some((x: any) => x.alert.msgType === "new" && x.cancelled), s6.body.alerts?.map((x: any) => [x.alert.msgType, x.cancelled]));

    console.log("\n6. 안전 경계");
    check("경보 수집으로 학교 재난이 자동 발령되지 않음", (await prisma.disasterEvent.count()) === 0);
    const runs = await prisma.alertCollectionRun.count({ where: { status: "success" } });
    check("수집 실행 기록 4건", runs === 4, { runs });
    check("소재지 확인 감사 로그", (await prisma.auditLog.count({ where: { action: "region.confirmed", schoolId: schoolA.id } })) === 1);
    await prisma.$disconnect();
  } finally {
    await server.stop();
  }

  console.log(`\n[e2e:step3b] 결과: ${passed}개 통과, ${failed}개 실패`);
  process.exitCode = failed > 0 ? 1 : 0;
}

main().catch((error) => {
  console.error("[e2e:step3b] 실행 실패:", error instanceof Error ? error.message : error);
  process.exitCode = 1;
});
