// STEP 7 국내 VPS(iwinv, 앱 1개 = 실제 학교 시범운영) 배포 설정 검사 — 순수 함수 + 저장소의 배포 설정 파일 내용
// 실제 서버·DB에는 접속하지 않습니다. 서버에서의 확인은 deploy/scripts/vps-check.sh(읽기 전용)로 합니다.
import fs from "node:fs";
import { describe, expect, it } from "vitest";
import { alertProviderErrors, deploymentRole, pilotNetworkErrors, pilotReadinessWarnings } from "../server/src/deploy/environment";
import { productionDbGuard, resolveDeployTarget } from "../server/src/deploy/dbTarget";
import { judgeApplyErrors, judgeDbIsolationErrors, judgeTargetErrors } from "../server/src/deploy/judgeDemo";

const read = (p: string) => fs.readFileSync(p, "utf8"); // vitest 는 저장소 루트에서 실행
const parseEnv = (text: string) =>
  Object.fromEntries(
    text
      .split("\n")
      .filter((l) => /^[A-Z_]+=/.test(l))
      .map((l) => [l.slice(0, l.indexOf("=")), l.slice(l.indexOf("=") + 1)]),
  ) as Record<string, string>;
// 예시 파일의 <…> 자리표시를 시험값으로 바꾼 시범운영 env
const exampleEnv = (): Record<string, string> => {
  const e = parseEnv(read("deploy/env/pilot.env.example"));
  return {
    ...e,
    DATABASE_URL: e.DATABASE_URL!.replace("<비밀번호>", "pw"),
    SESSION_SECRET: "x".repeat(48),
    APP_BASE_URL: "https://pilot.example.invalid",
  };
};
const good = () => ({ ...exampleEnv() });

describe("시범운영 네트워크 설정 강제(pilotNetworkErrors)", () => {
  it("예시 env 그대로면 시범운영 역할 + 통과(DB 보호·경보 공급자 검사 포함)", () => {
    const env = good();
    expect(deploymentRole(env)).toBe("pilot");
    expect(pilotNetworkErrors("pilot", env)).toEqual([]);
    expect(productionDbGuard(env)).toEqual([]);
    expect(alertProviderErrors("pilot", env)).toEqual([]);
  });
  it("0.0.0.0 수신(프록시 우회 직접 접속 가능)이면 거부, ::1 은 허용", () => {
    expect(pilotNetworkErrors("pilot", { ...good(), LISTEN_HOST: "0.0.0.0" }).join()).toContain("LISTEN_HOST");
    expect(pilotNetworkErrors("pilot", { ...good(), LISTEN_HOST: "::1" })).toEqual([]);
    const { LISTEN_HOST: _omit, ...noHost } = good();
    expect(pilotNetworkErrors("pilot", noHost).join()).toContain("LISTEN_HOST"); // 기본값 0.0.0.0
  });
  it.each(["0", "2", "3"])("TRUST_PROXY_HOPS=%s 거부(0: 모두 127.0.0.1로 보임, 2+: 위조 값 신뢰)", (h) => {
    expect(pilotNetworkErrors("pilot", { ...good(), TRUST_PROXY_HOPS: h }).join()).toContain("TRUST_PROXY_HOPS=1");
  });
  it("DB가 같은 서버가 아니면 거부(오류에 주소·비밀번호 없음)", () => {
    const errs = pilotNetworkErrors("pilot", { ...good(), DATABASE_URL: "postgresql://ss_pilot:S3cret@db.example.com:5432/safeschool?schema=safeschool_prod_pilot" }).join(" ");
    expect(errs).toContain("같은 서버");
    expect(errs).not.toContain("S3cret");
    expect(errs).not.toContain("db.example.com");
    expect(pilotNetworkErrors("pilot", { ...good(), DATABASE_URL: "postgresql://u:p@[::1]:5432/safeschool?schema=safeschool_prod_pilot" })).toEqual([]);
    expect(pilotNetworkErrors("pilot", { ...good(), DATABASE_URL: "잘못된 주소" }).join()).toContain("같은 서버");
  });
  it("APP_BASE_URL 이 https 가 아니면 거부", () => {
    expect(pilotNetworkErrors("pilot", { ...good(), APP_BASE_URL: "http://pilot.example.invalid" }).join()).toContain("https");
  });
  it("심사(Replit)·개발 환경에는 적용하지 않음(Replit은 0.0.0.0 필요)", () => {
    const replit = { NODE_ENV: "production", LISTEN_HOST: "0.0.0.0", DATABASE_URL: "postgresql://u:p@helium/heliumdb?schema=safeschool_prod_judge" };
    expect(pilotNetworkErrors("judge", replit)).toEqual([]);
    expect(pilotNetworkErrors("dev", replit)).toEqual([]);
  });
  it("기능 설정이 빠지면 경고만(값은 문구에 없음)", () => {
    const w = pilotReadinessWarnings("pilot", { ...good(), MAIL_API_KEY: "", SCHOOLINFO_API_KEY: "" });
    expect(w.join()).toContain("메일");
    expect(w.join()).toContain("학교알리미");
    expect(w.join()).toContain("재난문자");
    expect(pilotReadinessWarnings("judge", {})).toEqual([]);
  });
});

