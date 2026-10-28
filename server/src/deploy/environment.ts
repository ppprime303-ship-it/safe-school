// STEP 6·7 배포 환경 역할(순수 함수) — 같은 VPS에서 공모전 심사 환경과 실제 학교 시범운영 환경을 섞지 않기 위함
//
//   judge : 운영 모드 + 스키마 safeschool_prod_judge  — 가상 학교·모의 재난자료만, 심사용 준비·초기화 도구 허용
//   pilot : 운영 모드 + 스키마 safeschool_prod_pilot  — 실제 학교, 공식 재난문자 API만, 모의 경보·심사 도구 금지
//   production : 그 밖의 운영 스키마(safeschool_prod 등) — 모의 경보·심사 도구 금지
//   dev   : 개발·테스트(Replit Run·vitest) — 기존 동작 그대로
//
// 스키마 이름은 배포 검증(dbTarget)을 통과한 값이라 형식이 보장됩니다. 판정은 DEPLOY_DB_SCHEMA 를 기준으로 합니다.

export const JUDGE_SCHEMA = "safeschool_prod_judge";
export const PILOT_SCHEMA = "safeschool_prod_pilot";

export type DeploymentRole = "judge" | "pilot" | "production" | "dev";

export function deploymentRole(env: Record<string, string | undefined>): DeploymentRole {
  if (env.NODE_ENV !== "production") return "dev";
  const schema = env.DEPLOY_DB_SCHEMA?.trim();
  if (schema === JUDGE_SCHEMA) return "judge";
  if (schema === PILOT_SCHEMA) return "pilot";
  return "production";
}

/** 모의 경보 공급자: 개발과 심사 환경만 */
export const mockAlertsAllowed = (role: DeploymentRole) => role === "dev" || role === "judge";

/** 공식 재난문자 API: 심사 환경 금지(모의 자료만 쓰기로 함). 개발은 키를 넣어 응답 확인용으로만 */
export const officialAlertsAllowed = (role: DeploymentRole) => role !== "judge";

/** 심사용 준비·초기화 도구: 심사 환경 스키마에서만 */
export const judgeToolsAllowed = (role: DeploymentRole) => role === "judge";

/** 수집할 공급자 설정(ALERT_PROVIDERS=mock,mois_cbs) 검사 — 역할에 맞지 않으면 시작 거부 */
export function alertProviderErrors(role: DeploymentRole, env: Record<string, string | undefined>): string[] {
  const errors: string[] = [];
  const wanted = (env.ALERT_PROVIDERS ?? "").split(",").map((s) => s.trim()).filter(Boolean);
  const mockFeed = !!env.ALERT_MOCK_FEED?.trim();
  for (const p of wanted) if (p !== "mock" && p !== "mois_cbs") errors.push(`ALERT_PROVIDERS 에 알 수 없는 값: ${p.slice(0, 20)}`);
  if ((wanted.includes("mock") || mockFeed) && !mockAlertsAllowed(role)) errors.push(`이 환경(${role})에서는 모의 경보를 사용할 수 없습니다.`);
  if (wanted.includes("mock") && !mockFeed) errors.push("모의 경보를 쓰려면 ALERT_MOCK_FEED(모의 경보 파일 경로)가 필요합니다.");
  if (wanted.includes("mois_cbs") && !officialAlertsAllowed(role)) errors.push("심사 환경에서는 공식 재난문자 API를 사용하지 않습니다(모의 자료만).");
  if (wanted.includes("mois_cbs") && !env.MOIS_CBS_SERVICE_KEY?.trim()) errors.push("공식 재난문자 API를 쓰려면 MOIS_CBS_SERVICE_KEY 가 필요합니다.");
  return errors;
}

const LOOPBACK = new Set(["127.0.0.1", "::1", "localhost"]);

/**
 * 국내 VPS 시범운영(pilot) 네트워크 설정 검사 — 맞지 않으면 시작 거부
 * - 앱은 같은 서버의 Caddy 뒤에서만 받는다: LISTEN_HOST = 127.0.0.1 또는 ::1
 * - Caddy 1단(같은 서버) → TRUST_PROXY_HOPS = 1. Caddy는 신뢰하지 않는 클라이언트가 보낸 X-Forwarded-For를
 *   버리고 실제 접속 IP로 다시 쓰므로, 1단만 믿으면 req.ip 가 실제 사용자 IP가 된다.
 *   0이면 모든 사용자가 127.0.0.1로 보여 요청 제한을 함께 쓰게 되고, 2 이상이면 위조된 값을 믿게 된다.
 * - DB는 같은 서버의 PostgreSQL에만 연결(외부 DB 주소 금지)
 * - APP_BASE_URL 은 https
 * 오류 문구에는 주소·비밀번호를 넣지 않는다.
 */
export function pilotNetworkErrors(role: DeploymentRole, env: Record<string, string | undefined>): string[] {
  if (role !== "pilot") return [];
  const errors: string[] = [];
  const host = (env.LISTEN_HOST ?? "0.0.0.0").trim();
  if (!LOOPBACK.has(host)) errors.push("시범운영 서버는 LISTEN_HOST=127.0.0.1 이어야 합니다(Caddy를 거치지 않은 직접 접속 차단).");
  if ((env.TRUST_PROXY_HOPS ?? "1").trim() !== "1") errors.push("시범운영 서버(같은 서버의 Caddy 1단)는 TRUST_PROXY_HOPS=1 이어야 합니다.");
  let dbHost = "";
  try {
    dbHost = new URL(env.DATABASE_URL ?? "").hostname.replace(/^\[|\]$/g, "");
  } catch {
    dbHost = "";
  }
  if (!LOOPBACK.has(dbHost)) errors.push("시범운영 DB는 같은 서버(127.0.0.1)의 PostgreSQL만 사용합니다(DATABASE_URL 호스트 확인).");
  if (!/^https:\/\//.test(env.APP_BASE_URL ?? "")) errors.push("시범운영 APP_BASE_URL 은 https 주소여야 합니다.");
  return errors;
}

/** 시범운영 시작 시 경고(시작은 허용): 실제 학교 기능에 필요한 설정이 빠졌을 때 */
export function pilotReadinessWarnings(role: DeploymentRole, env: Record<string, string | undefined>): string[] {
  if (role !== "pilot") return [];
  const w: string[] = [];
  if (env.MAIL_PROVIDER === "manual") w.push("메일 수동 전달 모드 — 가입자마다 운영자가 'npm run operator -- email-code' 로 인증코드를 발급해 직접 보내야 합니다.");
  else if (env.MAIL_PROVIDER !== "resend" || !env.MAIL_API_KEY || !env.MAIL_FROM) w.push("메일 발송 미설정 — 교직원 가입(이메일 인증)이 503으로 거부됩니다.");
  if (!env.SCHOOLINFO_API_KEY) w.push("학교알리미 인증키 미설정 — 저장된 학교 목록으로만 검색합니다.");
  if (!(env.ALERT_PROVIDERS ?? "").includes("mois_cbs")) w.push("공식 재난문자 수집 꺼짐(승인·응답 형식 확인 전 기본값).");
  return w;
}
