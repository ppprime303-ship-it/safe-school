// Beta PILOT 2 Phase 2: 소재 입력 규칙·위치 표시·상세 열람 권한·익명 요약(DB 없이 실행)
import { describe, expect, it } from "vitest";
import { PLACE_LABEL_MAX, PRESENCE_PLACES, PLACE_DETAIL_MAX, PLACE_LABEL, placeLabel, presenceInputSchema } from "../shared/presence";
import { capabilitiesFor } from "../shared/permissions";
import { summarizePresence } from "../server/src/services/presence";

const base = { location: "on_campus", placeCategory: "classroom", placeDetail: "3학년 2반", availability: "available", expectedVersion: null };

describe("소재 입력 규칙(presenceInputSchema)", () => {
  it("교내: 분류 + 상세(선택), 공백 정리, 빈 상세는 없음으로", () => {
    expect(presenceInputSchema.parse(base)).toEqual({ location: "on_campus", placeCategory: "classroom", placeDetail: "3학년 2반", availability: "available", expectedVersion: null });
    expect(presenceInputSchema.parse({ ...base, placeCategory: "staff_room", placeDetail: "  " }).placeDetail).toBeNull();
    expect(presenceInputSchema.parse({ ...base, placeDetail: " 본관   2층 " }).placeDetail).toBe("본관 2층");
  });

  it("교외: 위치를 받지 않음(분류·상세를 보내면 400 대상)", () => {
    expect(presenceInputSchema.parse({ location: "off_campus", availability: "unsure", expectedVersion: 2 })).toEqual({ location: "off_campus", placeCategory: null, placeDetail: null, availability: "unsure", expectedVersion: 2 });
    expect(presenceInputSchema.safeParse({ location: "off_campus", placeDetail: "집", availability: "unsure", expectedVersion: null }).success).toBe(false);
  });

  it.each([
    ["교내인데 분류 없음", { ...base, placeCategory: null }],
    ["기타인데 상세 없음", { ...base, placeCategory: "other", placeDetail: null }],
    ["상세 41자", { ...base, placeDetail: "가".repeat(PLACE_DETAIL_MAX + 1) }],
    ["상세에 전화번호", { ...base, placeDetail: "010-1234-5678" }],
    ["상세에 주민등록번호", { ...base, placeDetail: "010101-3123456" }],
    ["모르는 분류", { ...base, placeCategory: "rooftop" }],
    ["가능 여부 없음", { ...base, availability: undefined }],
    ["다른 사람 지정(membershipId)", { ...base, membershipId: "00000000-0000-0000-0000-000000000000" }],
    ["모드 지정(mode)", { ...base, mode: "real" }],
    ["GPS", { ...base, lat: 37.5, lng: 126.7 }],
  ])("거부: %s", (_n, body) => {
    expect(presenceInputSchema.safeParse(body).success).toBe(false);
  });

  it("표시 문자열 '분류 / 상세'는 항상 50자 이내", () => {
    for (const p of PRESENCE_PLACES) {
      const label = placeLabel(p, "가".repeat(PLACE_DETAIL_MAX))!;
      expect(label.length).toBeLessThanOrEqual(PLACE_LABEL_MAX);
      expect(placeLabel(p, null)).toBe(PLACE_LABEL[p]);
    }
    expect(placeLabel(null, "무시")).toBeNull();
  });
});

describe("상세 열람 권한(presence.detail)", () => {
  it("학교 관리자·교장·교감·안전업무 담당(등록 직책)만", () => {
    expect(capabilitiesFor("admin", [])).toContain("presence.detail");
    for (const d of ["principal", "vice_principal", "safety_officer"] as const) expect(capabilitiesFor("staff", [d])).toContain("presence.detail");
    for (const role of ["homeroom", "staff"] as const) {
      expect(capabilitiesFor(role, [])).not.toContain("presence.detail");
      expect(capabilitiesFor(role, ["app_operator"])).not.toContain("presence.detail");
    }
  });
});

describe("익명 요약(summarizePresence, Phase 4 보고서 형식)", () => {
  const at = (m: number) => new Date(Date.UTC(2026, 9, 30, 1, m));
  it("미응답 = 대상 − 응답, 교내+교외 = 응답, 가능+불가+확인 필요 = 응답, 개인 정보 없음", () => {
    const s = summarizePresence(
      [{ readAt: at(1) }, { readAt: null }, { readAt: null }, { readAt: at(2) }],
      [
        { location: "on_campus", availability: "available", respondedAt: at(3) },
        { location: "off_campus", availability: "unsure", respondedAt: at(5) },
      ],
    );
    expect(s).toEqual({ targetCount: 4, respondedCount: 2, notRespondedCount: 2, onCampus: 1, offCampus: 1, available: 1, unavailable: 0, unsure: 1, alertsRead: 2, latestRespondedAt: at(5).toISOString() });
  });
  it("응답이 없으면 전원 미응답(교외·안전으로 추정하지 않음)", () => {
    expect(summarizePresence([{ readAt: null }, { readAt: null }], [])).toMatchObject({ targetCount: 2, respondedCount: 0, notRespondedCount: 2, onCampus: 0, offCampus: 0, latestRespondedAt: null });
  });
});
