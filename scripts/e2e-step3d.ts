// STEP 3-D 직책·업무 권한 + 비상대피훈련일지 자동 검증(HTTP): npm run e2e:step3d
//
// 안전장치: 테스트 전용 스키마(safeschool_test)만 사용하고 시작 시 비웁니다. 시연 스키마와 섞어 쓰지 마세요.
// 교장·교감 직책은 플랫폼 운영자 도구(서비스 함수)로 등록합니다(앱 API로는 등록 불가 — 그것도 확인).
// 실제 경보·문자 발송, K-에듀파인 연동은 없습니다.
import { execSync } from "node:child_process";
import { mkdirSync, writeFileSync } from "node:fs";
import { inflateRawSync } from "node:zlib";
import { createTestClient, getTestDatabaseUrl, resetTestData } from "../tests/test-db.js";
import { hashPassword } from "../server/src/security/password.js";
import { grantDutyByPlatformOperator } from "../server/src/services/duties.js";
import { currentSchoolYear } from "../server/src/services/events.js";
import { startTestServer } from "./e2e-server.js";

const PORT = Number(process.env.E2E_PORT ?? 5099);
const BASE = `http://127.0.0.1:${PORT}/api`;
const PASSWORD = "e2e-step3d-password";
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
  async raw(method: string, path: string, body?: unknown, extra: Record<string, string> = {}) {
    const headers: Record<string, string> = { "X-Requested-With": "safe-school", ...extra };
    if (body !== undefined) headers["Content-Type"] = "application/json";
    if (this.cookie) headers.Cookie = this.cookie;
    const res = await fetch(`${BASE}${path}`, { method, headers, body: body === undefined ? undefined : JSON.stringify(body) });
    const setCookie = res.headers.get("set-cookie");
    if (setCookie) {
      const pair = setCookie.split(";")[0]!;
      this.cookie = pair.endsWith("=") ? "" : pair;
    }
    return res;
  }
  async call(method: string, path: string, body?: unknown) {
    const res = await this.raw(method, path, body);
    const text = await res.text();
    return { status: res.status, body: text ? (JSON.parse(text) as Record<string, any>) : {} };
  }
  async login(email: string) {
    const r = await this.call("POST", "/auth/login", { email, password: PASSWORD, deviceKind: "personal" });
    if (r.status !== 200) throw new Error(`로그인 실패: ${email} (${r.status} ${r.body.code})`);
  }
}

function unzipNames(buf: Buffer) {
  const names: string[] = [];
  let section = "";
  let i = 0;
  while (buf.readUInt32LE(i) === 0x04034b50) {
    const method = buf.readUInt16LE(i + 8), size = buf.readUInt32LE(i + 18), nlen = buf.readUInt16LE(i + 26), xlen = buf.readUInt16LE(i + 28);
    const name = buf.subarray(i + 30, i + 30 + nlen).toString("utf8");
    const body = buf.subarray(i + 30 + nlen + xlen, i + 30 + nlen + xlen + size);
    if (name === "Contents/section0.xml") section = (method === 8 ? inflateRawSync(body) : body).toString("utf8");
    names.push(name);
    i += 30 + nlen + xlen + size;
  }
  return { names, section };
}

