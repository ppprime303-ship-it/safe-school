// STEP 7 실제 학교 시범운영 준비 — 환경 역할·경보 공급자 정책·공식 긴급재난문자 어댑터(계약 테스트, 실제 API 호출 없음)
// ⚠ 공식 API 응답 형식은 인증키 발급 전이라 '가정한 계약'입니다. 이 테스트 통과는 실제 연동 완료를 뜻하지 않습니다.
import { describe, expect, it } from "vitest";
import { alertProviderErrors, deploymentRole, judgeToolsAllowed, mockAlertsAllowed, officialAlertsAllowed } from "../server/src/deploy/environment";
import { MOIS_CBS_CONTRACT, MoisCbsSource, buildRequestUrl, kstYmd, normalizeMoisCbs, parseKstDateTime, severityOf } from "../server/src/alerts/moisCbs";
import { sanitizeError } from "../server/src/alerts/collector";
import { contentHash } from "../server/src/alerts/collector";
import { mailMode, sendMail } from "../server/src/mail/mailer";

const prod = (schema: string) => ({ NODE_ENV: "production", DEPLOY_DB_SCHEMA: schema });

describe("배포 환경 역할", () => {
  it("스키마로 심사·시범운영 구분, 개발·테스트는 dev", () => {
    expect(deploymentRole(prod("safeschool_prod_judge"))).toBe("judge");
    expect(deploymentRole(prod("safeschool_prod_pilot"))).toBe("pilot");
    expect(deploymentRole(prod("safeschool_prod"))).toBe("production");
    expect(deploymentRole({ NODE_ENV: "development", DEPLOY_DB_SCHEMA: "safeschool_prod_judge" })).toBe("dev");
    expect(deploymentRole({ NODE_ENV: "test" })).toBe("dev");
  });
  it("모의 경보는 개발·심사만, 공식 API는 심사 제외, 심사 도구는 심사만", () => {
    expect([mockAlertsAllowed("dev"), mockAlertsAllowed("judge"), mockAlertsAllowed("pilot"), mockAlertsAllowed("production")]).toEqual([true, true, false, false]);
    expect([officialAlertsAllowed("judge"), officialAlertsAllowed("pilot")]).toEqual([false, true]);
    expect([judgeToolsAllowed("judge"), judgeToolsAllowed("pilot"), judgeToolsAllowed("dev")]).toEqual([true, false, false]);
  });
  it("시작 시 공급자 설정 검사: 시범운영에 모의 자료 금지, 심사에 공식 API 금지, 키 없이 공식 API 금지", () => {
    expect(alertProviderErrors("pilot", { ALERT_MOCK_FEED: "/x.json" }).join()).toContain("모의 경보");
    expect(alertProviderErrors("pilot", { ALERT_PROVIDERS: "mock", ALERT_MOCK_FEED: "/x.json" }).length > 0).toBe(true);
    expect(alertProviderErrors("pilot", { ALERT_PROVIDERS: "mois_cbs" }).join()).toContain("MOIS_CBS_SERVICE_KEY");
    expect(alertProviderErrors("pilot", { ALERT_PROVIDERS: "mois_cbs", MOIS_CBS_SERVICE_KEY: "k" })).toEqual([]);
    expect(alertProviderErrors("judge", { ALERT_PROVIDERS: "mois_cbs", MOIS_CBS_SERVICE_KEY: "k" }).join()).toContain("심사 환경");
    expect(alertProviderErrors("judge", { ALERT_MOCK_FEED: "/x.json" })).toEqual([]);
    expect(alertProviderErrors("judge", { ALERT_PROVIDERS: "mock" }).join()).toContain("ALERT_MOCK_FEED");
    expect(alertProviderErrors("dev", { ALERT_PROVIDERS: "sms" }).join()).toContain("알 수 없는 값");
    expect(alertProviderErrors("dev", {})).toEqual([]); // Replit 기존 동작
  });
});

