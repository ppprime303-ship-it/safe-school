// Beta PILOT 2 배포 분리: 기존 Prototype과 앱·포트·설정 파일·DB·계정·업로드 경로가 다르고, Prototype을 가리키면 시작을 거부
// 실제 서버·DB에는 접속하지 않습니다(순수 함수 + 저장소 설정 파일 + DB 연결 전에 끝나는 시작 검사만).
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import { describe, expect, it } from "vitest";
import { productionDbGuard, resolveDeployTarget } from "../server/src/deploy/dbTarget";
import { alertProviderErrors, betaEnvironmentErrors, betaPreflightErrors, betaUploadDirErrors, dataModeFor, demoSeedRefusal, deploymentRole, judgeToolsAllowed, pilotNetworkErrors } from "../server/src/deploy/environment";

const read = (p: string) => fs.readFileSync(p, "utf8");
const parseEnv = (text: string) =>
  Object.fromEntries(
    text
      .split("\n")
      .filter((l) => /^[A-Z_]+=/.test(l))
      .map((l) => [l.slice(0, l.indexOf("=")), l.slice(l.indexOf("=") + 1).trim()]),
  ) as Record<string, string>;
const good = (): Record<string, string> => {
  const e = parseEnv(read("deploy/env/beta.env.example"));
  return { ...e, DATABASE_URL: e.DATABASE_URL!.replace("<비밀번호>", "S3cret"), SESSION_SECRET: "x".repeat(48), APP_BASE_URL: "https://beta.example.invalid" };
};
const PROTOTYPE_URL = "postgresql://ss_pilot:S3cret@127.0.0.1:5432/safeschool?schema=safeschool_prod_pilot";

