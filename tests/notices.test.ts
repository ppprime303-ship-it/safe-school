// STEP 3-C 재난안전 안내문 작성·수정·이력·재사용·처리 이력 (테스트 전용 DB 스키마, 모의 경보)
// 승인 대기 계정 차단(403)과 HTTP 경로의 다른 학교 ID 차단은 scripts/e2e-step3c.ts 에서 확인합니다.
import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { createTestClient, resetTestData } from "./test-db.js";
import { collectOnce } from "../server/src/alerts/collector.js";
import { MockAlertSource, type MockAlertInput } from "../server/src/alerts/providers.js";
import { listSchoolAlerts } from "../server/src/services/alerts.js";
import {
  addHandlingRecord,
  cancelNotice,
  createNotice,
  getNotice,
  listNotices,
  reuseNotice,
  updateNotice,
  voidHandlingRecord,
} from "../server/src/services/notices.js";

const prisma = createTestClient();
let incheon = "";
let busan = "";
let admin = ""; // 인천학교 관리자
let author = ""; // 인천학교 교사(작성자)
let other = ""; // 인천학교 다른 교사
let busanTeacher = "";

const minutesAgo = (m: number) => new Date(Date.now() - m * 60_000).toISOString();
const heat = (over: Partial<MockAlertInput> = {}): MockAlertInput => ({
  id: "N-HEAT-1",
  kind: "weather",
  severity: "warning",
  issuer: "기상청(모의)",
  title: "[모의] 폭염경보",
  body: "[모의] 인천 폭염경보",
  areas: "인천광역시",
  issuedAt: minutesAgo(30),
  ...over,
});
const collect = (list: MockAlertInput[]) => collectOnce(prisma, new MockAlertSource(() => list), { minIntervalMs: 0 });
const alertId = async (externalId: string) => (await prisma.officialAlert.findFirstOrThrow({ where: { externalId } })).id;
const draft = (alert: string, by = author, title = "폭염 안내", body = "본문 1") =>
  createNotice(prisma, { schoolId: incheon, actorUserId: by, alertId: alert, title, body, exampleKey: "heatwave.parent.issued" });
const save = (id: string, expectedVersion: number, over: Partial<{ title: string; body: string; status: "draft" | "completed"; by: string; role: "admin" | "homeroom" | "staff" }> = {}) =>
  updateNotice(prisma, {
    schoolId: incheon, noticeId: id, actorUserId: over.by ?? author, role: over.role ?? "homeroom",
    title: over.title ?? "폭염 안내", body: over.body ?? `본문 ${expectedVersion + 1}`, status: over.status ?? "draft", expectedVersion,
  });
const cancel = (id: string, expectedVersion: number, by = author, role: "admin" | "homeroom" = "homeroom") =>
  cancelNotice(prisma, { schoolId: incheon, noticeId: id, actorUserId: by, role, reason: "중복 작성", expectedVersion });

beforeEach(async () => {
  await resetTestData(prisma);
  const now = new Date();
  const school = async (slug: string, name: string, address: string) =>
    (await prisma.school.create({ data: { name, slug, address, status: "active", activatedAt: now } })).id;
  incheon = await school("test-incheon", "인천학교", "인천광역시 남동구 안전로 1");
  busan = await school("test-busan", "부산학교", "부산광역시 해운대구 바다로 1");
  const user = async (email: string, name: string) => (await prisma.user.create({ data: { email, displayName: name, emailVerifiedAt: now } })).id;
  admin = await user("admin@n.kr", "관리자");
  author = await user("author@n.kr", "작성교사");
  other = await user("other@n.kr", "다른교사");
  busanTeacher = await user("busan@n.kr", "부산교사");
  await collect([
    heat(),
    heat({ id: "N-HEAT-2", issuedAt: minutesAgo(20) }), // 같은 내용 재송출 → N-HEAT-1에 묶임
    heat({ id: "N-RAIN-1", title: "[모의] 호우주의보", body: "[모의] 인천 호우주의보", issuedAt: minutesAgo(10) }),
    heat({ id: "N-BUSAN-1", title: "[모의] 부산 풍랑", body: "[모의] 부산 풍랑경보", areas: "부산광역시", issuedAt: minutesAgo(5) }),
  ]);
});

afterAll(async () => {
  await prisma.$disconnect();
});

