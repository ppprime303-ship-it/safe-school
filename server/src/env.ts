import { z } from "zod";

// 환경변수를 시작할 때 한 번 검사합니다. 값은 Replit Secrets(또는 로컬 .env)에 넣고,
// 코드나 GitHub에는 절대 적지 않습니다.
const schema = z.object({
  NODE_ENV: z.enum(["development", "production", "test"]).default("development"),
  PORT: z.coerce.number().int().positive().default(5000),
  DATABASE_URL: z.string().min(1, "DATABASE_URL이 없습니다. Replit에서 PostgreSQL을 추가하세요."),
  SESSION_SECRET: z.string().optional(),
  APP_BASE_URL: z.string().url().optional(),
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
