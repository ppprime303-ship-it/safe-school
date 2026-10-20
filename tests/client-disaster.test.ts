// 화면의 상태 계산 규칙 테스트(미보고를 완료로 표시하지 않는지 등)
import { describe, expect, it } from "vitest";
import { computeUnconfirmed, deriveClassStatus, summarizeBoard, validateReport, type ClassReportView } from "../client/src/lib/disaster";
import { formatElapsed } from "../client/src/lib/format";

const report = (o: Partial<NonNullable<ClassReportView["report"]>> = {}) => ({
  enrolledCount: 28, absentKnown: 0, evacuated: 28, unconfirmed: 0, injured: 0, note: null, version: 1, reportedAt: "2026-10-20T00:00:00Z", reporterName: null, ...o,
});
const view = (id: string, r: ClassReportView["report"], enrolled: number | null = 28): ClassReportView => ({ classId: id, grade: 1, classNo: 1, label: id, enrolledCount: enrolled, report: r });

describe("학급 상태", () => {
  it("보고가 없으면 항상 미보고(완료로 표시하지 않음)", () => {
    expect(deriveClassStatus(view("a", null))).toBe("unreported");
  });
  it("미확인이 있으면 부상보다 먼저 표시", () => {
    expect(deriveClassStatus(view("a", report({ evacuated: 26, unconfirmed: 2, injured: 1 })))).toBe("unconfirmed");
    expect(deriveClassStatus(view("a", report({ injured: 1 })))).toBe("injured");
    expect(deriveClassStatus(view("a", report()))).toBe("reported");
  });
});

describe("상황판 집계", () => {
  it("미보고 학급 인원은 대피·미확인에 넣지 않고 '보고 대기'로 따로 센다", () => {
    const s = summarizeBoard([
      view("a", report({ evacuated: 25, absentKnown: 1, unconfirmed: 2, injured: 3 })),
      view("b", null, 30),
      view("c", null, null),
    ]);
    expect(s).toMatchObject({
      totalClasses: 3,
      reportedClasses: 1,
      unreportedClasses: 2,
      evacuated: 25,
      unconfirmed: 2,
      injured: 3,
      absentKnown: 1,
      pendingStudents: 30,
      enrolledTotal: 58,
      enrolledUnknownClasses: 1,
      classesWithUnconfirmed: 1,
      classesWithInjured: 1,
    });
    expect(s.reportProgress).toBe(33);
  });
  it("학급이 없으면 0으로 나누지 않는다", () => {
    expect(summarizeBoard([]).reportProgress).toBe(0);
  });
});

describe("보고 입력", () => {
  it("미확인 자동 계산", () => {
    expect(computeUnconfirmed(28, 25, 1)).toBe(2);
  });
  it("합계 초과·음수·재적 초과 부상을 막는다", () => {
    expect(validateReport({ enrolledCount: 28, evacuated: 28, absentKnown: 1, injured: 0 })).not.toBeNull();
    expect(validateReport({ enrolledCount: 28, evacuated: -1, absentKnown: 0, injured: 0 })).not.toBeNull();
    expect(validateReport({ enrolledCount: 28, evacuated: 1, absentKnown: 0, injured: 29 })).not.toBeNull();
    expect(validateReport({ enrolledCount: 28, evacuated: 1, absentKnown: 1, injured: 5 })).toBeNull(); // 부상자 > 대피 허용
  });
});

describe("경과 시간", () => {
  it("분·초, 시간·분", () => {
    const now = new Date("2026-10-20T10:00:00Z");
    expect(formatElapsed("2026-10-20T09:47:30Z", now)).toBe("12분 30초");
    expect(formatElapsed("2026-10-20T08:55:00Z", now)).toBe("1시간 5분");
  });
});