describe("작성·연결 경보 검사", () => {
  it("대상 경보에 작성하면 판 1, 수정 이력 1건, 감사 기록", async () => {
    const r = await draft(await alertId("N-HEAT-1"));
    expect(r).toMatchObject({ version: 1, redirectedFrom: null });
    const n = await getNotice(prisma, { schoolId: incheon, noticeId: r.id, userId: author, role: "homeroom" });
    expect(n.notice).toMatchObject({ status: "draft", version: 1, exampleKey: "heatwave.parent.issued", exampleVersion: 1, sourceNoticeId: null });
    expect(n.revisions.map((v) => v.version)).toEqual([1]);
    expect(n.canEdit).toBe(true);
    expect(await prisma.auditLog.count({ where: { action: "notice.created", targetId: r.id } })).toBe(1);
  });

  it("재송출 경보를 고르면 대표 경보로 연결한다", async () => {
    const r = await draft(await alertId("N-HEAT-2"));
    expect(r.alertId).toBe(await alertId("N-HEAT-1"));
    expect(r.redirectedFrom).toBe(await alertId("N-HEAT-2"));
  });

  it("다른 학교 경보는 404, 비대상 경보는 400", async () => {
    // 부산 경보: 인천학교 판정은 비대상
    await expect(draft(await alertId("N-BUSAN-1"))).rejects.toMatchObject({ status: 400 });
    // 없는(판정 없는) 경보 ID
    await expect(draft("00000000-0000-0000-0000-000000000000")).rejects.toMatchObject({ status: 404 });
    // 부산학교 입장에서 인천 경보
    await expect(
      createNotice(prisma, { schoolId: busan, actorUserId: busanTeacher, alertId: await alertId("N-HEAT-1"), title: "t", body: "b" }),
    ).rejects.toMatchObject({ status: 400 });
  });

  it("없는 예시문 키는 400", async () => {
    await expect(
      createNotice(prisma, { schoolId: incheon, actorUserId: author, alertId: await alertId("N-HEAT-1"), title: "t", body: "b", exampleKey: "heatwave.parent.unknown" }),
    ).rejects.toMatchObject({ status: 400 });
  });
});

describe("수정·동시 수정 방지·수정 이력", () => {
  it("저장할 때마다 판 번호 +1, 이전 판 내용·수정자 보존", async () => {
    const { id } = await draft(await alertId("N-HEAT-1"));
    await save(id, 1, { body: "두 번째" });
    await save(id, 2, { body: "세 번째", by: admin, role: "admin", status: "completed" });
    const n = await getNotice(prisma, { schoolId: incheon, noticeId: id, userId: author, role: "homeroom" });
    expect(n.notice).toMatchObject({ version: 3, status: "completed", body: "세 번째" });
    expect(n.revisions.map((r) => [r.version, r.body, r.changedByName])).toEqual([
      [3, "세 번째", "관리자"],
      [2, "두 번째", "작성교사"],
      [1, "본문 1", "작성교사"],
    ]);
    expect(await prisma.auditLog.count({ where: { action: "notice.completed", targetId: id } })).toBe(1);
  });

  it("오래된 판으로 저장하면 409, 동시 저장 2건 중 1건만 성공", async () => {
    const { id } = await draft(await alertId("N-HEAT-1"));
    const results = await Promise.allSettled([save(id, 1, { body: "가" }), save(id, 1, { body: "나", by: admin, role: "admin" })]);
    expect(results.filter((r) => r.status === "fulfilled")).toHaveLength(1);
    const rejected = results.find((r) => r.status === "rejected") as PromiseRejectedResult;
    expect(rejected.reason).toMatchObject({ status: 409 });
    await expect(save(id, 1, { body: "다" })).rejects.toMatchObject({ status: 409, code: "version_conflict" });
    expect(await prisma.schoolNoticeRevision.count({ where: { noticeId: id } })).toBe(2);
  });

  it("내용이 같으면 판 번호를 올리지 않는다", async () => {
    const { id } = await draft(await alertId("N-HEAT-1"));
    await expect(save(id, 1, { body: "본문 1" })).resolves.toMatchObject({ version: 1, changed: false });
  });

  it("작성자·관리자가 아닌 교사는 고칠 수 없다(403)", async () => {
    const { id } = await draft(await alertId("N-HEAT-1"));
    await expect(save(id, 1, { by: other, role: "staff" })).rejects.toMatchObject({ status: 403 });
    const n = await getNotice(prisma, { schoolId: incheon, noticeId: id, userId: other, role: "staff" });
    expect(n.canEdit).toBe(false);
  });

  it("수정 이력은 앱에서 직접 추가·수정·삭제할 수 없다", async () => {
    const { id } = await draft(await alertId("N-HEAT-1"));
    await expect(prisma.schoolNoticeRevision.create({ data: { noticeId: id, version: 5, title: "가짜", body: "가짜", status: "draft" } })).rejects.toBeTruthy();
    await expect(prisma.schoolNoticeRevision.updateMany({ data: { body: "x" } })).rejects.toBeTruthy();
    await expect(prisma.schoolNoticeRevision.deleteMany({})).rejects.toBeTruthy();
  });
});

