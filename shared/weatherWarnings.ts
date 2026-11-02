// 기상특보 표시 형태(화면·서버 공통). 읽기 전용 참고 정보이며 학교 재난 발령과 연결되지 않습니다.
export type WeatherFeedState = "not_configured" | "ok" | "failing";
export type WeatherErrorKind = "auth" | "rate_limited" | "server" | "params" | "timeout" | "network" | "format";
export type WeatherWarningStatus = "active" | "scheduled" | "released" | "unknown";

export interface WeatherWarningView {
  key: string;
  areaCode: string;
  areaName: string;
  kind: string; // 특보 종류
  level: string | null; // 주의보·경보·중대경보
  status: WeatherWarningStatus;
  relevance: "target" | "undetermined"; // undetermined: 공식 자료만으로 학교 포함 여부를 단정할 수 없는 구역
  issuedAt: string; // 발표 시각
  effectiveAt: string | null; // 발효 시각
  releasedAt: string | null; // 해제 시각
}

export interface SchoolWeatherWarnings {
  state: WeatherFeedState;
  source: string;
  contractVerified: boolean; // false: 실제 응답으로 형식을 확인하기 전
  fetchedAt: string | null; // 마지막 정상 조회 시각
  stale: boolean; // 마지막 정상 조회가 오래됨 또는 새 조회 실패로 이전 자료 표시
  errorKind: WeatherErrorKind | null;
  windowDays: number; // 이 기간에 발표된 자료만 조회
  partial: boolean; // 건수가 많아 일부만 받음
  statusText: { at: string | null; lines: string[] } | null; // 기상청 특보 현황 원문 중 인천 관련 줄(7일보다 먼저 발표된 특보 확인용)
  region: { sido: string; sigungu: string | null } | null;
  regionSupported: boolean;
  warnings: WeatherWarningView[];
}

export const WEATHER_ERROR_LABEL: Record<WeatherErrorKind, string> = {
  auth: "인증 또는 활용 승인 거부",
  rate_limited: "호출 한도 초과",
  server: "제공기관 서버 오류",
  params: "요청 형식 오류",
  timeout: "응답 시간 초과",
  network: "연결 실패",
  format: "응답 형식이 예상과 다름",
};

export const WEATHER_STATUS_LABEL: Record<WeatherWarningStatus, string> = {
  active: "발효 중",
  scheduled: "발효 예정",
  released: "해제",
  unknown: "상태 확인 필요",
};
