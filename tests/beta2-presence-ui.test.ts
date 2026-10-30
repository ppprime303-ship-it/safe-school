// Beta PILOT 2 Phase 2-B·C 화면(정적 렌더링): 실제 재난과 모의훈련 알림 구분, 훈련에는 소재 보고 버튼 없음
import { describe, expect, it } from "vitest";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { StaffAlertBanner } from "../client/src/components/layout/StaffAlertBar";
import { pickBannerAlert, type StaffAlertItem } from "../client/src/lib/presence";
import { presenceSentence } from "../client/src/pages/presence/PresencePage";
import { navItemsFor } from "../client/src/components/layout/AppShell";
import { StaffPresenceView } from "../client/src/pages/presence/StaffPresencePage";
import type { PresenceDetailResponse, PresenceSummaryResponse } from "../client/src/lib/presence";

const alert = (over: Partial<StaffAlertItem> & { mode?: "real" | "drill"; status?: "active" | "closed" } = {}): StaffAlertItem => ({
  id: over.id ?? "a1",
  createdAt: "2026-10-30T01:00:00.000Z",
  readAt: over.readAt ?? null,
  event: { id: `e-${over.id ?? "a1"}`, mode: over.mode ?? "real", status: over.status ?? "active", types: ["fire"], startedAt: "2026-10-30T01:00:00.000Z", closedAt: null },
  presenceRequested: (over.mode ?? "real") === "real" && (over.status ?? "active") === "active",
});
const render = (a: StaffAlertItem) => renderToStaticMarkup(createElement(StaffAlertBanner, { schoolId: "s1", alert: a, onAcknowledge: () => undefined }));

describe("교직원 알림 배너", () => {
  it("실제 재난: '실제 재난 알림', '교직원 소재 보고' 버튼(소재 화면 링크), '알림 확인', 비상연락망 병행 안내", () => {
    const html = render(alert());
    expect(html).toContain('data-testid="staff-alert-real"');
    expect(html).toContain("실제 재난 알림");
    expect(html).toContain('href="/s/s1/presence"');
    expect(html).toContain("교직원 소재 보고");
    expect(html).toContain("알림 확인");
    expect(html).toContain("학교 비상연락망을 함께 활용해 주세요");
  });

  it("모의훈련: '재난 모의훈련이 시작되었습니다', '실제 아님', '재난훈련 안내 확인'만 — 소재 보고 버튼·링크 없음", () => {
    const html = render(alert({ mode: "drill" }));
    expect(html).toContain('data-testid="staff-alert-drill"');
    expect(html).toContain("재난 모의훈련이 시작되었습니다");
    expect(html).toContain("실제 아님");
    expect(html).toContain("재난훈련 안내 확인");
    expect(html).not.toContain("교직원 소재 보고");
    expect(html).not.toContain("/presence");
    expect(html).not.toMatch(/교내|교외|대피 지원/);
  });

  it("이미 확인한 알림은 확인 버튼 없음(실제 재난은 소재 보고 버튼 유지)", () => {
    const html = render(alert({ readAt: "2026-10-30T01:01:00.000Z" }));
    expect(html).not.toContain("알림 확인");
    expect(html).toContain("교직원 소재 보고");
  });

  it("배너 선택: 확인 안 한 실제 재난 우선 → 확인 안 한 훈련 → 진행 중 실제 재난, 종료된 사건·확인한 훈련은 표시 안 함", () => {
    expect(pickBannerAlert([alert({ id: "d", mode: "drill" }), alert({ id: "r" })])!.id).toBe("r");
    expect(pickBannerAlert([alert({ id: "d", mode: "drill" })])!.id).toBe("d");
    expect(pickBannerAlert([alert({ id: "d", mode: "drill", readAt: "x" })])).toBeNull();
    expect(pickBannerAlert([alert({ id: "r", readAt: "x" })])!.id).toBe("r");
    expect(pickBannerAlert([alert({ id: "c", status: "closed" })])).toBeNull();
  });
});

describe("소재 보고 확인 문구", () => {
  it("교내는 장소 표시, 교외는 위치 없음", () => {
    expect(presenceSentence({ location: "on_campus", placeCategory: "classroom", placeDetail: "3학년 2반", availability: "available" })).toBe("교내 · 교실 / 3학년 2반 · 대피 지원 가능");
    expect(presenceSentence({ location: "off_campus", placeCategory: null, placeDetail: null, availability: "unsure" })).toBe("교외 · 확인 필요");
  });
});

describe("메뉴(소재 화면은 알림 배너·상황판에서 연결, Phase 3에서 '현장 제보' 추가)", () => {
  it("모바일 하단 메뉴: 소재 메뉴는 없고 현장 제보만 추가", () => {
    const bottom = (caps: string[]) => navItemsFor("s1", caps).filter((i) => i.mobile === undefined).map((i) => i.label);
    expect(bottom(["board.view"])).toEqual(["상황판", "학급 보고", "현장 제보", "경보", "학교 선택"]);
  });
});


const summary = { targetCount: 5, respondedCount: 3, notRespondedCount: 2, onCampus: 2, offCampus: 1, available: 2, unavailable: 0, unsure: 1, alertsRead: 4, latestRespondedAt: "2026-10-30T01:10:00.000Z" };
const presenceOf = (location: "on_campus" | "off_campus", placeLabel: string | null) => ({
  id: "p", location, placeCategory: location === "on_campus" ? ("playground" as const) : null, placeDetail: null, placeLabel, availability: "available" as const, version: 1, firstRespondedAt: "2026-10-30T01:05:00.000Z", respondedAt: "2026-10-30T01:05:00.000Z",
});

describe("교직원 소재 현황 화면", () => {
  it("요약 응답: 숫자만(응답·미응답·교내/교외·지원 가능), 성명·위치·명단 없음, 학생 대피 보고와 별개 안내", () => {
    const data: PresenceSummaryResponse = { eventId: "e1", eventStatus: "active", scope: "summary", summary };
    const html = renderToStaticMarkup(createElement(StaffPresenceView, { data }));
    expect(html).toContain("학생 대피 보고와 별개");
    expect(html).toContain("미응답");
    expect(html).toContain("추정하지 않");
    expect(html).not.toMatch(/개인별 소재|미응답 2명|장소별|운동장/);
  });

  it("상세 응답: 미응답자 명단·장소별·개인별 소재, 종료 상황 표시", () => {
    const data: PresenceDetailResponse = {
      eventId: "e1",
      eventStatus: "closed",
      scope: "detail",
      summary,
      byPlace: [{ placeCategory: "playground", count: 2 }],
      notResponded: [{ membershipId: "m4", name: "가상 미응답", alertReadAt: null }],
      people: [
        { membershipId: "m1", name: "가상 교사", role: "homeroom", alertReadAt: "2026-10-30T01:01:00.000Z", presence: presenceOf("on_campus", "운동장") },
        { membershipId: "m2", name: "가상 교직원", role: "staff", alertReadAt: null, presence: presenceOf("off_campus", null) },
        { membershipId: "m4", name: "가상 미응답", role: "staff", alertReadAt: null, presence: null },
      ],
      excludedResponses: 1,
    };
    const html = renderToStaticMarkup(createElement(StaffPresenceView, { data }));
    for (const t of ["미응답 1명", "가상 미응답", "교내 장소별", "운동장 2명", "개인별 소재", "교내 · 운동장", "교외", "종료된 상황", "집계에서 뺀 응답 1건"]) expect(html).toContain(t);
  });
});
