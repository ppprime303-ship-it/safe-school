// STEP 3-C 안내문 예시 라이브러리(순수 함수, DB 없음)
import { describe, expect, it } from "vitest";
import {
  NOTICE_DISASTER_TYPES,
  NOTICE_EXAMPLES,
  PLACEHOLDER_GUIDE,
  fillNoticeTemplate,
  findUnfilledGuides,
  formatNoticeTime,
  getNoticeExample,
  noticeFillValuesFrom,
  recommendNoticeSituation,
  recommendNoticeType,
} from "../shared/noticeExamples.js";
import { handlingRecordSchema, noticeUpdateSchema } from "../shared/schemas.js";

describe("예시문 21개 구조", () => {
  it("7개 유형 × (학부모 발령, 교직원 발령, 해제) = 21개, 키 중복 없음", () => {
    expect(NOTICE_EXAMPLES).toHaveLength(21);
    expect(new Set(NOTICE_EXAMPLES.map((e) => e.key)).size).toBe(21);
    for (const type of Object.keys(NOTICE_DISASTER_TYPES)) {
      const list = NOTICE_EXAMPLES.filter((e) => e.disasterType === type);
      expect(list.map((e) => `${e.audience}.${e.situation}`).sort()).toEqual(["parent.cancelled", "parent.issued", "staff.issued"]);
    }
  });

  it("모든 예시는 제목·본문이 DB 길이 제한 안이고, 키 형식이 서버 검증과 같다", () => {
    for (const e of NOTICE_EXAMPLES) {
      expect(e.key).toBe(`${e.disasterType}.${e.audience}.${e.situation}`);
      expect(e.title.length).toBeLessThanOrEqual(200);
      expect(e.body.length).toBeLessThanOrEqual(5000);
      expect(e.version).toBeGreaterThanOrEqual(1);
      const parsed = noticeUpdateSchema.safeParse({ title: e.title, body: e.body, status: "draft", exampleKey: e.key, expectedVersion: 1 });
      expect(parsed.success).toBe(true);
    }
  });

  it("예시문에는 실제 연락처·발송 문구가 없고, 확인할 수 없는 값은 입력 안내로 남는다", () => {
    for (const e of NOTICE_EXAMPLES) {
      expect(e.body).not.toMatch(/\d{2,3}-\d{3,4}-\d{4}/);
      expect(findUnfilledGuides(e.body).length).toBeGreaterThan(0);
    }
  });
});

describe("빈칸 채우기", () => {
  const ex = getNoticeExample("heatwave.parent.issued")!;

  it("확인된 값만 채우고, 없는 값은 입력 안내로 남긴다", () => {
    const body = fillNoticeTemplate(ex.body, { 학교명: "가상초등학교", 경보제목: "폭염경보", 발령시각: null, 지역: "  " });
    expect(body).toContain("가상초등학교");
    expect(body).toContain("폭염경보");
    expect(body).toContain(PLACEHOLDER_GUIDE.발령시각);
    expect(body).toContain(PLACEHOLDER_GUIDE.지역);
    expect(body).not.toMatch(/\{\{/);
  });

  it("예시 원본은 바뀌지 않는다", () => {
    const before = ex.body;
    fillNoticeTemplate(ex.body, { 학교명: "가상초등학교" });
    expect(ex.body).toBe(before);
    expect(getNoticeExample("heatwave.parent.issued")!.body).toBe(before);
  });

  it("경보에서 값 모으기: 제목이 없으면 본문 첫 줄(40자), 시각은 한국 시간", () => {
    const v = noticeFillValuesFrom({
      schoolName: "가상중학교",
      alert: { title: null, body: "\n[모의] 인천 남동구 호우경보 발효\n둘째 줄", areasRaw: "인천광역시 남동구", issuedAt: "2026-10-21T01:30:00.000Z" },
      disasterType: "storm_flood",
    });
    expect(v).toEqual({ 학교명: "가상중학교", 재난유형: "호우·태풍", 경보제목: "[모의] 인천 남동구 호우경보 발효", 발령시각: "2026년 10월 21일 10시 30분", 지역: "인천광역시 남동구" });
    expect(formatNoticeTime("2026-10-20T15:05:00.000Z")).toBe("2026년 10월 21일 0시 05분");
  });
});

describe("예시 추천", () => {
  it("경보 낱말로 유형 추천, 모르면 기타", () => {
    expect(recommendNoticeType({ title: "폭염경보" })).toBe("heatwave");
    expect(recommendNoticeType({ body: "태풍 북상에 따른 강풍" })).toBe("storm_flood");
    expect(recommendNoticeType({ body: "초미세먼지 주의보" })).toBe("fine_dust");
    expect(recommendNoticeType({ body: "규모 4.1 지진 발생" })).toBe("earthquake");
    expect(recommendNoticeType({ body: "한파경보" })).toBe("cold_wave");
    expect(recommendNoticeType({ body: "공장 화재로 연기 확산" })).toBe("fire_gas");
    expect(recommendNoticeType({ body: "실종자 발생" })).toBe("other");
  });

  it("해제 경보이거나 해제된 경보면 해제 안내 추천", () => {
    expect(recommendNoticeSituation({ msgType: "cancel" })).toBe("cancelled");
    expect(recommendNoticeSituation({ msgType: "new", cancelled: true })).toBe("cancelled");
    expect(recommendNoticeSituation({ msgType: "new" })).toBe("issued");
  });
});

describe("처리 이력 입력 검증(개인 연락처 거부)", () => {
  it("전화번호 형태는 거부, 발송 일시는 '발송 완료'일 때만", () => {
    expect(handlingRecordSchema.safeParse({ memo: "학부모 010-1234-5678 확인" }).success).toBe(false);
    expect(handlingRecordSchema.safeParse({ audienceCategory: "01012345678" }).success).toBe(false);
    expect(handlingRecordSchema.safeParse({ sentByTeacher: false, sentAt: "2026-10-21T10:00:00+09:00" }).success).toBe(false);
    expect(handlingRecordSchema.safeParse({ channel: "sms", audienceCategory: "3학년 학부모", sentByTeacher: true, sentAt: "2026-10-21T10:00:00+09:00" }).success).toBe(true);
    expect(handlingRecordSchema.safeParse({ channel: "real_api" }).success).toBe(false);
  });
});