describe("Beta 대상 판정", () => {
  it("예시 env 그대로면 beta 역할, DB 보호·경보·분리 검사 모두 통과", () => {
    const env = good();
    expect(deploymentRole(env)).toBe("beta");
    expect(productionDbGuard(env)).toEqual([]);
    expect(betaEnvironmentErrors("beta", env)).toEqual([]);
    expect(alertProviderErrors("beta", env)).toEqual([]);
    const t = resolveDeployTarget(env);
    expect(t.ok && t.profile).toBe("beta");
  });

  it("Beta 앱에 Prototype 스키마·DB·계정·운영 프로필을 지정하면 거부(오류에 비밀번호 없음)", () => {
    const schemaOnly = productionDbGuard({ ...good(), DEPLOY_DB_SCHEMA: "safeschool_prod_pilot", DATABASE_URL: PROTOTYPE_URL });
    expect(schemaOnly.join()).toContain("Beta 배포는 safeschool_beta");
    expect(schemaOnly.join()).not.toContain("S3cret");
    // 스키마 이름만 맞추고 DB·계정이 Prototype인 경우
    const sameName = { ...good(), DATABASE_URL: "postgresql://ss_pilot:S3cret@127.0.0.1:5432/safeschool?schema=safeschool_beta" };
    expect(productionDbGuard(sameName)).toEqual([]);
    const errs = betaEnvironmentErrors("beta", sameName).join();
    expect(errs).toContain("DB safeschool_beta 만");
    expect(errs).toContain("계정 ss_beta 만");
    expect(errs).not.toContain("S3cret");
    expect(betaEnvironmentErrors("beta", { ...good(), DATABASE_URL: "postgresql://ss_beta:S3cret@db.example.com:5432/safeschool_beta?schema=safeschool_beta" }).join()).toContain("같은 서버");
    expect(betaEnvironmentErrors("beta", { ...good(), DATABASE_URL: "잘못된 주소" }).join()).toContain("같은 서버");
    // 운영 프로필은 Beta 스키마를 받지 않음(반대 방향 오접속)
    expect(productionDbGuard({ ...good(), DEPLOY_PROFILE: "production" }).join()).toContain("운영(production)");
    // 프로필을 빠뜨려도 Beta 스키마면 Beta 검사 대상
    expect(deploymentRole({ NODE_ENV: "production", DEPLOY_DB_SCHEMA: "safeschool_beta" })).toBe("beta");
  });

  it("개발 모드로 Beta 프로필을 켜면 거부(검사 우회 방지), 기존 Prototype 판정은 그대로", () => {
    expect(productionDbGuard({ ...good(), NODE_ENV: "development" }).join()).toContain("NODE_ENV");
    expect(deploymentRole({ NODE_ENV: "production", DEPLOY_PROFILE: "production", DEPLOY_DB_SCHEMA: "safeschool_prod_pilot" })).toBe("pilot");
    expect(betaEnvironmentErrors("pilot", {})).toEqual([]);
    expect(pilotNetworkErrors("beta", {})).toEqual([]);
  });

  it.each([
    ["PORT", "5000", "포트"],
    ["LISTEN_HOST", "0.0.0.0", "LISTEN_HOST"],
    ["TRUST_PROXY_HOPS", "2", "TRUST_PROXY_HOPS"],
    ["APP_BASE_URL", "http://beta.example.invalid", "https"],
    ["BETA_DATA_MODE", "", "BETA_DATA_MODE"],
    ["BETA_DATA_MODE", "school_pilot", "승인"],
    ["MAIL_PROVIDER", "resend", "실제 메일"],
    ["INCIDENT_UPLOAD_DIR", "", "INCIDENT_UPLOAD_DIR"],
  ])("%s=%s 이면 시작 거부", (name, value, expected) => {
    expect(betaEnvironmentErrors("beta", { ...good(), [name]: value }).join()).toContain(expected);
  });

  it("실제 학교 모드는 승인 표시가 있을 때만 통과, 화면 구분값도 그대로", () => {
    const env = { ...good(), BETA_DATA_MODE: "school_pilot", BETA_SCHOOL_PILOT_APPROVED: "true" };
    expect(betaEnvironmentErrors("beta", env)).toEqual([]);
    expect(dataModeFor("beta", env)).toBe("school_pilot");
    expect(dataModeFor("beta", good())).toBe("virtual_test");
    expect(dataModeFor("dev", {})).toBe("virtual_test");
    expect(dataModeFor("judge", {})).toBe("virtual_test");
    expect(dataModeFor("pilot", {})).toBe("school_pilot");
  });

  it("데모 시드: Beta 가상 데이터 모드만 허용, 모의 경보·심사 도구 금지", () => {
    expect(demoSeedRefusal("beta", good())).toBeNull();
    expect(demoSeedRefusal("beta", { ...good(), BETA_DATA_MODE: "school_pilot" })).toContain("데모 데이터");
    expect(alertProviderErrors("beta", { ...good(), ALERT_PROVIDERS: "mock", ALERT_MOCK_FEED: "x.json" }).join()).toContain("모의 경보");
    expect(judgeToolsAllowed("beta")).toBe(false);
  });

  it("연결 후 사전 점검: 실제 DB·계정이 다르거나 운영 스키마가 보이면 거부", () => {
    expect(betaPreflightErrors({ database: "safeschool_beta", user: "ss_beta", schemas: ["safeschool_beta"] })).toEqual([]);
    expect(betaPreflightErrors({ database: "safeschool", user: "ss_beta", schemas: [] }).join()).toContain("DB가");
    expect(betaPreflightErrors({ database: "safeschool_beta", user: "ss_pilot", schemas: [] }).join()).toContain("계정이");
    expect(betaPreflightErrors({ database: "safeschool_beta", user: "ss_beta", schemas: ["safeschool_beta", "safeschool_prod_pilot"] }).join()).toContain("safeschool_prod_pilot");
  });
});

describe("사진 저장 경로", () => {
  it.each(["/srv/safe-school-beta/current/data/incident-uploads", "/srv/safe-school/current/data", "./data/incident-uploads", "/var/lib/safe-school-beta/", "/var/lib/safe-school-beta/../safe-school/uploads", "/var/lib/safe-school/uploads"])("%s 거부", (dir) => {
    expect(betaUploadDirErrors({ INCIDENT_UPLOAD_DIR: dir }).length).toBe(1);
  });
  it("Beta 영구 경로 허용", () => {
    expect(betaUploadDirErrors({ INCIDENT_UPLOAD_DIR: "/var/lib/safe-school-beta/uploads" })).toEqual([]);
  });
});

describe("서버 시작 거부(실제 시작 코드, DB 연결 전에 종료)", () => {
  const start = (over: Record<string, string>) => {
    const { DATABASE_URL: _d, ...clean } = process.env;
    return spawnSync(process.execPath, ["--import", "tsx", "server/src/env.ts"], { env: { ...clean, ...good(), ...over }, encoding: "utf8", timeout: 30000 });
  };
  it("Prototype 스키마·DB를 지정하면 종료 코드 1, 비밀번호 출력 없음", () => {
    const r = start({ DEPLOY_DB_SCHEMA: "safeschool_prod_pilot", DATABASE_URL: PROTOTYPE_URL });
    expect(r.status).toBe(1);
    expect(r.stderr).toContain("safeschool_beta");
    expect(`${r.stdout}${r.stderr}`).not.toContain("S3cret");
  });
  it("쓸 수 없는 사진 폴더면 종료 코드 1", () => {
    const r = start({ INCIDENT_UPLOAD_DIR: "/var/lib/safe-school-beta/no-such-folder-for-test" });
    expect(r.status).toBe(1);
    expect(r.stderr).toContain("쓸 수 없습니다");
  });
});

