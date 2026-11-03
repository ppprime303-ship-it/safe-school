// 공공 API 확인 도구의 호출 수 고정, 공식 명세 대조, 호출량 상한(가짜 응답, 실제 외부 호출 없음)
import { execFileSync, spawnSync } from "node:child_process";
import { readdirSync, readFileSync } from "node:fs";
import { betaEnvironmentErrors } from "../server/src/deploy/environment";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import type { PrismaClient } from "@prisma/client";
import { createTestClient, getTestDatabaseUrl, resetTestData } from "./test-db";
import { planSchoolinfoVerify } from "../scripts/schoolinfoVerifyPlan";
import { API_TYPE_BASIC_INFO, API_TYPE_GRADE_CLASS_STUDENTS, createSchoolinfoClient, SchoolinfoError } from "../server/src/integrations/schoolinfo";
import { SCHOOLINFO_SGG } from "../shared/schoolinfoRegions";
import { buildRequestUrl, MoisCbsSource, severityOf } from "../server/src/alerts/moisCbs";
import { classifyFeedError } from "../server/src/alerts/feedStatus";
import { collectOnce, kstDayStart } from "../server/src/alerts/collector";
import { createNeisClient } from "../server/src/integrations/neis";

const ps1 = readFileSync("scripts/preview/api-verify.ps1", "utf8");
const KEY = "test-key-not-real";

