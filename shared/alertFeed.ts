// STEP A 경보 수집 상태(화면·서버 공통 형태와 문구)
// - not_configured: 이 서버에서 공식 수집이 꺼져 있음 / never_succeeded: 한 번도 성공 못 함
// - failing: 마지막 시도가 실패 / stale: 마지막 성공이 오래됨 / ok: 최근 성공(실시간 보장 아님)
export type OfficialFeedState = "not_configured" | "never_succeeded" | "failing" | "stale" | "ok";
export type FeedErrorKind = "rate_limited" | "rejected" | "server_error" | "timeout" | "format" | "network" | "unknown";

export const FEED_ERROR_LABEL: Record<FeedErrorKind, string> = {
  rate_limited: "호출 한도 초과",
  rejected: "인증 또는 요청 거부",
  server_error: "제공기관 서버 오류",
  timeout: "응답 시간 초과",
  format: "응답 형식이 예상과 다름",
  network: "연결 실패",
  unknown: "알 수 없는 오류",
};

export interface AlertFeedStatus {
  official: {
    provider: "mois_cbs";
    state: OfficialFeedState;
    /** 응답 형식을 실제 응답으로 확인했는지(MOIS_CBS_CONTRACT.verified) */
    contractVerified: boolean;
    lastSuccessAt: string | null;
    lastFailureAt: string | null;
    lastFailureKind: FeedErrorKind | null;
    lastAttemptAt: string | null;
  };
  mock: { active: boolean; lastSuccessAt: string | null };
  checkedAt: string;
}
