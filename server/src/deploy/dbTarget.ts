// STEP 3-F 배포 DB 대상 검증(순수 함수 — DB에 접속하지 않음)
//
// 위험: 배포 실행이 `npx prisma migrate deploy && npm start` 였고 DATABASE_URL에 schema 매개변수가 없으면
//       Prisma는 'public' 스키마를 씁니다. 시연 데이터(safeschool_browser_demo)가 아닌 빈 스키마에 테이블을 새로 만들고
//       앱이 그쪽에 연결되며, 잘못 설정하면 테스트 스키마(safeschool_test, 테스트 때마다 비움)에 연결될 수도 있습니다.
//
// 원칙
// - 배포 프로필(DEPLOY_PROFILE)과 대상 스키마(DEPLOY_DB_SCHEMA)를 반드시 명시해야 합니다(기본값 없음).
// - 프로필별 허용 스키마만 통과: demo → safeschool_browser_demo, production → safeschool_prod(_이름)
// - public, 이름에 test가 들어간 스키마, 형식이 틀린 이름은 언제나 거부
// - DATABASE_URL에 이미 schema가 있으면 DEPLOY_DB_SCHEMA와 같아야 함(다르면 거부)
// - 검증을 통과한 URL 하나를 마이그레이션과 서버 시작에 똑같이 씁니다.
// - 오류·로그에는 비밀번호·전체 주소를 넣지 않고 호스트/DB 이름/스키마만 씁니다.

export type DeployProfile = "demo" | "production";

export const DEMO_SCHEMA = "safeschool_browser_demo";
const PROD_SCHEMA = /^safeschool_prod(_[a-z0-9]{1,20})?$/;
const IDENT = /^[a-z][a-z0-9_]{0,62}$/;

export interface DeployTargetOk {
  ok: true;
  profile: DeployProfile;
  schema: string;
  url: string; // 마이그레이션·서버에 같이 쓰는 주소(로그 출력 금지)
  summary: string; // 로그용: 호스트/DB · schema=… · 프로필
}
export interface DeployTargetFail {
  ok: false;
  errors: string[];
}

/** 로그용 요약: 비밀번호·사용자·다른 매개변수를 빼고 호스트/DB/스키마만 */
export function describeDbUrl(raw: string | undefined): string {
  if (!raw) return "(설정 없음)";
  try {
    const u = new URL(raw);
    return `${u.hostname}/${decodeURIComponent(u.pathname.slice(1)) || "(DB 이름 없음)"} · schema=${u.searchParams.get("schema") ?? "(미지정 → public)"}`;
  } catch {
    return "(주소 형식을 읽을 수 없음)";
  }
}

export function allowedSchema(profile: DeployProfile, schema: string): boolean {
  return profile === "demo" ? schema === DEMO_SCHEMA : PROD_SCHEMA.test(schema);
}

/** 스키마 이름 자체의 위험 검사(프로필과 무관하게 항상 거부할 것) */
export function forbiddenSchemaReason(schema: string): string | null {
  if (!IDENT.test(schema)) return `스키마 이름 형식이 올바르지 않습니다(영문 소문자·숫자·밑줄, 영문으로 시작): ${JSON.stringify(schema.slice(0, 64))}`;
  if (schema === "public") return "public 스키마는 배포 대상으로 쓸 수 없습니다(스키마 미지정 시 기본값이라 사고 위험).";
  if (schema.includes("test")) return `테스트 스키마(${schema})는 배포 대상으로 쓸 수 없습니다(테스트 때마다 데이터를 비움).`;
  return null;
}

export function resolveDeployTarget(env: Record<string, string | undefined>): DeployTargetOk | DeployTargetFail {
  const errors: string[] = [];
  const raw = env.DATABASE_URL?.trim();
  const profileRaw = env.DEPLOY_PROFILE?.trim();
  const schema = env.DEPLOY_DB_SCHEMA?.trim();

  if (!raw) errors.push("DATABASE_URL이 없습니다.");
  if (!profileRaw) errors.push("DEPLOY_PROFILE이 없습니다(demo 또는 production을 명시).");
  else if (profileRaw !== "demo" && profileRaw !== "production") errors.push(`DEPLOY_PROFILE 값이 올바르지 않습니다: ${JSON.stringify(profileRaw.slice(0, 20))}(demo 또는 production)`);
  if (!schema) errors.push("DEPLOY_DB_SCHEMA가 없습니다(배포 대상 스키마를 명시).");

  let url: URL | null = null;
  if (raw) {
    try {
      url = new URL(raw);
      if (url.protocol !== "postgresql:" && url.protocol !== "postgres:") {
        errors.push(`DATABASE_URL이 PostgreSQL 주소가 아닙니다(${url.protocol}).`);
        url = null;
      } else if (!url.hostname || url.pathname.length <= 1) {
        errors.push("DATABASE_URL에 호스트 또는 DB 이름이 없습니다.");
        url = null;
      }
    } catch {
      errors.push("DATABASE_URL 형식을 읽을 수 없습니다.");
    }
  }

  if (schema) {
    const why = forbiddenSchemaReason(schema);
    if (why) errors.push(why);
    else if ((profileRaw === "demo" || profileRaw === "production") && !allowedSchema(profileRaw, schema)) {
      errors.push(
        profileRaw === "demo"
          ? `시연(demo) 배포는 ${DEMO_SCHEMA} 스키마만 허용합니다(현재 ${schema}).`
          : `운영(production) 배포는 safeschool_prod 또는 safeschool_prod_<이름> 스키마만 허용합니다(현재 ${schema}).`,
      );
    }
  }

  if (url && schema) {
    const inUrl = url.searchParams.get("schema");
    if (inUrl !== null && inUrl !== schema) errors.push(`DATABASE_URL의 schema(${inUrl})와 DEPLOY_DB_SCHEMA(${schema})가 다릅니다. 하나로 맞추세요.`);
  }

  if (errors.length || !url || !schema || (profileRaw !== "demo" && profileRaw !== "production")) return { ok: false, errors: errors.length ? errors : ["설정이 올바르지 않습니다."] };
  url.searchParams.set("schema", schema);
  const target = url.toString();
  return { ok: true, profile: profileRaw, schema, url: target, summary: `${describeDbUrl(target)} · 프로필=${profileRaw}` };
}

