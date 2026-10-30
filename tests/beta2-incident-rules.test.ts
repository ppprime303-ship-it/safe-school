// Beta PILOT 2 Phase 3: 현장 제보 입력 규칙·유사 제보 점수·권한(DB 없이 실행)
import { describe, expect, it } from "vitest";
import { SIMILAR_THRESHOLD, incidentCreateSchema, incidentStatusSchema, incidentUpdateSchema, similarityScore, textOverlap, type SimilarityCandidate } from "../shared/incident";
import { capabilitiesFor } from "../shared/permissions";

const now = new Date("2026-10-30T02:00:00.000Z");
const cand = (over: Partial<SimilarityCandidate> = {}): SimilarityCandidate => ({
  type: "hazard",
  placeCategory: "stairs",
  placeDetail: "본관 2층",
  description: "계단에 깨진 유리 파편이 흩어져 있습니다",
  status: "received",
  createdAt: new Date("2026-10-30T01:50:00.000Z"),
  lastActivityAt: new Date("2026-10-30T01:50:00.000Z"),
  ...over,
});

describe("글자쌍 겹침(textOverlap)", () => {
  it("같은 글 1, 무관한 글 0, 띄어쓰기·문장부호 무시", () => {
    expect(textOverlap("유리 파편", "유리파편!")).toBe(1);
    expect(textOverlap("유리 파편", "조명 낙하")).toBe(0);
    expect(textOverlap("", "아무거나")).toBe(0);
    expect(textOverlap("계단 유리 파편", "계단에 깨진 유리 파편이 흩어져 있습니다")).toBeGreaterThan(0.2);
  });
});

describe("유사 제보 점수(similarityScore)", () => {
  const draft = { type: "hazard" as const, placeCategory: "stairs" as const, placeDetail: "본관 2층 계단", description: "계단 유리 파편" };
  it("같은 장소·유형·비슷한 설명·최근 → 높은 점수(제안)", () => {
    expect(similarityScore(draft, cand(), now)).toBeGreaterThanOrEqual(8);
  });
  it("같은 장소+같은 유형만으로도 제안 기준(4점) 이상", () => {
    expect(similarityScore({ ...draft, placeDetail: null, description: "전혀 다른 표현" }, cand({ lastActivityAt: new Date("2026-10-30T00:00:00.000Z") }), now)).toBe(5);
  });
  it("다른 장소·다른 유형이면 설명이 조금 겹쳐도 기준 미만", () => {
    expect(similarityScore({ type: "help_needed", placeCategory: "playground", placeDetail: null, description: "유리" }, cand(), now)).toBeLessThan(SIMILAR_THRESHOLD);
  });
  it("조치 완료된 제보는 1점 낮게, 30분 넘은 제보는 최근 가산 없음", () => {
    const fresh = similarityScore(draft, cand(), now);
    expect(similarityScore(draft, cand({ status: "resolved" }), now)).toBe(fresh - 1);
    expect(similarityScore(draft, cand({ lastActivityAt: new Date("2026-10-30T01:00:00.000Z") }), now)).toBe(fresh - 1);
  });
});

describe("입력 규칙", () => {
  const ok = { type: "hazard", placeCategory: "stairs", placeDetail: " 본관  2층 ", description: "  계단에 유리 파편  " };
  it("공백 정리, 상세 위치 선택", () => {
    expect(incidentCreateSchema.parse(ok)).toEqual({ type: "hazard", placeCategory: "stairs", placeDetail: "본관 2층", description: "계단에 유리 파편" });
    expect(incidentCreateSchema.parse({ ...ok, placeDetail: undefined }).placeDetail).toBeNull();
  });
  it.each([
    ["설명 1자", { ...ok, description: "유" }],
    ["설명 301자", { ...ok, description: "가".repeat(301) }],
    ["전화번호", { ...ok, description: "010-1234-5678로 연락" }],
    ["기타인데 상세 없음", { ...ok, placeCategory: "other", placeDetail: undefined }],
    ["모르는 유형", { ...ok, type: "fire" }],
    ["작성자 지정", { ...ok, reporterMembershipId: "x" }],
    ["교직원 위치 끼워 넣기", { ...ok, location: "on_campus" }],
  ])("거부: %s", (_n, b) => {
    expect(incidentCreateSchema.safeParse(b).success).toBe(false);
  });
  it("후속 정보·상태 변경 스키마", () => {
    expect(incidentUpdateSchema.safeParse({ kind: "action", note: "출입 통제함" }).success).toBe(true);
    expect(incidentUpdateSchema.safeParse({ kind: "action", note: "x" }).success).toBe(false);
    expect(incidentStatusSchema.safeParse({ status: "resolved", expectedStatus: "in_progress" }).success).toBe(true);
    expect(incidentStatusSchema.safeParse({ status: "deleted", expectedStatus: "received" }).success).toBe(false);
  });
});

describe("권한", () => {
  it("처리(incident.manage)·사진(incident.photo): 학교 관리자·교장·교감·안전업무 담당만", () => {
    for (const cap of ["incident.manage", "incident.photo"] as const) {
      expect(capabilitiesFor("admin", [])).toContain(cap);
      for (const d of ["principal", "vice_principal", "safety_officer"] as const) expect(capabilitiesFor("staff", [d])).toContain(cap);
      for (const role of ["homeroom", "staff"] as const) {
        expect(capabilitiesFor(role, [])).not.toContain(cap);
        expect(capabilitiesFor(role, ["app_operator"])).not.toContain(cap);
      }
    }
  });
});
