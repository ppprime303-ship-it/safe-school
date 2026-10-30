// 재난 대응 화면이 쓰는 데이터 형태와 상태 계산(순수 함수, 테스트 대상)
//
// 서버 API 계약(STEP 3에서 구현 예정 — 현재 서버에는 아직 없음):
//   GET  /api/schools/:schoolId/events/active                 → { event: ActiveEvent | null }
//   GET  /api/schools/:schoolId/events/:eventId/board         → BoardData (관리자)
//   GET  /api/schools/:schoolId/events/:eventId/my-classes    → { classes: ClassReportView[] } (담당 학급)
//   PUT  /api/schools/:schoolId/events/:eventId/reports/:classId  (Idempotency-Key 헤더)
//        body: ReportInput → { report }
//   POST /api/schools/:schoolId/events/:eventId/close
import type { DisasterTypeKey } from "@shared/constants";

export type EventMode = "real" | "drill";

export interface ActiveEvent {
  id: string;
  mode: EventMode;
  types: DisasterTypeKey[]; // 복합재난이면 여러 개(첫 번째가 최초 유형)
  location: string | null;
  evacPlace: string | null;
  message: string | null;
  startedAt: string;
}

export interface ClassReport {
  enrolledCount: number;
  absentKnown: number;
  evacuated: number;
  unconfirmed: number;
  injured: number | null; // null: 이 화면 권한으로는 비공개(Beta PILOT 2 상황판 요약)
  note: string | null;
  version: number;
  reportedAt: string;
  reporterName: string | null;
}

export interface ClassReportView {
  classId: string;
  grade: number;
  classNo: number;
  label: string;
  enrolledCount: number | null; // 발령 시점 재적(관리자 미확인이면 null)
  report: ClassReport | null;
  /** v0.1 내 학급 목록: 본인 담당(own) / 이 훈련 동안 대리 담당(delegated) */
  responsibility?: "own" | "delegated";
  /** v0.1 상황판: 진행 중 대리 담당(있으면) */
  delegation?: { id: string; delegateMembershipId: string; delegateName: string; reason: "unreachable" | "unable" | "admin_decision"; basis: string | null; assignedAt: string } | null;
}

export interface BoardData {
  /** full: 상세(메모·보고자·부상·대리 담당) / summary: 일반 교직원용 요약 — 서버가 권한별로 걸러서 보냄 */
  scope?: "full" | "summary";
  event: ActiveEvent;
  serverTime: string;
  classes: ClassReportView[];
}

export interface ReportInput {
  evacuated: number;
  absentKnown: number;
  injured: number;
  enrolledCount: number;
  enrolledChangeReason: "transfer_out" | "transfer_in" | "other" | null;
  note: string | null;
  expectedVersion: number | null;
}

// ───────────── 학급 상태 ─────────────
// 미보고는 절대 '완료'로 표시하지 않습니다. 미확인 인원은 부상자보다 우선 표시(행방 미확인이 가장 위급).
export type ClassStatus = "unreported" | "unconfirmed" | "injured" | "reported";

export function deriveClassStatus(view: Pick<ClassReportView, "report">): ClassStatus {
  if (!view.report) return "unreported";
  if (view.report.unconfirmed > 0) return "unconfirmed";
  if ((view.report.injured ?? 0) > 0) return "injured";
  return "reported";
}

export interface BoardSummary {
  totalClasses: number;
  reportedClasses: number;
  unreportedClasses: number;
  enrolledTotal: number; // 재적을 아는 학급의 합(보고된 학급은 보고 재적)
  enrolledUnknownClasses: number; // 재적 미확인 + 미보고 학급 수
  evacuated: number;
  absentKnown: number;
  unconfirmed: number;
  injured: number;
  pendingStudents: number; // 미보고 학급의 재적 합(보고 대기 인원)
  reportProgress: number; // 보고 완료 학급 %
  evacuatedRate: number; // 대피 확인 / 재적 합 %
  classesWithUnconfirmed: number;
  classesWithInjured: number;
}

export function summarizeBoard(classes: ClassReportView[]): BoardSummary {
  let reported = 0;
  let enrolledTotal = 0;
  let enrolledUnknown = 0;
  let evacuated = 0;
  let absentKnown = 0;
  let unconfirmed = 0;
  let injured = 0;
  let pending = 0;
  let withUnconfirmed = 0;
  let withInjured = 0;
  for (const c of classes) {
    if (c.report) {
      reported++;
      enrolledTotal += c.report.enrolledCount;
      evacuated += c.report.evacuated;
      absentKnown += c.report.absentKnown;
      unconfirmed += c.report.unconfirmed;
      injured += c.report.injured ?? 0;
      if (c.report.unconfirmed > 0) withUnconfirmed++;
      if ((c.report.injured ?? 0) > 0) withInjured++;
    } else if (c.enrolledCount !== null) {
      enrolledTotal += c.enrolledCount;
      pending += c.enrolledCount;
    } else {
      enrolledUnknown++;
    }
  }
  const total = classes.length;
  return {
    totalClasses: total,
    reportedClasses: reported,
    unreportedClasses: total - reported,
    enrolledTotal,
    enrolledUnknownClasses: enrolledUnknown,
    evacuated,
    absentKnown,
    unconfirmed,
    injured,
    pendingStudents: pending,
    reportProgress: total > 0 ? Math.round((reported / total) * 100) : 0,
    evacuatedRate: enrolledTotal > 0 ? Math.round((evacuated / enrolledTotal) * 100) : 0,
    classesWithUnconfirmed: withUnconfirmed,
    classesWithInjured: withInjured,
  };
}

/** 미확인 = 재적 − 대피 확인 − 사전 파악 부재 (서버 규칙과 동일) */
export function computeUnconfirmed(enrolled: number, evacuated: number, absentKnown: number): number {
  return enrolled - evacuated - absentKnown;
}

/** 보고 입력 검증: 화면에서 저장 전에 알려 주기 위함(서버가 최종 검증) */
export function validateReport(input: Pick<ReportInput, "enrolledCount" | "evacuated" | "absentKnown" | "injured">): string | null {
  const { enrolledCount, evacuated, absentKnown, injured } = input;
  if ([enrolledCount, evacuated, absentKnown, injured].some((n) => !Number.isInteger(n) || n < 0)) return "0 이상의 숫자만 입력할 수 있습니다.";
  if (enrolledCount > 60) return "재적은 60명 이하여야 합니다.";
  if (evacuated + absentKnown > enrolledCount) return "대피 확인과 사전 파악 부재의 합이 재적보다 많습니다.";
  if (injured > enrolledCount) return "부상자가 재적보다 많습니다.";
  return null;
}
