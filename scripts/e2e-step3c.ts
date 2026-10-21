// STEP 3-C 재난안전 안내문 작성 지원 자동 검증(HTTP): npm run e2e:step3c
//
// 안전장치: 테스트 전용 스키마(safeschool_test)만 사용하고 시작 시 비웁니다. 시연 스키마와 섞어 쓰지 마세요.
// 모의 경보만 사용합니다. 결재·실제 발송·모의 발송 API는 없으며, 이 스크립트도 발송하지 않습니다.
// 구성: 인천 학교 A — 관리자·담임(작성자)·교직원·승인 대기 교사, 부산 학교 B — 관리자
import { execSync } from "node:child_process";
import { createTestClient, getTestDatabaseUrl, resetTestData } from "../tests/test-db.js";
import { hashPassword } from "../server/src/security/password.js";
import { collectOnce } from "../server/src/alerts/collector.js";
import { MOCK_SCENARIOS } from "../server/src/alerts/mockScenarios.js";
import { MockAlertSource } from "../server/src/alerts/providers.js";
import { startTestServer } from "./e2e-server.js";

const PORT = Number(process.env.E2E_PORT ?? 5098);
const BASE = `http://127.0.0.1:${PORT}/api`;
const PASSWORD = "e2e-step3c-password";
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
  console.log("[e2e:step3c] 테스트 스키마에 마이그레이션 적용");
  execSync("npx prisma migrate deploy", { stdio: "ignore", env: { ...process.env, DATABASE_URL: testUrl } });

  const prisma = createTestClient();
  await resetTestData(prisma);
  const now = new Date();
  const hash = await hashPassword(PASSWORD);
  const user = (email: string, displayName: string) => prisma.user.create({ data: { email, displayName, passwordHash: hash, emailVerifiedAt: now } });
  const member = (schoolId: string, userId: string, role: "admin" | "homeroom" | "staff", status: "approved" | "pending" = "approved") =>
    prisma.schoolMembership.create({
      data: { schoolId, userId, role, status, ...(status === "approved" ? { approvalMethod: "roster" as const, approvedAt: now } : {}) },
    });
  const schoolA = await prisma.school.create({ data: { name: "안내A초등학교", slug: "e2e3c-a", address: "인천광역시 남동구 시험로 1", status: "active", activatedAt: now } });
  const schoolB = await prisma.school.create({ data: { name: "안내B초등학교", slug: "e2e3c-b", address: "부산광역시 해운대구 시험로 1", status: "active", activatedAt: now } });
  await member(schoolA.id, (await user("admin-a@e2e3c.test", "A관리자")).id, "admin");
  await member(schoolA.id, (await user("teacher-a@e2e3c.test", "A담임")).id, "homeroom");
  await member(schoolA.id, (await user("staff-a@e2e3c.test", "A교직원")).id, "staff");
  await member(schoolA.id, (await user("pending-a@e2e3c.test", "A승인대기")).id, "staff", "pending");
  await member(schoolB.id, (await user("admin-b@e2e3c.test", "B관리자")).id, "admin");

  const server = await startTestServer(PORT, { ...process.env, DATABASE_URL: testUrl, NODE_ENV: "test", MAIL_PROVIDER: "console", SCHOOLINFO_API_KEY: "", ALERT_MOCK_FEED: "" });
  try {
    const admin = new Agent();
    const teacher = new Agent();
    const staff = new Agent();
    const pending = new Agent();
    const adminB = new Agent();
    await admin.login("admin-a@e2e3c.test");
    await teacher.login("teacher-a@e2e3c.test");
    await staff.login("staff-a@e2e3c.test");
    await pending.login("pending-a@e2e3c.test");
    await adminB.login("admin-b@e2e3c.test");
    const A = `/schools/${schoolA.id}`;
    const B = `/schools/${schoolB.id}`;

    await collectOnce(prisma, new MockAlertSource(MOCK_SCENARIOS["incheon-heatwave"]!), { minIntervalMs: 0 });
    const alertsBefore = await prisma.officialAlert.findMany({ orderBy: { externalId: "asc" } });
    const id = (ext: string) => alertsBefore.find((a) => a.externalId === ext)!.id;
    const heat = id("MOCK-HEAT-001");

    console.log("\n1. 예시문·권한");
    const ex = await teacher.call("GET", `${A}/notice-examples`);
    check("예시문 21개(7개 유형 × 3)와 안내 문구", ex.status === 200 && ex.body.examples?.length === 21 && typeof ex.body.guide?.feature === "string", ex.body.examples?.length);
    const pendingEx = await pending.call("GET", `${A}/notice-examples`);
    check("승인 대기 계정 → 403", pendingEx.status === 403 && pendingEx.body.code === "membership_pending", pendingEx.body);
    const crossEx = await adminB.call("GET", `${A}/notices`);
    check("다른 학교 관리자 → 404", crossEx.status === 404, crossEx.body);

    console.log("\n2. 작성·수정·동시 수정 방지");
    const created = await teacher.call("POST", `${A}/notices`, { alertId: id("MOCK-HEAT-002"), title: "[안내A초등학교] 폭염 안내", body: "본문 1", exampleKey: "heatwave.parent.issued" });
    const nid = created.body.id as string;
    check("재송출 경보로 작성 → 대표 경보에 연결(201, 판 1)", created.status === 201 && created.body.alertId === heat && created.body.version === 1, created.body);
    const pendingCreate = await pending.call("POST", `${A}/notices`, { alertId: heat, title: "t", body: "b" });
    check("승인 대기 계정 작성 → 403", pendingCreate.status === 403, pendingCreate.body);
    const nonTarget = await teacher.call("POST", `${A}/notices`, { alertId: id("MOCK-RAIN-001"), title: "t", body: "b" });
    check("비대상(부산) 경보에 작성 → 400", nonTarget.status === 400 && nonTarget.body.code === "alert_not_target", nonTarget.body);
    const crossCreate = await adminB.call("POST", `${B}/notices`, { alertId: heat, title: "t", body: "b" });
    check("B 학교가 A 지역 경보에 작성 → 400(대상 아님)", crossCreate.status === 400, crossCreate.body);
    const noTitle = await teacher.call("POST", `${A}/notices`, { alertId: heat, title: " ", body: "b" });
    check("빈 제목 → 400", noTitle.status === 400, noTitle.body);

    const upd = { title: "[안내A초등학교] 폭염 안내", status: "draft" };
    const s1 = await teacher.call("PATCH", `${A}/notices/${nid}`, { ...upd, body: "본문 2", expectedVersion: 1 });
    check("작성자 저장 → 판 2", s1.status === 200 && s1.body.version === 2, s1.body);
    const stale = await admin.call("PATCH", `${A}/notices/${nid}`, { ...upd, body: "덮어쓰기", expectedVersion: 1 });
    check("오래된 판으로 저장 → 409 version_conflict", stale.status === 409 && stale.body.code === "version_conflict", stale.body);
    const [c1, c2] = await Promise.all([
      teacher.call("PATCH", `${A}/notices/${nid}`, { ...upd, body: "동시 가", expectedVersion: 2 }),
      admin.call("PATCH", `${A}/notices/${nid}`, { ...upd, body: "동시 나", expectedVersion: 2 }),
    ]);
    check("동시 저장 2건 중 1건만 성공", [c1.status, c2.status].sort().join(",") === "200,409", [c1.status, c2.status]);
    const notAuthor = await staff.call("PATCH", `${A}/notices/${nid}`, { ...upd, body: "남의 글", expectedVersion: 3 });
    check("작성자·관리자가 아닌 교직원 수정 → 403", notAuthor.status === 403, notAuthor.body);
    const done = await admin.call("PATCH", `${A}/notices/${nid}`, { ...upd, status: "completed", body: "관리자 최종", expectedVersion: 3 });
    check("관리자 수정·작성 완료 → 판 4", done.status === 200 && done.body.version === 4, done.body);
    const detail = await staff.call("GET", `${A}/notices/${nid}`);
    check("수정 이력 4판 연속(4,3,2,1)·교직원 조회 가능·수정 불가 표시",
      detail.status === 200 && detail.body.revisions?.map((r: any) => r.version).join(",") === "4,3,2,1" && detail.body.canEdit === false, detail.body.revisions?.map((r: any) => r.version));
    check("공식 경보 원문과 안내문 분리(경보 원문은 그대로 표시)", detail.body.alert?.body === alertsBefore.find((a) => a.id === heat)!.body && detail.body.notice?.body === "관리자 최종");

    console.log("\n3. 다른 학교 ID 차단");
    const crossGet = await adminB.call("GET", `${B}/notices/${nid}`);
    const crossPatch = await adminB.call("PATCH", `${B}/notices/${nid}`, { ...upd, body: "x", expectedVersion: 4 });
    const crossCancel = await adminB.call("POST", `${B}/notices/${nid}/cancel`, { reason: "x", expectedVersion: 4 });
    const crossReuse = await adminB.call("POST", `${B}/notices/${nid}/reuse`, {});
    const crossRecord = await adminB.call("POST", `${B}/notices/${nid}/records`, { sentByTeacher: false });
    check("B 학교 경로로 A 안내문 조회·수정·취소·재사용·이력 입력 → 모두 404",
      [crossGet, crossPatch, crossCancel, crossReuse, crossRecord].every((r) => r.status === 404), [crossGet, crossPatch, crossCancel, crossReuse, crossRecord].map((r) => r.status));
    const badId = await teacher.call("GET", `${A}/notices/not-a-uuid`);
    check("형식이 틀린 ID → 404", badId.status === 404, badId.body);

    console.log("\n4. 선택적 처리 이력(교사 직접 입력)");
    const rec = await teacher.call("POST", `${A}/notices/${nid}/records`, { channel: "school_app", audienceCategory: "전교 학부모", sentByTeacher: true, sentAt: new Date().toISOString() });
    check("처리 이력 입력 → 201", rec.status === 201, rec.body);
    const phone = await teacher.call("POST", `${A}/notices/${nid}/records`, { memo: "학부모 010-1234-5678", sentByTeacher: false });
    check("개인 연락처(전화번호) 입력 → 400", phone.status === 400, phone.body);
    const voidOther = await staff.call("POST", `${A}/notices/${nid}/records/${rec.body.id}/void`, { reason: "x" });
    check("기록자·관리자가 아닌 교직원 무효 처리 → 403", voidOther.status === 403, voidOther.body);
    const voided = await teacher.call("POST", `${A}/notices/${nid}/records/${rec.body.id}/void`, { reason: "잘못 입력" });
    check("기록자 무효 처리 → 200", voided.status === 200, voided.body);

    console.log("\n5. 취소와 재사용(취소된 안내문으로 새 초안)");
    const notCancelled = await teacher.call("POST", `${A}/notices/${nid}/reuse`, {});
    check("취소되지 않은 안내문 재사용 → 409", notCancelled.status === 409 && notCancelled.body.code === "source_not_cancelled", notCancelled.body);
    const cancelled = await teacher.call("POST", `${A}/notices/${nid}/cancel`, { reason: "날짜 오기", expectedVersion: 4 });
    check("취소(사유 필수) → 판 5", cancelled.status === 200 && cancelled.body.version === 5, cancelled.body);
    const afterCancel = await admin.call("PATCH", `${A}/notices/${nid}`, { ...upd, body: "되살리기", expectedVersion: 5 });
    check("취소된 원본 수정 → 409 notice_cancelled", afterCancel.status === 409 && afterCancel.body.code === "notice_cancelled", afterCancel.body);
    const restore = await admin.call("POST", `${A}/notices/${nid}/cancel`, { reason: "다시", expectedVersion: 5 });
    check("다시 취소(상태 변경) → 409", restore.status === 409, restore.body);
    const pendingReuse = await pending.call("POST", `${A}/notices/${nid}/reuse`, {});
    check("승인 대기 계정 재사용 → 403", pendingReuse.status === 403, pendingReuse.body);

    await collectOnce(prisma, new MockAlertSource(MOCK_SCENARIOS["incheon-heatwave-cancel"]!), { minIntervalMs: 0 });
    const reuse1 = await staff.call("POST", `${A}/notices/${nid}/reuse`, {});
    const r1 = reuse1.body;
    check("새 초안 생성 → 201, 새 ID, 같은 경보", reuse1.status === 201 && r1.created === true && r1.id !== nid && r1.alertId === heat, r1);
    check("해제된 경보 경고 + 과거 내용 확인 경고", r1.warnings?.map((w: any) => w.code).join(",") === "alert_cancelled,past_content", r1.warnings);
    const again = await staff.call("POST", `${A}/notices/${nid}/reuse`, {});
    check("같은 요청 다시 → 200, 같은 초안(중복 없음)", again.status === 200 && again.body.created === false && again.body.id === r1.id, again.body);
    const newDraft = await staff.call("GET", `${A}/notices/${r1.id}`);
    check("새 초안: 작성 중·판 1·원본 연결·원본 본문 복사·재사용자가 작성자",
      newDraft.body.notice?.status === "draft" && newDraft.body.notice?.version === 1 && newDraft.body.notice?.sourceNoticeId === nid &&
        newDraft.body.notice?.body === "관리자 최종" && newDraft.body.canEdit === true && newDraft.body.revisions?.length === 1 && newDraft.body.alert?.cancelled === true,
      newDraft.body.notice);
    const edit = await staff.call("PATCH", `${A}/notices/${r1.id}`, { title: "[안내A초등학교] 폭염 해제 안내", body: "해제 안내 본문", status: "completed", expectedVersion: 1 });
    check("재사용한 초안 수정·작성 완료 → 판 2", edit.status === 200 && edit.body.version === 2, edit.body);
    const src = await teacher.call("GET", `${A}/notices/${nid}`);
    check("원본: 취소 상태·사유·본문·이력 5판 그대로, 재사용 초안 목록에 표시",
      src.body.notice?.status === "cancelled" && src.body.notice?.cancelReason === "날짜 오기" && src.body.notice?.body === "관리자 최종" &&
        src.body.revisions?.length === 5 && src.body.reusedBy?.[0]?.id === r1.id,
      { notice: src.body.notice, revs: src.body.revisions?.length });
    const toNonTarget = await teacher.call("POST", `${A}/notices/${nid}/reuse`, { alertId: id("MOCK-RAIN-001") });
    check("다른 경보에 연결: 비대상 → 400", toNonTarget.status === 400, toNonTarget.body);
    const cancelAlert = (await prisma.officialAlert.findFirstOrThrow({ where: { externalId: "MOCK-HEAT-003" } })).id;
    const toOther = await teacher.call("POST", `${A}/notices/${nid}/reuse`, { alertId: cancelAlert });
    check("다른 대상 경보(해제 경보)에 연결 → 201, '다른 경보' 경고", toOther.status === 201 && toOther.body.warnings?.some((w: any) => w.code === "alert_changed"), toOther.body);
    check("재사용 감사 로그 2건(재사용자·원본 기록)",
      (await prisma.auditLog.count({ where: { action: "notice.reused", schoolId: schoolA.id, before: { path: ["sourceNoticeId"], equals: nid } } })) === 2);

    console.log("\n6. 기존 기능 유지");
    const alertsAfter = await prisma.officialAlert.findMany({ orderBy: { externalId: "asc" } });
    check("공식 경보 원문 변경 없음(해제 경보 1건 추가 외)", JSON.stringify(alertsAfter.filter((a) => a.externalId !== "MOCK-HEAT-003")) === JSON.stringify(alertsBefore));
    const box = await teacher.call("GET", `${A}/alerts`);
    const heatItem = box.body.alerts?.find((a: any) => a.alert.id === heat);
    check("경보함: 폭염경보 1건(재송출 묶음)·해제됨·안내문 수 1(취소 제외)",
      heatItem?.rebroadcastCount === 1 && heatItem?.cancelled === true && heatItem?.noticeCount === 1, heatItem && { r: heatItem.rebroadcastCount, c: heatItem.cancelled, n: heatItem.noticeCount });
    const list = await teacher.call("GET", `${A}/notices`);
    check("안내문 목록 3건(취소 원본 포함)", list.body.notices?.length === 3, list.body.notices?.map((n: any) => n.status));
    const listB = await adminB.call("GET", `${B}/notices`);
    check("B 학교 목록에는 A 안내문 없음", listB.status === 200 && listB.body.notices?.length === 0, listB.body);
    await prisma.$disconnect();
  } finally {
    await server.stop();
  }

  console.log(`\n[e2e:step3c] 결과: ${passed}개 통과, ${failed}개 실패`);
  process.exitCode = failed > 0 ? 1 : 0;
}

main().catch((error) => {
  console.error("[e2e:step3c] 실행 실패:", error instanceof Error ? error.message : error);
  process.exitCode = 1;
});
