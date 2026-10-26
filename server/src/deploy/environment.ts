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
