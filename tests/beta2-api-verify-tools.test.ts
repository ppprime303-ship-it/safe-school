// 공공 API 확인 도구의 호출 수 고정, 공식 명세 대조, 호출량 상한(가짜 응답, 실제 외부 호출 없음)
import { readFileSync } from "node:fs";
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
  it("환경 예시에 15분 미만 간격이 없음, 수집기는 재시도 없음", () => {
    expect(readFileSync("deploy/env/pilot.env.example", "utf8")).toMatch(/^MOIS_CBS_INTERVAL_SEC=900$/m);
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
  it("한국 날짜 0시 계산", () => {
    expect(kstDayStart(new Date("2026-11-02T14:59:00Z")).toISOString()).toBe("2026-11-01T15:00:00.000Z");
    expect(kstDayStart(new Date("2026-11-02T15:00:00Z")).toISOString()).toBe("2026-11-02T15:00:00.000Z");
  });
});

describe("나이스 500 구분", () => {
  it("HTML 500은 서버 오류로, 응답 형식 기록, 본문·키 없음", async () => {
    const c = createNeisClient({ apiKey: KEY, retries: 0, fetchImpl: async () => ({ ok: false, status: 500, json: async () => { throw new Error("no"); }, headers: { get: () => "text/html;charset=ISO-8859-1" } }) });
    await expect(c.searchSchools({ officeCode: "E10" })).rejects.toMatchObject({ kind: "server", message: "나이스 서버 오류(HTTP 500, text/html)" });
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