describe("심사 도구는 국내 VPS(시범운영)에서 실행 불가", () => {
  it("코드: 시범운영 대상이면 계획 보기·쓰기 모두 거부", () => {
    const t = resolveDeployTarget(good());
    expect(t.ok).toBe(true);
    if (!t.ok) return;
    expect(judgeTargetErrors(t).join()).toContain("시범운영");
    expect(judgeApplyErrors(t, "safeschool_prod_pilot").length).toBeGreaterThan(0);
  });
  it("DB: 시범운영 계정의 실제 권한 조회 결과(로컬 PostgreSQL 16, 2026-10-26)로도 거부", () => {
    // ss_pilot 로 `SELECT nspname, has_schema_privilege(current_user, oid, 'USAGE') FROM pg_namespace WHERE nspname LIKE 'safeschool%'` → pilot|t 한 줄
    expect(judgeDbIsolationErrors([{ schema: "safeschool_prod_pilot", usage: true }], "ss_pilot").join()).toContain("safeschool_prod_pilot");
  });
});

describe("배포 설정 파일(앱 1개)", () => {
  const env = parseEnv(read("deploy/env/pilot.env.example"));
  it("env 예시: 실제 비밀값 없음(자리표시만), 모의 경보 없음, 심사 스키마 없음", () => {
    const text = read("deploy/env/pilot.env.example");
    expect(env.SESSION_SECRET).toMatch(/^</);
    expect(env.DATABASE_URL).toContain("<비밀번호>");
    expect(env.MAIL_API_KEY).toMatch(/^</);
    expect(text).not.toMatch(/^ALERT_PROVIDERS=.*mock/m);
    expect(text).not.toMatch(/^ALERT_MOCK_FEED=/m);
    expect(text).not.toContain("safeschool_prod_judge");
  });
  it("Caddy: 같은 서버 앱 포트로만 프록시, trusted_proxies 없음(클라이언트 X-Forwarded-For 무시), 접속 로그 헤더 삭제", () => {
    const caddy = read("deploy/caddy/Caddyfile.example");
    const proxies = [...caddy.matchAll(/reverse_proxy\s+(\S+)/g)].map((m) => m[1]);
    expect(proxies).toEqual([`127.0.0.1:${env.PORT}`]);
    expect(caddy).not.toMatch(/^\s*trusted_proxies/m);
    expect(caddy).toMatch(/request>headers delete/);
    expect(caddy).toMatch(/roll_keep_for/);
    expect(caddy).not.toContain("5001");
  });
  it("systemd: 시범운영 1개, 시작 전 읽기 전용 점검, 서버만 실행(재시작으로 마이그레이션하지 않음), 메모리 상한", () => {
    const unit = read("deploy/systemd/safe-school.service");
    expect(unit).toMatch(/^EnvironmentFile=\/etc\/safe-school\/pilot\.env$/m);
    expect(unit).toMatch(/^User=ss-pilot$/m);
    expect(unit).toMatch(/^ExecStartPre=\/usr\/bin\/node dist\/deploy-start\.js --check$/m);
    expect(unit).toMatch(/^ExecStart=\/usr\/bin\/node dist\/server\/index\.js$/m);
    expect(unit).not.toMatch(/^ExecStart=.*deploy-start\.js\s*$/m);
    expect(unit).toMatch(/^MemoryMax=\d+M$/m);
    expect(unit).toMatch(/max-old-space-size=\d+/);
    expect(unit).not.toContain("%i");
  });
  it("DB 계정 SQL: 시범운영 스키마만, 비밀번호를 파일에 적지 않음", () => {
    const sql = read("deploy/sql/roles.sql");
    expect(sql).toContain("CREATE SCHEMA safeschool_prod_pilot AUTHORIZATION ss_pilot");
    expect(sql).not.toMatch(/CREATE SCHEMA safeschool_prod_judge/);
    expect(sql).not.toMatch(/CREATE ROLE ss_judge/);
    expect(sql).not.toMatch(/PASSWORD\s+'/i);
    expect(sql).toMatch(/NOSUPERUSER NOCREATEDB NOCREATEROLE/);
  });
  it("PostgreSQL: 루프백에서만 받음, SQL·값이 로그에 남지 않게", () => {
    const conf = read("deploy/postgres/90-safeschool.conf");
    expect(conf).toMatch(/^listen_addresses = 'localhost'$/m);
    expect(conf).toMatch(/^log_statement = 'none'$/m);
    expect(conf).toMatch(/^log_min_error_statement = panic$/m);
    expect(conf).toMatch(/^log_error_verbosity = terse$/m);
    const hba = read("deploy/postgres/pg_hba.conf.example")
      .split("\n")
      .filter((l) => /^host/.test(l));
    expect(hba.length).toBeGreaterThan(0);
    for (const l of hba) expect(l.split(/\s+/)[3]).toMatch(/^(127\.0\.0\.1\/32|::1\/128)$/);
  });
  it("백업 스크립트: 시범운영 스키마만", () => {
    const sh = read("deploy/scripts/pg-backup.sh");
    expect(sh).toMatch(/^SCHEMA="safeschool_prod_pilot"$/m);
    expect(sh).not.toContain("safeschool_prod_judge_");
  });
});
