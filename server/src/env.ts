import { z } from "zod";
import { productionDbGuard } from "./deploy/dbTarget.js";
import { alertProviderErrors, deploymentRole, pilotNetworkErrors, pilotReadinessWarnings } from "./deploy/environment.js";

// 환경변수를 시작할 때 한 번 검사합니다. 값은 Replit Secrets(또는 로컬 .env)에 넣고,
// 코드나 GitHub에는 절대 적지 않습니다.
const schema = z.object({
  NODE_ENV: z.enum(["development", "production", "test"]).default("development"),
  PORT: z.coerce.number().int().positive().default(5000),
  // STEP 6: 서버가 연결을 받을 주소. Replit은 0.0.0.0(기본). VPS는 127.0.0.1 로 두고 리버스 프록시(HTTPS)만 외부에 열어,
  // 프록시를 거치지 않은 직접 접속(X-Forwarded-For 위조로 요청 제한 회피)을 막습니다.
  LISTEN_HOST: z.string().regex(/^[0-9a-fA-F:.]+$/, "LISTEN_HOST는 IP 주소로 지정하세요(예: 127.0.0.1)").default("0.0.0.0"),
  // STEP 6: 앞단 프록시 단계 수(Express trust proxy). Caddy/Nginx 하나 = 1(기본). CDN을 앞에 더 두면 2.
  TRUST_PROXY_HOPS: z.coerce.number().int().min(0).max(3).default(1),
  DATABASE_URL: z.string().min(1, "DATABASE_URL이 없습니다. Replit에서 PostgreSQL을 추가하세요."),
  SESSION_SECRET: z.string().optional(),
  APP_BASE_URL: z.string().url().optional(),
  // STEP 3-B 경보 수집(기본 꺼짐). 모의 경보 파일은 개발·시연에서만 사용(운영에서는 거부)
  ALERT_MOCK_FEED: z.string().optional(),
  ALERT_COLLECT_INTERVAL_SEC: z.coerce.number().int().min(30).max(3600).default(60),
  // STEP 7: 수집 공급자(쉼표 구분: mock, mois_cbs). 비우면 ALERT_MOCK_FEED 가 있을 때만 모의 수집(기존 동작)
  ALERT_PROVIDERS: z.string().optional(),
  // 공식 긴급재난문자 API 인증키(재난안전데이터 공유플랫폼). 로그·화면에 출력 금지
  MOIS_CBS_SERVICE_KEY: z.string().optional(),
  // 공식 API 최소 수집 간격(초). 일일 호출 한도를 넘지 않게 기본 300초
  MOIS_CBS_INTERVAL_SEC: z.coerce.number().int().min(120).max(3600).default(300),
  // STEP A: 나이스 교육정보 개방 포털 인증키(공개 교육정보 조회 전용). 로그·화면 출력 금지. 없으면 호출하지 않음
  NEIS_API_KEY: z.string().optional(),
  // 이 서버의 나이스 하루 호출 상한(공식 한도 수치 확인 전 — 기본 900)
  NEIS_DAILY_LIMIT: z.coerce.number().int().min(1).max(100000).optional(),
  // STEP A: 학교알리미 인증키가 시군구(sggCode) 지정을 요구하면 true(공식 페이지는 '선택')
  SCHOOLINFO_SGG_REQUIRED: z.enum(["true", "false"]).optional(),
});

const parsed = schema.safeParse(process.env);
if (!parsed.success) {
  console.error("[설정 오류] 환경변수를 확인하세요:");
  for (const issue of parsed.error.issues) {
    console.error(` - ${issue.path.join(".")}: ${issue.message}`);
  }
  process.exit(1);
}

export const env = parsed.data;

// 운영 환경에서는 세션 비밀키가 반드시 있어야 합니다(STEP 2 로그인에서 사용).
if (env.NODE_ENV === "production" && (!env.SESSION_SECRET || env.SESSION_SECRET.length < 32)) {
  console.error("[설정 오류] 운영 환경에는 32자 이상의 SESSION_SECRET이 필요합니다.");
  process.exit(1);
}

// STEP 3-F: 운영 모드에서는 배포 DB 대상(프로필·스키마)을 검증한 뒤에만 시작합니다(DB 연결 전에 중단).
// 개발(Run 워크플로)·테스트 모드는 영향 없음. 오류에는 주소·비밀번호를 넣지 않습니다.
const dbGuardErrors = productionDbGuard(process.env);
if (dbGuardErrors.length) {
  console.error("[설정 오류] 배포 DB 대상 검증 실패 — DB에 연결하지 않고 중단합니다:");
  for (const e of dbGuardErrors) console.error(` - ${e}`);
  process.exit(1);
}

// STEP 7: 환경 역할(심사·시범운영)에 맞지 않는 경보 공급자 설정이면 시작 거부(모의 자료가 실제 학교 환경에 섞이지 않게)
export const deployRole = deploymentRole(process.env);
const providerErrors = alertProviderErrors(deployRole, process.env);
if (providerErrors.length) {
  console.error("[설정 오류] 경보 공급자 설정을 확인하세요:");
  for (const e of providerErrors) console.error(` - ${e}`);
  process.exit(1);
}

// 국내 VPS 시범운영: 네트워크·DB 위치 설정이 맞지 않으면 시작 거부, 기능 설정이 빠졌으면 경고만(값은 출력하지 않음)
const pilotErrors = pilotNetworkErrors(deployRole, process.env);
if (pilotErrors.length) {
  console.error("[설정 오류] 시범운영 서버 설정을 확인하세요:");
  for (const e of pilotErrors) console.error(` - ${e}`);
  process.exit(1);
}
for (const w of pilotReadinessWarnings(deployRole, process.env)) console.warn(`[시범운영 점검] ${w}`);
