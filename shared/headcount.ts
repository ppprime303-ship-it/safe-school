// 2026-10-28 v0.1 특수학급 등 '원 소속 학급 ≠ 현재 수업 그룹' 학생의 중복 집계 방지 — 검증용 순수 함수(화면·서버 공통)
//
// 왜 필요한가
// - 특수교육대상학생은 원반(예: 3학년 2반)에 소속된 채 특수학급 수업에 참여합니다. 원반 보고와 특수학급 보고를 그냥 더하면
//   같은 학생이 2명으로 계산될 수 있습니다.
//
// v0.1 의 한계(사실대로)
// - 지금 보고는 학급별 '숫자'만 있습니다(학생 명단 없음). 숫자만으로는 같은 학생인지 알 수 없으므로 정확한 중복 제거가 불가능합니다.
//   → 이 파일의 (1) 가상 학생 ID 기반 계산은 Beta 자료 구조를 미리 검증하는 용도이고, 실제 보고 화면에는 아직 연결하지 않았습니다.
//   → (2) 숫자 기반 교차 확인은 '원반이 보낸다고 한 인원'과 '이동 그룹이 받았다고 한 인원'이 맞는지만 봅니다(같은 학생인지는 모름).
//
// 원칙
// - 학생 한 명은 학교 전체에서 한 번만 계산합니다.
// - 재난 시점에 그 학생을 '현재 인솔 책임'이 있는 그룹(교사)이 보고한 상태만 씁니다(현재 인솔 책임 우선).
// - 책임 그룹이 확인하지 않은 학생은 다른 교사 인원에 임의로 넣지 않고 '미확인'으로 둡니다.
// - 책임이 바뀌면(대리 인솔 등) 그 이력을 남기고, 바뀐 뒤의 그룹 보고를 씁니다.

export type StudentStatus = "evacuated" | "injured" | "absent_known" | "unconfirmed";

/** 가상 학생(시험용 ID만, 이름·학번 없음) */
export interface VirtualStudent {
  id: string;
  homeClassId: string;
}
/** 재난 시점 현재 수업·활동 그룹(시간표 기준). 없으면 원반 */
export interface Placement {
  studentId: string;
  groupId: string;
}
/** 인솔 책임 이전 이력(예: 특수교사 부재 → 원반 담임이 데려감). 시각 순서대로 적용 */
export interface ResponsibilityTransfer {
  studentId: string;
  fromGroupId: string;
  toGroupId: string;
  at: string;
  by: string;
}
/** 그룹(원반·특수학급·활동반)의 보고: 그 그룹이 확인한 학생과 상태 */
export interface GroupReport {
  groupId: string;
  entries: { studentId: string; status: StudentStatus }[];
}

export type TallyFlag = "duplicate_report" | "reported_outside_responsibility" | "not_reported_by_responsible";

export interface TallyResult {
  /** 학교 전체 학생 수(한 번씩만) */
  total: number;
  byStatus: Record<StudentStatus, number>;
  perStudent: Record<string, { status: StudentStatus; responsibleGroupId: string; flags: TallyFlag[] }>;
  /** 단순 합산했다면 나왔을 인원(중복 위험을 보여 주기 위한 값) */
  naiveSum: number;
}

