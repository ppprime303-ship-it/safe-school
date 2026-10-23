// STEP 3-F 배포 DB 대상 안전장치(순수 — DB 접속 없음)
import { describe, expect, it } from "vitest";
import { describeDbUrl, productionDbGuard, resolveDeployTarget } from "../server/src/deploy/dbTarget.js";

const BASE = "postgresql://appuser:S3cr3t-pass@helium:5432/heliumdb?sslmode=disable";
const ok = (env: Record<string, string | undefined>) => {
  const r = resolveDeployTarget(env);
  if (!r.ok) throw new Error(r.errors.join("; "));
  return r;
};
const errs = (env: Record<string, string | undefined>) => {
  const r = resolveDeployTarget(env);
  expect(r.ok).toBe(false);
  return r.ok ? [] : r.errors.join(" | ");
};

describe("배포 DB 대상 검증", () => {
  it("시연: 명시한 safeschool_browser_demo 허용, 같은 주소에 schema를 붙여 마이그레이션·서버가 공유", () => {
    const r = ok({ DATABASE_URL: BASE, DEPLOY_PROFILE: "demo", DEPLOY_DB_SCHEMA: "safeschool_browser_demo" });
    expect(new URL(r.url).searchParams.get("schema")).toBe("safeschool_browser_demo");
    expect(new URL(r.url).searchParams.get("sslmode")).toBe("disable"); // 다른 매개변수 보존
    expect(r.summary).toBe("helium/heliumdb · schema=safeschool_browser_demo · 프로필=demo");
  });

  it("URL에 이미 같은 schema가 있으면 허용, 다르면 거부", () => {
    expect(ok({ DATABASE_URL: `${BASE}&schema=safeschool_browser_demo`, DEPLOY_PROFILE: "demo", DEPLOY_DB_SCHEMA: "safeschool_browser_demo" }).schema).toBe("safeschool_browser_demo");
    expect(errs({ DATABASE_URL: `${BASE}&schema=public`, DEPLOY_PROFILE: "demo", DEPLOY_DB_SCHEMA: "safeschool_browser_demo" })).toContain("다릅니다");
  });

  it("운영: safeschool_prod(_이름)만 허용, 시연·운영 스키마 교차 사용 거부", () => {
    expect(ok({ DATABASE_URL: BASE, DEPLOY_PROFILE: "production", DEPLOY_DB_SCHEMA: "safeschool_prod" }).profile).toBe("production");
    expect(ok({ DATABASE_URL: BASE, DEPLOY_PROFILE: "production", DEPLOY_DB_SCHEMA: "safeschool_prod_seoul1" }).schema).toBe("safeschool_prod_seoul1");
    expect(errs({ DATABASE_URL: BASE, DEPLOY_PROFILE: "production", DEPLOY_DB_SCHEMA: "safeschool_browser_demo" })).toContain("운영(production)");
    expect(errs({ DATABASE_URL: BASE, DEPLOY_PROFILE: "demo", DEPLOY_DB_SCHEMA: "safeschool_prod" })).toContain("시연(demo)");
  });

  it("거부: 스키마 미지정·public·safeschool_test·이름에 test·형식 오류", () => {
    expect(errs({ DATABASE_URL: BASE, DEPLOY_PROFILE: "demo" })).toContain("DEPLOY_DB_SCHEMA가 없습니다");
    expect(errs({ DATABASE_URL: BASE, DEPLOY_PROFILE: "demo", DEPLOY_DB_SCHEMA: "public" })).toContain("public 스키마");
    expect(errs({ DATABASE_URL: BASE, DEPLOY_PROFILE: "demo", DEPLOY_DB_SCHEMA: "safeschool_test" })).toContain("테스트 스키마");
    expect(errs({ DATABASE_URL: BASE, DEPLOY_PROFILE: "production", DEPLOY_DB_SCHEMA: "safeschool_prod_test" })).toContain("테스트 스키마");
    expect(errs({ DATABASE_URL: BASE, DEPLOY_PROFILE: "demo", DEPLOY_DB_SCHEMA: "Demo; DROP SCHEMA x" })).toContain("형식이 올바르지 않습니다");
    expect(errs({ DATABASE_URL: BASE, DEPLOY_PROFILE: "demo", DEPLOY_DB_SCHEMA: "   " })).toContain("DEPLOY_DB_SCHEMA가 없습니다");
  });

  it("거부: 누락된 설정·잘못된 프로필·잘못된 URL", () => {
    expect(errs({})).toContain("DATABASE_URL이 없습니다");
    expect(errs({ DATABASE_URL: BASE, DEPLOY_DB_SCHEMA: "safeschool_browser_demo" })).toContain("DEPLOY_PROFILE이 없습니다");
    expect(errs({ DATABASE_URL: BASE, DEPLOY_PROFILE: "prod", DEPLOY_DB_SCHEMA: "safeschool_prod" })).toContain("DEPLOY_PROFILE 값이 올바르지 않습니다");
    expect(errs({ DATABASE_URL: "not a url", DEPLOY_PROFILE: "demo", DEPLOY_DB_SCHEMA: "safeschool_browser_demo" })).toContain("형식을 읽을 수 없습니다");
    expect(errs({ DATABASE_URL: "mysql://u:p@h/db", DEPLOY_PROFILE: "demo", DEPLOY_DB_SCHEMA: "safeschool_browser_demo" })).toContain("PostgreSQL 주소가 아닙니다");
    expect(errs({ DATABASE_URL: "postgresql://u:p@helium", DEPLOY_PROFILE: "demo", DEPLOY_DB_SCHEMA: "safeschool_browser_demo" })).toContain("DB 이름이 없습니다");
  });

  it("오류·요약에 비밀번호·사용자 이름이 나오지 않음", () => {
    const all = [
      errs({ DATABASE_URL: BASE, DEPLOY_PROFILE: "demo", DEPLOY_DB_SCHEMA: "public" }),
      errs({ DATABASE_URL: `${BASE}&schema=x`, DEPLOY_PROFILE: "demo", DEPLOY_DB_SCHEMA: "safeschool_browser_demo" }),
      ok({ DATABASE_URL: BASE, DEPLOY_PROFILE: "demo", DEPLOY_DB_SCHEMA: "safeschool_browser_demo" }).summary,
      describeDbUrl(BASE),
    ].join(" ");
    expect(all).not.toContain("S3cr3t-pass");
    expect(all).not.toContain("appuser");
    expect(describeDbUrl(BASE)).toBe("helium/heliumdb · schema=(미지정 → public)");
  });
});

