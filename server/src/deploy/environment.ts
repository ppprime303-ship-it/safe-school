// STEP 6·7 배포 환경 역할(순수 함수) — 같은 VPS에서 공모전 심사 환경과 실제 학교 시범운영 환경을 섞지 않기 위함
//
//   judge : 운영 모드 + 스키마 safeschool_prod_judge  — 가상 학교·모의 재난자료만, 심사용 준비·초기화 도구 허용
//   pilot : 운영 모드 + 스키마 safeschool_prod_pilot  — 실제 학교, 공식 재난문자 API만, 모의 경보·심사 도구 금지
//   production : 그 밖의 운영 스키마(safeschool_prod 등) — 모의 경보·심사 도구 금지
//   dev   : 개발·테스트(Replit Run·vitest) — 기존 동작 그대로
//
// 스키마 이름은 배포 검증(dbTarget)을 통과한 값이라 형식이 보장됩니다. 판정은 DEPLOY_DB_SCHEMA 를 기준으로 합니다.

import path from "node:path";
import type { DataMode } from "../../../shared/release.js";

export const JUDGE_SCHEMA = "safeschool_prod_judge";
export const PILOT_SCHEMA = "safeschool_prod_pilot";

// Beta PILOT 2 전용 대상(기존 Prototype과 앱·포트·DB·계정·업로드 경로를 모두 달리함 — docs/beta2/release/beta-environment.md)
export const BETA_SCHEMA = "safeschool_beta";
export const BETA_DATABASE = "safeschool_beta";
export const BETA_DB_USER = "ss_beta";
export const BETA_PORT = "5100";
export const BETA_UPLOAD_ROOT = "/var/lib/safe-school-beta/";

export type DeploymentRole = "judge" | "pilot" | "beta" | "production" | "dev";

export function deploymentRole(env: Record<string, string | undefined>): DeploymentRole {
  if (env.NODE_ENV !== "production") return "dev";
  const schema = env.DEPLOY_DB_SCHEMA?.trim();
  if (env.DEPLOY_PROFILE?.trim() === "beta" || schema === BETA_SCHEMA) return "beta";
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
  else if (env.MAIL_PROVIDER === "gmail" ? !env.GMAIL_SMTP_USER || !env.GMAIL_SMTP_APP_PASSWORD : env.MAIL_PROVIDER !== "resend" || !env.MAIL_API_KEY || !env.MAIL_FROM) w.push("메일 발송 미설정 — 교직원 가입(이메일 인증)이 503으로 거부됩니다.");
  if (!env.SCHOOLINFO_API_KEY) w.push("학교알리미 인증키 미설정 — 저장된 학교 목록으로만 검색합니다.");
  if (!(env.ALERT_PROVIDERS ?? "").includes("mois_cbs")) w.push("공식 재난문자 수집 꺼짐(승인·응답 형식 확인 전 기본값).");
  if (!env.INCIDENT_UPLOAD_DIR) w.push("INCIDENT_UPLOAD_DIR 미설정 — 현장 사진 저장이 실패할 수 있습니다(systemd 읽기 전용 경로).");
  return w;
}

/** 현장 사진 저장 경로: 코드 릴리스 폴더 밖, Beta 전용 영구 경로만(릴리스 전환으로 사진이 사라지거나 Prototype 경로와 섞이지 않게) */
export function betaUploadDirErrors(env: Record<string, string | undefined>): string[] {
  const dir = env.INCIDENT_UPLOAD_DIR?.trim();
  if (!dir) return [`Beta는 INCIDENT_UPLOAD_DIR 을 ${BETA_UPLOAD_ROOT} 아래로 지정해야 합니다.`];
  if (path.posix.normalize(dir) !== dir.replace(/\/$/, "") || !dir.startsWith(BETA_UPLOAD_ROOT) || dir.length <= BETA_UPLOAD_ROOT.length) {
    return [`Beta INCIDENT_UPLOAD_DIR 은 ${BETA_UPLOAD_ROOT} 아래의 영구 경로여야 합니다(릴리스·Prototype 경로 금지).`];
  }
  return [];
}

/**
 * Beta 앱 시작 검사 — 하나라도 어긋나면 시작 거부. 스키마가 맞아도 DB·계정·포트가 Prototype 쪽이면 막습니다.
 * 가상 데이터 모드에서는 실제 메일 발송을 켤 수 없고, 실제 학교 모드는 승인 표시가 있어야 합니다.
 * 오류 문구에는 주소·비밀번호를 넣지 않습니다.
 */
