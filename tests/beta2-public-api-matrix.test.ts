// Phase 6: 공식 재난문자 어댑터의 남은 장애 경우(가짜 HTTP만, 실제 호출 없음). 다른 경우는 step7-pilot·step-a-alert-feed·alerts·neis·step-a-schoolinfo 가 검증합니다.
import fs from "node:fs";
import { describe, expect, it } from "vitest";
import { MOIS_CBS_CONTRACT, MoisCbsSource } from "../server/src/alerts/moisCbs";
import { sanitizeError } from "../server/src/alerts/collector";
import { betaEnvironmentErrors } from "../server/src/deploy/environment";

const KEY = "not-a-real-key-1234";
const NOW = () => new Date("2026-11-02T01:00:00Z");
const res = (status: number, text: string) => ({ ok: status >= 200 && status < 300, status, json: async () => JSON.parse(text), text: async () => text });
const rec = (over: Record<string, unknown> = {}) => ({ SN: 1, CRT_DT: "2026/11/02 09:00:00", MSG_CN: "가상 안전안내 문자", RCPTN_RGN_NM: "가상광역시 전체", EMRG_STEP_NM: "안전안내", DST_SE_NM: "호우", ...over });
const source = (http: any, timeoutMs = 50) => new MoisCbsSource(KEY, http, NOW, timeoutMs);

describe("긴급재난문자 어댑터 장애 경우", () => {
  it("응답이 오지 않으면 시간 제한으로 실패", async () => {
    const http = (_u: string, init: { signal: AbortSignal }) => new Promise((_r, reject) => init.signal.addEventListener("abort", () => reject(init.signal.reason)));
    await expect(source(http).fetch()).rejects.toThrow();
  });
  it.each([401, 403, 500])("HTTP %s 는 실패로 기록, 경보 0건으로 위장하지 않음", async (status) => {
    await expect(source(async () => res(status, "denied")).fetch()).rejects.toThrow(String(status));
  });
  it("결과 코드 인증 오류·잘못된 JSON·XML 게이트웨이 오류는 실패", async () => {
    await expect(source(async () => res(200, JSON.stringify({ header: { resultCode: "30", resultMsg: "미등록 키" }, body: [] }))).fetch()).rejects.toThrow("30");
    await expect(source(async () => res(200, "{not json")).fetch()).rejects.toThrow();
    await expect(source(async () => res(200, "<OpenAPI_ServiceResponse><returnReasonCode>22</returnReasonCode></OpenAPI_ServiceResponse>")).fetch()).rejects.toThrow();
  });
  it("지연 도착 문자는 수신 시각이 아니라 원래 발송 시각을 유지, 잘못된 항목은 버리고 건수 기록", async () => {
    const s = source(async () => res(200, JSON.stringify({ header: { resultCode: "00" }, totalCount: 2, body: [rec({ SN: 9, CRT_DT: "2026/11/01 08:30:00" }), rec({ SN: 10, MSG_CN: "" })] })));
    const r = await s.fetch();
    expect(r.alerts).toHaveLength(1);
    expect(r.alerts[0]!.issuedAt.toISOString()).toBe("2026-10-31T23:30:00.000Z");
    expect(s.lastRejected).toBe(1);
  });
  it("수집 오류 문구에서 인증키를 가림", () => {
    expect(sanitizeError(new Error(`연결 실패 serviceKey=${KEY}&x=1`))).not.toContain(KEY);
  });
});

describe("연동 안전장치", () => {
  it("공식 명세 확인(2026-11-03 실제 응답): 검증됨 표시, Beta는 일일 배분량을 정해야 재난문자 수집 시작", () => {
    expect(MOIS_CBS_CONTRACT.verified).toBe(true);
    const env = { DEPLOY_PROFILE: "beta", ALERT_PROVIDERS: "mois_cbs" };
    expect(betaEnvironmentErrors("beta", env).join()).not.toContain("명세 확인");
    expect(betaEnvironmentErrors("beta", env).join()).toContain("MOIS_CBS_DAILY_LIMIT");
    expect(betaEnvironmentErrors("beta", { ...env, MOIS_CBS_DAILY_LIMIT: "60" }).join()).not.toMatch(/MOIS_CBS|명세/);
  });
  it("경보 수집 코드는 학교 재난 발령·교직원 알림을 만들지 않음", () => {
    for (const f of ["server/src/alerts/collector.ts", "server/src/alerts/moisCbs.ts", "server/src/alerts/providers.ts"]) {
      expect(fs.readFileSync(f, "utf8")).not.toMatch(/disasterEvent|issueEvent|staffAlert/);
    }
  });
  it("API 키는 화면 코드에서 쓰지 않음", () => {
    const walk = (d: string): string[] => fs.readdirSync(d, { withFileTypes: true }).flatMap((e) => (e.isDirectory() ? walk(`${d}/${e.name}`) : [`${d}/${e.name}`]));
    for (const f of walk("client/src")) expect(fs.readFileSync(f, "utf8")).not.toMatch(/MOIS_CBS_SERVICE_KEY|NEIS_API_KEY|SCHOOLINFO_API_KEY|GMAIL_SMTP/);
  });
});
