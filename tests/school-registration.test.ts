// 학교 등록·교직원 가입 시나리오 1~10 (서비스 계층, 테스트 전용 DB 스키마)
import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { createTestClient, resetTestData } from "./test-db.js";
import { FakeSchoolinfoClient, gradeClassRow } from "./fixtures/schoolinfo.js";
import { searchDirectory, syncDirectory } from "../server/src/services/schoolDirectory.js";
import { buildSourceUrl } from "../server/src/integrations/schoolinfo.js";
import { applyForSchoolRegistration, reviewSchoolRegistration } from "../server/src/services/schoolRegistration.js";
import { decideMemberships, requestToJoinSchool, resolveSchoolAccess, revokeMembership, setAssignments } from "../server/src/services/membership.js";
import { applyClassStructure, confirmEnrollment, getClassStructureProposal, refreshGradeClassData } from "../server/src/services/publicData.js";

const prisma = createTestClient();
let client: FakeSchoolinfoClient;
let userA = "";
let userB = "";
const YEAR = 2026;

async function verifiedUser(email: string, name: string) {
  return (await prisma.user.create({ data: { email, displayName: name, emailVerifiedAt: new Date() } })).id;
}

async function registerAndApprove() {
  await searchDirectory(prisma, client, { q: "안전초", kindCode: "02" });
  const reg = await applyForSchoolRegistration(prisma, { userId: userA, externalCode: "S000000001", applicantPosition: "교감" });
  await reviewSchoolRegistration(prisma, { registrationId: reg.registration.id, decision: "approve", reviewer: "운영자", verificationMethod: "공문 확인" });
  return reg.school.id;
}

beforeEach(async () => {
  process.env.SCHOOLINFO_GRADE_DATA = "enabled"; // 학년별 공시자료 테스트용(운영 기본값은 꺼짐)
  await resetTestData(prisma);
  client = new FakeSchoolinfoClient();
  userA = await verifiedUser("a@school.kr", "교직원A");
  userB = await verifiedUser("b@school.kr", "교직원B");
});

afterAll(async () => {
  await prisma.$disconnect();
});

describe("최초 학교 등록", () => {
  it("1·2) 학교를 검색해 등록 신청하면 학교알리미 기본정보가 자동으로 채워진다", async () => {
    const search = await searchDirectory(prisma, client, { q: "안 전", kindCode: "02" }); // 공백은 무시
    expect(search.stale).toBe(false);
    expect(search.results.map((r) => r.name)).toEqual(["안전중앙초등학교", "안전초등학교"]); // 폐교 제외
    expect(search.results.every((r) => r.registeredSchool === null)).toBe(true);

    const { school, registration, membership } = await applyForSchoolRegistration(prisma, {
      userId: userA,
      externalCode: "S000000001",
      applicantPosition: "교감",
    });
    expect(school).toMatchObject({ name: "안전초등학교", address: "가상시 안전로 1", eduOfficeName: "가상교육청", infoSource: "schoolinfo" });
    expect(registration.status).toBe("pending_verification");
    expect(membership).toMatchObject({ role: "admin", status: "pending" });
    const basic = await prisma.schoolPublicDataSnapshot.findFirst({ where: { schoolId: school.id, dataset: "basic_info" } });
    expect(basic?.sourceUrl).toContain("schoolinfo.go.kr");
  });

  it("3) 관리자 자격 확인 전에는 첫 신청자도 학교 관리 권한이 없다", async () => {
    await searchDirectory(prisma, client, { q: "안전초", kindCode: "02" });
    const { school } = await applyForSchoolRegistration(prisma, { userId: userA, externalCode: "S000000001" });
    expect(school.status).toBe("pending_verification");
    await expect(resolveSchoolAccess(prisma, { userId: userA, schoolId: school.id, roles: ["admin"] })).rejects.toMatchObject({
      code: "membership_pending",
    });
  });

  it("확인 방법 없이 승인할 수 없다", async () => {
    await searchDirectory(prisma, client, { q: "안전초", kindCode: "02" });
    const { registration } = await applyForSchoolRegistration(prisma, { userId: userA, externalCode: "S000000001" });
    await expect(reviewSchoolRegistration(prisma, { registrationId: registration.id, decision: "approve", reviewer: "운영자" })).rejects.toMatchObject({
      code: "bad_request",
    });
  });

  it("4) 운영자 승인 후 학교 공간이 활성화되고 신청자가 관리자가 된다", async () => {
    const schoolId = await registerAndApprove();
    const school = await prisma.school.findUniqueOrThrow({ where: { id: schoolId } });
    expect(school.status).toBe("active");
    expect(school.activatedAt).not.toBeNull();
    const access = await resolveSchoolAccess(prisma, { userId: userA, schoolId, roles: ["admin"] });
    expect(access.role).toBe("admin");
  });

  it("이메일 미인증 사용자는 등록 신청할 수 없다", async () => {
    const unverified = (await prisma.user.create({ data: { email: "c@school.kr", displayName: "C" } })).id;
    await searchDirectory(prisma, client, { q: "안전초", kindCode: "02" });
    await expect(applyForSchoolRegistration(prisma, { userId: unverified, externalCode: "S000000001" })).rejects.toMatchObject({ code: "forbidden" });
  });
});

