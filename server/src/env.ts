import { z } from "zod";
import { productionDbGuard } from "./deploy/dbTarget.js";

// 환경변수를 시작할 때 한 번 검사합니다. 값은 Replit Secrets(또는 로컬 .env)에 넣고,
// 코드나 GitHub에는 절대 적지 않습니다.
const schema = z.object({
  NODE_ENV: z.enum(["development", "production", "test"]).default("development"),
  PORT: z.coerce.number().int().positive().default(5000),
  DATABASE_URL: z.string().min(1, "DATABASE_URL이 없습니다. Replit에서 PostgreSQL을 추가하세요."),
  SESSION_SECRET: z.string().optional(),
  APP_BASE_URL: z.string().url().optional(),
  // STEP 3-B 경보 수집(기본 꺼짐). 모의 경보 파일은 개발·시연에서만 사용(운영에서는 거부)
  ALERT_MOCK_FEED: z.string().optional(),
  ALERT_COLLECT_INTERVAL_SEC: z.coerce.number().int().min(30).max(3600).default(60),
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