const rec = (o: Record<string, unknown> = {}) => ({ SN: 123456, CRT_DT: "2026/10/25 14:05:00", MSG_CN: "[인천광역시] 호우경보 발효 중. 하천변 접근 금지", RCPTN_RGN_NM: "인천광역시 남동구,인천광역시 연수구", EMRG_STEP_NM: "안전안내", DST_SE_NM: "호우", ...o });

describe("공식 긴급재난문자 어댑터 — 정규화(가정한 계약)", () => {
  it("발송 시각(CRT_DT, 한국 시간)을 UTC로, 형식 3가지", () => {
    expect(parseKstDateTime("2026/10/25 14:05:00")?.toISOString()).toBe("2026-10-25T05:05:00.000Z");
    expect(parseKstDateTime("2026-10-25 14:05")?.toISOString()).toBe("2026-10-25T05:05:00.000Z");
    expect(parseKstDateTime("20261025140500")?.toISOString()).toBe("2026-10-25T05:05:00.000Z");
    for (const bad of ["2026/02/30 10:00:00", "어제", "", 20261025, null]) expect(parseKstDateTime(bad)).toBe(null);
  });
  it("필드 대응: SN→원본 ID, MSG_CN→본문, RCPTN_RGN_NM→지역, 원문 보존, 공식(모의 아님) 발신", () => {
    const n = normalizeMoisCbs(rec())!;
    expect([n.externalId, n.kind, n.severity, n.msgType, n.issuer, n.title]).toEqual(["123456", "disaster_text", "advisory", "new", "행정안전부(긴급재난문자)", "[호우] 긴급재난문자"]);
    expect(n.areas.map((a) => a.sido)).toEqual(["인천광역시", "인천광역시"]);
    expect(n.raw).toEqual(rec());
  });
  it("단계: 위급→emergency, 긴급→warning, 안전안내→advisory, 모름→info", () => {
    expect(["위급재난", "긴급재난", "안전안내", undefined].map(severityOf)).toEqual(["emergency", "warning", "advisory", "info"]);
  });
  it("전국 대상 경보도 지역으로 인식", () => {
    expect(normalizeMoisCbs(rec({ RCPTN_RGN_NM: "전국" }))!.areas[0]!.sido).toBe("전국");
  });
  it("필수 값이 없거나 형식이 다르면 버림(추측으로 채우지 않음)", () => {
    for (const o of [{ SN: undefined }, { MSG_CN: "" }, { RCPTN_RGN_NM: " " }, { CRT_DT: "어제" }]) expect(normalizeMoisCbs(rec(o))).toBe(null);
  });
  it("같은 문구·지역의 재송출은 같은 내용 해시(경보함에서 '재송출'로 묶음)", () => {
    const a = normalizeMoisCbs(rec({ SN: 1 }))!;
    const b = normalizeMoisCbs(rec({ SN: 2, CRT_DT: "2026/10/25 14:10:00" }))!;
    expect(contentHash(a)).toBe(contentHash(b));
  });
});

type Resp = { ok: boolean; status: number; json(): Promise<unknown> };
const reply = (status: number, data: unknown): Resp => ({ ok: status >= 200 && status < 300, status, json: async () => data });
const NOW = () => new Date("2026-10-26T01:00:00Z"); // 한국 2026-10-26 10:00