describe("후속 교직원 가입", () => {
  it("5·6) 같은 학교를 다시 등록하면 거부되고, 기존 학교에 가입 신청으로 연결된다", async () => {
    const schoolId = await registerAndApprove();
    const search = await searchDirectory(prisma, client, { q: "안전초", kindCode: "02" });
    expect(search.results.find((r) => r.externalCode === "S000000001")?.registeredSchool?.id).toBe(schoolId);

    await expect(applyForSchoolRegistration(prisma, { userId: userB, externalCode: "S000000001" })).rejects.toMatchObject({
      code: "school_already_registered",
      details: { schoolId },
    });
    const { membership } = await requestToJoinSchool(prisma, { userId: userB, schoolId, requestedRole: "homeroom" });
    expect(membership.status).toBe("pending");
    expect(await prisma.school.count()).toBe(1); // 학교가 새로 생기지 않음
  });

  it("7) 관리자 승인 전에는 학교 업무 데이터에 접근할 수 없고, 다른 학교 사용자는 존재도 알 수 없다", async () => {
    const schoolId = await registerAndApprove();
    await requestToJoinSchool(prisma, { userId: userB, schoolId, requestedRole: "homeroom" });
    await expect(resolveSchoolAccess(prisma, { userId: userB, schoolId })).rejects.toMatchObject({ code: "membership_pending" });
    const stranger = await verifiedUser("x@other.kr", "외부인");
    await expect(resolveSchoolAccess(prisma, { userId: stranger, schoolId })).rejects.toMatchObject({ code: "not_found" });
  });

  it("8) 관리자가 일괄 승인하고 학급·업무를 배정한다", async () => {
    const schoolId = await registerAndApprove();
    const { membership } = await requestToJoinSchool(prisma, { userId: userB, schoolId, requestedRole: "homeroom" });
    const result = await decideMemberships(prisma, { schoolId, actorUserId: userA, membershipIds: [membership.id], decision: "approve" });
    expect(result).toEqual({ processed: 1, skipped: 0 });

    await applyClassStructure(prisma, { schoolId, actorUserId: userA, schoolYear: YEAR, grades: [{ grade: 1, classCount: 3 }] });
    const cls = await prisma.schoolClass.findFirstOrThrow({ where: { schoolId, grade: 1, classNo: 2 } });
    await setAssignments(prisma, { schoolId, actorUserId: userA, membershipId: membership.id, assignments: [{ classId: cls.id, duty: "homeroom" }] });

    const access = await resolveSchoolAccess(prisma, { userId: userB, schoolId });
    expect(access.status).toBe("approved");
    expect(await prisma.classAssignment.count({ where: { membershipId: membership.id } })).toBe(1);
    // 담임은 관리자 기능에 접근 불가
    await expect(resolveSchoolAccess(prisma, { userId: userB, schoolId, roles: ["admin"] })).rejects.toMatchObject({ code: "forbidden" });
  });

  it("권한을 회수하면 그 사용자의 세션이 즉시 삭제된다", async () => {
    const schoolId = await registerAndApprove();
    const { membership } = await requestToJoinSchool(prisma, { userId: userB, schoolId, requestedRole: "staff" });
    await decideMemberships(prisma, { schoolId, actorUserId: userA, membershipIds: [membership.id], decision: "approve" });
    await prisma.session.create({ data: { id: "sess-b", userId: userB, deviceKind: "personal", expiresAt: new Date(Date.now() + 3600_000) } });
    const result = await revokeMembership(prisma, { schoolId, actorUserId: userA, membershipId: membership.id });
    expect(result.sessionsInvalidated).toBe(1);
    await expect(resolveSchoolAccess(prisma, { userId: userB, schoolId })).rejects.toMatchObject({ code: "membership_inactive" });
  });
});

