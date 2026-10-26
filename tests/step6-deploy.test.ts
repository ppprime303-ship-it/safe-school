// STEP 6 배포·보안 점검(순수 함수·미들웨어 단위 — DB 접속 없음)
import { describe, expect, it } from "vitest";
import { newSchemaDecision, productionDbGuard, resolveDeployTarget, type DeployTargetOk } from "../server/src/deploy/dbTarget";
import {
  JUDGE_EMAIL_DOMAIN,
  buildJudgePlan,
  generatePassword,
  judgeApplyErrors,
  passwordFileErrors,
  passwordFileText,
  validateJudgePlan,
} from "../server/src/deploy/judgeDemo";
import { capabilitiesFor } from "../shared/permissions";
import { rateLimit, requireJsonForMutations } from "../server/src/middleware/security";
import { setSessionCookie, SESSION_COOKIE } from "../server/src/auth/session";
import { assertMockAllowed } from "../server/src/alerts/providers";
import { maskSensitive } from "../server/src/security/safeLog";

const BASE = "postgresql://app:pw@db.internal:5432/safeschool";
const prodEnv = { NODE_ENV: "production", DEPLOY_PROFILE: "production", DEPLOY_DB_SCHEMA: "safeschool_prod_judge", DATABASE_URL: `${BASE}?schema=safeschool_prod_judge` };

describe("운영 서버 시작 보호(productionDbGuard)", () => {
  it("운영 프로필 + 전용 스키마 → 통과", () => {
    expect(productionDbGuard(prodEnv)).toEqual([]);
  });
  it("운영 프로필인데 NODE_ENV가 production이 아니면 시작 거부(systemd 설정 누락 대비)", () => {
    for (const NODE_ENV of [undefined, "development", "test"]) expect(productionDbGuard({ ...prodEnv, NODE_ENV }).join()).toContain("NODE_ENV");
  });
  it("Replit 개발·테스트(운영 프로필 없음)는 기존처럼 통과", () => {
    expect(productionDbGuard({ NODE_ENV: "development", DATABASE_URL: `${BASE}?schema=safeschool_browser_demo` })).toEqual([]);
    expect(productionDbGuard({ NODE_ENV: "test", DEPLOY_PROFILE: "demo", DATABASE_URL: `${BASE}?schema=safeschool_test` })).toEqual([]);
  });
  it("심사 DB가 Replit 시연·테스트·public 스키마를 가리키면 거부", () => {
    for (const schema of ["safeschool_browser_demo", "safeschool_test", "public", "safeschool_prod_test"]) {
      const errs = productionDbGuard({ ...prodEnv, DEPLOY_DB_SCHEMA: schema, DATABASE_URL: `${BASE}?schema=${schema}` });
      expect(errs.length > 0).toBe(true);
    }
    expect(productionDbGuard({ ...prodEnv, DATABASE_URL: BASE }).join()).toContain("deploy:start"); // 주소에 schema 없음
  });
  it("오류 메시지에 비밀번호·전체 주소가 없음", () => {
    const errs = productionDbGuard({ ...prodEnv, DATABASE_URL: "postgresql://app:S3cr3tPw@db.internal:5432/safeschool?schema=public" }).join(" ");
    expect(errs).not.toContain("S3cr3tPw");
    expect(maskSensitive("postgresql://app:S3cr3tPw@db.internal:5432/x")).toBe("[주소 가림]");
  });
});

describe("새 스키마 생성 정책(DEPLOY_ALLOW_NEW_SCHEMA 오용 방지)", () => {
  it("운영: 마이그레이션 단계 + 플래그일 때만 생성", () => {
    expect(newSchemaDecision({ profile: "production", mode: "migrate", schemaReady: false, allowFlag: true }).action).toBe("create");
    expect(newSchemaDecision({ profile: "production", mode: "migrate", schemaReady: false, allowFlag: false }).action).toBe("refuse");
  });
  it("서버 시작·점검 단계에서는 플래그가 남아 있어도 새로 만들지 않음", () => {
    for (const mode of ["start", "check"] as const) {
      const d = newSchemaDecision({ profile: "production", mode, schemaReady: false, allowFlag: true });
      expect(d.action).toBe("refuse");
      expect(d.message).toContain("deploy:migrate");
    }
  });
  it("이미 있는 스키마에 플래그가 남아 있으면 진행하되 제거 경고", () => {
    const d = newSchemaDecision({ profile: "production", mode: "start", schemaReady: true, allowFlag: true });
    expect(d.action).toBe("proceed");
    expect(d.warn).toContain("제거");
    expect(newSchemaDecision({ profile: "production", mode: "start", schemaReady: true, allowFlag: false }).warn).toBe(undefined);
  });
  it("시연(demo) 프로필은 새 스키마를 절대 만들지 않음", () => {
    expect(newSchemaDecision({ profile: "demo", mode: "migrate", schemaReady: false, allowFlag: true }).action).toBe("refuse");
  });
});