describe("공식 긴급재난문자 어댑터 — 요청·응답 처리(가짜 HTTP)", () => {
  it("요청 주소: serviceKey(대문자 K)·json·페이지·어제 날짜, 인코딩된 키는 다시 인코딩하지 않음", () => {
    expect(kstYmd(NOW(), 1)).toBe("20261025");
    expect(buildRequestUrl("a+b/c", 1, "20261025")).toBe(`${MOIS_CBS_CONTRACT.endpoint}?serviceKey=a%2Bb%2Fc&returnType=json&pageNo=1&numOfRows=100&crtDt=20261025`);
    expect(buildRequestUrl("a%2Bb", 2, "20261025")).toContain("serviceKey=a%2Bb&");
    expect(MOIS_CBS_CONTRACT.verified).toBe(true); // 2026-11-03 등록 서버 IP 실제 응답으로 확인
  });
  it("새 재난문자 없음: 빈 body → 0건(오류 아님)", async () => {
    const src = new MoisCbsSource("k", async () => reply(200, { header: { resultCode: "00" }, totalCount: 0, body: [] }), NOW);
    expect((await src.fetch()).alerts).toEqual([]);
  });
  it("여러 페이지 수집, 형식 불일치 항목은 건수만 기록", async () => {
    const pages = [Array.from({ length: 100 }, (_, i) => rec({ SN: i + 1 })), [rec({ SN: 101 }), { SN: 102 }]];
    const urls: string[] = [];
    const src = new MoisCbsSource("k", async (u) => (urls.push(u), reply(200, { totalCount: 102, body: pages[urls.length - 1] })), NOW);
    const r = await src.fetch();
    expect([r.alerts.length, src.lastRejected, urls.length]).toEqual([101, 1, 2]);
  });
  it("호출 제한(429)·HTTP 오류·결과 코드 오류·형식 오류는 실패로(수집 기록에 남고 다음 주기 재시도)", async () => {
    const run = (r: Resp) => new MoisCbsSource("k", async () => r, NOW).fetch();
    await expect(run(reply(429, {}))).rejects.toThrow("호출 제한");
    await expect(run(reply(500, {}))).rejects.toThrow("HTTP 500");
    await expect(run(reply(200, { header: { resultCode: "30", resultMsg: "SERVICE KEY IS NOT REGISTERED" } }))).rejects.toThrow("결과 코드 30");
    await expect(run(reply(200, { body: { item: [] } }))).rejects.toThrow("body 배열");
    await expect(run({ ok: true, status: 200, json: async () => { throw new Error("x"); } })).rejects.toThrow("JSON");
  });
  it("오류 기록에 인증키가 남지 않음", () => {
    expect(sanitizeError(new Error(`fetch failed ${buildRequestUrl("SECRET-KEY-123", 1, "20261025")}`))).not.toContain("SECRET-KEY-123");
  });
  it("빈 인증키로는 만들 수 없음", () => {
    expect(() => new MoisCbsSource(" ")).toThrow();
  });
});

describe("업무용 이메일 인증 발송 설정", () => {
  const withEnv = async (env: Record<string, string | undefined>, fn: () => unknown) => {
    const keys = ["NODE_ENV", "MAIL_PROVIDER", "MAIL_API_KEY", "MAIL_FROM"];
    const prev = Object.fromEntries(keys.map((k) => [k, process.env[k]]));
    for (const k of keys) if (env[k] === undefined) delete process.env[k]; else process.env[k] = env[k];
    try {
      return await fn();
    } finally {
      for (const k of keys) if (prev[k] === undefined) delete process.env[k]; else process.env[k] = prev[k];
    }
  };
  it("운영 모드에서는 개발용 console 발송을 쓸 수 없음(인증코드를 화면에 내주지 않음)", async () => {
    expect(await withEnv({ NODE_ENV: "production", MAIL_PROVIDER: "console" }, () => mailMode())).toBe("none");
    expect(await withEnv({ NODE_ENV: "development", MAIL_PROVIDER: "console" }, () => mailMode())).toBe("console");
  });
  it("운영 모드에서 발송 설정이 없으면 보낸 것처럼 응답하지 않고 503", async () => {
    let status = 0;
    await withEnv({ NODE_ENV: "production", MAIL_PROVIDER: "console" }, async () => {
      try {
        await sendMail({ to: "t@school.example", subject: "s", text: "t" });
      } catch (e) {
        status = (e as { status: number }).status;
      }
    });
    expect(status).toBe(503);
  });
  it("실제 발송은 Resend + 키 + 보내는 주소가 모두 있을 때만", async () => {
    expect(await withEnv({ NODE_ENV: "production", MAIL_PROVIDER: "resend", MAIL_API_KEY: "k" }, () => mailMode())).toBe("none");
    expect(await withEnv({ NODE_ENV: "production", MAIL_PROVIDER: "resend", MAIL_API_KEY: "k", MAIL_FROM: "SAFE SCHOOL <no-reply@example.org>" }, () => mailMode())).toBe("resend");
  });
});
