// STEP 1 DB 무결성 테스트: 잘못된 데이터가 DB 단계에서 확실히 거부되는지 확인합니다.
// (화면이나 API에 버그가 있어도 DB가 마지막 방어선이 됩니다.)
import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { createTestClient, resetTestData } from "./test-db.js";

const prisma = createTestClient();

let schoolA = "";
let schoolB = "";
let classA11 = "";
let adminUser = "";

beforeEach(async () => {
  await resetTestData(prisma);
  schoolA = (await prisma.school.create({ data: { name: "A학교", slug: "school-a" } })).id;
  schoolB = (await prisma.school.create({ data: { name: "B학교", slug: "school-b" } })).id;
  classA11 = (
    await prisma.schoolClass.create({
      data: { schoolId: schoolA, schoolYear: 2026, grade: 1, classNo: 1, label: "1학년 1반", enrolledCount: 28 },
    })
  ).id;
  adminUser = (await prisma.user.create({ data: { email: "admin@a.kr", displayName: "관리자" } })).id;
});

afterAll(async () => {
  await prisma.$disconnect();
});

async function newEvent(schoolId: string, mode: "real" | "drill" = "drill") {
  return prisma.disasterEvent.create({ data: { schoolId, primaryType: "earthquake", mode } });
}

describe("학교·학급", () => {
  it("이메일은 소문자로만 저장된다", async () => {
    await expect(prisma.user.create({ data: { email: "Teacher@A.kr", displayName: "x" } })).rejects.toThrow();
  });

  it("학급 재적은 0~60명만 허용한다", async () => {
    await expect(
      prisma.schoolClass.create({ data: { schoolId: schoolA, schoolYear: 2026, grade: 1, classNo: 2, label: "1-2", enrolledCount: 61 } }),
    ).rejects.toThrow();
  });

  it("같은 학교의 같은 학년·반은 중복될 수 없지만, 다른 학교는 가능하다", async () => {
    await expect(
      prisma.schoolClass.create({ data: { schoolId: schoolA, schoolYear: 2026, grade: 1, classNo: 1, label: "1-1", enrolledCount: 20 } }),
    ).rejects.toThrow();
    await expect(
      prisma.schoolClass.create({ data: { schoolId: schoolB, schoolYear: 2026, grade: 1, classNo: 1, label: "1-1", enrolledCount: 20 } }),
    ).resolves.toBeTruthy();
  });

  it("승인 상태에는 승인 방식(명단·개별·최초)과 승인 시각이 필요하다", async () => {
    await expect(
      prisma.schoolMembership.create({ data: { schoolId: schoolA, userId: adminUser, role: "admin", status: "approved" } }),
    ).rejects.toThrow();
    await expect(
      prisma.schoolMembership.create({
        data: { schoolId: schoolA, userId: adminUser, role: "admin", status: "approved", approvalMethod: "roster", approvedAt: new Date() },
      }),
    ).resolves.toBeTruthy();
  });
});

describe("재난 발령·복합재난", () => {
  it("한 학교에 진행 중인 상황은 1건만 가능하다(중복 발령 방지)", async () => {
    await newEvent(schoolA);
    await expect(newEvent(schoolA, "real")).rejects.toThrow();
  });

  it("다른 학교는 동시에 발령할 수 있다", async () => {
    await newEvent(schoolA);
    await expect(newEvent(schoolB)).resolves.toBeTruthy();
  });

  it("종료하면 새로 발령할 수 있다", async () => {
    const ev = await newEvent(schoolA);
    await prisma.disasterEvent.update({ where: { id: ev.id }, data: { status: "closed", closedAt: new Date() } });
    await expect(newEvent(schoolA, "real")).resolves.toBeTruthy();
  });

  it("종료 상태에는 종료 시각이 있어야 한다", async () => {
    const ev = await newEvent(schoolA);
    await expect(prisma.disasterEvent.update({ where: { id: ev.id }, data: { status: "closed" } })).rejects.toThrow();
  });

  it("진행 중 상황에 다른 재난 유형을 추가할 수 있고, 같은 유형은 한 번만 기록된다", async () => {
    const ev = await newEvent(schoolA);
    await prisma.disasterEventType.create({ data: { eventId: ev.id, type: "earthquake" } });
    await expect(prisma.disasterEventType.create({ data: { eventId: ev.id, type: "fire" } })).resolves.toBeTruthy();
    await expect(prisma.disasterEventType.create({ data: { eventId: ev.id, type: "fire" } })).rejects.toThrow();
  });
});

