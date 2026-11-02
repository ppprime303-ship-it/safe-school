// Beta PILOT 2 Phase 3-B 화면(정적 렌더링): 훈련 표시, 유사 제보 제안(막지 않음), 상세의 권한별 표시, 종료 시 읽기 전용
import { describe, expect, it } from "vitest";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { EventModeBadge, IncidentCard, SimilarSuggestions } from "../client/src/pages/incidents/IncidentsPage";
import { IncidentDetailView } from "../client/src/pages/incidents/IncidentDetailPage";
import type { IncidentDetail, IncidentItem } from "../client/src/lib/incident";

const item = (over: Partial<IncidentItem> = {}): IncidentItem => ({
  id: "i1",
  type: "hazard",
  placeCategory: "stairs",
  placeLabel: "계단 / 본관 2층",
  description: "계단에 유리 파편",
  status: "received",
  createdAt: "2026-10-30T01:00:00.000Z",
  lastActivityAt: "2026-10-30T01:05:00.000Z",
  updateCount: 1,
  photoCount: 0,
  mine: false,
  ...over,
});
const detail = (over: Partial<IncidentDetail> = {}): IncidentDetail => ({
  ...item(),
  event: { id: "e1", mode: "real", status: "active" },
  updates: [{ id: "u1", kind: "change", note: "난간도 흔들림", createdAt: "2026-10-30T01:03:00.000Z", mine: true }],
  statusHistory: [{ from: "received", to: "checking", createdAt: "2026-10-30T01:04:00.000Z" }],
  ...over,
});
const html = (el: Parameters<typeof renderToStaticMarkup>[0]) => renderToStaticMarkup(el);

describe("현장 제보 화면", () => {
  it("모드 표시: 훈련은 '훈련 상황 제보 · 실제 아님', 종료는 '조회만'", () => {
    expect(html(createElement(EventModeBadge, { event: { id: "e", mode: "drill", status: "active" } }))).toContain("훈련 상황 제보 · 실제 아님");
    expect(html(createElement(EventModeBadge, { event: { id: "e", mode: "real", status: "closed" } }))).toMatch(/실제 재난 현장 제보.*종료\(조회만\)/);
  });

  it("목록 카드: 내 제보 표시, 작성자 이름은 서버가 준 경우(대응 담당자)만", () => {
    const general = html(createElement(IncidentCard, { schoolId: "s1", item: item({ mine: true }) }));
    expect(general).toContain("내 제보");
    expect(general).not.toContain("제보 가상");
    expect(general).toContain('href="/s/s1/incidents/i1"');
    expect(html(createElement(IncidentCard, { schoolId: "s1", item: item({ reporterName: "가상 교사" }) }))).toContain("제보 가상 교사");
  });

  it("유사 제보 제안: 기존 제보에 정보 추가 링크 + 새로 제보해도 된다는 안내", () => {
    const h = html(createElement(SimilarSuggestions, { schoolId: "s1", items: [item()] }));
    expect(h).toContain("비슷한 제보가 있습니다");
    expect(h).toContain("이 제보에 정보 추가");
    expect(h).toContain("새로 제보해도 됩니다");
  });

  it("상세: 일반 교직원은 처리 상태 버튼 없음, 대응 담당자는 진행 중일 때 상태 버튼", () => {
    const general = html(createElement(IncidentDetailView, { schoolId: "s1", incident: detail(), canManage: false }));
    expect(general).not.toContain("처리 상태(대응 담당자)");
    expect(general).toContain("난간도 흔들림");
    expect(general).toContain("내가 추가");
    const manager = html(createElement(IncidentDetailView, { schoolId: "s1", incident: detail({ reporterName: "가상 교사" }), canManage: true }));
    for (const t of ["처리 상태(대응 담당자)", "조치 대기", "조치 완료", "세부 기록: 접수 → 확인 중", "가상 교사"]) expect(manager).toContain(t);
  });

  it("상세: 종료된 상황은 대응 담당자도 상태 버튼 없음(정정 절차 안내)", () => {
    const h = html(createElement(IncidentDetailView, { schoolId: "s1", incident: detail({ event: { id: "e1", mode: "drill", status: "closed" } }), canManage: true }));
    expect(h).toContain("처리 상태를 바꿀 수 없습니다");
    expect(h).not.toContain('aria-pressed="false"');
    expect(h).toContain("훈련 상황 제보");
  });
});