describe("학교 간 격리", () => {
  it("다른 학교의 안내문·처리 이력 ID로 조회·수정·취소·재사용·이력 입력은 모두 404", async () => {
    const { id } = await draft(await alertId("N-HEAT-1"));
    const rec = await addHandlingRecord(prisma, { schoolId: incheon, noticeId: id, actorUserId: author, channel: "sms", sentByTeacher: false });
    const asBusan = { schoolId: busan, noticeId: id, actorUserId: busanTeacher, role: "admin" as const };
    await expect(getNotice(prisma, { ...asBusan, userId: busanTeacher })).rejects.toMatchObject({ status: 404 });
    await expect(updateNotice(prisma, { ...asBusan, title: "t", body: "b", status: "draft", expectedVersion: 1 })).rejects.toMatchObject({ status: 404 });
    await expect(cancelNotice(prisma, { ...asBusan, reason: "r", expectedVersion: 1 })).rejects.toMatchObject({ status: 404 });
    await expect(reuseNotice(prisma, { schoolId: busan, sourceNoticeId: id, actorUserId: busanTeacher })).rejects.toMatchObject({ status: 404 });
    await expect(addHandlingRecord(prisma, { ...asBusan, sentByTeacher: false })).rejects.toMatchObject({ status: 404 });
    await expect(voidHandlingRecord(prisma, { ...asBusan, recordId: rec.id, reason: "r" })).rejects.toMatchObject({ status: 404 });
    expect((await listNotices(prisma, { schoolId: busan })).notices).toHaveLength(0);
  });
});

