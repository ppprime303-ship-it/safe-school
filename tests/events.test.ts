// STEP 3-A 재난 발령·학급 보고·상황판·종료 (서비스 계층, 테스트 전용 DB 스키마)
import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { createTestClient, resetTestData } from "./test-db.js";
import {
  addEventType,
  closeEvent,
  currentSchoolYear,
  getActiveEvent,
  getBoard,
  issueEvent,
  myClasses,
  submitReport,
  summarize,
  type ReportInput,
} from "../server/src/services/events.js";
import { assignDelegate } from "../server/src/services/delegations.js";

const prisma = createTestClient();
const YEAR = currentSchoolYear();

let schoolA = "";
let schoolB = "";
let adminUser = "";
let teacherUser = "";
let adminMembership = "";
let teacherMembership = "";
let class11 = ""; // 담임 배정, 재적 28
let class12 = ""; // 미배정, 재적 30
let class13 = ""; // 재적 미확인(null)
let classB11 = "";

const input = (over: Partial<ReportInput> = {}): ReportInput => ({
  evacuated: 26,
  absentKnown: 1,
  injured: 0,
  enrolledCount: 28,
  enrolledChangeReason: null,
  note: null,
  expectedVersion: null,
  ...over,
});

async function approvedMember(schoolId: string, userId: string, role: "admin" | "homeroom" | "staff") {
  return (
    await prisma.schoolMembership.create({
      data: { schoolId, userId, role, status: "approved", approvalMethod: "roster", approvedAt: new Date() },
    })
  ).id;
}

beforeEach(async () => {
  await resetTestData(prisma);
  const now = new Date();
  schoolA = (await prisma.school.create({ data: { name: "A학교", slug: "test-a", status: "active", activatedAt: now } })).id;
  schoolB = (await prisma.school.create({ data: { name: "B학교", slug: "test-b", status: "active", activatedAt: now } })).id;
  adminUser = (await prisma.user.create({ data: { email: "admin@a.kr", displayName: "관리자", emailVerifiedAt: now } })).id;
  teacherUser = (await prisma.user.create({ data: { email: "t@a.kr", displayName: "담임", emailVerifiedAt: now } })).id;
  adminMembership = await approvedMember(schoolA, adminUser, "admin");
  teacherMembership = await approvedMember(schoolA, teacherUser, "homeroom");
  const mk = async (schoolId: string, grade: number, classNo: number, enrolledCount: number | null) =>
    (await prisma.schoolClass.create({ data: { schoolId, schoolYear: YEAR, grade, classNo, label: `${grade}학년 ${classNo}반`, enrolledCount } })).id;
  class11 = await mk(schoolA, 1, 1, 28);
  class12 = await mk(schoolA, 1, 2, 30);
  class13 = await mk(schoolA, 1, 3, null);
  classB11 = await mk(schoolB, 1, 1, 25);
  await prisma.schoolClass.create({ data: { schoolId: schoolA, schoolYear: YEAR - 1, grade: 1, classNo: 1, label: "작년 1-1", enrolledCount: 20 } });
  await prisma.classAssignment.create({ data: { membershipId: teacherMembership, classId: class11, duty: "homeroom" } });
});

afterAll(async () => {
  await prisma.$disconnect();
});

const drill = () => issueEvent(prisma, { schoolId: schoolA, actorUserId: adminUser, primaryType: "fire", mode: "drill", evacPlace: "운동장" });
const report = (eventId: string, classId: string, key: string, over: Partial<ReportInput> = {}, who: "teacher" | "admin" = "teacher") =>
  submitReport(prisma, {
    schoolId: schoolA,
    eventId,
    classId,
    actorUserId: who === "teacher" ? teacherUser : adminUser,
    membershipId: who === "teacher" ? teacherMembership : adminMembership,
    idempotencyKey: key,
    input: input(over),
  });

describe("A1 발령", () => {
  it("훈련 발령은 바로 되고, 최초 유형이 기록되며 감사 로그가 남는다", async () => {
    const event = await drill();
    expect(event).toMatchObject({ mode: "drill", status: "active", types: ["fire"], evacPlace: "운동장" });
    expect((await getActiveEvent(prisma, schoolA))?.id).toBe(event.id);
    expect(await getActiveEvent(prisma, schoolB)).toBeNull();
    expect(await prisma.auditLog.count({ where: { action: "event.issued_drill", targetId: event.id } })).toBe(1);
  });

  it("실제 상황은 confirmReal 없이는 발령되지 않는다", async () => {
    await expect(issueEvent(prisma, { schoolId: schoolA, actorUserId: adminUser, primaryType: "fire", mode: "real" })).rejects.toMatchObject({
      code: "confirm_required",
    });
    expect(await prisma.disasterEvent.count()).toBe(0);
    await expect(
      issueEvent(prisma, { schoolId: schoolA, actorUserId: adminUser, primaryType: "fire", mode: "real", confirmReal: true }),
    ).resolves.toMatchObject({ mode: "real" });
  });

  it("학교당 진행 중 상황은 1건이며, 중복 발령은 기존 상황 ID와 함께 409", async () => {
    const first = await drill();
    await expect(drill()).rejects.toMatchObject({ status: 409, code: "event_already_active", details: { eventId: first.id } });
    // 다른 학교는 영향 없음
    await expect(issueEvent(prisma, { schoolId: schoolB, actorUserId: adminUser, primaryType: "earthquake", mode: "drill" })).resolves.toBeTruthy();
  });

  it("복합재난: 유형을 추가하면 최초 유형이 앞에 유지되고, 같은 유형은 중복되지 않는다", async () => {
    const event = await drill();
    await addEventType(prisma, { schoolId: schoolA, eventId: event.id, actorUserId: adminUser, type: "earthquake" });
    const again = await addEventType(prisma, { schoolId: schoolA, eventId: event.id, actorUserId: adminUser, type: "earthquake" });
    expect(again.types).toEqual(["fire", "earthquake"]);
  });

  it("다른 학교의 상황 ID로는 접근할 수 없다(404)", async () => {
    const event = await drill();
    await expect(getBoard(prisma, { schoolId: schoolB, eventId: event.id })).rejects.toMatchObject({ status: 404 });
  });
});

