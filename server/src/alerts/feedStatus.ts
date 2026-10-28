// STEP A P0-1 경보 수집 상태(경보함 표시용)
// - 경보함이 비어 있을 때 '경보 없음'인지 '공식 경보를 확인하지 못하고 있음'인지 구분하기 위함.
// - 근거는 수집 기록(alert_collection_runs)과 이 서버가 시작할 때 켠 공급자뿐입니다. 추측으로 '정상'이라 하지 않습니다.
//   · 공식 수집이 꺼져 있으면 not_configured, 한 번도 성공하지 않았으면 never_succeeded(실패 기록이 있어도)
//   · 마지막 시도가 실패면 failing, 마지막 성공이 오래되면 stale, 그 밖에만 ok
// - 화면에는 오류 원문을 보내지 않고 종류(시간 초과·호출 제한 등)만 보냅니다(원문은 서버 기록에만, 인증키는 이미 가림).
// - 학교와 무관한 서버 전체 상태라 학교 간 정보가 섞이지 않습니다.
import type { AlertProvider, PrismaClient } from "@prisma/client";
import { MOIS_CBS_CONTRACT } from "./moisCbs.js";
import type { AlertFeedStatus, FeedErrorKind, OfficialFeedState } from "../../../shared/alertFeed.js";

export { FEED_ERROR_LABEL } from "../../../shared/alertFeed.js";
export type { AlertFeedStatus, FeedErrorKind, OfficialFeedState };

export interface ConfiguredAlertSource {
  provider: AlertProvider;
  isMock: boolean;
  intervalMs: number;
}

let configured: ConfiguredAlertSource[] = [];

/** 서버 시작 때(index.ts) 실제로 켠 수집 공급자를 등록합니다. */
export function setConfiguredAlertSources(list: ConfiguredAlertSource[]): void {
  configured = list.map((s) => ({ ...s }));
}

/** 수집 실패 기록(이미 비밀값을 가린 문장)을 화면용 종류로 분류 */
export function classifyFeedError(message: string | null | undefined): FeedErrorKind {
  const m = message ?? "";
  // 게이트웨이 오류 이름은 공공데이터포털 표준(UNREGISTERED_IP_ERROR 등) 기준 — 재난안전데이터 공유플랫폼 적용 여부는 명세 확인 필요.
  // 숫자 코드만으로는 분류하지 않습니다(플랫폼마다 다를 수 있음). 이름을 모르면 아래 일반 규칙 → 알 수 없음.
  if (/UNREGISTERED_IP/.test(m)) return "ip_blocked";
  if (/429|호출 제한|한도|LIMITED_NUMBER|EXCEEDS/i.test(m)) return "rate_limited";
  if (/HTTP 40[13]|결과 코드|SERVICE_KEY|DEADLINE_HAS_EXPIRED|SERVICE_ACCESS_DENIED|UNSIGNED_CALL|인증/i.test(m)) return "rejected";
  if (/HTTP 400|INVALID_REQUEST_PARAMETER|NO_MANDATORY_REQUEST_PARAMETERS|NO_OPENAPI_SERVICE/.test(m)) return "bad_request";
  if (/HTTP 5\d\d|APPLICATION_ERROR|HTTP_ERROR/.test(m)) return "server_error";
  if (/게이트웨이 오류/.test(m)) return "unknown"; // 이름을 모르는 게이트웨이 오류
  if (/timeout|timed out|aborted|시간 초과/i.test(m)) return "timeout";
  if (/형식|JSON|XML|body 배열/i.test(m)) return "format";
  if (/fetch failed|ECONN|ENOTFOUND|EAI_AGAIN|network|연결/i.test(m)) return "network";
  return "unknown";
}

/** 마지막 성공이 이보다 오래되면 '지연'(수집 간격 3배, 최소 15분) */
export function staleAfterMs(intervalMs: number): number {
  return Math.max(3 * intervalMs, 15 * 60_000);
}

export async function getAlertFeedStatus(prisma: PrismaClient, now: Date = new Date()): Promise<AlertFeedStatus> {
  const lastOf = (provider: AlertProvider, status: "success" | "failed") =>
    prisma.alertCollectionRun.findFirst({ where: { provider, status }, orderBy: { startedAt: "desc" }, select: { startedAt: true, finishedAt: true, errorMessage: true } });
  const [ok, failed, mockOk] = await Promise.all([lastOf("mois_cbs", "success"), lastOf("mois_cbs", "failed"), lastOf("mock", "success")]);

  const at = (r: { startedAt: Date; finishedAt: Date | null } | null) => (r ? (r.finishedAt ?? r.startedAt) : null);
  const okAt = at(ok);
  const failedAt = at(failed);
  const source = configured.find((s) => s.provider === "mois_cbs");

  let state: OfficialFeedState;
  if (!source) state = "not_configured";
  else if (!okAt) state = "never_succeeded";
  else if (failedAt && failedAt > okAt) state = "failing";
  else if (now.getTime() - okAt.getTime() > staleAfterMs(source.intervalMs)) state = "stale";
  else state = "ok";

  const lastAttempt = [okAt, failedAt].filter((d): d is Date => !!d).sort((a, b) => b.getTime() - a.getTime())[0] ?? null;
  return {
    official: {
      provider: "mois_cbs",
      state,
      contractVerified: MOIS_CBS_CONTRACT.verified,
      lastSuccessAt: okAt?.toISOString() ?? null,
      lastFailureAt: failedAt?.toISOString() ?? null,
      lastFailureKind: failed ? classifyFeedError(failed.errorMessage) : null,
      lastAttemptAt: lastAttempt?.toISOString() ?? null,
    },
    mock: { active: configured.some((s) => s.provider === "mock"), lastSuccessAt: at(mockOk)?.toISOString() ?? null },
    checkedAt: now.toISOString(),
  };
}