describe("학급 대피 보고", () => {
  async function report(data: Partial<{ enrolledCount: number; enrolledChangeReason: "transfer_out" | "transfer_in" | "other"; absentKnown: number; evacuated: number; unconfirmed: number; injured: number }>, eventId?: string) {
    const ev = eventId ?? (await newEvent(schoolA)).id;
    return prisma.evacuationReport.create({
      data: {
        eventId: ev,
        schoolId: schoolA,
        classId: classA11,
        enrolledSnapshot: 28,
        enrolledCount: data.enrolledCount ?? 28,
        enrolledChangeReason: data.enrolledChangeReason,
        absentKnown: data.absentKnown ?? 0,
        evacuated: data.evacuated ?? 28,
        unconfirmed: data.unconfirmed ?? 0,
        injured: data.injured ?? 0,
      },
    });
  }

  it("대피 확인 + 사전 파악 부재 + 미확인 = 보고 재적이어야 한다", async () => {
    await expect(report({ evacuated: 25, unconfirmed: 2 })).rejects.toThrow(); // 27 ≠ 28
    await expect(report({ evacuated: 25, absentKnown: 1, unconfirmed: 2 })).resolves.toBeTruthy();
  });

  it("음수는 저장되지 않는다", async () => {
    await expect(report({ evacuated: 30, unconfirmed: -2 })).rejects.toThrow();
  });

  it("부상자는 대피 확인 인원보다 많을 수 있다(대피 여부와 별도 관리)", async () => {
    await expect(report({ evacuated: 1, absentKnown: 1, unconfirmed: 26, injured: 3 })).resolves.toBeTruthy();
  });

  it("부상자는 보고 재적을 넘을 수 없다", async () => {
    await expect(report({ injured: 29 })).rejects.toThrow();
  });

  it("재적을 바꾸면 사유가 필요하다", async () => {
    await expect(report({ enrolledCount: 27, evacuated: 27 })).rejects.toThrow();
    await expect(report({ enrolledCount: 27, evacuated: 27, enrolledChangeReason: "transfer_out" })).resolves.toBeTruthy();
  });

  it("같은 상황·같은 학급의 보고는 한 건만 존재한다(수정은 버전으로)", async () => {
    const ev = await newEvent(schoolA);
    await report({}, ev.id);
    await expect(report({}, ev.id)).rejects.toThrow();
  });

  it("같은 요청(멱등키)은 이력에 두 번 저장되지 않는다", async () => {
    const r = await report({});
    const base = { reportId: r.id, enrolledCount: 28, absentKnown: 0, evacuated: 28, unconfirmed: 0, injured: 0, idempotencyKey: "req-1" };
    await prisma.evacuationReportRevision.create({ data: { ...base, version: 1 } });
    await expect(prisma.evacuationReportRevision.create({ data: { ...base, version: 2 } })).rejects.toThrow();
  });
});

describe("감사 로그", () => {
  it("추가는 되지만 수정·삭제는 거부된다", async () => {
    const log = await prisma.auditLog.create({ data: { schoolId: schoolA, action: "test.create" } });
    await expect(prisma.auditLog.update({ where: { id: log.id }, data: { action: "changed" } })).rejects.toThrow();
    await expect(prisma.auditLog.delete({ where: { id: log.id } })).rejects.toThrow();
  });
});

describe("세션", () => {
  it("권한 회수 시 사용자 세션을 한 번에 삭제할 수 있다", async () => {
    const future = new Date(Date.now() + 3600_000);
    await prisma.session.createMany({
      data: [
        { id: "s1", userId: adminUser, deviceKind: "personal", expiresAt: future },
        { id: "s2", userId: adminUser, deviceKind: "shared", expiresAt: future, idleExpiresAt: future },
      ],
    });
    const { count } = await prisma.session.deleteMany({ where: { userId: adminUser } });
    expect(count).toBe(2);
    expect(await prisma.session.count({ where: { userId: adminUser } })).toBe(0);
  });
});
