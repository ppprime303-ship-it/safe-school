// STEP 6 배포·보안 점검(순수 함수·미들웨어 단위 — DB 접속 없음)
import { describe, expect, it } from "vitest";
import { newSchemaDecision, productionDbGuard, resolveDeployTarget, type DeployTargetOk } from "../server/src/deploy/dbTarget";
import {
  JUDGE_EMAIL_DOMAIN,
  buildJudgePlan,
  generatePassword,
  judgeApplyErrors,
  judgeDataIsolationErrors,
  judgeDbIsolationErrors,
  judgeTargetErrors,
  passwordFileErrors,
  passwordFileText,
  validateJudgePlan,
} from "../server/src/deploy/judgeDemo";
import { capabilitiesFor } from "../shared/permissions";
import { rateLimit, requireJsonForMutations } from "../server/src/middleware/security";
import { setSessionCookie, SESSION_COOKIE } from "../server/src/auth/session";
import { assertMockAllowed } from "../server/src/alerts/providers";
import { maskSensitive } from "../server/src/security/safeLog";
import { matchRegion, parseAddress, parseAreas } from "../server/src/alerts/region";
import fs from "node:fs";

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

describe("심사위원 시연 계획(가상 학교 2곳 × 계정 4개)", () => {
  const plan = buildJudgePlan();
  const caps = (key: string) => {
    const a = plan.accounts.find((x) => x.key === key)!;
    return capabilitiesFor(a.role, a.duties);
  };
  it("계획 점검 통과: 학교 2곳(초·중), 계정 8개, 학교별 4개, 교장 1명", () => {
    expect(validateJudgePlan(plan)).toEqual([]);
    expect(plan.schools.map((s) => [s.name, s.kindCode])).toEqual([["SAFE 시연초등학교(가상)", "02"], ["SAFE 시연중학교(가상)", "03"]]);
    expect(plan.accounts.length).toBe(8);
    expect(new Set(plan.accounts.map((a) => a.email)).size).toBe(8);
  });
  it("A1 앱 운영담당+담임: 교직원 승인·업무 지정 가능, 발령 불가, 1학년 1반 배정", () => {
    expect(caps("a1").includes("members.manage") && caps("a1").includes("duties.manage")).toBe(true);
    expect(caps("a1").includes("event.issue")).toBe(false);
    expect(plan.accounts.find((a) => a.key === "a1")!.assignments).toEqual([{ grade: 1, classNo: 1, duty: "homeroom" }]);
  });
  it("B2 안전업무 담당+담임: 발령·종료·상황판·훈련일지 작성 가능, 교직원 승인 불가", () => {
    for (const c of ["event.issue", "event.close", "board.view", "drilllog.edit"] as const) expect(caps("b2").includes(c)).toBe(true);
    expect(caps("b2").includes("members.manage")).toBe(false);
  });
  it("교장·교감: 발령·종료·상황판·훈련일지 열람만, 교직원 승인·훈련일지 수정 불가", () => {
    for (const k of ["a3", "a4", "b3", "b4"]) {
      expect(caps(k).includes("event.issue") && caps(k).includes("drilllog.view")).toBe(true);
      expect(caps(k).includes("members.manage") || caps(k).includes("drilllog.edit")).toBe(false);
    }
  });
  it("학교별로 다른 학급·인원·훈련 시나리오", () => {
    const [a, b] = plan.schools;
    expect([a!.classes.length, b!.classes.length]).toEqual([12, 12]);
    expect(Math.max(...a!.classes.map((c) => c.grade))).toBe(6);
    expect(Math.max(...b!.classes.map((c) => c.grade))).toBe(3);
    expect(a!.classes.reduce((t, c) => t + c.enrolled, 0) !== b!.classes.reduce((t, c) => t + c.enrolled, 0)).toBe(true);
    expect([a!.drill.type, b!.drill.type]).toEqual(["fire", "earthquake"]);
    expect([a!.drill.unreported.length, b!.drill.unreported.length]).toEqual([1, 2]);
  });
  it("나머지 학급은 로그인할 수 없는 가상 담임(이메일 고유, 예약 도메인)", () => {
    expect(plan.virtualStaff.length).toBe(22); // 24개 학급 - 심사 계정이 맡은 2개
    for (const v of plan.virtualStaff) expect(v.displayName.includes("로그인 불가") && v.email.endsWith(`@${JUDGE_EMAIL_DOMAIN}`)).toBe(true);
  });
  it("가상 주소로 모의 경보 지역 매칭: 초등(인천 남동구)·중학교(경기 수원시), 모의 경보 파일과 연결", () => {
    const [a, b] = plan.schools;
    expect(parseAddress(a!.address)).toEqual({ sido: "인천광역시", sigungu: "남동구" });
    expect(parseAddress(b!.address)).toEqual({ sido: "경기도", sigungu: "수원시" });
    const feed = JSON.parse(fs.readFileSync("deploy/judge/mock-alerts.json", "utf8")) as { id: string; body: string; areas: string; title: string }[];
    for (const x of feed) expect(x.body.includes("[모의") && x.title.startsWith("[모의]") && x.id.startsWith("judge-mock-")).toBe(true);
    const hits = (addr: string) => feed.filter((x) => matchRegion(parseAddress(addr), parseAreas(x.areas)).result === "target").map((x) => x.id);
    expect(hits(a!.address)).toEqual(["judge-mock-001", "judge-mock-003", "judge-mock-004"]);
    expect(hits(b!.address)).toEqual(["judge-mock-002", "judge-mock-003"]);
  });
  it("실제 개인정보 없음: 예약 도메인(.invalid), '가상' 표시, 소문자", () => {
    expect(JUDGE_EMAIL_DOMAIN.endsWith(".invalid")).toBe(true);
    for (const a of plan.accounts) expect(a.displayName.includes("가상") && a.email === a.email.toLowerCase()).toBe(true);
  });
  it("계획 점검이 권한 위반을 잡아냄(교장에게 운영 업무를 주면 오류)", () => {
    const bad = { ...plan, accounts: plan.accounts.map((a) => (a.key === "a3" ? { ...a, duties: [...a.duties, "app_operator" as const] } : a)) };
    expect(validateJudgePlan(bad).some((e) => e.includes("a3") && e.includes("members.manage"))).toBe(true);
  });
});