describe("서버 시작 검사(운영 모드)", () => {
  const demo = { DEPLOY_PROFILE: "demo", DEPLOY_DB_SCHEMA: "safeschool_browser_demo" };
  it("개발·테스트 모드는 검사하지 않음(Run 워크플로·자동 테스트 영향 없음)", () => {
    expect(productionDbGuard({ NODE_ENV: "development", DATABASE_URL: BASE })).toEqual([]);
    expect(productionDbGuard({ NODE_ENV: "test", DATABASE_URL: `${BASE}&schema=safeschool_test` })).toEqual([]);
    expect(productionDbGuard({ DATABASE_URL: BASE })).toEqual([]);
  });
  it("운영 모드: 배포 스크립트가 schema를 붙인 주소면 통과, schema 없는 주소로 직접 npm start 하면 거부", () => {
    expect(productionDbGuard({ NODE_ENV: "production", DATABASE_URL: `${BASE}&schema=safeschool_browser_demo`, ...demo })).toEqual([]);
    expect(productionDbGuard({ NODE_ENV: "production", DATABASE_URL: BASE, ...demo }).join()).toContain("deploy:start");
    expect(productionDbGuard({ NODE_ENV: "production", DATABASE_URL: `${BASE}&schema=safeschool_browser_demo` }).join()).toContain("DEPLOY_PROFILE이 없습니다");
    expect(productionDbGuard({ NODE_ENV: "production", DATABASE_URL: `${BASE}&schema=safeschool_test`, DEPLOY_PROFILE: "demo", DEPLOY_DB_SCHEMA: "safeschool_test" }).join()).toContain("테스트 스키마");
  });
});
