// 화면과 서버가 함께 쓰는 공통 값. DB 열거형(prisma/schema.prisma)과 이름이 같아야 합니다.

export const DISASTER_TYPES = {
  fire: "화재",
  earthquake: "지진",
  storm_flood: "태풍·호우",
  heatwave: "폭염",
  fine_dust: "미세먼지",
  gas_leak: "가스누출",
  intruder: "외부인 침입",
  other: "기타",
} as const;
export type DisasterTypeKey = keyof typeof DISASTER_TYPES;

export const EVENT_MODES = {
  real: "실제 상황",
  drill: "훈련",
} as const;

export const MEMBER_ROLES = {
  admin: "학교 관리자",
  homeroom: "담임교사",
  staff: "일반 교직원",
} as const;

export const ASSIGNMENT_DUTIES = {
  homeroom: "담임",
  assist: "보조(대리 보고)",
  inspection: "시설 점검",
} as const;

export const ENROLLED_CHANGE_REASONS = {
  transfer_out: "전출",
  transfer_in: "전입",
  other: "기타",
} as const;

// 세션 정책(STEP 2에서 사용). 개인 기기는 길게, 공용 기기는 짧게.
export const SESSION_POLICY = {
  personal: { absoluteHours: 24 * 30, idleMinutes: null },
  shared: { absoluteHours: 8, idleMinutes: 30 },
  adminReauthMinutes: 10,
} as const;

// 학급 보고 계산 규칙: 미확인 = 보고 재적 − 대피 확인 − 사전 파악 부재
export function computeUnconfirmed(input: {
  enrolledCount: number;
  evacuated: number;
  absentKnown: number;
}): number {
  return input.enrolledCount - input.evacuated - input.absentKnown;
}
