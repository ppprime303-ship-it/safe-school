// STEP 3-F 배포 시작 안전장치: 대상 검증 → 읽기 전용 사전 점검 → (같은 주소로) 마이그레이션 → 서버 시작
//
//   npm run deploy:check     검증 + 읽기 전용 점검만(아무것도 바꾸지 않음) — 배포 전 Shell에서 확인용
//   npm run deploy:migrate   검증 + 점검 + 마이그레이션(prisma migrate deploy, 데이터 삭제 없음)만
//   npm run deploy:start     검증 + 점검 + 마이그레이션 + 서버 시작(Replit 배포 실행 명령)
//
// 필요한 설정(Replit 배포 Secrets 또는 환경변수): DATABASE_URL, DEPLOY_PROFILE(demo|production), DEPLOY_DB_SCHEMA
// - 하나라도 없거나 허용되지 않은 대상이면 DB에 연결하기 전에 멈춥니다(종료 코드 1).
// - 시연(demo) 배포는 이미 있는 safeschool_browser_demo(마이그레이션 기록이 있는 스키마)에만 연결합니다. 새 스키마를 만들지 않습니다.
// - 주소·비밀번호는 출력하지 않습니다(호스트/DB 이름/스키마만).
// - reset·삭제·시드는 하지 않습니다.
import { spawn, spawnSync } from "node:child_process";
import { PrismaClient } from "@prisma/client";
import { newSchemaDecision, resolveDeployTarget, type DeployProfile } from "../server/src/deploy/dbTarget.js";
import { betaEnvironmentErrors, betaPreflightErrors } from "../server/src/deploy/environment.js";
import { safeErrorSummary } from "../server/src/security/safeLog.js";

const mode = process.argv.includes("--check") ? "check" : process.argv.includes("--migrate-only") ? "migrate" : "start";
const log = (m: string) => console.log(`[deploy] ${m}`);
const fail = (msgs: string[], header = "중단 — DB를 바꾸지 않았습니다(마이그레이션 실행 전):"): never => {
  console.error(`[deploy] ${header}`);
  for (const m of msgs) console.error(` - ${m}`);
  process.exit(1);
};

async function preflight(url: string, schema: string, profile: DeployProfile) {
  const db = new PrismaClient({ datasourceUrl: url, log: ["error"] });
  try {
    // Beta: 주소 문자열이 아니라 실제로 연결된 DB·계정·스키마를 다시 확인(읽기 전용). 운영 DB면 마이그레이션 전에 멈춤
    if (profile === "beta") {
      const who = await db.$queryRaw<{ database: string; user: string }[]>`SELECT current_database() AS database, current_user AS "user"`;
      const schemas = await db.$queryRaw<{ name: string }[]>`SELECT nspname AS name FROM pg_namespace WHERE nspname LIKE 'safeschool%'`;
      const errors = betaPreflightErrors({ database: who[0]!.database, user: who[0]!.user, schemas: schemas.map((s) => s.name) });
      if (errors.length) fail(errors);
    }
    const rows = await db.$queryRaw<{ schema_exists: boolean; has_migrations: boolean; has_schools: boolean; has_users: boolean }[]>`
      SELECT EXISTS (SELECT 1 FROM information_schema.schemata WHERE schema_name = ${schema}) AS schema_exists,
             to_regclass(format('%I._prisma_migrations', ${schema}::text)) IS NOT NULL AS has_migrations,
             to_regclass(format('%I.schools', ${schema}::text)) IS NOT NULL AS has_schools,
             to_regclass(format('%I.users', ${schema}::text)) IS NOT NULL AS has_users`;
    const r = rows[0]!;
    // STEP 6: 새 스키마 생성은 '--migrate-only' 단계에서만(서버 시작 때 플래그가 남아 있어도 만들지 않음)
    const d = newSchemaDecision({ profile, mode, schemaReady: r.schema_exists && r.has_migrations, allowFlag: process.env.DEPLOY_ALLOW_NEW_SCHEMA === "true" });
    if (d.warn) log(`경고: ${d.warn}`);
    if (d.action === "refuse") fail([`${schema}: ${d.message}`]);
    if (d.action === "create") {
      log(`새 운영 스키마(${schema})를 마이그레이션으로 만듭니다(DEPLOY_ALLOW_NEW_SCHEMA=true, 이 단계에서만). 끝나면 플래그를 제거하세요.`);
      return;
    }
    // 읽기 전용 확인: 대상이 맞는지 사람이 볼 수 있게 건수만(이름·이메일은 출력하지 않음)
    if (r.has_schools && r.has_users) {
      // schema는 검증된 식별자(영문 소문자·숫자·밑줄)만 통과하므로 따옴표로 감싸 넣어도 안전
      const c = (await db.$queryRawUnsafe(`SELECT (SELECT count(*) FROM "${schema}".schools) AS schools, (SELECT count(*) FROM "${schema}".users) AS users`)) as { schools: bigint; users: bigint }[];
      log(`대상 스키마 현재 데이터: 학교 ${Number(c[0]!.schools)}개, 사용자 ${Number(c[0]!.users)}명(보존, 변경하지 않음)`);
    }
  } catch (e) {
    fail([`DB 사전 점검 실패(연결·권한 확인): ${safeErrorSummary(e)}`]);
  } finally {
    await db.$disconnect().catch(() => {});
  }
}

async function main() {
  const target = resolveDeployTarget(process.env);
  if (!target.ok) return fail(target.errors);
  if (target.profile === "beta") {
    const errors = betaEnvironmentErrors("beta", process.env);
    if (errors.length) return fail(errors);
  }
  log(`대상: ${target.summary}`);
  await preflight(target.url, target.schema, target.profile);
  if (mode === "check") {
    log("점검만 했습니다(마이그레이션·서버 시작 안 함).");
    return;
  }

  const childEnv = { ...process.env, DATABASE_URL: target.url };
  log("마이그레이션 적용(prisma migrate deploy — 적용 대기분만, 데이터 삭제 없음)");
  const m = spawnSync("npx", ["prisma", "migrate", "deploy"], { stdio: "inherit", env: childEnv });
  if (m.status !== 0) fail([`prisma migrate deploy 종료 코드 ${m.status ?? "없음"} — 위 Prisma 출력에서 실패한 마이그레이션을 확인하세요(되돌리기·reset 하지 말 것).`], "중단 — 마이그레이션 단계에서 실패, 서버를 시작하지 않습니다:");
  if (mode === "migrate") return;

  log("서버 시작(검증된 같은 DB 주소 사용)");
  const server = spawn(process.execPath, ["dist/server/index.js"], { stdio: "inherit", env: { ...childEnv, NODE_ENV: "production" } });
  for (const sig of ["SIGTERM", "SIGINT"] as const) process.on(sig, () => server.kill(sig));
  server.on("exit", (code, signal) => process.exit(code ?? (signal ? 0 : 1)));
}

main().catch((e) => fail([safeErrorSummary(e)]));