describe("심사위원 시연 계획", () => {
  it("독립형(권장): 학교 5곳·계정 5개, 계정마다 발령·종료·상황판·교직원 승인·훈련일지 작성 가능", () => {
    const p = buildJudgePlan("independent");
    expect(validateJudgePlan(p)).toEqual([]);
    expect(p.schools.length).toBe(5);
    expect(new Set(p.accounts.map((a) => a.schoolKey)).size).toBe(5); // 학교가 서로 다름 → 발령이 섞이지 않음
    for (const a of p.accounts) {
      const caps = capabilitiesFor(a.role, a.duties);
      for (const c of ["event.issue", "event.close", "board.view", "members.manage", "drilllog.edit"] as const) expect(caps.includes(c)).toBe(true);
    }
  });
  it("공유형: 학교 1곳에 앱 운영담당·교장·안전업무 담당·담임·교감(기존 권한 구조만 사용)", () => {
    const p = buildJudgePlan("shared");
    expect(validateJudgePlan(p)).toEqual([]);
    expect(p.accounts.map((a) => a.roleLabel)).toEqual(["앱 운영담당", "교장", "안전업무 담당", "담임교사", "교감"]);
    const capsOf = (i: number) => capabilitiesFor(p.accounts[i]!.role, p.accounts[i]!.duties);
    expect(capsOf(0).includes("members.manage")).toBe(true);
    expect(capsOf(0).includes("event.issue")).toBe(false); // 앱 운영만으로 발령 불가
    expect(capsOf(1).includes("members.manage")).toBe(false); // 교장 직책만으로 승인 불가
    expect(capsOf(3)).toEqual([]); // 담임: 배정 학급 보고만(별도 권한 없음)
  });
  it("실제 개인정보 없음: 예약 도메인 이메일·'가상' 표시·소문자", () => {
    for (const layout of ["independent", "shared"] as const) {
      const p = buildJudgePlan(layout);
      for (const a of p.accounts) {
        expect(a.email.endsWith(`@${JUDGE_EMAIL_DOMAIN}`) && JUDGE_EMAIL_DOMAIN.endsWith(".invalid")).toBe(true);
        expect(a.displayName.includes("가상")).toBe(true);
      }
      for (const s of p.schools) expect(s.name.includes("(가상)")).toBe(true);
    }
  });
  it("계획 점검이 규칙 위반을 잡아냄", () => {
    const p = buildJudgePlan("shared");
    p.accounts[0] = { ...p.accounts[0]!, email: "Real.Person@school.go.kr", duties: [] };
    const errs = validateJudgePlan(p);
    expect(errs.some((e) => e.includes("예약 도메인"))).toBe(true);
    expect(errs.some((e) => e.includes("members.manage"))).toBe(true);
  });
});

