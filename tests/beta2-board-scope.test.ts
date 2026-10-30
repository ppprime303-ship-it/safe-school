// Beta PILOT 2 Phase 1-1: 상황판 열람 권한과 보고 권한 분리(DB 없이 실행되는 순수 함수 테스트)
// - 승인된 교직원은 역할·업무와 관계없이 상황판 요약(board.view)
// - 상세(board.detail: 메모·보고자·부상·대리 담당)는 관리자·교장·교감·안전업무 담당만
// - 요약 응답(restrictBoard)은 서버에서 민감 항목을 아예 빼고 보냄
import { describe, expect, it } from "vitest";
import { capabilitiesFor, type MemberRole, type StaffDuty } from "../shared/permissions";
import { restrictBoard, summarize } from "../server/src/services/events";

const ROLES: MemberRole[] = ["admin", "homeroom", "staff"];
const DUTIES: StaffDuty[] = ["principal", "vice_principal", "safety_officer", "app_operator"];

describe("권한 계산: 상황판 요약은 모두, 상세는 발령·안전 담당만", () => {
  it.each(ROLES)("%s 역할(업무 없음)도 board.view", (role) => {
    expect(capabilitiesFor(role, [])).toContain("board.view");
  });

  it("업무 없는 담임·교직원: 요약만, 상세·발령·종료 없음", () => {
    for (const role of ["homeroom", "staff"] as const) {
      const caps = capabilitiesFor(role, []);
      expect(caps).toEqual(["board.view"]);
    }
  });

  it("앱 운영담당만으로는 상세 없음", () => {
    expect(capabilitiesFor("staff", ["app_operator"])).not.toContain("board.detail");
    expect(capabilitiesFor("homeroom", ["app_operator"])).not.toContain("board.detail");
  });

  it("관리자·교장·교감·안전업무 담당은 상세", () => {
    expect(capabilitiesFor("admin", [])).toContain("board.detail");
    for (const d of ["principal", "vice_principal", "safety_officer"] as const) expect(capabilitiesFor("staff", [d])).toContain("board.detail");
  });

  it("상세 권한이 있으면 항상 요약 권한도 있음", () => {
    for (const role of ROLES)
      for (const d of [[], ...DUTIES.map((x) => [x])] as StaffDuty[][]) {
        const caps = capabilitiesFor(role, d);
        if (caps.includes("board.detail")) expect(caps).toContain("board.view");
      }
  });
});

const board = {
  event: { id: "e1", mode: "drill" as const, status: "active" as const, types: ["fire" as const], location: "본관 1층", evacPlace: "운동장", message: null, startedAt: "2026-10-30T01:00:00.000Z", closedAt: null },
  serverTime: "2026-10-30T01:05:00.000Z",
  classes: [
    {
      classId: "c1",
      grade: 1,
      classNo: 1,
      label: "1학년 1반",
      enrolledCount: 25,
      report: { enrolledCount: 25, absentKnown: 1, evacuated: 22, unconfirmed: 2, injured: 1, note: "홍길동 조퇴, 김OO 화장실", version: 2, reportedAt: "2026-10-30T01:03:00.000Z", reporterName: "담임 교사" },
      delegation: { id: "d1", classId: "c1", reason: "unreachable" as const, basis: "연락 안 됨", assignedAt: new Date(), delegateMembershipId: "m9", delegateName: "대리 교사" },
    },
    { classId: "c2", grade: 1, classNo: 2, label: "1학년 2반", enrolledCount: 24, report: null, delegation: null },
  ],
};

describe("restrictBoard: 요약 응답에서 민감 항목 제거", () => {
  const r = restrictBoard(board);
  const json = JSON.stringify(r);

  it("scope 는 summary", () => expect(r.scope).toBe("summary"));

  it("메모·보고자·부상 인원·대리 담당 정보가 응답에 없음", () => {
    expect(json).not.toContain("홍길동");
    expect(json).not.toContain("담임 교사");
    expect(json).not.toContain("대리 교사");
    expect(json).not.toContain("연락 안 됨");
    expect(json).not.toContain("delegat");
    const c1 = r.classes[0]!;
    expect(c1.report).toMatchObject({ injured: null, note: null, reporterName: null });
    expect(r.summary).not.toHaveProperty("injured");
  });

  it("공개 항목(보고 여부·재적·대피·사전 부재·미확인·보고 시각)은 그대로", () => {
    expect(r.classes[0]!.report).toMatchObject({ enrolledCount: 25, absentKnown: 1, evacuated: 22, unconfirmed: 2, reportedAt: "2026-10-30T01:03:00.000Z" });
    expect(r.classes[1]!.report).toBeNull();
    expect(r.event).toEqual(board.event);
    const { injured: _i, ...expected } = summarize(board.classes);
    expect(r.summary).toEqual(expected);
    expect(r.summary).toMatchObject({ totalClasses: 2, reportedClasses: 1, unreportedClasses: 1, evacuated: 22, unconfirmed: 2, pendingStudents: 24 });
  });

  it("원본 상황판 객체는 바꾸지 않음(상세 응답과 섞이지 않음)", () => {
    expect(board.classes[0]!.report!.note).toBe("홍길동 조퇴, 김OO 화장실");
    expect(board.classes[0]!.delegation).not.toBeNull();
  });
});
