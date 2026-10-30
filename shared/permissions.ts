// STEP 3-D 학교 직책·업무·앱 권한 계산(화면·서버 공통, 순수 함수)
//
// 원칙
// - 학교 직책(교장·교감), 업무(안전업무 담당·앱 운영담당), 기본 역할(관리자·담임·교직원)을 따로 두고 권한을 '합산'합니다.
// - 교장·교감 직책만으로 교직원 승인 같은 앱 운영 권한은 생기지 않습니다.
// - 안전업무 담당만으로 앱 운영 권한은 생기지 않고, 앱 운영담당만으로 발령 권한은 생기지 않습니다.
// - 기존 'admin'(플랫폼 운영자가 자격을 확인한 학교 관리자)은 **지금까지 쓰던 기능만** 그대로 유지합니다(호환 계층).
//   새 기능 중 훈련일지 '작성·수정'은 자동으로 주지 않고, '열람·다운로드'만 줍니다(기존에도 상황판 전체 열람 가능).

export type MemberRole = "admin" | "homeroom" | "staff";
export type StaffDuty = "principal" | "vice_principal" | "safety_officer" | "app_operator";

export const DUTY_LABEL: Record<StaffDuty, string> = {
  principal: "교장",
  vice_principal: "교감",
  safety_officer: "안전업무 담당",
  app_operator: "앱 운영담당",
};

export type Capability =
  | "event.issue" // 학교 내부 재난 대응 상황·모의훈련 발령(실제 상황은 확인 절차)
  | "event.close" // 진행 중 상황 종료
  | "board.view" // 학교 전체 대피 현황 요약(Beta PILOT 2: 승인된 교직원 누구나). 보고 권한과 무관
  | "board.detail" // 상황판 상세: 학급 메모·보고자·부상 인원·대리 담당(관리자·교장·교감·안전업무 담당)
  | "drilllog.view" // 훈련일지 열람·다운로드
  | "drilllog.edit" // 훈련일지 만들기·수정
  | "members.manage" // 교직원 가입 승인·거절·회수, 학급 배정
  | "members.rename" // Beta PILOT 2: 교직원 표시 성명 정정(학교 관리자만. 역할·배정·대리 지정과 무관)
  | "admin.transfer" // Beta PILOT 2: 학교 관리자 권한 이양(학교 관리자만, 비밀번호 재확인. 플랫폼 운영자 권한과 무관)
  | "presence.detail" // Beta PILOT 2 Phase 2: 실제 재난 교직원 개인별 소재·미응답자 명단(학교 관리자·교장·교감·안전업무 담당 — 등록된 직책 기준)
  | "classes.manage" // 학급 구성·재적 확인
  | "region.manage" // 학교 소재지(경보 수신 지역) 확인
  | "duties.manage"; // 안전업무 담당·앱 운영담당 지정·해제(교장·교감 직책은 제외)

export const CAPABILITY_LABEL: Record<Capability, string> = {
  "event.issue": "재난·훈련 발령",
  "event.close": "재난·훈련 종료",
  "board.view": "전체 대피 현황",
  "board.detail": "상황판 상세(메모·보고자·부상·대리 담당)",
  "drilllog.view": "훈련일지 열람·다운로드",
  "drilllog.edit": "훈련일지 작성·수정",
  "members.manage": "교직원 승인·배정",
  "members.rename": "교직원 성명 정정",
  "admin.transfer": "학교 관리자 권한 이양",
  "presence.detail": "교직원 개인별 소재 현황",
  "classes.manage": "학급 관리",
  "region.manage": "학교 소재지 확인",
  "duties.manage": "업무 담당자 지정",
};

const BY_ROLE: Record<MemberRole, Capability[]> = {
  // 기존 학교 관리자: STEP 2~3-C에서 쓰던 기능 그대로 + 훈련일지 열람(상황판 열람과 같은 수준)
  // + 업무 담당자 지정(기존에도 교직원 승인·역할 변경을 하던 운영 권한의 연장, 교장·교감 지정은 불가)
  // Beta PILOT 2: 상황판 요약(board.view)은 승인된 교직원 누구나. 열람 권한은 학급 보고 권한을 만들지 않습니다(보고는 담임·지정 대리 담당만)
  // Beta PILOT 2: 성명 정정(members.rename)은 학교 관리자만 — 앱 운영담당은 승인·배정은 하지만 성명은 바꾸지 않음
  admin: ["event.issue", "event.close", "board.view", "board.detail", "members.manage", "members.rename", "admin.transfer", "presence.detail", "classes.manage", "region.manage", "duties.manage", "drilllog.view"],
  homeroom: ["board.view"],
  staff: ["board.view"],
};

const BY_DUTY: Record<StaffDuty, Capability[]> = {
  principal: ["event.issue", "event.close", "board.view", "board.detail", "presence.detail", "drilllog.view"],
  vice_principal: ["event.issue", "event.close", "board.view", "board.detail", "presence.detail", "drilllog.view"],
  safety_officer: ["event.issue", "event.close", "board.view", "board.detail", "presence.detail", "drilllog.view", "drilllog.edit"],
  app_operator: ["members.manage", "classes.manage", "region.manage", "duties.manage"],
};

export function capabilitiesFor(role: MemberRole, duties: readonly StaffDuty[]): Capability[] {
  const set = new Set<Capability>(BY_ROLE[role] ?? []);
  for (const d of duties) for (const c of BY_DUTY[d] ?? []) set.add(c);
  return [...set].sort();
}

export function hasCapability(caps: readonly string[] | undefined, cap: Capability): boolean {
  return !!caps && caps.includes(cap);
}

/** 앱 안에서 지정·해제할 수 있는 업무(교장·교감 직책은 플랫폼 운영자 확인으로만) */
export const APP_GRANTABLE_DUTIES: readonly StaffDuty[] = ["safety_officer", "app_operator"];

/** '운영 권한을 가진 사람'(마지막 운영자 보호 계산용): 기존 관리자 또는 앱 운영담당 */
export function isOperator(role: MemberRole, duties: readonly StaffDuty[]): boolean {
  return capabilitiesFor(role, duties).includes("members.manage");
}