describe("A2 학급 보고", () => {
  it("담임은 배정된 학급만 보고 목록에 보이고, 관리자도 담임·대리 학급이 없으면 비어 있다(전체 현황은 상황판, Phase 1-3)", async () => {
    const event = await drill();
    const mine = await myClasses(prisma, { schoolId: schoolA, eventId: event.id, membershipId: teacherMembership });
    expect(mine.map((c) => c.classId)).toEqual([class11]);
    expect(await myClasses(prisma, { schoolId: schoolA, eventId: event.id, membershipId: adminMembership })).toEqual([]);
    const board = await getBoard(prisma, { schoolId: schoolA, eventId: event.id });
    expect(board.classes.map((c) => c.classId)).toEqual([class11, class12, class13]); // 작년 학급·다른 학교 제외
  });

  it("관리자라는 이유만으로는 보고 불가(생성·수정 모두 403), 관리자가 담임인 학급은 보고 가능", async () => {
    const event = await drill();
    await expect(report(event.id, class12, "key-adm-0001", { enrolledCount: 30 }, "admin")).rejects.toMatchObject({ status: 403, code: "class_not_assigned" });
    await report(event.id, class11, "key-adm-0002");
    await expect(report(event.id, class11, "key-adm-0003", { evacuated: 27, expectedVersion: 1 }, "admin")).rejects.toMatchObject({ status: 403 });
    await prisma.classAssignment.create({ data: { membershipId: adminMembership, classId: class12, duty: "homeroom" } });
    const { report: r } = await report(event.id, class12, "key-adm-0004", { enrolledCount: 30, evacuated: 30, absentKnown: 0 }, "admin");
    expect(r.version).toBe(1);
    expect(await prisma.evacuationReportRevision.count({ where: { report: { classId: class11 } } })).toBe(1);
  });

  it("미확인 인원은 서버가 계산하고, 보고자 이름과 버전이 돌아온다", async () => {
    const event = await drill();
    const { report: r } = await report(event.id, class11, "key-0000001");
    expect(r).toMatchObject({ enrolledCount: 28, evacuated: 26, absentKnown: 1, unconfirmed: 1, version: 1, reporterName: "담임" });
  });

  it("배정되지 않은 학급은 보고할 수 없다(403)", async () => {
    const event = await drill();
    await expect(report(event.id, class12, "key-0000002", { enrolledCount: 30 })).rejects.toMatchObject({ status: 403, code: "class_not_assigned" });
  });

  it("다른 학교 학급은 보고할 수 없다(404)", async () => {
    const event = await drill();
    await expect(report(event.id, classB11, "key-0000003", { enrolledCount: 25 }, "admin")).rejects.toMatchObject({ status: 404 });
  });

  it("같은 요청 번호로 다시 보내면 중복 저장 없이 같은 결과를 돌려준다(통신 재시도)", async () => {
    const event = await drill();
    const a = await report(event.id, class11, "key-retry-01");
    const b = await report(event.id, class11, "key-retry-01");
    expect(b.replayed).toBe(true);
    expect(b.report.version).toBe(a.report.version);
    expect(await prisma.evacuationReportRevision.count()).toBe(1);
  });

  it("다른 사람이 먼저 수정했으면 409 version_conflict와 최신 보고를 돌려준다", async () => {
    const event = await drill();
    await report(event.id, class11, "key-v1-0001");
    // Phase 1-3: 두 번째 보고자는 이 사건에 지정된 대리 담당(관리자 대리 보고는 없어짐)
    const deputyUser = (await prisma.user.create({ data: { email: "deputy@a.kr", displayName: "대리교사", emailVerifiedAt: new Date() } })).id;
    const deputyMembership = await approvedMember(schoolA, deputyUser, "staff");
    await assignDelegate(prisma, { schoolId: schoolA, eventId: event.id, classId: class11, actorUserId: adminUser, delegateMembershipId: deputyMembership, reason: "unable" });
    await submitReport(prisma, { schoolId: schoolA, eventId: event.id, classId: class11, actorUserId: deputyUser, membershipId: deputyMembership, idempotencyKey: "key-v2-0001", input: input({ evacuated: 27, expectedVersion: 1 }) });
    await expect(report(event.id, class11, "key-v2-0002", { evacuated: 25, expectedVersion: 1 })).rejects.toMatchObject({
      code: "version_conflict",
      details: { current: { version: 2, evacuated: 27 } },
    });
    const revisions = await prisma.evacuationReportRevision.findMany({ orderBy: { version: "asc" } });
    expect(revisions.map((r) => [r.version, r.changeReason])).toEqual([
      [1, null],
      [2, "대리 담당 보고"],
    ]);
  });

  it("합계가 재적을 넘으면 422, 부상자는 대피 인원과 독립적으로 재적 이하이면 된다", async () => {
    const event = await drill();
    await expect(report(event.id, class11, "key-sum-0001", { evacuated: 28, absentKnown: 1 })).rejects.toMatchObject({ status: 422, code: "sum_mismatch" });
    const { report: r } = await report(event.id, class11, "key-sum-0002", { evacuated: 10, injured: 15 });
    expect(r).toMatchObject({ injured: 15, unconfirmed: 17 });
  });

  it("재적을 바꾸면 사유가 필요하고, 첫 보고 시점 학급 재적이 기준으로 남는다", async () => {
    const event = await drill();
    await expect(report(event.id, class11, "key-enr-0001", { enrolledCount: 27, evacuated: 26, absentKnown: 0 })).rejects.toMatchObject({
      code: "enrolled_reason_required",
    });
    await report(event.id, class11, "key-enr-0002", { enrolledCount: 27, evacuated: 26, absentKnown: 0, enrolledChangeReason: "transfer_out" });
    const saved = await prisma.evacuationReport.findFirstOrThrow({ where: { classId: class11 } });
    expect(saved).toMatchObject({ enrolledSnapshot: 28, enrolledCount: 27, enrolledChangeReason: "transfer_out" });
  });

  it("재적 미확인 학급도 담임이 현장 인원으로 보고할 수 있다", async () => {
    const event = await drill();
    await prisma.classAssignment.create({ data: { membershipId: teacherMembership, classId: class13, duty: "homeroom" } });
    const { report: r } = await report(event.id, class13, "key-null-001", { enrolledCount: 22, evacuated: 22, absentKnown: 0 });
    expect(r.unconfirmed).toBe(0);
  });
});