describe("취소와 재사용(취소된 안내문으로 새 초안)", () => {
  async function cancelledNotice() {
    const alert = await alertId("N-HEAT-1");
    const { id } = await draft(alert);
    await save(id, 1, { body: "원본 최종 본문" });
    await cancel(id, 2);
    return { id, alert };
  }

  it("1·2. 취소된 원본은 수정·직접 복구 불가(서비스 409, DB 직접 변경도 거부)", async () => {
    const { id } = await cancelledNotice();
    await expect(save(id, 3)).rejects.toMatchObject({ status: 409, code: "notice_cancelled" });
    await expect(cancel(id, 3)).rejects.toMatchObject({ status: 409 });
    await expect(prisma.schoolNotice.update({ where: { id }, data: { body: "되살리기", version: 4 } })).rejects.toBeTruthy();
    await expect(
      prisma.schoolNotice.update({ where: { id }, data: { status: "draft", cancelledAt: null, cancelReason: null, version: 4 } }),
    ).rejects.toBeTruthy();
    await expect(prisma.schoolNotice.delete({ where: { id } })).rejects.toBeTruthy();
    await expect(addHandlingRecord(prisma, { schoolId: incheon, noticeId: id, actorUserId: author, sentByTeacher: false })).rejects.toMatchObject({ status: 409 });
  });

  it("3·4·5·7. 새 초안 생성: 새 ID·판 1·작성 중, 원본 내용·취소 정보·이력 그대로, 연결 관계 확인", async () => {
    const { id: src, alert } = await cancelledNotice();
    const before = await prisma.schoolNotice.findUniqueOrThrow({ where: { id: src } });
    const r = await reuseNotice(prisma, { schoolId: incheon, sourceNoticeId: src, actorUserId: other });
    expect(r).toMatchObject({ created: true, alertId: alert });
    expect(r.id).not.toBe(src);
    const n = await getNotice(prisma, { schoolId: incheon, noticeId: r.id, userId: other, role: "staff" });
    expect(n.notice).toMatchObject({ status: "draft", version: 1, title: before.title, body: "원본 최종 본문", sourceNoticeId: src, createdByName: "다른교사" });
    expect(n.revisions.map((v) => v.version)).toEqual([1]);
    expect(n.source).toMatchObject({ id: src, cancelReason: "중복 작성", sameAlert: true });
    expect(n.canEdit).toBe(true); // 새 초안의 작성자는 재사용한 교사

    expect(await prisma.schoolNotice.findUniqueOrThrow({ where: { id: src } })).toEqual(before);
    expect(await prisma.schoolNoticeRevision.count({ where: { noticeId: src } })).toBe(3);
    const s = await getNotice(prisma, { schoolId: incheon, noticeId: src, userId: author, role: "homeroom" });
    expect(s.reusedBy.map((x) => x.id)).toEqual([r.id]);
    expect(s.canEdit).toBe(false);
  });

  it("6. 재사용한 초안은 수정·저장·작성 완료 가능", async () => {
    const { id: src } = await cancelledNotice();
    const r = await reuseNotice(prisma, { schoolId: incheon, sourceNoticeId: src, actorUserId: author });
    await expect(save(r.id, 1, { body: "다시 고친 본문" })).resolves.toMatchObject({ version: 2, changed: true });
    await expect(save(r.id, 2, { body: "다시 고친 본문", status: "completed" })).resolves.toMatchObject({ version: 3 });
  });

  it("작성 중·작성 완료 안내문은 재사용 대상이 아니다(409)", async () => {
    const { id } = await draft(await alertId("N-HEAT-1"));
    await expect(reuseNotice(prisma, { schoolId: incheon, sourceNoticeId: id, actorUserId: author })).rejects.toMatchObject({ status: 409, code: "source_not_cancelled" });
  });

  it("8. 다른 학교 안내문 재사용 차단(404)", async () => {
    const { id: src } = await cancelledNotice();
    await expect(reuseNotice(prisma, { schoolId: busan, sourceNoticeId: src, actorUserId: busanTeacher })).rejects.toMatchObject({ status: 404 });
    expect(await prisma.schoolNotice.count({ where: { sourceNoticeId: src } })).toBe(0);
  });

  it("10. 해제된 경보에 연결한 채 재사용하면 경고, 과거 내용 확인 경고는 항상", async () => {
    const { id: src } = await cancelledNotice();
    await collect([heat({ id: "N-HEAT-9", msgType: "cancel", refId: "N-HEAT-1", title: "[모의] 폭염경보 해제", body: "[모의] 폭염경보 해제", severity: "info", issuedAt: minutesAgo(1) })]);
    const r = await reuseNotice(prisma, { schoolId: incheon, sourceNoticeId: src, actorUserId: author });
    expect(r.warnings.map((w) => w.code)).toEqual(["alert_cancelled", "past_content"]);
    const n = await getNotice(prisma, { schoolId: incheon, noticeId: r.id, userId: author, role: "homeroom" });
    expect(n.alert.cancelled).toBe(true);
  });

  it("11. 다른 경보에 연결: 대상 경보는 허용(경고), 비대상 400, 판정 없는 경보 404, 재송출은 대표 경보로", async () => {
    const { id: src } = await cancelledNotice();
    await expect(reuseNotice(prisma, { schoolId: incheon, sourceNoticeId: src, actorUserId: author, alertId: await alertId("N-BUSAN-1") })).rejects.toMatchObject({ status: 400 });
    await expect(reuseNotice(prisma, { schoolId: incheon, sourceNoticeId: src, actorUserId: author, alertId: "00000000-0000-0000-0000-000000000000" })).rejects.toMatchObject({ status: 404 });
    const rain = await alertId("N-RAIN-1");
    const r = await reuseNotice(prisma, { schoolId: incheon, sourceNoticeId: src, actorUserId: author, alertId: rain });
    expect(r).toMatchObject({ created: true, alertId: rain });
    expect(r.warnings.map((w) => w.code)).toContain("alert_changed");
    // 앞 초안을 작성 완료한 뒤, 재송출 경보를 고르면 대표 경보로 연결
    await save(r.id, 1, { status: "completed" });
    const r2 = await reuseNotice(prisma, { schoolId: incheon, sourceNoticeId: src, actorUserId: author, alertId: await alertId("N-HEAT-2") });
    expect(r2.alertId).toBe(await alertId("N-HEAT-1"));
  });

  it("12. 같은 재사용 요청을 두 번(또는 동시에) 보내도 작성 중 초안은 1건", async () => {
    const { id: src } = await cancelledNotice();
    const [a, b] = await Promise.all([
      reuseNotice(prisma, { schoolId: incheon, sourceNoticeId: src, actorUserId: author }),
      reuseNotice(prisma, { schoolId: incheon, sourceNoticeId: src, actorUserId: author }),
    ]);
    expect(a.id).toBe(b.id);
    expect([a.created, b.created].sort()).toEqual([false, true]);
    const c = await reuseNotice(prisma, { schoolId: incheon, sourceNoticeId: src, actorUserId: author });
    expect(c).toMatchObject({ id: a.id, created: false });
    expect(await prisma.schoolNotice.count({ where: { sourceNoticeId: src } })).toBe(1);
  });

  it("13. 재사용 감사 기록: 재사용한 사람·원본·연결 경보", async () => {
    const { id: src, alert } = await cancelledNotice();
    const r = await reuseNotice(prisma, { schoolId: incheon, sourceNoticeId: src, actorUserId: other });
    const log = await prisma.auditLog.findFirstOrThrow({ where: { action: "notice.reused", targetId: r.id } });
    expect(log).toMatchObject({ schoolId: incheon, actorUserId: other, before: { sourceNoticeId: src, sourceAlertId: alert }, after: { alertId: alert, sameAlert: true, version: 1 } });
    expect(await prisma.auditLog.count({ where: { action: "notice.cancelled", targetId: src } })).toBe(1);
  });
});

