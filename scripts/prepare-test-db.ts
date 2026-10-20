// `npm test` 가 먼저 실행하는 스크립트: 테스트 스키마에 마이그레이션을 적용합니다.
// 운영·개발 스키마(public)에는 아무 영향이 없습니다.
import { execSync } from "node:child_process";
import { getTestDatabaseUrl } from "../tests/test-db.js";

const testUrl = getTestDatabaseUrl();
const schema = new URL(testUrl).searchParams.get("schema");
console.log(`[test] 테스트 스키마 '${schema}' 에 마이그레이션 적용`);
execSync("npx prisma migrate deploy", {
  stdio: "inherit",
  env: { ...process.env, DATABASE_URL: testUrl },
});