async function main() {
  const testUrl = getTestDatabaseUrl();
  console.log("[e2e:step3d] 테스트 스키마에 마이그레이션 적용");
  execSync("npx prisma migrate deploy", { stdio: "ignore", env: { ...process.env, DATABASE_URL: testUrl } });

  const prisma = createTestClient();
  await resetTestData(prisma);
  const now = new Date();
  const hash = await hashPassword(PASSWORD);
  const year = currentSchoolYear();
  const A = await prisma.school.create({ data: { name: "훈련일지A초등학교", slug: "e2e3d-a", status: "active", activatedAt: now } });
  const Bs = await prisma.school.create({ data: { name: "훈련일지B초등학교", slug: "e2e3d-b", status: "active", activatedAt: now } });
  const mem: Record<string, string> = {};
  const person = async (key: string, schoolId: string, role: "admin" | "homeroom" | "staff") => {
    const u = await prisma.user.create({ data: { email: `${key}@e2e3d.test`, displayName: key, passwordHash: hash, emailVerifiedAt: now } });
    mem[key] = (await prisma.schoolMembership.create({ data: { schoolId, userId: u.id, role, status: "approved", approvalMethod: "roster", approvedAt: now } })).id;
  };
  for (const [k, r] of [["admin", "admin"], ["principal", "staff"], ["vice1", "staff"], ["vice2", "staff"], ["safety1", "staff"], ["safety2", "homeroom"], ["operator", "staff"], ["teacher", "homeroom"], ["staff", "staff"]] as const) {
    await person(k, A.id, r);
  }
  await person("adminB", Bs.id, "admin");
  const cls = async (g: number, n: number, e: number) =>
    (await prisma.schoolClass.create({ data: { schoolId: A.id, schoolYear: year, grade: g, classNo: n, label: `${g}학년 ${n}반`, enrolledCount: e } })).id;
  const c11 = await cls(1, 1, 25);
  const c12 = await cls(1, 2, 27);
  await cls(2, 1, 24);
  await prisma.classAssignment.create({ data: { membershipId: mem.teacher!, classId: c11, duty: "homeroom" } });
  // 플랫폼 운영자(기관 확인 후): 교장 1, 교감 2
  await grantDutyByPlatformOperator(prisma, { membershipId: mem.principal!, duty: "principal", operator: "e2e 운영자", verificationMethod: "공문 확인" });
  await grantDutyByPlatformOperator(prisma, { membershipId: mem.vice1!, duty: "vice_principal", operator: "e2e 운영자", verificationMethod: "공문 확인" });
  await grantDutyByPlatformOperator(prisma, { membershipId: mem.vice2!, duty: "vice_principal", operator: "e2e 운영자", verificationMethod: "공문 확인" });

  const server = await startTestServer(PORT, { ...process.env, DATABASE_URL: testUrl, NODE_ENV: "test", MAIL_PROVIDER: "console", SCHOOLINFO_API_KEY: "", ALERT_MOCK_FEED: "" });
  try {
    const ag: Record<string, Agent> = {};
    for (const k of ["admin", "principal", "vice1", "vice2", "safety1", "safety2", "operator", "teacher", "staff", "adminB"]) {
      ag[k] = new Agent();
      await ag[k]!.login(`${k}@e2e3d.test`);
    }
    const S = `/schools/${A.id}`;

    console.log("\n1. 내 권한(/auth/me)");
    const meP = await ag.principal!.call("GET", "/auth/me");
    const pm = meP.body.memberships?.find((m: any) => m.school.id === A.id);
    check("교장: 직책 표시, 발령·종료·상황판·훈련일지 열람, 가입 승인 없음",
      pm?.duties?.includes("principal") && ["event.issue", "event.close", "board.view", "drilllog.view"].every((c) => pm.capabilities?.includes(c)) && !pm.capabilities?.includes("members.manage"), pm);
    const meA = await ag.admin!.call("GET", "/auth/me");
    const am = meA.body.memberships?.find((m: any) => m.school.id === A.id);
    check("기존 관리자: 기존 기능 유지 + 훈련일지 열람, 작성·수정 자동 부여 없음",
      ["event.issue", "members.manage", "classes.manage", "drilllog.view"].every((c) => am?.capabilities?.includes(c)) && !am?.capabilities?.includes("drilllog.edit"), am?.capabilities);

    console.log("\n2. 업무 지정(앱 운영 권한·비밀번호 재확인)");
    const g1 = await ag.admin!.call("POST", `${S}/duties`, { membershipId: mem.safety1, duty: "safety_officer" });
    const g2 = await ag.admin!.call("POST", `${S}/duties`, { membershipId: mem.safety2, duty: "safety_officer" });
    const g3 = await ag.admin!.call("POST", `${S}/duties`, { membershipId: mem.operator, duty: "app_operator" });
    const g4 = await ag.operator!.call("POST", `${S}/duties`, { membershipId: mem.safety1, duty: "app_operator" });
    check("관리자: 안전업무 담당 2명·앱 운영담당 지정, 앱 운영담당이 안전담당에게 운영 업무 겸임 지정", [g1, g2, g3, g4].every((r) => r.status === 201), [g1, g2, g3, g4].map((r) => r.status));
    const self = await ag.operator!.call("POST", `${S}/duties`, { membershipId: mem.operator, duty: "safety_officer" });
    check("자기 자신에게 지정 → 403", self.status === 403, self.body);
    const pos = await ag.admin!.call("POST", `${S}/duties`, { membershipId: mem.staff, duty: "principal" });
    check("앱에서 교장 지정 → 400(입력 거부)", pos.status === 400, pos.body);
    const byPrincipal = await ag.principal!.call("POST", `${S}/duties`, { membershipId: mem.staff, duty: "safety_officer" });
    check("교장은 업무 지정 권한 없음 → 403", byPrincipal.status === 403, byPrincipal.body);
    const bySafety = await ag.safety2!.call("GET", `${S}/members`);
    check("안전업무 담당(담임 겸임)은 교직원 관리 없음 → 403", bySafety.status === 403, bySafety.body);
    const byOp = await ag.operator!.call("GET", `${S}/members`);
    check("앱 운영담당은 교직원 목록 조회 가능", byOp.status === 200 && Array.isArray(byOp.body.members), byOp.status);
    const crossDuty = await ag.adminB!.call("POST", `${S}/duties`, { membershipId: mem.staff, duty: "safety_officer" });
    check("다른 학교 관리자 → 404", crossDuty.status === 404, crossDuty.body);

    console.log("\n3. 발령·종료(교감1 발령 → 교감2 종료, 안전담당 → 교장)");
    const iss = await ag.vice1!.call("POST", `${S}/events`, { primaryType: "earthquake", mode: "drill", evacPlace: "운동장" });
    check("교감1 모의훈련 발령 201", iss.status === 201, iss.body);
    const ev1 = iss.body.event?.id;
    const dup = await ag.safety1!.call("POST", `${S}/events`, { primaryType: "fire", mode: "drill" });
    check("진행 중 중복 발령 → 409", dup.status === 409, dup.body);
    for (const k of ["operator", "staff", "teacher"]) {
      const r = await ag[k]!.call("POST", `${S}/events`, { primaryType: "fire", mode: "drill" });
      check(`${k} 발령 → 403`, r.status === 403, r.body);
    }
    const board = await ag.principal!.call("GET", `${S}/events/${ev1}/board`);
    check("교장 상황판 열람", board.status === 200, board.status);
    const tBoard = await ag.teacher!.call("GET", `${S}/events/${ev1}/board`);
    check("담임 상황판 → 403", tBoard.status === 403, tBoard.status);
    const rep = await ag.teacher!.raw("PUT", `${S}/events/${ev1}/reports/${c11}`, { evacuated: 24, absentKnown: 1, injured: 0, enrolledCount: 25, enrolledChangeReason: null, note: null, expectedVersion: null }, { "Idempotency-Key": "e2e3d-report-0001" });
    const repBody = await rep.text();
    check("담임 학급 보고(기존 기능)", rep.status === 200, repBody.slice(0, 120));
    const close1 = await ag.vice2!.call("POST", `${S}/events/${ev1}/close`, {});
    check("교감2가 종료(발령자와 다른 사람)", close1.status === 200, close1.body);
    const evRow = await prisma.disasterEvent.findUniqueOrThrow({ where: { id: ev1 }, include: { createdBy: true, closedBy: true } });
    check("발령자·종료자 기록(교감1·교감2)", evRow.createdBy?.displayName === "vice1" && evRow.closedBy?.displayName === "vice2");
    const iss2 = await ag.safety2!.call("POST", `${S}/events`, { primaryType: "fire", mode: "drill" });
    const close2 = await ag.principal!.call("POST", `${S}/events/${iss2.body.event?.id}/close`, {});
    check("안전담당2 발령 → 교장 종료", iss2.status === 201 && close2.status === 200, [iss2.status, close2.status]);
    const realNo = await ag.safety1!.call("POST", `${S}/events`, { primaryType: "fire", mode: "real" });
    check("실제 상황은 확인 없이 발령 불가 → 400", realNo.status === 400, realNo.body);
    const real = await ag.safety1!.call("POST", `${S}/events`, { primaryType: "fire", mode: "real", confirmReal: true });
    const realClose = await ag.vice1!.call("POST", `${S}/events/${real.body.event?.id}/close`, { confirmClose: true });
    check("실제 상황: 확인 후 발령(안전담당1)·종료(교감1)", real.status === 201 && realClose.status === 200, [real.status, realClose.status]);
    const auditIssue = await prisma.auditLog.count({ where: { schoolId: A.id, action: { in: ["event.issued_drill", "event.issued_real", "event.closed"] } } });
    check("발령·종료 감사 기록 6건", auditIssue === 6, auditIssue);

    console.log("\n4. 훈련일지");
    const list = await ag.safety1!.call("GET", `${S}/drill-logs`);
    check("목록: 종료된 모의훈련 2건(실제 상황 제외), 작성 가능", list.status === 200 && list.body.events?.length === 2 && list.body.canEdit === true, list.body.events?.length);
    const realLog = await ag.safety1!.call("POST", `${S}/events/${real.body.event?.id}/drill-log`, {});
    check("실제 상황 훈련일지 → 409", realLog.status === 409, realLog.body);
    const pLog = await ag.principal!.call("POST", `${S}/events/${ev1}/drill-log`, {});
    check("교장 훈련일지 만들기 → 403(열람만)", pLog.status === 403, pLog.body);
    const [mk1, mk2] = await Promise.all([ag.safety1!.call("POST", `${S}/events/${ev1}/drill-log`, {}), ag.safety2!.call("POST", `${S}/events/${ev1}/drill-log`, {})]);
    check("두 안전담당이 동시에 만들기 → 1건(201 + 200, 같은 ID)", [mk1.status, mk2.status].sort().join() === "200,201" && mk1.body.id === mk2.body.id, [mk1.status, mk2.status]);
    const logId = mk1.body.id;
    const d1 = await ag.safety2!.call("GET", `${S}/drill-logs/${logId}`);
    const byL = Object.fromEntries((d1.body.snapshot?.classes ?? []).map((c: any) => [c.label, c]));
    check("자동작성: 1학년 1반 보고(대피 24), 1학년 2반·2학년 1반 미보고(보고 없음)", byL["1학년 1반"]?.report?.evacuated === 24 && byL["1학년 2반"]?.report === null && byL["2학년 1반"]?.report === null, Object.keys(byL));
    check("담당자 입력은 빈칸(교직원·총인원·소요시간·평가)", d1.body.manual?.staffCount === "" && d1.body.manual?.totalCount === "" && d1.body.manual?.durationText === "" && d1.body.manual?.evals?.every((e: any) => e.result === ""));
    const manual = { ...d1.body.manual, staffCount: "14", durationText: "6분 51초", improvements: "방송 <설비> & 사이렌 점검", evals: d1.body.manual.evals.map((e: any, i: number) => ({ ...e, result: i === 4 ? "X" : "O" })) };
    const s1 = await ag.safety1!.call("PATCH", `${S}/drill-logs/${logId}`, { manual, status: "draft", expectedVersion: 1 });
    check("안전담당1 저장 → 판 2", s1.status === 200 && s1.body.version === 2, s1.body);
    const same = await ag.safety1!.call("PATCH", `${S}/drill-logs/${logId}`, { manual, status: "draft", expectedVersion: 2 });
    check("같은 내용 저장 → 판 그대로(jsonb 키 순서와 무관)", same.status === 200 && same.body.changed === false && same.body.version === 2, same.body);
    const stale = await ag.safety2!.call("PATCH", `${S}/drill-logs/${logId}`, { manual: { ...manual, staffCount: "15" }, status: "draft", expectedVersion: 1 });
    check("안전담당2가 오래된 판으로 저장 → 409", stale.status === 409 && stale.body.code === "version_conflict", stale.body);
    const s2 = await ag.safety2!.call("PATCH", `${S}/drill-logs/${logId}`, { manual: { ...manual, staffCount: "15" }, status: "completed", expectedVersion: 2 });
    check("안전담당2 최신 판으로 작성 완료 → 판 3", s2.status === 200 && s2.body.version === 3, s2.body);
    const badOx = await ag.safety1!.call("PATCH", `${S}/drill-logs/${logId}`, { manual: { ...manual, evals: manual.evals.map((e: any) => ({ ...e, result: "△" })) }, status: "draft", expectedVersion: 3 });
    check("O/X 외 값 → 400", badOx.status === 400, badOx.body);
    const vEdit = await ag.vice1!.call("PATCH", `${S}/drill-logs/${logId}`, { manual, status: "draft", expectedVersion: 3 });
    check("교감 수정 → 403", vEdit.status === 403, vEdit.body);
    const vView = await ag.vice2!.call("GET", `${S}/drill-logs/${logId}`);
    check("교감 열람(수정 불가 표시)", vView.status === 200 && vView.body.canEdit === false, vView.body.canEdit);
    const tView = await ag.teacher!.call("GET", `${S}/drill-logs/${logId}`);
    check("담임 열람 → 403", tView.status === 403, tView.status);
    const cross = await ag.adminB!.call("GET", `/schools/${Bs.id}/drill-logs/${logId}`);
    check("다른 학교 경로로 A 훈련일지 → 404", cross.status === 404, cross.status);

    const dl = await ag.principal!.raw("GET", `${S}/drill-logs/${logId}/export.hwpx`);
    const buf = Buffer.from(await dl.arrayBuffer());
    const z = unzipNames(buf);
    check("교장 HWPX 내려받기: 형식·파일 이름", dl.status === 200 && dl.headers.get("content-type")?.startsWith("application/hwp+zip") === true && (dl.headers.get("content-disposition") ?? "").includes("filename*=UTF-8''"), [dl.status, dl.headers.get("content-type")]);
    check("HWPX: mimetype 첫 항목, 필수 파일", z.names[0] === "mimetype" && ["Contents/section0.xml", "Contents/header.xml", "META-INF/container.xml"].every((n) => z.names.includes(n)), z.names);
    check("HWPX 본문: 학교명·입력값·이스케이프·미보고·O/X 글자", z.section.includes("훈련일지A초등학교") && z.section.includes("방송 &lt;설비&gt; &amp; 사이렌 점검") && z.section.includes("미보고") && z.section.includes("6분 51초") && !z.section.includes("□"));
    // 한글에서 직접 열어 볼 시험 파일(테스트 DB의 가상 데이터만): e2e-output/
    mkdirSync("e2e-output", { recursive: true });
    writeFileSync("e2e-output/step3d_훈련일지_3학급.hwpx", buf);
    check("3학급: 붙임 1쪽", (z.section.match(/붙임\. 학급별 대피 현황/g) ?? []).length === 1, (z.section.match(/붙임\. 학급별 대피 현황[^<]*/g) ?? []));

    // 32학급 초과: 학급 37개 추가 → 원본 변경 알림 → 다시 불러오기(판 +1) → 붙임 2쪽
    for (let g = 3; g <= 6; g++) for (let n = 1; n <= (g === 6 ? 10 : 9); n++) await cls(g, n, 25);
    const changed = await ag.safety1!.call("GET", `${S}/drill-logs/${logId}`);
    check("학급 추가 후 원본 변경 알림(자동 반영 안 함)", (changed.body.sourceChanges?.length ?? 0) >= 37 && changed.body.snapshot?.classes?.length === 3, changed.body.sourceChanges?.length);
    const refreshed = await ag.safety1!.call("PATCH", `${S}/drill-logs/${logId}`, { manual: changed.body.manual, status: "completed", expectedVersion: changed.body.log.version, refreshAuto: true });
    check("다시 불러오기 → 판 +1", refreshed.status === 200 && refreshed.body.version === changed.body.log.version + 1, refreshed.body);
    const dl40 = await ag.safety1!.raw("GET", `${S}/drill-logs/${logId}/export.hwpx`);
    const buf40 = Buffer.from(await dl40.arrayBuffer());
    const z40 = unzipNames(buf40);
    writeFileSync("e2e-output/step3d_훈련일지_40학급.hwpx", buf40);
    check("40학급: 붙임 2쪽, 마지막 학급 포함, 미보고 표시", dl40.status === 200 && (z40.section.match(/붙임\. 학급별 대피 현황/g) ?? []).length === 2 && z40.section.includes("6학년 10반") && z40.section.includes("미보고"));
    console.log("  → 한글 확인용 파일: e2e-output/step3d_훈련일지_3학급.hwpx, step3d_훈련일지_40학급.hwpx (테스트 데이터)");

    const tDl = await ag.staff!.raw("GET", `${S}/drill-logs/${logId}/export.hwpx`);
    check("일반 교직원 내려받기 → 403", tDl.status === 403, tDl.status);

    console.log("\n4-1. 동시 요청·직접 API(화면 우회)");
    const [cg1, cg2] = await Promise.all([
      ag.admin!.call("POST", `${S}/duties`, { membershipId: mem.staff, duty: "safety_officer" }),
      ag.operator!.call("POST", `${S}/duties`, { membershipId: mem.staff, duty: "safety_officer" }),
    ]);
    check("같은 사람에게 같은 업무 동시 지정 → 1건만(201 + 409)", [cg1.status, cg2.status].sort().join() === "201,409", [cg1.status, cg2.status]);
    const staffDuty = await prisma.memberDuty.findFirstOrThrow({ where: { membershipId: mem.staff, duty: "safety_officer", endedAt: null } });
    await ag.admin!.call("POST", `${S}/duties/${staffDuty.id}/end`, { reason: "시험 정리" });
    const direct = await ag.teacher!.call("POST", `${S}/duties`, { membershipId: mem.teacher, duty: "safety_officer" });
    check("권한 없는 담임이 업무 지정 API 직접 호출 → 403", direct.status === 403, direct.body);
    const directLog = await ag.staff!.call("PATCH", `${S}/drill-logs/${logId}`, { manual, status: "draft", expectedVersion: 3 });
    check("권한 없는 교직원이 훈련일지 수정 API 직접 호출 → 403", directLog.status === 403, directLog.body);
    const crossMembers = await ag.adminB!.call("GET", `${S}/members`);
    check("다른 학교 관리자가 A 교직원 목록 → 404", crossMembers.status === 404, crossMembers.status);

    console.log("\n5. 권한 해제·회수");
    const dutyRow = await prisma.memberDuty.findFirstOrThrow({ where: { membershipId: mem.safety2, duty: "safety_officer", endedAt: null } });
    const end = await ag.operator!.call("POST", `${S}/duties/${dutyRow.id}/end`, { reason: "업무분장 변경" });
    check("앱 운영담당이 안전업무 해제", end.status === 200, end.body);
    const after = await ag.safety2!.call("POST", `${S}/events`, { primaryType: "fire", mode: "drill" });
    check("해제 직후 발령 → 403(계정은 그대로)", after.status === 403, after.body);
    const stillMember = await ag.safety2!.call("GET", `${S}/events/active`);
    check("해제된 사람도 학교 정보는 계속 조회", stillMember.status === 200, stillMember.status);
    const revAdmin = await ag.operator!.call("POST", `${S}/members/${mem.admin}/revoke`, {});
    check("앱 운영담당이 학교 관리자 회수 → 403", revAdmin.status === 403, revAdmin.body);
    const revPrincipal = await ag.admin!.call("POST", `${S}/members/${mem.principal}/revoke`, {});
    check("교장 계정 앱에서 회수 → 403(플랫폼 운영자 처리)", revPrincipal.status === 403, revPrincipal.body);
    const opDuty = await prisma.memberDuty.findFirstOrThrow({ where: { membershipId: mem.operator, duty: "app_operator", endedAt: null } });
    const endOp = await ag.admin!.call("POST", `${S}/duties/${opDuty.id}/end`, { reason: "전보" });
    check("관리자가 앱 운영담당 해제(다른 운영 권한자 있음)", endOp.status === 200, endOp.body);
    check("업무 기록은 삭제되지 않고 종료로 남음(4-1 정리 1 + 해제 2)", (await prisma.memberDuty.count({ where: { schoolId: A.id, endedAt: { not: null } } })) === 3);
    await prisma.$disconnect();
  } finally {
    await server.stop();
  }

  console.log(`\n[e2e:step3d] 결과: ${passed}개 통과, ${failed}개 실패`);
  process.exitCode = failed > 0 ? 1 : 0;
}

main().catch((error) => {
  console.error("[e2e:step3d] 실행 실패:", error instanceof Error ? error.message : error);
  process.exitCode = 1;
});