/**
 * 서버 시작 시 검사(운영 모드에서만): 배포 스크립트를 거치지 않고 `npm start`를 직접 실행해도
 * schema 미지정·public·test 스키마로는 DB에 연결하기 전에 멈춥니다. 개발·테스트 모드는 기존 동작 그대로.
 */
export function productionDbGuard(env: Record<string, string | undefined>): string[] {
  if (env.NODE_ENV !== "production") {
    // STEP 6: 운영 프로필을 지정했는데 개발·테스트 모드로 켜면(systemd에 NODE_ENV 누락 등) 검사를 건너뛰게 되므로 시작 거부
    return env.DEPLOY_PROFILE?.trim() === "production"
      ? ["DEPLOY_PROFILE=production 인데 NODE_ENV가 production이 아닙니다. 운영 서버는 NODE_ENV=production 으로 시작하세요(npm start 또는 npm run deploy:start)."]
      : [];
  }
  const r = resolveDeployTarget(env);
  if (!r.ok) return r.errors;
  // 서버는 DATABASE_URL을 그대로 쓰므로, 검증한 대상과 실제 주소의 스키마가 같아야 함
  try {
    if (new URL(env.DATABASE_URL!).searchParams.get("schema") !== r.schema) return ["DATABASE_URL에 검증된 schema가 없습니다. 배포는 `npm run deploy:start`로 시작하세요."];
  } catch {
    return ["DATABASE_URL 형식을 읽을 수 없습니다."];
  }
  return [];
}

/**
 * STEP 6: 새 스키마(마이그레이션 기록 없음) 처리 정책 — 사전 점검 결과로 결정(순수 함수)
 *  - demo: 언제나 거부(시연 데이터가 있어야 하는 대상)
 *  - production: '--migrate-only' 단계에서 DEPLOY_ALLOW_NEW_SCHEMA=true 일 때만 생성 허용.
 *    서버 시작(deploy:start)·점검(--check)에서는 플래그가 남아 있어도 새 스키마를 만들지 않음 → 잘못된 DB 주소로 바뀌었을 때 조용히 새로 만드는 사고 방지
 *  - 이미 있는 스키마인데 플래그가 남아 있으면 경고(제거 안내)
 */
export type DeployMode = "check" | "migrate" | "start";
export function newSchemaDecision(p: { profile: DeployProfile; mode: DeployMode; schemaReady: boolean; allowFlag: boolean }): { action: "proceed" | "create" | "refuse"; message?: string; warn?: string } {
  const flagWarn = p.allowFlag ? "DEPLOY_ALLOW_NEW_SCHEMA=true 가 남아 있습니다. 첫 생성이 끝났으면 즉시 제거하세요." : undefined;
  if (p.schemaReady) return { action: "proceed", warn: flagWarn };
  if (p.profile === "demo") return { action: "refuse", message: "시연 스키마가 없거나 마이그레이션 기록이 없습니다. 새 스키마를 만들지 않습니다(잘못된 DB에 연결했을 가능성)." };
  if (p.mode !== "migrate") {
    return {
      action: "refuse",
      message: p.allowFlag
        ? "새 운영 스키마는 서버 시작 단계에서 만들지 않습니다. 'npm run deploy:migrate'(DEPLOY_ALLOW_NEW_SCHEMA=true 일시 지정)로 먼저 생성하세요."
        : "운영 스키마가 아직 없습니다. 처음 만드는 경우에만 DEPLOY_ALLOW_NEW_SCHEMA=true 를 일시적으로 지정하고 'npm run deploy:migrate'를 실행하세요.",
    };
  }
  if (!p.allowFlag) return { action: "refuse", message: "운영 스키마가 아직 없습니다. 처음 만드는 경우에만 DEPLOY_ALLOW_NEW_SCHEMA=true 를 일시적으로 지정하세요." };
  return { action: "create" };
}