describe("배포 설정 파일", () => {
  const unit = read("deploy/systemd/safe-school-beta.service");
  const env = parseEnv(read("deploy/env/beta.env.example"));
  const prototypeUnit = read("deploy/systemd/safe-school.service");

  it("env 예시: 비밀값 없음, Prototype 값·모의 경보·실제 메일 없음", () => {
    const text = read("deploy/env/beta.env.example");
    expect(env.SESSION_SECRET).toMatch(/^</);
    expect(env.DATABASE_URL).toContain("<비밀번호>");
    for (const banned of ["safeschool_prod", "ss_pilot", "/etc/safe-school/pilot"]) {
      expect(text.split("\n").filter((l) => !l.startsWith("#")).join("\n")).not.toContain(banned);
    }
    expect(text).not.toMatch(/^ALERT_/m);
    expect(text).not.toMatch(/^MAIL_PROVIDER=/m);
  });

  it("systemd: Prototype과 계정·경로·설정 파일·로그 이름이 다르고, Prototype 파일에 접근 차단", () => {
    for (const line of ["User=ss-beta", "WorkingDirectory=/srv/safe-school-beta/current", "EnvironmentFile=/etc/safe-school-beta/beta.env", "SyslogIdentifier=safe-school-beta", "ProtectSystem=strict", "ReadOnlyPaths=/srv/safe-school-beta", "ExecStartPre=/usr/bin/node dist/deploy-start.js --check", "ExecStart=/usr/bin/node dist/server/index.js"]) {
      expect(unit.split("\n")).toContain(line);
    }
    expect(unit).toMatch(/^InaccessiblePaths=-\/etc\/safe-school -\/srv\/safe-school$/m);
    for (const line of ["User=ss-beta", "EnvironmentFile=/etc/safe-school-beta/beta.env"]) expect(prototypeUnit.split("\n")).not.toContain(line);
    expect(Number(/^MemoryMax=(\d+)M$/m.exec(unit)![1])).toBeLessThan(Number(/^MemoryMax=(\d+)M$/m.exec(prototypeUnit)![1]));
  });

  it("systemd와 env의 사진 경로가 같고, 쓰기 경로는 코드 폴더 밖이며 앱 검사도 통과", () => {
    const rw = /^ReadWritePaths=(\S+)$/m.exec(unit)![1]!;
    expect(rw).toBe(env.INCIDENT_UPLOAD_DIR);
    expect(rw.startsWith("/srv/")).toBe(false);
    expect(unit).toMatch(/^StateDirectory=safe-school-beta\/uploads$/m);
    expect(unit).toMatch(/^StateDirectoryMode=0700$/m);
    expect(betaUploadDirErrors(env)).toEqual([]);
  });

  it("DB 계정 SQL: Beta 전용 DB·스키마만 만들고 Prototype 객체·비밀번호·삭제 문장 없음", () => {
    const sql = read("deploy/sql/beta-roles.sql");
    expect(sql).toContain("CREATE DATABASE safeschool_beta");
    expect(sql).toContain("CREATE SCHEMA safeschool_beta AUTHORIZATION ss_beta");
    expect(sql).toMatch(/NOSUPERUSER NOCREATEDB NOCREATEROLE/);
    expect(sql).not.toMatch(/PASSWORD\s+'/i);
    expect(sql).not.toMatch(/^\s*(DROP|TRUNCATE|DELETE)\b/im);
    expect(sql).not.toMatch(/CREATE SCHEMA safeschool_prod|ALTER ROLE ss_pilot|GRANT .* TO ss_pilot/);
    const hba = read("deploy/postgres/pg_hba.beta.example").split("\n").filter((l) => /^host/.test(l));
    expect(hba.length).toBe(2);
    for (const l of hba) {
      const [, db, user, addr] = l.split(/\s+/);
      expect([db, user]).toEqual(["safeschool_beta", "ss_beta"]);
      expect(addr).toMatch(/^(127\.0\.0\.1\/32|::1\/128)$/);
    }
  });
});
