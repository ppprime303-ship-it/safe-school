// 경보함 데이터 형태(서버 server/src/services/alerts.ts 와 같음)
export interface AlertItem {
  matchId: string;
  result: "target" | "undetermined";
  reason: string;
  read: boolean;
  rebroadcastCount: number;
  cancelled: boolean;
  expired: boolean;
  noticeCount: number; // STEP 3-C 이 경보에 연결된 학교 안내문 수(취소 제외)
  alert: {
    id: string;
    provider: string;
    isMock: boolean;
    kind: "disaster_text" | "weather" | "air_quality" | "other";
    severity: "info" | "advisory" | "warning" | "emergency";
    msgType: "new" | "update" | "cancel";
    issuer: string;
    title: string | null;
    body: string;
    areasRaw: string;
    issuedAt: string;
    expiresAt: string | null;
    receivedAt: string;
  };
}

export interface RegionInfo {
  address: string | null;
  region: { sido: string; sigungu: string | null; source: "address_parsed" | "admin"; confirmed: boolean; confirmedAt: string | null } | null;
}

export const KIND_LABEL: Record<AlertItem["alert"]["kind"], string> = {
  disaster_text: "재난문자",
  weather: "기상특보",
  air_quality: "대기질",
  other: "기타",
};

// 색만으로 구분하지 않도록 항상 글자 라벨을 함께 표시
export const SEVERITY_META: Record<AlertItem["alert"]["severity"], { label: string; badge: string }> = {
  emergency: { label: "긴급", badge: "bg-danger text-white" },
  warning: { label: "경보", badge: "bg-danger-soft text-danger border border-danger" },
  advisory: { label: "주의보", badge: "bg-warning-soft text-warning-strong border border-warning" },
  info: { label: "안내", badge: "bg-neutral-soft text-neutral border border-line-strong" },
};

export const MSG_LABEL: Record<AlertItem["alert"]["msgType"], string | null> = { new: null, update: "정정 안내", cancel: "해제 안내" };

// STEP A: 경보 수집 상태(shared/alertFeed.ts)
export { FEED_ERROR_LABEL, type AlertFeedStatus, type FeedErrorKind, type OfficialFeedState } from "@shared/alertFeed";
