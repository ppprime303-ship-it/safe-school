// 교직원 가입 신청 정보(화면·서버 공통) — v0.1(2026-10-28) 간편 입력
// - '교직원 구분'과 '담당 업무'는 승인 담당자가 참고하는 신청 정보일 뿐 권한이 아닙니다. 실제 권한은 승인 후 학교 관리자가 정하는
//   역할(담임·교직원)·학급 배정·업무(직책)이며, 교장·교감 직책은 플랫폼 운영자 확인으로만 부여됩니다(shared/permissions.ts).
// - 가입 단계에서 담당 학생 수는 받지 않습니다(학급 재적은 학교 관리자가 학급 화면에서 관리).
// - 학교마다 업무 이름이 달라도 늘릴 수 있게 키·이름 표로 둡니다(DB에는 키 문자열 배열, 새 키 추가에 마이그레이션 불필요).

export const POSITION_LABEL = {
  teacher: "교사",
  principal: "교장",
  vice_principal: "교감",
  other: "기타 교직원",
} as const;
export type RequestedPosition = keyof typeof POSITION_LABEL;
export const POSITIONS = Object.keys(POSITION_LABEL) as RequestedPosition[];

export const REQUESTED_DUTY_LABEL = {
  homeroom: "담임교사",
  special_class: "특수교사·특수학급 담당",
  grade_head: "학년부장·학년 담당",
  safety_officer: "안전 담당",
  assistant_homeroom: "부담임",
  other: "기타 업무",
  // 이전 신청 화면(10/27)의 키 — 기존 신청 자료 호환용(새 화면에는 표시하지 않음)
  health_teacher: "보건교사",
  disaster_response: "재난 대응 담당자",
  school_admin: "학교 관리자(교장·교감)",
  general_staff: "일반 교직원",
} as const;

export type RequestedDuty = keyof typeof REQUESTED_DUTY_LABEL;
export const REQUESTED_DUTIES = Object.keys(REQUESTED_DUTY_LABEL) as RequestedDuty[];

/** 새 가입 화면에 보이는 업무(학교급별). 부담임은 중·고등학교만 */
export function visibleDuties(kindCode: string | null | undefined): RequestedDuty[] {
  const secondary = kindCode === "03" || kindCode === "04";
  return ["homeroom", "special_class", "grade_head", "safety_officer", ...(secondary ? (["assistant_homeroom"] as const) : []), "other"];
}

/** 학교급별 학년 범위(초등 1~6, 중·고 1~3, 그 밖 1~6). 반은 1~20 */
export function gradeRange(kindCode: string | null | undefined): number[] {
  const max = kindCode === "03" || kindCode === "04" ? 3 : 6;
  return Array.from({ length: max }, (_, i) => i + 1);
}
export const CLASS_NUMBERS = Array.from({ length: 20 }, (_, i) => i + 1);

/** 담당 학급 신청 정보를 사람이 읽는 한 줄로(예: "담임 3학년 2반 · 학년부장 3학년"). 대리 후보 제안도 이 형식을 읽음 */
export function describeRequestedClasses(v: {
  homeroom?: { grade: number; classNo: number } | null;
  assistant?: { grade: number; classNo: number } | null;
  gradeHead?: number | null;
  specialClassName?: string | null;
}): string | undefined {
  const parts = [
    v.homeroom && `담임 ${v.homeroom.grade}학년 ${v.homeroom.classNo}반`,
    v.assistant && `부담임 ${v.assistant.grade}학년 ${v.assistant.classNo}반`,
    v.gradeHead && `학년부장 ${v.gradeHead}학년`,
    v.specialClassName?.trim() && `특수학급 ${v.specialClassName.trim()}`,
  ].filter(Boolean);
  return parts.length ? parts.join(" · ") : undefined;
}

/** 신청 업무로 정하는 '신청 역할'(승인 전 표시용). 담임을 고르면 homeroom, 그 밖에는 staff. admin 은 신청으로 생기지 않음 */
export const requestedRoleOf = (duties: readonly RequestedDuty[]): "homeroom" | "staff" => (duties.includes("homeroom") ? "homeroom" : "staff");