describe("심사위원 비밀번호·파일", () => {
  it("무작위 20자, 네 종류 문자 포함, 매번 다름", () => {
    const set = new Set(Array.from({ length: 50 }, () => generatePassword()));
    expect(set.size).toBe(50);
    for (const pw of set) {
      expect(pw.length).toBe(20);
      expect(/[A-Z]/.test(pw) && /[a-z]/.test(pw) && /[0-9]/.test(pw) && /[^A-Za-z0-9]/.test(pw)).toBe(true);
    }
    expect(() => generatePassword(12)).toThrow();
  });
  it("비밀번호 파일: 절대 경로·저장소 밖·새 파일만", () => {
    expect(passwordFileErrors("/root/judge.txt", "/srv/safe-school", false)).toEqual([]);
    expect(passwordFileErrors(undefined, "/srv/safe-school", false).length).toBe(1);
    expect(passwordFileErrors("judge.txt", "/srv/safe-school", false).join()).toContain("절대 경로");
    expect(passwordFileErrors("/srv/safe-school/docs/judge.txt", "/srv/safe-school", false).join()).toContain("저장소");
    expect(passwordFileErrors("/root/judge.txt", "/srv/safe-school", true).join()).toContain("덮어쓰지");
  });
  it("적용(--apply)은 운영 프로필 + 스키마 이름 확인 문구가 있어야", () => {
    const t = resolveDeployTarget(prodEnv) as DeployTargetOk;
    expect(judgeApplyErrors(t, "safeschool_prod_judge")).toEqual([]);
    expect(judgeApplyErrors(t, undefined).join()).toContain("JUDGE_SETUP_CONFIRM");
    const demo = resolveDeployTarget({ DEPLOY_PROFILE: "demo", DEPLOY_DB_SCHEMA: "safeschool_browser_demo", DATABASE_URL: BASE }) as DeployTargetOk;
    expect(judgeApplyErrors(demo, "safeschool_browser_demo").join()).toContain("Replit 시연 DB 금지");
  });
  it("파일 내용은 운영자 전용 안내 + 계정 행", () => {
    const txt = passwordFileText([{ email: "judge1@x.invalid", password: "P", roleLabel: "교장", schoolName: "가상" }], "2026-10-26T00:00:00Z");
    expect(txt.split("\n")[0]).toContain("운영자 전용");
    expect(txt).toContain("judge1@x.invalid\tP\t교장\t가상");
  });
});

describe("보안 미들웨어·쿠키·모의 경보", () => {
  const run = (mw: (req: never, res: never, next: (e?: unknown) => void) => void, req: object) => {
    let err: unknown = "not-called";
    mw(req as never, {} as never, (e?: unknown) => (err = e));
    return err as { status?: number } | undefined;
  };
  it("CSRF: 상태 변경 요청은 JSON 본문 또는 전용 헤더만", () => {
    expect(run(requireJsonForMutations, { method: "POST", headers: { "content-type": "application/x-www-form-urlencoded", "content-length": "10" } })?.status).toBe(415);
    expect(run(requireJsonForMutations, { method: "POST", headers: {} })?.status).toBe(400);
    expect(run(requireJsonForMutations, { method: "POST", headers: { "x-requested-with": "safe-school" } })).toBe(undefined);
    expect(run(requireJsonForMutations, { method: "POST", headers: { "content-type": "application/json", "content-length": "2" } })).toBe(undefined);
    expect(run(requireJsonForMutations, { method: "GET", headers: {} })).toBe(undefined);
  });
  it("요청 횟수 제한은 IP별(프록시가 넘긴 실제 IP 기준)", () => {
    const mw = rateLimit({ windowMs: 60_000, max: 2 });
    const hit = (ip: string) => run(mw, { ip });
    expect([hit("1.1.1.1"), hit("1.1.1.1"), hit("1.1.1.1")?.status]).toEqual([undefined, undefined, 429]);
    expect(hit("2.2.2.2")).toBe(undefined);
  });
  it("운영 쿠키: HttpOnly·Secure·SameSite=Lax·경로 /", () => {
    const prev = process.env.NODE_ENV;
    process.env.NODE_ENV = "production";
    try {
      let got: { name?: string; opts?: Record<string, unknown> } = {};
      const res = { cookie: (name: string, _v: string, opts: Record<string, unknown>) => (got = { name, opts }) };
      setSessionCookie(res as never, { token: "t", expiresAt: new Date(Date.now() + 1000), deviceKind: "shared" });
      expect(got.name).toBe(SESSION_COOKIE);
      expect(got.opts).toMatchObject({ httpOnly: true, secure: true, sameSite: "lax", path: "/" });
      expect("expires" in got.opts!).toBe(false); // 공용 기기: 브라우저를 닫으면 삭제
    } finally {
      process.env.NODE_ENV = prev;
    }
  });
  it("운영 모드에서는 모의 경보 공급자 사용 거부(실제 공식 경보와 혼동 방지)", () => {
    expect(() => assertMockAllowed("production")).toThrow();
    expect(() => assertMockAllowed("development")).not.toThrow();
  });
});