describe("학교알리미 호출 계획", () => {
  const scriptArgs = /\$schoolArgs = @\(([^)]*)\)/.exec(ps1)![1]!.split(",").map((s) => s.trim().replace(/'/g, ""));

  it("api-verify 인자는 영종구 기본정보 정확히 1회", () => {
    const plan = planSchoolinfoVerify(scriptArgs);
    expect(plan.error).toBeNull();
    expect(plan.calls.map((c) => c.apiType)).toEqual([API_TYPE_BASIC_INFO]);
    expect(plan.sgg).toBe("28155");
    expect(SCHOOLINFO_SGG.find(([c]) => c === "28155")?.[1]).toBe("영종구");
  });
  it("PowerShell 에서 인자를 잃는 npm run 을 쓰지 않음", () => {
    expect(ps1).not.toMatch(/npm run/);
    expect(ps1).toMatch(/\[switch\]\$DryRun/);
  });
  it("시군구가 없거나 공식 표에 없으면 호출 0회", () => {
    for (const argv of [["--basic-only"], ["--sgg", "28110", "--basic-only"], ["--sgg", "--basic-only"], ["--sgg", "abc"]]) {
      const plan = planSchoolinfoVerify(argv);
      expect(plan.calls).toEqual([]);
      expect(plan.error).toContain("호출하지 않았습니다");
    }
  });
  it("학년별 자료는 공시연도를 줄 때만 추가, --basic-only 가 우선", () => {
    expect(planSchoolinfoVerify(["--sgg", "28155"]).calls).toHaveLength(1);
    expect(planSchoolinfoVerify(["--sgg", "28155", "--pban-yr", "2026"]).calls.map((c) => c.apiType)).toEqual([API_TYPE_BASIC_INFO, API_TYPE_GRADE_CLASS_STUDENTS]);
    expect(planSchoolinfoVerify(["--sgg", "28155", "--pban-yr", "2026", "--basic-only"]).calls).toHaveLength(1);
  });
  it("요청에 시군구 포함, 출처 주소에 키 없음, 실패해도 재시도 없음, 오류에 키 없음", async () => {
    const urls: string[] = [];
    const fake = (body: unknown) => (async (u: URL) => {
      urls.push(String(u));
      return new Response(JSON.stringify(body), { status: 200 });
    }) as unknown as typeof fetch;
    const ok = await createSchoolinfoClient({ apiKey: KEY, fetchImpl: fake({ resultCode: "success", list: [{ SCHUL_CODE: "S0", SCHUL_NM: "가상초" }] }) }).fetch({ apiType: API_TYPE_BASIC_INFO, schulKndCode: "02", sidoCode: "28", sggCode: "28155" });
    expect(urls).toHaveLength(1);
    expect(urls[0]).toContain("sggCode=28155");
    expect(ok.sourceUrl).not.toContain(KEY);
    urls.length = 0;
    const failed = createSchoolinfoClient({ apiKey: KEY, fetchImpl: fake({ resultCode: "fail", resultMsg: "시군구 코드(sggCode)는 필수 정보입니다." }) }).fetch({ apiType: API_TYPE_BASIC_INFO, schulKndCode: "02", sidoCode: "28" });
    await expect(failed).rejects.toBeInstanceOf(SchoolinfoError);
    expect(urls).toHaveLength(1);
  });
});

describe("긴급재난문자 공식 명세", () => {
  it("요청 주소·인자가 공식 명세와 일치", () => {
    const u = new URL(buildRequestUrl("a/b", 1, "20261102"));
    expect(`${u.origin}${u.pathname}`).toBe("https://www.safetydata.go.kr/V2/api/DSSP-IF-00247");
    expect(Object.fromEntries(u.searchParams)).toEqual({ serviceKey: "a/b", returnType: "json", pageNo: "1", numOfRows: "100", crtDt: "20261102" });
    expect(buildRequestUrl("a%2Fb", 1, "20261102")).toContain("serviceKey=a%2Fb&");
  });
  it("공식 긴급단계 이름 판정", () => {
    expect([severityOf("위급재난"), severityOf("긴급재난"), severityOf("안전안내")]).toEqual(["emergency", "warning", "advisory"]);
  });
  it("공식 오류표: 32는 등록되지 않은 IP, 22는 호출 제한", () => {
    expect(classifyFeedError("공식 재난문자 API 결과 코드 32: ")).toBe("ip_blocked");
    expect(classifyFeedError("공식 재난문자 API 결과 코드 32: UNREGISTERED IP ERROR")).toBe("ip_blocked");
    expect(classifyFeedError("공식 재난문자 API 결과 코드 22: ")).toBe("rate_limited");
    expect(classifyFeedError("공식 재난문자 API 결과 코드 30: SERVICE KEY IS NOT REGISTERED ERROR")).toBe("rejected");
  });
  it("수집 1쪽 설정이면 자료가 많아도 1회만 호출", async () => {
    let calls = 0;
    const rows = Array.from({ length: 100 }, (_, i) => ({ SN: i, CRT_DT: "2026/11/02 10:00:00", MSG_CN: "가상", RCPTN_RGN_NM: "인천광역시 영종구" }));
    const s = new MoisCbsSource(KEY, (async () => { calls++; return { ok: true, status: 200, json: async () => ({ header: { resultCode: "00" }, totalCount: 900, body: rows }) }; }) as never, undefined, undefined, 1);
    await s.fetch();
    expect(calls).toBe(1);
  });
  it("환경 예시는 30분 간격, 15분 미만은 설정 불가, 수집기는 재시도 없음", () => {
    expect(readFileSync("deploy/env/pilot.env.example", "utf8")).toMatch(/^MOIS_CBS_INTERVAL_SEC=1800$/m);
    const env = readFileSync("server/src/env.ts", "utf8");
    expect(env).toMatch(/MOIS_CBS_INTERVAL_SEC: z\.coerce\.number\(\)\.int\(\)\.min\(900\)/);
    expect(readFileSync("server/src/index.ts", "utf8")).toMatch(/retries: 0, dailyCallLimit: env\.MOIS_CBS_DAILY_LIMIT/);
  });
});

describe("일일 호출 상한(수집 기록 기준, 서버 간 공유)", () => {
  let prisma: PrismaClient;
  beforeAll(() => {
    process.env.DATABASE_URL = getTestDatabaseUrl();
    prisma = createTestClient();
  });
  beforeEach(async () => {
    await resetTestData(prisma);
  });
  afterAll(async () => {
    await prisma.$disconnect();
  });
  const source = (onCall: () => void) => new MoisCbsSource(KEY, (async () => { onCall(); return { ok: true, status: 200, json: async () => ({ header: { resultCode: "00" }, totalCount: 0, body: [] }) }; }) as never, undefined, undefined, 1);
  const opts = { minIntervalMs: 0, retries: 0, dailyCallLimit: 3, callsPerAttempt: 1 };

  it("상한에 닿으면 호출하지 않고 건너뜀, 실패 호출도 셈, 전날 기록은 세지 않음", async () => {
    let calls = 0;
    for (let i = 0; i < 2; i++) expect((await collectOnce(prisma, source(() => calls++), opts)).status).toBe("success");
    const failing = new MoisCbsSource(KEY, (async () => { calls++; throw new Error("fetch failed"); }) as never, undefined, undefined, 1);
    expect((await collectOnce(prisma, failing, opts)).status).toBe("failed");
    expect(calls).toBe(3);
    expect((await collectOnce(prisma, source(() => calls++), opts)).status).toBe("skipped");
    expect(calls).toBe(3);
    await prisma.alertCollectionRun.updateMany({ data: { startedAt: new Date(kstDayStart(new Date()).getTime() - 1000) } });
    expect((await collectOnce(prisma, source(() => calls++), opts)).status).toBe("success");
  });
  it("제공기관 호출 제한(코드 22) 뒤에는 그날 호출하지 않음, 다음 날 재개", async () => {
    let calls = 0;
    const limited = new MoisCbsSource(KEY, (async () => { calls++; return { ok: true, status: 200, json: async () => ({ header: { resultCode: "22", resultMsg: "LIMITED NUMBER OF SERVICE REQUESTS EXCEEDS ERROR" }, body: [] }) }; }) as never, undefined, undefined, 1);
    const wide = { ...opts, dailyCallLimit: 50 };
    expect((await collectOnce(prisma, limited, wide)).status).toBe("failed");
    expect((await collectOnce(prisma, source(() => calls++), wide)).status).toBe("skipped");
    expect(calls).toBe(1);
    await prisma.alertCollectionRun.updateMany({ data: { startedAt: new Date(kstDayStart(new Date()).getTime() - 1000) } });
    expect((await collectOnce(prisma, source(() => calls++), wide)).status).toBe("success");
  });
  it("재시작해도 수집 간격 안에서는 다시 호출하지 않음", async () => {
    let calls = 0;
    const spaced = { ...opts, minIntervalMs: 60_000, dailyCallLimit: 50 };
    await collectOnce(prisma, source(() => calls++), spaced);
    expect((await collectOnce(prisma, source(() => calls++), spaced)).status).toBe("skipped");
    expect(calls).toBe(1);
  });
  it("한국 날짜 0시 계산", () => {
    expect(kstDayStart(new Date("2026-11-02T14:59:00Z")).toISOString()).toBe("2026-11-01T15:00:00.000Z");
    expect(kstDayStart(new Date("2026-11-02T15:00:00Z")).toISOString()).toBe("2026-11-02T15:00:00.000Z");
  });
});

describe("서버 일회성 재난문자 확인 도구", () => {
  const tool = "deploy/scripts/mois-verify-once.mjs";
  const source = readFileSync(tool, "utf8");
  const NOW = new Date("2026-11-02T03:00:00Z");
  const row = (o: object = {}) => ({ SN: 2, CRT_DT: "2026/11/02 10:00:00", MSG_CN: "민감할 수 있는 본문 010-0000-0000", RCPTN_RGN_NM: "인천광역시 중구", EMRG_STEP_NM: "안전안내", ...o });

  it("--dry-run 은 키 입력·호출 없이 계획만", () => {
    const out = execFileSync(process.execPath, [tool, "--dry-run"], { encoding: "utf8" });
    expect(out).toContain("1회");
    expect(out).toContain("/V2/api/DSSP-IF-00247");
  });
  it("터미널이 아니면 호출하지 않음", () => {
    const r = spawnSync(process.execPath, [tool], { encoding: "utf8", input: "piped" });
    expect(r.status).toBe(1);
    expect(r.stderr).toContain("터미널");
  });
  it("호출 1곳, 재시도·저장·앱 접근·환경변수 키 없음", () => {
    expect(source.match(/await fetch\(/g)).toHaveLength(1);
    expect(source).not.toMatch(/writeFile|appendFile|process\.env|child_process|DATABASE_URL|setTimeout/);
  });
  it("요청이 공식 명세와 일치, 조회시작일은 어제", async () => {
    const { buildUrl } = await import("../deploy/scripts/mois-verify-once.mjs");
    const u = new URL(buildUrl("a/b", NOW));
    expect(`${u.origin}${u.pathname}`).toBe("https://www.safetydata.go.kr/V2/api/DSSP-IF-00247");
    expect(Object.fromEntries(u.searchParams)).toEqual({ serviceKey: "a/b", returnType: "json", pageNo: "1", numOfRows: "100", crtDt: "20261101" });
  });
  it("정상 응답 요약: 항목·정렬·지역 표시, 본문 미출력", async () => {
    const { summarize } = await import("../deploy/scripts/mois-verify-once.mjs");
    const lines = summarize(200, JSON.stringify({ header: { resultCode: "00", resultMsg: "NORMAL SERVICE" }, totalCount: 2, body: [row(), row({ SN: 1, CRT_DT: "2026/11/02 09:00:00", RCPTN_RGN_NM: "부산광역시 전체" })] })).join("\n");
    expect(lines).toContain("정렬: 최신순");
    expect(lines).toContain("SN 고유: 2/2");
    expect(lines).toContain("인천광역시 중구");
    expect(lines).toContain("판정: 정상 응답");
    expect(lines).not.toContain("010-0000-0000");
    expect(lines).not.toContain("민감");
  });
  it("코드 32·XML·비정상 구조는 정상으로 판정하지 않음", async () => {
    const { summarize } = await import("../deploy/scripts/mois-verify-once.mjs");
    expect(summarize(200, JSON.stringify({ header: { resultCode: "32", resultMsg: "UNREGISTERED IP ERROR" }, body: [] })).join()).toContain("정상 응답 아님");
    expect(summarize(200, "<OpenAPI_ServiceResponse><returnReasonCode>30</returnReasonCode></OpenAPI_ServiceResponse>").join()).toContain("코드 30");
    expect(summarize(200, JSON.stringify({ header: { resultCode: "00" }, body: {} })).join()).toContain("body 배열 아님");
    expect(summarize(500, "oops").join()).toContain("JSON 아님");
  });
});

describe("Gmail 시험 스크립트 안전성", () => {
  const ps = readFileSync("scripts/preview/mail-signup-test.ps1", "utf8");
  it("테스트 DB·포트 5003 고정, 대상 확인, 초기화·시드·마이그레이션 없음", () => {
    expect(ps).toContain("/safeschool_test?schema=safeschool_test");
    expect(ps).toMatch(/\$u\.AbsolutePath -ne "\/safeschool_test"/);
    expect(ps).toContain('$env:PORT = "5003"');
    expect(ps).toContain('$env:LISTEN_HOST = "127.0.0.1"');
    expect(ps).not.toMatch(/migrate|db:seed|preview:setup|DROP|TRUNCATE|safeschool_preview\?|DEPLOY_PROFILE =/);
  });
  it("앱 비밀번호는 숨김 입력, 출력·파일 저장 없음, 종료 때 정리", () => {
    expect(ps).toMatch(/Read-Host .* -AsSecureString/);
    expect(ps).not.toMatch(/Set-Content|Out-File|Write-Host .*PASSWORD|Write-Output/);
    expect(ps).toMatch(/finally \{\s*Remove-Item Env:GMAIL_SMTP_APP_PASSWORD/);
  });
});

describe("나이스 500 구분", () => {
  it("HTML 500은 서버 오류로, 응답 형식 기록, 본문·키 없음", async () => {
    const c = createNeisClient({ apiKey: KEY, retries: 0, fetchImpl: async () => ({ ok: false, status: 500, json: async () => { throw new Error("no"); }, headers: { get: () => "text/html;charset=ISO-8859-1" } }) });
    await expect(c.searchSchools({ officeCode: "E10" })).rejects.toMatchObject({ kind: "server", message: "나이스 서버 오류(HTTP 500, text/html)" });
  });
});

describe("Beta 시작 검사와 키 노출", () => {
  const school = { BETA_DATA_MODE: "school_pilot", BETA_SCHOOL_PILOT_APPROVED: "true", MAIL_PROVIDER: "gmail" };
  it("실제 학교 모드 메일은 운영 발신 계정 승인 필요, 가상 모드는 실제 발송 거부", () => {
    expect(betaEnvironmentErrors("beta" as never, school).join()).toContain("BETA_MAIL_SENDER_APPROVED");
    expect(betaEnvironmentErrors("beta" as never, { ...school, BETA_MAIL_SENDER_APPROVED: "true" }).join()).not.toContain("BETA_MAIL_SENDER_APPROVED");
    expect(betaEnvironmentErrors("beta" as never, { BETA_DATA_MODE: "virtual_test", MAIL_PROVIDER: "gmail" }).join()).toContain("실제 메일 발송");
  });
  it("재난문자 수집은 환경별 호출 배분량이 필요(계약은 2026-11-03 실제 응답으로 확인)", () => {
    const errors = betaEnvironmentErrors("beta" as never, { ALERT_PROVIDERS: "mois_cbs" }).join();
    expect(errors).toContain("MOIS_CBS_DAILY_LIMIT");
    expect(errors).not.toContain("MOIS_CBS_CONTRACT");
  });
  it("화면 코드는 서버 비밀값 이름을 쓰지 않고 외부 API를 직접 부르지 않음", () => {
    const walk = (dir: string): string[] => readdirSync(dir, { withFileTypes: true }).flatMap((e) => (e.isDirectory() ? walk(`${dir}/${e.name}`) : /\.tsx?$/.test(e.name) ? [`${dir}/${e.name}`] : []));
    for (const f of [...walk("client/src"), ...walk("shared")]) {
      const text = readFileSync(f, "utf8");
      expect(text, f).not.toMatch(/SCHOOLINFO_API_KEY|NEIS_API_KEY|MOIS_CBS_SERVICE_KEY|KMA_WARNING_SERVICE_KEY|GMAIL_SMTP_APP_PASSWORD|SESSION_SECRET/);
      expect(text, f).not.toMatch(/apis\.data\.go\.kr|safetydata\.go\.kr\/V2|open\.neis\.go\.kr\/hub|schoolinfo\.go\.kr\/openApi/);
    }
  });
});

describe("비밀키 추적 제외", () => {
  it(".gitignore 규칙과 예시 파일의 빈 값", () => {
    const ignore = readFileSync(".gitignore", "utf8");
    for (const rule of [".env", "secrets/", "*.key", "*.pw"]) expect(ignore.split(/\r?\n/)).toContain(rule);
    const example = readFileSync(".env.example", "utf8");
    for (const n of ["SCHOOLINFO_API_KEY", "NEIS_API_KEY", "KMA_WARNING_SERVICE_KEY", "GMAIL_SMTP_APP_PASSWORD"]) expect(example).toMatch(new RegExp(`^${n}=$`, "m"));
  });
});