describe("선택적 처리 이력(교사 직접 입력)", () => {
  it("입력·무효 처리(기록자 또는 관리자), 무효는 1회, 삭제 불가", async () => {
    const { id } = await draft(await alertId("N-HEAT-1"));
    const rec = await addHandlingRecord(prisma, {
      schoolId: incheon, noticeId: id, actorUserId: author, channel: "school_app", audienceCategory: "전교 학부모", sentByTeacher: true, sentAt: new Date().toISOString(),
    });
    await expect(voidHandlingRecord(prisma, { schoolId: incheon, noticeId: id, recordId: rec.id, actorUserId: other, role: "staff", reason: "r" })).rejects.toMatchObject({ status: 403 });
    await voidHandlingRecord(prisma, { schoolId: incheon, noticeId: id, recordId: rec.id, actorUserId: admin, role: "admin", reason: "잘못 입력" });
    await expect(voidHandlingRecord(prisma, { schoolId: incheon, noticeId: id, recordId: rec.id, actorUserId: admin, role: "admin", reason: "또" })).rejects.toMatchObject({ status: 409 });
    await expect(prisma.noticeHandlingRecord.delete({ where: { id: rec.id } })).rejects.toBeTruthy();
    const n = await getNotice(prisma, { schoolId: incheon, noticeId: id, userId: author, role: "homeroom" });
    expect(n.records[0]).toMatchObject({ channel: "school_app", sentByTeacher: true, voidReason: "잘못 입력" });
  });
});

describe("14. 기존 STEP 3-B 동작 유지", () => {
  it("경보함은 그대로(재송출 묶음 1건) + 경보별 안내문 수(취소 제외)만 추가, 공식 경보 원문 불변", async () => {
    const before = await prisma.officialAlert.findMany({ orderBy: { externalId: "asc" } });
    const heatId = await alertId("N-HEAT-1");
    const a = await draft(heatId);
    const b = await draft(heatId, other, "교직원 안내", "교직원 본문");
    await cancel(b.id, 1, other);
    const { alerts } = await listSchoolAlerts(prisma, { schoolId: incheon, userId: author, role: "homeroom" });
    const h = alerts.find((x) => x.alert.id === heatId)!;
    expect(h).toMatchObject({ rebroadcastCount: 1, noticeCount: 1 });
    expect(alerts.find((x) => x.alert.id !== heatId)!.noticeCount).toBe(0);
    expect(await prisma.officialAlert.findMany({ orderBy: { externalId: "asc" } })).toEqual(before);
    expect(a.id).not.toBe(b.id);
  });
});
