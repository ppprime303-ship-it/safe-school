// STEP 3-E 통합 업무 흐름 검증(HTTP): npm run e2e:step3e
//
// 시나리오 1 지진 모의훈련(발령 → 담임 보고·수정 → 상황판 → 종료 → 훈련일지 → 공동 수정 → 원본 변경·다시 불러오기 → HWPX)
// 시나리오 2 실제 재난(확인 절차 → 보고·집계 → 공식 경보 연결 안내문 → 종료 확인 → 감사 로그 → 훈련일지 생성 거부)
// 시나리오 3 공식 경보(모의 공급자): 지역 매칭·중복·재송출 묶음·해제·읽음·안내문 연결, 경보가 학교 발령을 만들지 않음
// 권한 종합: 교장·교감·복수 안전담당·겸임·기존 관리자·무단 차단·다른 학교·해제 후 세션·마지막 운영담당·동시 해제
//
// 안전장치: 테스트 전용 스키마(safeschool_test)만 사용하고 시작 시 비웁니다(시연 스키마와 섞어 쓰지 마세요).
// 모든 데이터는 가상입니다. 실제 경보·문자·학부모 발송, K-에듀파인 연동은 없습니다.
import { execSync } from "node:child_process";
import { mkdirSync, writeFileSync } from "node:fs";
import { inflateRawSync } from "node:zlib";
import { createTestClient, getTestDatabaseUrl, resetTestData } from "../tests/test-db.js";
import { hashPassword } from "../server/src/security/password.js";
import { grantDutyByPlatformOperator } from "../server/src/services/duties.js";
import { currentSchoolYear } from "../server/src/services/events.js";
import { collectOnce } from "../server/src/alerts/collector.js";
import { MOCK_SCENARIOS } from "../server/src/alerts/mockScenarios.js";
import { MockAlertSource } from "../server/src/alerts/providers.js";
import { startTestServer } from "./e2e-server.js";

const PORT = Number(process.env.E2E_PORT ?? 5098);
const BASE = `http://127.0.0.1:${PORT}/api`;
const PASSWORD = "e2e-step3e-password";
let passed = 0;
let failed = 0;
const failures: string[] = [];

function check(label: string, ok: boolean, detail?: unknown) {
  if (ok) {
    passed++;
    console.log(`  ✓ ${label}`);
  } else {
    failed++;
    failures.push(label);
    console.log(`  ✗ ${label}${detail !== undefined ? ` — ${JSON.stringify(detail).slice(0, 400)}` : ""}`);
  }
}

// 발령·종료 API는 1분에 20회 제한(남용 방지) → 시험도 그 안에서 실행(제한을 끄지 않음)
const issueTimes: number[] = [];
async function issueSlot() {
  const now = Date.now();
  while (issueTimes.length && now - issueTimes[0]! > 61_000) issueTimes.shift();
  if (issueTimes.length >= 18) {
    const wait = 61_500 - (now - issueTimes[0]!);
    console.log(`  … 발령·종료 요청 제한(1분 20회) 때문에 ${Math.ceil(wait / 1000)}초 대기`);
    await new Promise((r) => setTimeout(r, wait));
    issueTimes.length = 0;
  }
  issueTimes.push(Date.now());
}

