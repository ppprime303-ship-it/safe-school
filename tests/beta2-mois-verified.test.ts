// 긴급재난문자 실제 응답 형태(2026-11-03 등록 서버 IP 실측) 회귀 테스트 — 가짜 응답만 사용, 실제 호출·발령 없음
// 실측 구조: 최상위 header·numOfRows·pageNo·totalCount·body(배열), 항목 필드 11개, CRT_DT 'YYYY/MM/DD HH:mm:ss', 순서 일정하지 않음
import { describe, expect, it } from "vitest";
import { MOIS_CBS_CONTRACT, MoisCbsSource, parseKstDateTime } from "../server/src/alerts/moisCbs";

const rec = (sn: number, crt: string, region: string) => ({
  MSG_CN: `[가상 시험 ${sn}] 안전 안내`, RCPTN_RGN_NM: region, CRT_DT: crt, EMRG_STEP_ID: "3", REG_YMD: crt.slice(0, 10), DST_SE_ID: "1",
  RCPTN_RGN_ID: "1", EMRG_STEP_NM: "안전안내", SN: sn, DST_SE_NM: "기타", MDFCN_YMD: crt.slice(0, 10),
});
const fakeHttp = (body: unknown) => async () => ({ ok: true, status: 200, json: async () => body, text: async () => JSON.stringify(body) });

describe("긴급재난문자 실측 응답 형태", () => {
  it("계약 확인됨(2026-11-03)", () => {
    expect(MOIS_CBS_CONTRACT.verified).toBe(true);
  });

  it("CRT_DT 'YYYY/MM/DD HH:mm:ss' 는 한국 시각 → UTC", () => {
    expect(parseKstDateTime("2026/11/02 07:01:49")?.toISOString()).toBe("2026-11-01T22:01:49.000Z");
    expect(parseKstDateTime("2026/11/02 00:00:00")?.toISOString()).toBe("2026-11-01T15:00:00.000Z");
    expect(parseKstDateTime("2026/02/30 10:00:00")).toBeNull();
  });

  it("실측 구조(최상위 header·numOfRows·pageNo·totalCount·body), 순서가 섞여도 모두 정규화, SN 은 문자열 externalId", async () => {
    const body = {
      header: { resultCode: "00", resultMsg: "NORMAL SERVICE", errorMsg: null },
      numOfRows: 100, pageNo: 1, totalCount: 3,
      body: [rec(300, "2026/11/02 07:01:49", "경상남도 창원시"), rec(100, "2026/11/02 09:30:00", "서울특별시 종로구"), rec(200, "2026/11/01 18:00:00", "전라남도 여수시")],
    };
    const src = new MoisCbsSource("k", fakeHttp(body) as never, () => new Date("2026-11-03T06:00:00Z"), 1000, 1);
    const r = await src.fetch();
    expect(src.lastRejected).toBe(0);
    expect(r.alerts.map((a) => a.externalId)).toEqual(["300", "100", "200"]); // 응답 순서 그대로 — 저장 순서는 수집기가 발송 시각으로 정렬
    expect(r.alerts.map((a) => a.issuedAt.toISOString())).toEqual(["2026-11-01T22:01:49.000Z", "2026-11-02T00:30:00.000Z", "2026-11-01T09:00:00.000Z"]);
    expect(r.alerts.every((a) => a.severity === "advisory" && a.kind === "disaster_text" && a.msgType === "new")).toBe(true);
  });

  it("오늘 응답처럼 인천 대상이 없으면 정상 빈 결과로 처리(오류 아님)", async () => {
    const body = { header: { resultCode: "00", resultMsg: "NORMAL SERVICE" }, numOfRows: 100, pageNo: 1, totalCount: 0, body: [] };
    const r = await new MoisCbsSource("k", fakeHttp(body) as never, () => new Date("2026-11-03T06:00:00Z"), 1000, 1).fetch();
    expect(r.alerts).toEqual([]);
  });
});