describe("공시자료와 실제 학급 데이터", () => {
  it("학년별 공시자료 연동은 기본적으로 꺼져 있고, 꺼져 있으면 호출하지 않는다", async () => {
    const schoolId = await registerAndApprove();
    delete process.env.SCHOOLINFO_GRADE_DATA;
    client.calls = [];
    const result = await refreshGradeClassData(prisma, client, { schoolId });
    expect(result.stale).toBe(true);
    expect(result.warning).toContain("SCHOOLINFO_GRADE_DATA");
    expect(client.calls.filter((c) => c.apiType === "09")).toHaveLength(0);
  });

  it("기대 필드가 없는 응답은 저장하지 않고 기존 목록을 지킨다", async () => {
    await searchDirectory(prisma, client, { q: "안전초", kindCode: "02" });
    const before = await prisma.schoolDirectoryEntry.count();
    const broken = new FakeSchoolinfoClient();
    broken.fetch = async (query) => ({ rows: [{ CODE: "X", NAME: "형식바뀜학교" }], sourceUrl: buildSourceUrl(query) });
    await expect(syncDirectory(prisma, broken, { kindCode: "02" })).rejects.toMatchObject({ kind: "format" });
    expect(await prisma.schoolDirectoryEntry.count()).toBe(before);
  });

  it("공시자료로 학급 구조만 만들고, 재적은 관리자가 확인할 때까지 비워 둔다(학년 합계를 나누지 않음)", async () => {
    const schoolId = await registerAndApprove();
    await refreshGradeClassData(prisma, client, { schoolId });
    const proposal = await getClassStructureProposal(prisma, schoolId, YEAR);
    expect(proposal.grades[0]).toMatchObject({ grade: 1, publicClassCount: 3, publicStudentCount: 75, existingClassCount: 0 });

    await applyClassStructure(prisma, {
      schoolId,
      actorUserId: userA,
      schoolYear: YEAR,
      grades: proposal.grades.map((g) => ({ grade: g.grade, classCount: g.publicClassCount ?? 0 })),
    });
    const classes = await prisma.schoolClass.findMany({ where: { schoolId, schoolYear: YEAR } });
    expect(classes).toHaveLength(8);
    expect(classes.every((c) => c.enrolledCount === null && c.enrolledConfirmedAt === null && c.origin === "schoolinfo")).toBe(true);
  });

  it("9) 공시자료가 바뀌어도 관리자가 확인한 학급 재적은 그대로다", async () => {
    const schoolId = await registerAndApprove();
    await refreshGradeClassData(prisma, client, { schoolId });
    await applyClassStructure(prisma, { schoolId, actorUserId: userA, schoolYear: YEAR, grades: [{ grade: 1, classCount: 3 }] });
    const c11 = await prisma.schoolClass.findFirstOrThrow({ where: { schoolId, grade: 1, classNo: 1 } });
    await confirmEnrollment(prisma, { schoolId, actorUserId: userA, items: [{ classId: c11.id, enrolledCount: 26 }] });

    // 공시자료 변경: 1학년 4학급·99명
    client.gradeRow = gradeClassRow({ COL_C1: "4", COL_S1: "99" });
    const refreshed = await refreshGradeClassData(prisma, client, { schoolId });
    expect(refreshed.changed).toBe(true);
    expect(await prisma.schoolPublicDataSnapshot.count({ where: { schoolId, dataset: "grade_class_students" } })).toBe(2);

    const after = await prisma.schoolClass.findUniqueOrThrow({ where: { id: c11.id } });
    expect(after.enrolledCount).toBe(26);
    expect(after.enrolledConfirmedAt).not.toBeNull();
    expect(await prisma.schoolClass.count({ where: { schoolId, grade: 1 } })).toBe(3); // 자동으로 늘지 않음

    // 관리자가 구조 적용을 다시 해도 기존 학급은 그대로, 없는 4반만 추가
    const applied = await applyClassStructure(prisma, { schoolId, actorUserId: userA, schoolYear: YEAR, grades: [{ grade: 1, classCount: 4 }] });
    expect(applied.created).toBe(1);
    expect((await prisma.schoolClass.findUniqueOrThrow({ where: { id: c11.id } })).enrolledCount).toBe(26);
  });

  it("같은 공시자료를 다시 받아도 스냅숏이 중복 저장되지 않는다", async () => {
    const schoolId = await registerAndApprove();
    await refreshGradeClassData(prisma, client, { schoolId });
    const again = await refreshGradeClassData(prisma, client, { schoolId });
    expect(again.changed).toBe(false);
    expect(await prisma.schoolPublicDataSnapshot.count({ where: { schoolId, dataset: "grade_class_students" } })).toBe(1);
  });

  it("10) 학교알리미 장애 시 저장된 목록과 스냅숏으로 계속 동작한다", async () => {
    const schoolId = await registerAndApprove();
    await refreshGradeClassData(prisma, client, { schoolId });

    client.failing = true;
    // 검색: 목록을 오래된 것으로 만든 뒤 장애 상황에서 검색
    await prisma.schoolDirectoryEntry.updateMany({ data: { syncedAt: new Date("2020-01-01") } });
    const search = await searchDirectory(prisma, client, { q: "안전초", kindCode: "02" });
    expect(search.stale).toBe(true);
    expect(search.warning).toContain("저장된 목록");
    expect(search.results.length).toBeGreaterThan(0);

    // 공시자료: 마지막 스냅숏 반환
    const refreshed = await refreshGradeClassData(prisma, client, { schoolId });
    expect(refreshed.stale).toBe(true);
    expect(refreshed.snapshot).not.toBeNull();

    // 인증키 미설정(client=null)도 같은 방식
    const noClient = await searchDirectory(prisma, null, { q: "안전초", kindCode: "02" });
    expect(noClient.results.length).toBeGreaterThan(0);
  });
});
