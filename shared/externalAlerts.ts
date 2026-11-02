// 외부 경보(긴급재난문자·기상특보) 교직원 안내. 화면·서버 공통. 학교 재난 발령과 연결되지 않습니다.
export type NoticeStatus = "active" | "scheduled" | "unknown" | "issued";
export type NoticePriority = "urgent" | "normal";

export interface PendingAlertNotice {
  matchId: string;
  kind: "disaster_text" | "weather" | "air_quality" | "other";
  isMock: boolean;
  verified: boolean; // false: 공식 응답 형식 확인 전
  priority: NoticePriority;
  relevance: "target" | "undetermined";
  title: string | null;
  issuer: string;
  areasRaw: string;
  body: string;
  issuedAt: string;
  status: NoticeStatus;
  sourceLabel: string;
  lastCollectedAt: string | null;
}

export interface PendingAlertNotices {
  notices: PendingAlertNotice[];
  /** 학교 사건 진행 중: 대피 보고를 가리지 않도록 화면을 막지 않는 안내로 표시 */
  activeEvent: boolean;
}

export const NOTICE_STATUS_LABEL: Record<NoticeStatus, string> = {
  active: "발효 중",
  scheduled: "발효 예정",
  unknown: "상태 확인 필요",
  issued: "발송됨",
};

export const ALERT_SOURCE_LABEL: Record<string, string> = {
  mois_cbs: "행정안전부 긴급재난문자",
  kma_warning: "기상청 기상특보 조회서비스",
  mock: "모의 공급자(시연용 가상 경보)",
};