export function tallyByVirtualStudents(input: {
  students: VirtualStudent[];
  placements: Placement[];
  transfers?: ResponsibilityTransfer[];
  reports: GroupReport[];
}): TallyResult {
  const responsible = new Map<string, string>();
  for (const s of input.students) responsible.set(s.id, s.homeClassId);
  for (const p of input.placements) if (responsible.has(p.studentId)) responsible.set(p.studentId, p.groupId);
  for (const t of [...(input.transfers ?? [])].sort((a, b) => a.at.localeCompare(b.at))) {
    // 이전 기록의 출발 그룹이 현재 책임 그룹과 같을 때만 적용(엉뚱한 이전은 무시)
    if (responsible.get(t.studentId) === t.fromGroupId) responsible.set(t.studentId, t.toGroupId);
  }

  const seen = new Map<string, { groupId: string; status: StudentStatus }[]>();
  let naiveSum = 0;
  for (const r of input.reports) {
    for (const e of r.entries) {
      naiveSum++;
      seen.set(e.studentId, [...(seen.get(e.studentId) ?? []), { groupId: r.groupId, status: e.status }]);
    }
  }

  const byStatus: Record<StudentStatus, number> = { evacuated: 0, injured: 0, absent_known: 0, unconfirmed: 0 };
  const perStudent: TallyResult["perStudent"] = {};
  for (const s of input.students) {
    const group = responsible.get(s.id)!;
    const reportsOf = seen.get(s.id) ?? [];
    const flags: TallyFlag[] = [];
    if (reportsOf.length > 1) flags.push("duplicate_report");
    if (reportsOf.some((r) => r.groupId !== group)) flags.push("reported_outside_responsibility");
    const own = reportsOf.find((r) => r.groupId === group);
    if (!own) flags.push("not_reported_by_responsible");
    const status: StudentStatus = own ? own.status : "unconfirmed";
    byStatus[status]++;
    perStudent[s.id] = { status, responsibleGroupId: group, flags };
  }
  return { total: input.students.length, byStatus, perStudent, naiveSum };
}

/** v0.1 숫자 보고용 교차 확인: 원반이 '다른 그룹 인솔 중'이라고 한 인원과 이동 그룹이 '원반별로 받았다'고 한 인원이 맞는지 */
export interface CountReport {
  groupId: string;
  /** 이 그룹 교사가 지금 직접 데리고 있는 인원(다른 그룹에 간 학생 제외) */
  presentWithMe: number;
  /** 원반 → 다른 그룹으로 가 있는 인원(그룹별) */
  awayTo?: { groupId: string; count: number }[];
  /** 이동 그룹이 받은 인원(원반별) */
  receivedFrom?: { homeClassId: string; count: number }[];
}

export function crossCheckCounts(reports: CountReport[]) {
  const mismatches: { homeClassId: string; groupId: string; homeSays: number; groupSays: number }[] = [];
  const byId = new Map(reports.map((r) => [r.groupId, r]));
  for (const home of reports) {
    for (const a of home.awayTo ?? []) {
      const g = byId.get(a.groupId);
      const groupSays = g?.receivedFrom?.find((x) => x.homeClassId === home.groupId)?.count ?? 0;
      if (groupSays !== a.count) mismatches.push({ homeClassId: home.groupId, groupId: a.groupId, homeSays: a.count, groupSays });
    }
  }
  for (const g of reports) {
    for (const rcv of g.receivedFrom ?? []) {
      const home = byId.get(rcv.homeClassId);
      const homeSays = home?.awayTo?.find((x) => x.groupId === g.groupId)?.count ?? 0;
      if (homeSays === 0 && rcv.count > 0) mismatches.push({ homeClassId: rcv.homeClassId, groupId: g.groupId, homeSays, groupSays: rcv.count });
    }
  }
  return {
    // 각 교사가 '지금 데리고 있는 인원'만 더하므로 이동 학생은 한 번만 들어감(같은 학생인지는 확인 못 함)
    presentTotal: reports.reduce((n, r) => n + r.presentWithMe, 0),
    mismatches,
    limitation: "숫자만으로는 같은 학생인지 확인할 수 없습니다. 불일치가 있으면 해당 교사에게 직접 확인하세요.",
  };
}

/** 화면 안내 문구(보고·상황판 공통) */
export const SPECIAL_CLASS_NOTICE =
  "특수학급 등 다른 교실에서 수업 중인 학생은 지금 그 학생을 인솔하는 교사만 보고하세요. 원반에서는 '사전 파악 부재'로 넣고 메모에 '특수학급 인솔 중'처럼 적으면 대피·미확인 인원이 두 번 계산되지 않습니다. 단, 재적 합계에는 원반·특수학급 양쪽에 잡힐 수 있고, v0.1은 학생 명단 없이 숫자만 집계하므로 같은 학생인지 자동 확인은 하지 못합니다.";