describe("심사 도구: 실제 학교 환경 차단(코드·DB)", () => {
  const t = (schema: string, profile = "production") => resolveDeployTarget({ DEPLOY_PROFILE: profile, DEPLOY_DB_SCHEMA: schema, DATABASE_URL: BASE }) as DeployTargetOk;
  it("심사 스키마만 허용, 시범운영·기타 운영 스키마·Replit 시연 거부", () => {
    expect(judgeTargetErrors(t("safeschool_prod_judge"))).toEqual([]);
    expect(judgeTargetErrors(t("safeschool_prod_pilot")).join()).toContain("실제 학교 시범운영");
    expect(judgeTargetErrors(t("safeschool_prod")).length).toBe(1);
    expect(judgeTargetErrors(t("safeschool_browser_demo", "demo")).length).toBe(2);
  });
  it("쓰기는 확인 문구(스키마 이름) 필요", () => {
    expect(judgeApplyErrors(t("safeschool_prod_judge"), "safeschool_prod_judge")).toEqual([]);
    expect(judgeApplyErrors(t("safeschool_prod_judge"), undefined).join()).toContain("JUDGE_SETUP_CONFIRM");
  });
  it("DB 계정이 시범운영 스키마를 쓸 수 있으면 거부(최소 권한 계정 필수)", () => {
    expect(judgeDbIsolationErrors([{ schema: "safeschool_prod_judge", usage: true }, { schema: "safeschool_prod_pilot", usage: false }], "ss_judge")).toEqual([]);
    expect(judgeDbIsolationErrors([{ schema: "safeschool_prod_judge", usage: true }, { schema: "safeschool_prod_pilot", usage: true }], "postgres").join()).toContain("safeschool_prod_pilot");
  });
  it("Replit 배포 DB: 같은 DB의 개발용 가상 스키마(test·browser_demo) 접근은 허용, 다른 운영 스키마는 거부", () => {
    const replit = [
      { schema: "safeschool_prod_judge", usage: true },
      { schema: "safeschool_test", usage: true },
      { schema: "safeschool_browser_demo", usage: true },
    ];
    expect(judgeDbIsolationErrors(replit, "replit_owner")).toEqual([]);
    expect(judgeDbIsolationErrors([...replit, { schema: "safeschool_prod", usage: true }], "replit_owner").join()).toContain("safeschool_prod");
  });
  it("심사 스키마에 시연 학교가 아닌 학교가 있으면 거부", () => {
    expect(judgeDataIsolationErrors(0)).toEqual([]);
    expect(judgeDataIsolationErrors(1).length).toBe(1);
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
  it("파일 내용은 운영자 전용 안내 + 계정 행", () => {
    const txt = passwordFileText([{ email: "judge-a3@x.invalid", password: "P", roleLabel: "교장", schoolName: "가상" }], "2026-10-26T00:00:00Z");
    expect(txt.split("\n")[0]).toContain("운영자 전용");
    expect(txt).toContain("judge-a3@x.invalid\tP\t교장\t가상");
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
  it("모의 경보: 개발·심사 환경만, 시범운영·기타 운영 거부(실제 공식 경보와 혼동 방지)", () => {
    expect(() => assertMockAllowed("production")).toThrow();
    expect(() => assertMockAllowed("production", "pilot")).toThrow();
    expect(() => assertMockAllowed("production", "production")).toThrow();
    expect(() => assertMockAllowed("production", "judge")).not.toThrow();
    expect(() => assertMockAllowed("development")).not.toThrow();
  });
});