export function betaEnvironmentErrors(role: DeploymentRole, env: Record<string, string | undefined>): string[] {
  if (role !== "beta") return [];
  const errors: string[] = [];
  if (env.DEPLOY_PROFILE?.trim() !== "beta") errors.push("Beta 앱은 DEPLOY_PROFILE=beta 로 시작해야 합니다.");
  if (env.DEPLOY_DB_SCHEMA?.trim() !== BETA_SCHEMA) errors.push(`Beta 앱은 스키마 ${BETA_SCHEMA} 만 사용합니다.`);
  let url: URL | null = null;
  try {
    url = new URL(env.DATABASE_URL ?? "");
  } catch {
    url = null;
  }
  const dbHost = url?.hostname.replace(/^\[|\]$/g, "") ?? "";
  if (!LOOPBACK.has(dbHost)) errors.push("Beta DB는 같은 서버(127.0.0.1)의 PostgreSQL만 사용합니다(DATABASE_URL 호스트 확인).");
  if (decodeURIComponent(url?.pathname.slice(1) ?? "") !== BETA_DATABASE) errors.push(`Beta 앱은 DB ${BETA_DATABASE} 만 사용합니다(운영·Prototype DB 연결 거부).`);
  if (decodeURIComponent(url?.username ?? "") !== BETA_DB_USER) errors.push(`Beta 앱은 DB 계정 ${BETA_DB_USER} 만 사용합니다(운영·Prototype 계정 거부).`);
  if ((env.PORT ?? "").trim() !== BETA_PORT) errors.push(`Beta 앱 포트는 ${BETA_PORT} 입니다(기존 Prototype 포트와 분리).`);
  if (!LOOPBACK.has((env.LISTEN_HOST ?? "0.0.0.0").trim())) errors.push("Beta 앱은 LISTEN_HOST=127.0.0.1 이어야 합니다(Caddy를 거치지 않은 직접 접속 차단).");
  if ((env.TRUST_PROXY_HOPS ?? "1").trim() !== "1") errors.push("Beta 앱(같은 서버의 Caddy 1단)은 TRUST_PROXY_HOPS=1 이어야 합니다.");
  if (!/^https:\/\//.test(env.APP_BASE_URL ?? "")) errors.push("Beta APP_BASE_URL 은 https 주소여야 합니다.");
  errors.push(...betaUploadDirErrors(env));
  const mode = env.BETA_DATA_MODE?.trim();
  if (mode !== "virtual_test" && mode !== "school_pilot") errors.push("BETA_DATA_MODE 를 virtual_test 또는 school_pilot 으로 명시해야 합니다.");
  if (mode === "virtual_test" && (env.MAIL_PROVIDER === "resend" || env.MAIL_PROVIDER === "gmail")) errors.push(`가상 데이터 모드에서는 실제 메일 발송(MAIL_PROVIDER=${env.MAIL_PROVIDER})을 켤 수 없습니다.`);
  if (mode === "school_pilot" && env.BETA_SCHOOL_PILOT_APPROVED !== "true") errors.push("실제 학교 모드는 학교·개인정보 승인 후 BETA_SCHOOL_PILOT_APPROVED=true 로만 시작합니다.");
  return errors;
}

/** Beta 앱이 실제로 연결된 DB 확인(deploy-start 사전 점검의 읽기 전용 조회 결과로 판정). 같은 DB에 운영 스키마가 보이면 거부 */
export function betaPreflightErrors(p: { database: string; user: string; schemas: string[] }): string[] {
  const errors: string[] = [];
  if (p.database !== BETA_DATABASE) errors.push(`연결된 DB가 ${BETA_DATABASE} 가 아닙니다.`);
  if (p.user !== BETA_DB_USER) errors.push(`연결된 DB 계정이 ${BETA_DB_USER} 가 아닙니다.`);
  const foreign = p.schemas.filter((s) => s.startsWith("safeschool_prod") || s === "safeschool_browser_demo");
  if (foreign.length) errors.push(`이 DB에 운영·시연 스키마가 있습니다(${foreign.join(", ")}). Beta 전용 DB가 아닙니다.`);
  return errors;
}

/** 화면 안내용 데이터 구분: 개발·심사는 가상 데이터, Beta는 명시한 값(잘못된 값은 시작 거부), 그 밖의 운영은 실제 학교 */
export function dataModeFor(role: DeploymentRole, env: Record<string, string | undefined>): DataMode {
  if (role === "dev" || role === "judge") return "virtual_test";
  if (role === "beta") return env.BETA_DATA_MODE?.trim() === "school_pilot" ? "school_pilot" : "virtual_test";
  return "school_pilot";
}

/** Beta 데모 시드 거부 사유: 가상 데이터 모드에서만 허용(시범운영 스키마 금지는 seed.ts 가 따로 검사) */
export function demoSeedRefusal(role: DeploymentRole, env: Record<string, string | undefined>): string | null {
  if (role === "beta" && env.BETA_DATA_MODE?.trim() !== "virtual_test") return "Beta 실제 학교 모드에는 데모 데이터를 넣을 수 없습니다.";
  return null;
}