class Agent {
  cookie = "";
  constructor(public name: string) {}
  async raw(method: string, path: string, body?: unknown, extra: Record<string, string> = {}) {
    if (method === "POST" && /\/events(\/[^/]+\/close)?$/.test(path)) await issueSlot();
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
  async call(method: string, path: string, body?: unknown, extra: Record<string, string> = {}) {
    const res = await this.raw(method, path, body, extra);
    const text = await res.text();
    let parsed: Record<string, any> = {};
    try {
      parsed = text ? JSON.parse(text) : {};
    } catch {
      parsed = { raw: text.slice(0, 200) };
    }
    return { status: res.status, body: parsed };
  }
  async login(email: string) {
    const r = await this.call("POST", "/auth/login", { email, password: PASSWORD, deviceKind: "personal" });
    if (r.status !== 200) throw new Error(`로그인 실패: ${email} (${r.status} ${r.body.code})`);
  }
}

function unzipSection(buf: Buffer) {
  const names: string[] = [];
  let section = "";
  let i = 0;
  while (i + 30 <= buf.length && buf.readUInt32LE(i) === 0x04034b50) {
    const method = buf.readUInt16LE(i + 8), size = buf.readUInt32LE(i + 18), nlen = buf.readUInt16LE(i + 26), xlen = buf.readUInt16LE(i + 28);
    const name = buf.subarray(i + 30, i + 30 + nlen).toString("utf8");
    const body = buf.subarray(i + 30 + nlen + xlen, i + 30 + nlen + xlen + size);
    if (name === "Contents/section0.xml") section = (method === 8 ? inflateRawSync(body) : body).toString("utf8");
    names.push(name);
    i += 30 + nlen + xlen + size;
  }
  return { names, section };
}

let keySeq = 0;
const ikey = () => `e2e3e-${Date.now()}-${++keySeq}`;
// 이메일은 DB 제약(users_email_lowercase)에 맞게 소문자로 만듭니다(인증·DB 제약은 그대로). 키는 소문자로 바꿔도 서로 겹치지 않음
const emailOf = (key: string) => `${key.toLowerCase()}@e2e3e.test`;
const report = (evacuated: number, absentKnown: number, enrolledCount: number, expectedVersion: number | null, injured = 0, note: string | null = null) => ({
  evacuated, absentKnown, injured, enrolledCount, enrolledChangeReason: null, note, expectedVersion,
});

async function main() {
  const testUrl = getTestDatabaseUrl();
  console.log("[e2e:step3e] 테스트 스키마에 마이그레이션 적용(시연 스키마 사용 안 함)");
  execSync("npx prisma migrate deploy", { stdio: "ignore", env: { ...process.env, DATABASE_URL: testUrl } });

  const prisma = createTestClient();
  await resetTestData(prisma);
  const now = new Date();
  const hash = await hashPassword(PASSWORD);
  const year = currentSchoolYear();
  const A = await prisma.school.create({ data: { name: "통합검증A초등학교", slug: "e2e3e-a", address: "인천광역시 남동구 시험로 1", status: "active", activatedAt: now } });
  const B = await prisma.school.create({ data: { name: "통합검증B초등학교", slug: "e2e3e-b", address: "부산광역시 해운대구 시험로 1", status: "active", activatedAt: now } });
  const C = await prisma.school.create({ data: { name: "통합검증C초등학교", slug: "e2e3e-c", address: "대전광역시 서구 시험로 1", status: "active", activatedAt: now } });
  const mem: Record<string, string> = {};
  const person = async (key: string, schoolId: string, role: "admin" | "homeroom" | "staff") => {
    const u = await prisma.user.create({ data: { email: emailOf(key), displayName: key, passwordHash: hash, emailVerifiedAt: now } });
    mem[key] = (await prisma.schoolMembership.create({ data: { schoolId, userId: u.id, role, status: "approved", approvalMethod: "roster", approvedAt: now } })).id;
  };
  // A학교: 교장 1·교감 2(직책), 안전담당 A(교직원)·B(담임 겸임), 안전+앱운영 겸임 1, 앱 운영담당 1, 기존 관리자, 담임, 일반 교직원
  for (const [k, r] of [
    ["admin", "admin"], ["principal", "staff"], ["vice1", "staff"], ["vice2", "staff"], ["safetyA", "staff"], ["safetyB", "homeroom"],
    ["opSafe", "staff"], ["operator", "staff"], ["teacher", "homeroom"], ["staff", "staff"],
  ] as const) await person(k, A.id, r);
  await person("adminB", B.id, "admin");
  await person("opX", C.id, "staff");
  await person("opY", C.id, "staff");
  const cls = async (g: number, n: number, e: number) =>
    (await prisma.schoolClass.create({ data: { schoolId: A.id, schoolYear: year, grade: g, classNo: n, label: `${g}학년 ${n}반`, enrolledCount: e } })).id;
  const c11 = await cls(1, 1, 25);
  const c12 = await cls(1, 2, 27);
  const c21 = await cls(2, 1, 24);
  await cls(2, 2, 26);
  await prisma.classAssignment.create({ data: { membershipId: mem.teacher!, classId: c11, duty: "homeroom" } });
  await prisma.classAssignment.create({ data: { membershipId: mem.safetyB!, classId: c12, duty: "homeroom" } });
  // 플랫폼 운영자(기관 확인 후)만 등록하는 직책, C학교는 관리자 없이 앱 운영담당 2명
  await grantDutyByPlatformOperator(prisma, { membershipId: mem.principal!, duty: "principal", operator: "e2e 운영자", verificationMethod: "공문 확인" });
  await grantDutyByPlatformOperator(prisma, { membershipId: mem.vice1!, duty: "vice_principal", operator: "e2e 운영자", verificationMethod: "공문 확인" });
  await grantDutyByPlatformOperator(prisma, { membershipId: mem.vice2!, duty: "vice_principal", operator: "e2e 운영자", verificationMethod: "공문 확인" });
  const gx = await grantDutyByPlatformOperator(prisma, { membershipId: mem.opX!, duty: "app_operator", operator: "e2e 운영자" });
  const gy = await grantDutyByPlatformOperator(prisma, { membershipId: mem.opY!, duty: "app_operator", operator: "e2e 운영자" });

  const server = await startTestServer(PORT, { ...process.env, DATABASE_URL: testUrl, NODE_ENV: "test", MAIL_PROVIDER: "console", SCHOOLINFO_API_KEY: "", ALERT_MOCK_FEED: "" });
  try {
    const ag: Record<string, Agent> = {};
    for (const k of ["admin", "principal", "vice1", "vice2", "safetyA", "safetyB", "opSafe", "operator", "teacher", "staff", "adminB", "opX", "opY"]) {
      ag[k] = new Agent(k);
      await ag[k]!.login(emailOf(k));
    }
    const S = `/schools/${A.id}`;
    const SB = `/schools/${B.id}`;
    const SC = `/schools/${C.id}`;

    console.log("\n0. 업무 지정(앱) — 복수 안전담당·겸임");
    const grants = await Promise.all([
      ag.admin!.call("POST", `${S}/duties`, { membershipId: mem.safetyA, duty: "safety_officer" }),
      ag.admin!.call("POST", `${S}/duties`, { membershipId: mem.safetyB, duty: "safety_officer" }),
      ag.admin!.call("POST", `${S}/duties`, { membershipId: mem.operator, duty: "app_operator" }),
    ]);
    const g4 = await ag.operator!.call("POST", `${S}/duties`, { membershipId: mem.opSafe, duty: "app_operator" });
    const g5 = await ag.operator!.call("POST", `${S}/duties`, { membershipId: mem.opSafe, duty: "safety_officer" });
    check("안전담당 2명·앱 운영담당·겸임(안전+앱운영) 지정", [...grants, g4, g5].every((r) => r.status === 201), [...grants, g4, g5].map((r) => r.status));
    const capsOf = async (k: string) => (await ag[k]!.call("GET", "/auth/me")).body.memberships?.find((m: any) => m.school.id === A.id)?.capabilities ?? [];
    const cOpSafe = await capsOf("opSafe");
    check("겸임(안전+앱운영): 발령·훈련일지 작성 + 교직원 승인·업무 지정 권한 합산", ["event.issue", "drilllog.edit", "members.manage", "duties.manage"].every((c) => cOpSafe.includes(c)), cOpSafe);
    const cSafetyB = await capsOf("safetyB");
    check("겸임(담임+안전): 발령·상황판·훈련일지, 교직원 승인 없음", ["event.issue", "board.view", "drilllog.edit"].every((c) => cSafetyB.includes(c)) && !cSafetyB.includes("members.manage"), cSafetyB);
    const cPrincipal = await capsOf("principal");
    check("교장: 가입 승인·업무 지정·훈련일지 작성 자동 부여 없음", !["members.manage", "duties.manage", "drilllog.edit"].some((c) => cPrincipal.includes(c)), cPrincipal);

    // ───────────── 시나리오 1 ─────────────
    console.log("\n1. 시나리오 1 — 지진 모의훈련");
    const iss = await ag.principal!.call("POST", `${S}/events`, { primaryType: "earthquake", mode: "drill", evacPlace: "운동장" });
    check("1-2 교장 단독 모의훈련 발령 201", iss.status === 201 && iss.body.event?.mode === "drill", iss.body);
    const ev1 = iss.body.event?.id as string;
    const act = await ag.teacher!.call("GET", `${S}/events/active`);
    check("1-3 담임에게 진행 중 상황(훈련) 표시", act.status === 200 && act.body.event?.id === ev1 && act.body.event?.mode === "drill", act.body);
    const myT = await ag.teacher!.call("GET", `${S}/events/${ev1}/my-classes`);
    const myB = await ag.safetyB!.call("GET", `${S}/events/${ev1}/my-classes`);
    check("1-3 담당 학급만: 담임 1학년 1반, 담임+안전 겸임은 1학년 2반", myT.body.classes?.map((c: any) => c.label).join() === "1학년 1반" && myB.body.classes?.map((c: any) => c.label).join() === "1학년 2반", [myT.body.classes?.length, myB.body.classes?.length]);
    const r1 = await ag.teacher!.call("PUT", `${S}/events/${ev1}/reports/${c11}`, report(23, 1, 25, null), { "Idempotency-Key": "e2e3e-c11-first" });
    check("1-4 담임 보고(대피 23·부재 1 → 미확인 1)", r1.status === 200 && r1.body.report?.unconfirmed === 1 && r1.body.report?.version === 1, r1.body);
    const r1dup = await ag.teacher!.call("PUT", `${S}/events/${ev1}/reports/${c11}`, report(23, 1, 25, null), { "Idempotency-Key": "e2e3e-c11-first" });
    check("중복 클릭(같은 요청 번호) → 같은 결과, 새 판 없음", r1dup.status === 200 && r1dup.body.replayed === true && r1dup.body.report?.version === 1, r1dup.body);
    const rB = await ag.safetyB!.call("PUT", `${S}/events/${ev1}/reports/${c12}`, report(26, 1, 27, null, 1, "가상 메모: 보건실 이동 1명"), { "Idempotency-Key": ikey() });
    check("1-4 담임+안전 겸임 교사 학급 보고(부상 1)", rB.status === 200 && rB.body.report?.injured === 1, rB.body);
    const rOther = await ag.teacher!.call("PUT", `${S}/events/${ev1}/reports/${c12}`, report(27, 0, 27, 1), { "Idempotency-Key": ikey() });
    check("담당이 아닌 학급 보고 → 거부(403/404)", [403, 404].includes(rOther.status), rOther.body);
    const r2 = await ag.teacher!.call("PUT", `${S}/events/${ev1}/reports/${c11}`, report(24, 1, 25, 1), { "Idempotency-Key": ikey() });
    check("1-7 보고 수정 → 판 2, 미확인 0", r2.status === 200 && r2.body.report?.version === 2 && r2.body.report?.unconfirmed === 0, r2.body);
    const rStale = await ag.teacher!.call("PUT", `${S}/events/${ev1}/reports/${c11}`, report(22, 1, 25, 1), { "Idempotency-Key": ikey() });
    check("1-7 오래된 판으로 수정 → 409(덮어쓰기 방지)", rStale.status === 409, rStale.body);
    const revs = await prisma.evacuationReportRevision.count({ where: { report: { eventId: ev1, classId: c11 } } }).catch(() => -1);
    check("1-7 보고 수정 이력 보존(판 1·2)", revs >= 2, revs);
    const board = await ag.vice1!.call("GET", `${S}/events/${ev1}/board`);
    const sm = board.body.summary ?? {};
    check("1-5 상황판: 보고 2/4학급, 대피 50, 부상 1, 미확인 0", board.status === 200 && sm.totalClasses === 4 && sm.reportedClasses === 2 && sm.evacuated === 50 && sm.injured === 1 && sm.unconfirmed === 0, sm);
    const unrep = (board.body.classes ?? []).filter((c: any) => !c.report).map((c: any) => c.label);
    check("1-6 미보고 학급은 보고 없음(0명 아님): 2학년 1반·2반, 대기 인원 50", unrep.join() === "2학년 1반,2학년 2반" && sm.pendingStudents === 50, [unrep, sm.pendingStudents]);
    const boardDeny = await Promise.all(["teacher", "operator", "staff"].map((k) => ag[k]!.call("GET", `${S}/events/${ev1}/board`)));
    check("상황판: 담임·앱 운영담당·일반 교직원 → 403(서버 검사)", boardDeny.every((r) => r.status === 403), boardDeny.map((r) => r.status));
    const close1 = await ag.vice2!.call("POST", `${S}/events/${ev1}/close`, {});
    check("1-8 교감(발령자와 다른 사람) 종료", close1.status === 200, close1.body);
    const late = await ag.teacher!.call("PUT", `${S}/events/${ev1}/reports/${c11}`, report(25, 0, 25, 2), { "Idempotency-Key": ikey() });
    check("종료 후 보고 → 409", late.status === 409, late.body);

    console.log("\n1-9. 훈련일지");
    const [mk1, mk2] = await Promise.all([ag.safetyA!.call("POST", `${S}/events/${ev1}/drill-log`, {}), ag.opSafe!.call("POST", `${S}/events/${ev1}/drill-log`, {})]);
    check("1-9 안전담당·겸임자 동시 생성 → 1건(201+200)", [mk1.status, mk2.status].sort().join() === "200,201" && mk1.body.id === mk2.body.id, [mk1.status, mk2.status]);
    const logId = mk1.body.id as string;
    const deny = await Promise.all([ag.principal!.call("POST", `${S}/events/${ev1}/drill-log`, {}), ag.admin!.call("POST", `${S}/events/${ev1}/drill-log`, {}), ag.operator!.call("GET", `${S}/drill-logs`)]);
    check("훈련일지: 교장·기존 관리자 만들기 403, 앱 운영담당 목록 403", deny.map((r) => r.status).join() === "403,403,403", deny.map((r) => r.status));
    const d1 = await ag.safetyA!.call("GET", `${S}/drill-logs/${logId}`);
    const byL = Object.fromEntries((d1.body.snapshot?.classes ?? []).map((c: any) => [c.label, c]));
    check(
      "1-10 자동 입력: 1-1 대피 24(판 2)·1-2 대피 26·부상 1, 2-1·2-2 미보고(null), 재적 분리",
      byL["1학년 1반"]?.report?.evacuated === 24 && byL["1학년 1반"]?.report?.version === 2 && byL["1학년 2반"]?.report?.injured === 1 && byL["2학년 1반"]?.report === null && byL["2학년 2반"]?.report === null && byL["2학년 1반"]?.enrolled === 24,
      byL,
    );
    check("자동작성 시각 정보: 시작·종료 시각(초 포함) 보존", typeof d1.body.snapshot?.event?.startedAt === "string" && typeof d1.body.snapshot?.event?.closedAt === "string", d1.body.snapshot?.event);
    const manual = {
      ...d1.body.manual,
      staffCount: "14",
      studentCount: "75",
      roles: d1.body.manual.roles.map((r: any, i: number) => (i === 1 ? { ...r, who: "교무부장, 행정실장" } : i === 2 ? { ...r, who: "외부 강사(가상 소방서)" } : r)),
      durationText: "6분 51초",
      evals: d1.body.manual.evals.map((e: any, i: number) => ({ ...e, result: i === 4 ? "X" : "O", note: i === 4 ? "일부 교실 사이렌 <소리> 작음 & 점검 필요" : "" })),
      improvements: "방송 설비 음량 점검, 2층 계단 동선 분산",
    };
    const s1 = await ag.safetyA!.call("PATCH", `${S}/drill-logs/${logId}`, { manual, status: "draft", expectedVersion: 1 });
    check("1-11·12 안전담당A 입력 저장 → 판 2", s1.status === 200 && s1.body.version === 2, s1.body);
    const s2 = await ag.safetyB!.call("PATCH", `${S}/drill-logs/${logId}`, { manual: { ...manual, trainingNote: "사전 안전교육 후 2차 경보에 운동장 대피" }, status: "draft", expectedVersion: 2 });
    check("복수 안전담당 공동 수정: 안전담당B → 판 3", s2.status === 200 && s2.body.version === 3, s2.body);
    const stale = await ag.opSafe!.call("PATCH", `${S}/drill-logs/${logId}`, { manual, status: "completed", expectedVersion: 2 });
    check("동시 수정 충돌: 오래된 판 저장 → 409", stale.status === 409 && stale.body.code === "version_conflict", stale.body);
    const same = await ag.safetyB!.call("PATCH", `${S}/drill-logs/${logId}`, { manual: { ...manual, trainingNote: "사전 안전교육 후 2차 경보에 운동장 대피" }, status: "draft", expectedVersion: 3 });
    check("같은 내용 다시 저장 → 판 유지", same.status === 200 && same.body.changed === false && same.body.version === 3, same.body);
    // 원본 변경(미보고 학급 재적 변경) → 알림만, 자동 반영 없음 → 다시 불러오기(수동 입력 보존)
    await prisma.schoolClass.update({ where: { id: c21 }, data: { enrolledCount: 23 } });
    const d2 = await ag.safetyA!.call("GET", `${S}/drill-logs/${logId}`);
    check("원본 변경 감지(자동 반영 안 함)", (d2.body.sourceChanges ?? []).some((t: string) => t.includes("2학년 1반")) && d2.body.snapshot?.classes?.find((c: any) => c.label === "2학년 1반")?.enrolled === 24, d2.body.sourceChanges);
    const rf = await ag.safetyA!.call("PATCH", `${S}/drill-logs/${logId}`, { manual: d2.body.manual, status: "draft", expectedVersion: 3, refreshAuto: true });
    const d3 = await ag.safetyA!.call("GET", `${S}/drill-logs/${logId}`);
    check(
      "다시 불러오기 → 판 4, 재적 23 반영, 담당자 입력(평가·인원·담당자) 보존",
      rf.status === 200 && rf.body.version === 4 && d3.body.snapshot?.classes?.find((c: any) => c.label === "2학년 1반")?.enrolled === 23 &&
        d3.body.manual?.evals?.[4]?.result === "X" && d3.body.manual?.staffCount === "14" && d3.body.manual?.roles?.[1]?.who === "교무부장, 행정실장" && (d3.body.sourceChanges ?? []).length === 0,
      [rf.body, d3.body.manual?.evals?.[4]],
    );
    check("1-12 수정 이력 4판(작성자·시각)", d3.body.revisions?.length === 4 && d3.body.revisions.every((r: any) => r.changedAt && r.changedByName), d3.body.revisions);
    const comp = await ag.safetyA!.call("PATCH", `${S}/drill-logs/${logId}`, { manual: d3.body.manual, status: "completed", expectedVersion: 4 });
    check("작성 완료 저장 → 판 5", comp.status === 200 && comp.body.version === 5, comp.body);

    console.log("\n1-13. HWPX");
    const dlP = await ag.principal!.raw("GET", `${S}/drill-logs/${logId}/export.hwpx`);
    const bufP = Buffer.from(await dlP.arrayBuffer());
    const zP = unzipSection(bufP);
    check("1-15 교장 내려받기 200·HWPX 구조", dlP.status === 200 && zP.names[0] === "mimetype" && zP.names.includes("Contents/section0.xml"), [dlP.status, zP.names.slice(0, 3)]);
    const dlV = await ag.vice1!.raw("GET", `${S}/drill-logs/${logId}/export.hwpx`);
    const dlS = await ag.staff!.raw("GET", `${S}/drill-logs/${logId}/export.hwpx`);
    check("교감 내려받기 200, 일반 교직원 403", dlV.status === 200 && dlS.status === 403, [dlV.status, dlS.status]);
    const sec = zP.section;
    check(
      "1-13 문서 데이터: 학교명·지진·교직원 14·학생 참가 75·대피 확인 50 ※·총 89·담당자·소요 시간·O/X·비고 이스케이프·반영사항",
      ["통합검증A초등학교", "비상대피훈련일지(지진)", "<hp:t>14명</hp:t>", "<hp:t>75명</hp:t>", "<hp:t>50명 ※</hp:t>", "<hp:t>89명</hp:t>", "교무부장, 행정실장", "외부 강사(가상 소방서)", "6분 51초", "<hp:t>X</hp:t>", "사이렌 &lt;소리&gt; 작음 &amp; 점검", "2층 계단 동선 분산"].every((t) => sec.includes(t)),
      ["<hp:t>50명 ※</hp:t>", "<hp:t>89명</hp:t>"].map((t) => [t, sec.includes(t)]),
    );
    check("미보고 학급: '—'·'미보고', 주석에 미보고 2학급 제외, 보고 시각 ≠ 대피 완료 안내", sec.includes("<hp:t>미보고</hp:t>") && sec.includes("미보고 2학급 제외") && sec.includes("실제 대피 완료 시각이 아닙니다"));
    check("시간: 시·분·초 표시와 초 단위 계산 안내", /\d{2}:\d{2}:\d{2} ~ \d{2}:\d{2}:\d{2} \(총 /.test(sec) && sec.includes("1초 미만 버림"));
    mkdirSync("e2e-output", { recursive: true });
    writeFileSync("e2e-output/step3e_시나리오1_훈련일지.hwpx", bufP);

    // ───────────── 시나리오 2 ─────────────
    console.log("\n2. 시나리오 2 — 실제 재난(학교 내부 발령)");
    const evBefore = await prisma.disasterEvent.count({ where: { schoolId: A.id } });
    const noConfirm = await ag.safetyA!.call("POST", `${S}/events`, { primaryType: "fire", mode: "real" });
    check("2-3 확인 없이 실제 상황 발령 → 400", noConfirm.status === 400, noConfirm.body);
    const real = await ag.safetyA!.call("POST", `${S}/events`, { primaryType: "fire", mode: "real", confirmReal: true, evacPlace: "운동장" });
    check("2-1 안전담당 실제 상황 발령(확인 후) 201·실제 구분", real.status === 201 && real.body.event?.mode === "real", real.body);
    const evR = real.body.event?.id as string;
    const dupR = await ag.vice1!.call("POST", `${S}/events`, { primaryType: "earthquake", mode: "drill" });
    check("진행 중 중복 발령(훈련 포함) → 409", dupR.status === 409, dupR.body);
    const actR = await ag.teacher!.call("GET", `${S}/events/active`);
    check("2-2 담임 화면: 실제 상황으로 표시", actR.body.event?.mode === "real", actR.body.event);
    await ag.teacher!.call("PUT", `${S}/events/${evR}/reports/${c11}`, report(25, 0, 25, null), { "Idempotency-Key": ikey() });
    const bR = await ag.principal!.call("GET", `${S}/events/${evR}/board`);
    check("2-4 실제 상황 집계: 보고 1/4, 미보고 3", bR.body.summary?.reportedClasses === 1 && (bR.body.classes ?? []).filter((c: any) => !c.report).length === 3, bR.body.summary);
    // 2-5 안내문: 이 앱의 안내문은 공식 경보(모의)에 연결해 작성(학교 내부 발령에 직접 연결하는 기능은 없음 — 보고서에 기록)
    await collectOnce(prisma, new MockAlertSource(MOCK_SCENARIOS["incheon-heatwave"]!), { minIntervalMs: 0 });
    const alertsA = await ag.safetyA!.call("GET", `${S}/alerts`);
    const heat = (alertsA.body.alerts ?? []).find((x: any) => x.alert?.msgType === "new" && x.result === "target");
    const nc = await ag.safetyA!.call("POST", `${S}/notices`, { alertId: heat?.alert?.id, title: "[통합검증A초등학교] 가상 안전 안내", body: "가상 안내문 본문 1" });
    check("2-5 안전안내문 초안 작성(공식 경보 모의 연결) 201", nc.status === 201 && nc.body.version === 1, nc.body);
    const nu = await ag.safetyA!.call("PATCH", `${S}/notices/${nc.body.id}`, { title: "[통합검증A초등학교] 가상 안전 안내", body: "가상 안내문 본문 2 — 수정", status: "draft", expectedVersion: 1 });
    const nd = await ag.safetyA!.call("GET", `${S}/notices/${nc.body.id}`);
    check("2-6 안내문 수정·저장·이력(판 2)", nu.status === 200 && nu.body.version === 2 && nd.body.revisions?.length === 2, [nu.body, nd.body.revisions?.length]);
    const closeNo = await ag.vice1!.call("POST", `${S}/events/${evR}/close`, {});
    check("실제 상황 종료는 확인 필요 → 400", closeNo.status === 400, closeNo.body);
    const closeR = await ag.vice1!.call("POST", `${S}/events/${evR}/close`, { confirmClose: true });
    check("2-7 교감 종료(확인 후)", closeR.status === 200, closeR.body);
    const auditR = await prisma.auditLog.findMany({ where: { schoolId: A.id, targetId: evR }, select: { action: true } });
    check("2-8 종료 기록·감사 로그(발령·종료)", auditR.some((a) => a.action === "event.issued_real") && auditR.some((a) => a.action === "event.closed"), auditR.map((a) => a.action));
    const realLog = await ag.safetyA!.call("POST", `${S}/events/${evR}/drill-log`, {});
    const listR = await ag.safetyA!.call("GET", `${S}/drill-logs`);
    check("2-9 실제 재난 훈련일지 생성 → 409, 목록에 실제 상황 없음", realLog.status === 409 && !(listR.body.events ?? []).some((e: any) => e.eventId === evR), [realLog.status, listR.body.events?.length]);

    // ───────────── 시나리오 3 ─────────────
    console.log("\n3. 시나리오 3 — 공식 경보(모의 공급자, 실제 API 아님)");
    const again = await collectOnce(prisma, new MockAlertSource(MOCK_SCENARIOS["incheon-heatwave"]!), { minIntervalMs: 0 });
    check("같은 경보 재수집 → 저장 0건(중복 방지)", again.inserted === 0, again);
    const a1 = await ag.staff!.call("GET", `${S}/alerts`);
    const heads = (a1.body.alerts ?? []).filter((x: any) => x.alert?.msgType === "new");
    check("A학교(인천): 대상 경보 1건 + 재송출 1회 묶음, 모의 표시", heads.length === 1 && heads[0].rebroadcastCount === 1 && heads[0].alert.isMock === true, (a1.body.alerts ?? []).map((x: any) => [x.result, x.rebroadcastCount]));
    const bAlerts = await ag.adminB!.call("GET", `${SB}/alerts`);
    check("B학교(부산): 인천 경보 미표시·부산 경보만", (bAlerts.body.alerts ?? []).every((x: any) => !String(x.alert?.areasRaw).includes("인천")), (bAlerts.body.alerts ?? []).map((x: any) => x.alert?.areasRaw));
    await collectOnce(prisma, new MockAlertSource(MOCK_SCENARIOS["unclear-area"]!), { minIntervalMs: 0 });
    const uStaff = await ag.staff!.call("GET", `${S}/alerts`);
    const uOp = await ag.operator!.call("GET", `${S}/alerts`);
    check("미판정 경보: 소재지 확인 권한자(앱 운영담당)에게만", !(uStaff.body.alerts ?? []).some((x: any) => x.result === "undetermined") && (uOp.body.alerts ?? []).some((x: any) => x.result === "undetermined"), [(uStaff.body.alerts ?? []).length, (uOp.body.alerts ?? []).length]);
    const read = await ag.staff!.call("POST", `${S}/alerts/${heads[0]?.matchId}/read`, {});
    const tAfter = await ag.teacher!.call("GET", `${S}/alerts`);
    check("읽음은 사용자별(교직원 읽음 → 담임은 읽지 않음 유지)", read.status === 200 && (tAfter.body.alerts ?? []).find((x: any) => x.matchId === heads[0]?.matchId)?.read === false, read.body);
    const evCountBefore = await prisma.disasterEvent.count({ where: { schoolId: A.id } });
    await collectOnce(prisma, new MockAlertSource(MOCK_SCENARIOS["incheon-heatwave-cancel"]!), { minIntervalMs: 0 });
    const aCancel = await ag.staff!.call("GET", `${S}/alerts`);
    check("해제 경보 → 원래 경보 '해제됨' 표시", (aCancel.body.alerts ?? []).some((x: any) => x.alert?.msgType === "new" && x.cancelled) && (aCancel.body.alerts ?? []).some((x: any) => x.alert?.msgType === "cancel"), (aCancel.body.alerts ?? []).map((x: any) => [x.alert?.msgType, x.cancelled]));
    const actAfter = await ag.staff!.call("GET", `${S}/events/active`);
    check("경보 수집이 학교 재난 상황을 자동 발령하지 않음", (await prisma.disasterEvent.count({ where: { schoolId: A.id } })) === evCountBefore && actAfter.body.event === null && evCountBefore === evBefore + 1, [evBefore, evCountBefore]);
    const nList = await ag.staff!.call("GET", `${S}/notices?alertId=${heat?.alert?.id}`);
    check("경보와 안내문 연결(경보별 안내문 목록)", (nList.body.notices ?? []).some((n: any) => n.id === nc.body.id), (nList.body.notices ?? []).length);

    // ───────────── 권한 종합 ─────────────
    console.log("\n4. 직책·권한 종합(서버 API 직접 호출)");
    const v1 = await ag.vice1!.call("GET", `${S}/drill-logs/${logId}`);
    const v2 = await ag.vice2!.call("GET", `${S}/drill-logs`);
    check("교감1·교감2 각각 독립 열람(수정 불가 표시)", v1.status === 200 && v1.body.canEdit === false && v2.status === 200, [v1.status, v2.status]);
    const i3 = await ag.safetyA!.call("POST", `${S}/events`, { primaryType: "fire", mode: "drill" });
    const c3 = await ag.safetyB!.call("POST", `${S}/events/${i3.body.event?.id}/close`, {});
    check("안전담당A 발령 → 안전담당B 종료", i3.status === 201 && c3.status === 200, [i3.status, c3.status]);
    const i4 = await ag.opSafe!.call("POST", `${S}/events`, { primaryType: "earthquake", mode: "drill" });
    const m4 = await ag.opSafe!.call("GET", `${S}/members`);
    const c4 = await ag.opSafe!.call("POST", `${S}/events/${i4.body.event?.id}/close`, {});
    check("겸임(안전+앱운영): 발령·종료와 교직원 관리 모두 가능", i4.status === 201 && m4.status === 200 && c4.status === 200, [i4.status, m4.status, c4.status]);
    const i5 = await ag.admin!.call("POST", `${S}/events`, { primaryType: "earthquake", mode: "drill" });
    const m5 = await ag.admin!.call("GET", `${S}/members`);
    const c5 = await ag.admin!.call("POST", `${S}/events/${i5.body.event?.id}/close`, {});
    const l5 = await ag.admin!.call("GET", `${S}/drill-logs/${logId}`);
    check("기존 관리자: 발령·종료·교직원 관리·훈련일지 열람 유지(수정 불가)", i5.status === 201 && m5.status === 200 && c5.status === 200 && l5.status === 200 && l5.body.canEdit === false, [i5.status, m5.status, c5.status, l5.body.canEdit]);
    const deny2 = await Promise.all([
      ag.staff!.call("POST", `${S}/events`, { primaryType: "fire", mode: "drill" }),
      ag.teacher!.call("POST", `${S}/events`, { primaryType: "fire", mode: "drill" }),
      ag.operator!.call("POST", `${S}/events`, { primaryType: "fire", mode: "drill" }),
      ag.operator!.call("PATCH", `${S}/drill-logs/${logId}`, { manual, status: "draft", expectedVersion: 5 }),
      ag.principal!.call("GET", `${S}/members`),
      ag.principal!.call("POST", `${S}/members/approve`, { membershipIds: [mem.staff] }),
      ag.vice1!.call("POST", `${S}/duties`, { membershipId: mem.staff, duty: "safety_officer" }),
    ]);
    check("무단 차단: 일반·담임·앱운영 발령, 앱운영 훈련일지 수정, 교장 교직원 목록·승인, 교감 업무 지정 → 403", deny2.every((r) => r.status === 403), deny2.map((r) => r.status));
    const cross = await Promise.all([
      ag.adminB!.call("GET", `${S}/drill-logs/${logId}`),
      ag.adminB!.call("GET", `${S}/alerts`),
      ag.adminB!.call("GET", `${S}/notices/${nc.body.id}`),
      ag.adminB!.call("GET", `${S}/events/${ev1}/board`),
      ag.adminB!.raw("GET", `${S}/drill-logs/${logId}/export.hwpx`),
      ag.adminB!.call("GET", `${SB}/drill-logs/${logId}`),
    ]);
    check("다른 학교: 훈련일지·경보·안내문·상황판·HWPX → 404, 자기 학교 경로로 남의 ID → 404", cross.every((r) => r.status === 404), cross.map((r) => r.status));
    // 업무 해제 후 기존 세션
    const dB = await prisma.memberDuty.findFirstOrThrow({ where: { membershipId: mem.safetyB, duty: "safety_officer", endedAt: null } });
    const endB = await ag.operator!.call("POST", `${S}/duties/${dB.id}/end`, { reason: "업무분장 변경(가상)" });
    const afterB = await Promise.all([
      ag.safetyB!.call("POST", `${S}/events`, { primaryType: "fire", mode: "drill" }),
      ag.safetyB!.call("PATCH", `${S}/drill-logs/${logId}`, { manual, status: "draft", expectedVersion: 5 }),
      ag.safetyB!.call("GET", `${S}/events/active`),
    ]);
    check("업무 해제 → 같은 세션에서 발령·훈련일지 수정 403, 담임 기능(학교 조회)은 유지", endB.status === 200 && afterB[0].status === 403 && afterB[1].status === 403 && afterB[2].status === 200, [endB.status, ...afterB.map((r) => r.status)]);
    // C학교: 관리자 없이 앱 운영담당 2명 → 동시에 서로 해제 → 1명은 남음 → 마지막은 해제 불가
    const ends = await Promise.all([ag.opX!.call("POST", `${SC}/duties/${gy.id}/end`, { reason: "가상" }), ag.opY!.call("POST", `${SC}/duties/${gx.id}/end`, { reason: "가상" })]);
    const leftC = await prisma.memberDuty.count({ where: { schoolId: C.id, duty: "app_operator", endedAt: null } });
    check("운영담당 2명이 동시에 서로 해제 → 1건만 성공, 1명 남음", ends.filter((r) => r.status === 200).length === 1 && leftC === 1, [ends.map((r) => [r.status, r.body.code]), leftC]);
    const survivorKey = ends[0]!.status === 200 ? "opX" : "opY";
    const survivorDuty = survivorKey === "opX" ? gx : gy;
    const selfEnd = await ag[survivorKey]!.call("POST", `${SC}/duties/${survivorDuty.id}/end`, { reason: "가상" });
    check("마지막 앱 운영담당 해제 → 409(학교 운영 권한 0명 방지)", selfEnd.status === 409 && selfEnd.body.code === "last_operator", selfEnd.body);

    console.log("\n5. 기록 보존");
    const ended = await prisma.memberDuty.count({ where: { schoolId: A.id, endedAt: { not: null } } });
    const drillRevs = await prisma.drillLogRevision.count({ where: { drillLogId: logId } }).catch(() => -1);
    const auditDrill = await prisma.auditLog.count({ where: { schoolId: A.id, action: { startsWith: "drilllog." } } });
    check("업무 해제는 삭제가 아니라 종료 기록, 훈련일지 이력 5판, 훈련일지 감사 로그 남음", ended === 1 && drillRevs === 5 && auditDrill >= 5, [ended, drillRevs, auditDrill]);
    await prisma.$disconnect();
  } finally {
    await server.stop();
  }

  console.log(`\n[e2e:step3e] 결과: ${passed}개 통과, ${failed}개 실패`);
  if (failures.length) console.log(`실패 항목:\n - ${failures.join("\n - ")}`);
  process.exitCode = failed > 0 ? 1 : 0;
}

main().catch((error) => {
  console.error("[e2e:step3e] 실행 실패:", error instanceof Error ? error.message : error);
  process.exitCode = 1;
});