describe("A3 상황판·종료", () => {
  it("상황판은 미보고 학급을 구분하고, 미보고 학생 수와 재적 미확인 학급 수를 따로 센다", async () => {
    const event = await drill();
    await report(event.id, class11, "key-board-01", { injured: 1 });
    const board = await getBoard(prisma, { schoolId: schoolA, eventId: event.id });
    expect(board.serverTime).toBeTruthy();
    expect(summarize(board.classes)).toMatchObject({
      totalClasses: 3,
      reportedClasses: 1,
      unreportedClasses: 2,
      evacuated: 26,
      unconfirmed: 1,
      injured: 1,
      pendingStudents: 30,
      unknownEnrolledClasses: 1,
    });
  });

  it("실제 상황 종료는 confirmClose가 필요하고, 종료 후에는 보고·유형 추가가 막히며 최종 집계가 감사 로그에 남는다", async () => {
    const event = await issueEvent(prisma, { schoolId: schoolA, actorUserId: adminUser, primaryType: "fire", mode: "real", confirmReal: true });
    await report(event.id, class11, "key-close-01");
    await expect(closeEvent(prisma, { schoolId: schoolA, eventId: event.id, actorUserId: adminUser })).rejects.toMatchObject({ code: "confirm_required" });
    const closed = await closeEvent(prisma, { schoolId: schoolA, eventId: event.id, actorUserId: adminUser, confirmClose: true });
    expect(closed.event.status).toBe("closed");
    expect(closed.summary).toMatchObject({ reportedClasses: 1, unconfirmed: 1 });
    expect(await getActiveEvent(prisma, schoolA)).toBeNull();
    await expect(report(event.id, class11, "key-close-02", { expectedVersion: 1 })).rejects.toMatchObject({ code: "event_closed" });
    await expect(addEventType(prisma, { schoolId: schoolA, eventId: event.id, actorUserId: adminUser, type: "other" })).rejects.toMatchObject({
      code: "event_closed",
    });
    const log = await prisma.auditLog.findFirstOrThrow({ where: { action: "event.closed", targetId: event.id } });
    expect(log.after).toMatchObject({ mode: "real", summary: { reportedClasses: 1 } });
    // 종료 후 새 상황 발령 가능(학교당 진행 중 1건 제약은 진행 중에만 적용)
    await expect(drill()).resolves.toBeTruthy();
  });

  it("훈련 종료는 확인 플래그 없이도 된다", async () => {
    const event = await drill();
    await expect(closeEvent(prisma, { schoolId: schoolA, eventId: event.id, actorUserId: adminUser })).resolves.toMatchObject({
      event: { status: "closed" },
    });
  });
});
