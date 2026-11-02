// 제품·개발 버전 표기(화면·서버 공통). 배포 여부·시점과 무관한 값입니다 — 배포 기록은 docs/devlog 와 릴리스 태그로 따로 관리합니다.
export const RELEASE = {
  product: "SAFE SCHOOL",
  devVersion: "Beta PILOT 2",
  stage: "제한적 시범운영 준비",
} as const;

/** 이 서버가 다루는 데이터: 승인된 가상 데이터 테스트 / 실제 학교 시범운영 */
export type DataMode = "virtual_test" | "school_pilot";
