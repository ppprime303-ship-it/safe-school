// Beta PILOT 2 Phase 4-A: 공통 보고서 배치(모의훈련 일지 / 실제 재난 상황보고서) — DB 없이 실행
// - 이전 저장본(incidents 없음)은 기존 서식 그대로(기존 drilllog-doc 테스트가 고정)
// - 새 스냅숏: 붙임 1 학급별, 붙임 2 현장 제보·조치(두 서식), 붙임 3 교직원 소재 익명 집계(실제 재난만)
// - 개인정보 가림·검사
import { describe, expect, it } from "vitest";
import { capabilitiesFor } from "../shared/permissions";
import {
  INCIDENT_ROWS_PER_PAGE,
  MASK,
  buildDrillDoc,
  checkDoc,
  defaultManual,
  docTitle,
  maskPersonal,
  scanDocPrivacy,
  type DrillIncidentSnap,
  type DrillSnapshot,
} from "../shared/drillLog";

const incident = (no: number, over: Partial<DrillIncidentSnap> = {}): DrillIncidentSnap => ({
  no,
  typeLabel: "위험 발견",
  placeLabel: "복도 / 본관 1층",
  createdAt: "2026-10-30T01:05:00.000Z",
  statusLabel: "조치 중",
  updateCount: 2,
  actionCount: 1,
  summary: "복도에 연기",
  lastAction: "출입 통제",
  ...over,
});
const snap = (mode: "drill" | "real", over: Partial<DrillSnapshot> = {}): DrillSnapshot => ({
  takenAt: "2026-10-30T01:40:00.000Z",
  schoolName: "가상초등학교",
  event: { id: "e1", type: "fire", typeLabel: "화재", extraTypeLabels: [], mode, startedAt: "2026-10-30T01:00:00.000Z", closedAt: "2026-10-30T01:30:00.000Z", evacPlace: "운동장", location: null, issuedByName: "발령자이름", closedByName: "종료자이름" },
  classes: [
    { classId: "c1", label: "1학년 1반", grade: 1, classNo: 1, enrolled: 25, enrolledSource: "report", report: { evacuated: 24, absentKnown: 1, unconfirmed: 0, injured: 0, note: null, version: 1, reportedAt: "2026-10-30T01:10:00.000Z", lastChangedAt: "2026-10-30T01:10:00.000Z" } },
    { classId: "c2", label: "1학년 2반", grade: 1, classNo: 2, enrolled: 26, enrolledSource: "class", report: null },
  ],
  incidents: [incident(1)],
  presence: mode === "real" ? { targetCount: 10, respondedCount: 7, notRespondedCount: 3, onCampus: 5, offCampus: 2, available: 4, unavailable: 1, unsure: 2, alertsRead: 8, latestRespondedAt: "2026-10-30T01:20:00.000Z" } : undefined,
  ...over,
});
const allText = (d: ReturnType<typeof buildDrillDoc>) => d.pages.flatMap((p) => [p.title, p.subtitle, p.footnote ?? "", ...p.table.cells.map((c) => c.text)]).join("\n");

describe("모의훈련 일지(새 스냅숏)", () => {
  const d = buildDrillDoc(snap("drill"), defaultManual());
  it("본문 + 붙임 1 학급별 + 붙임 2 현장 제보, 배치 검사 통과, 제목·표제어는 기존 승인 서식 그대로", () => {
    expect(d.pages.map((p) => p.title)).toEqual(["비상대피훈련일지(화재)", "붙임 1. 학급별 대피 현황", "붙임 2. 현장 제보·조치 현황"]);
    expect(checkDoc(d)).toEqual([]);
    const main = d.pages[0]!.table.cells.map((c) => c.text);
    for (const t of ["참가인원", "학생 참가", "총 참가", "훈    련    내    용", "훈련 개요", "평    가", "추후 대피훈련 시\n반영사항"]) expect(main).toContain(t);
    expect(d.pages[0]!.footnote).toContain("붙임  1. 학급별 대피 현황  2. 현장 제보·조치 현황 각 1부.");
    expect(d.pages[0]!.footnote).toContain("※ 집계 기준 시각 2026. 10. 30. 10:40 (사건 종료 2026. 10. 30. 10:30).");
  });
  it("교직원 소재 붙임·숫자는 절대 없음(스냅숏에 소재 값이 잘못 들어와도)", () => {
    const leaked = buildDrillDoc(snap("drill", { presence: { targetCount: 10, respondedCount: 7, notRespondedCount: 3, onCampus: 5, offCampus: 2, available: 4, unavailable: 1, unsure: 2, alertsRead: 8, latestRespondedAt: null } }), defaultManual());
    expect(leaked.pages).toHaveLength(3);
    expect(allText(leaked)).not.toMatch(/소재|교내|교외|대피 지원|미응답/);
  });
});

describe("실제 재난 상황보고서", () => {
  const d = buildDrillDoc(snap("real"), defaultManual());
  const text = allText(d);
  it("제목 '재난대피 상황보고서', 같은 칸·같은 순서에 표제어만 바뀜, [실제 상황] 표시", () => {
    expect(docTitle(snap("real"))).toBe("재난대피 상황보고서(화재)");
    expect(d.pages.map((p) => p.title)).toEqual(["재난대피 상황보고서(화재)", "붙임 1. 학급별 대피 현황", "붙임 2. 현장 제보·조치 현황", "붙임 3. 교직원 소재 응답 통계(익명 집계)"]);
    const drill = buildDrillDoc(snap("drill"), defaultManual());
    const shape = (x: typeof d) => x.pages[0]!.table.cells.map((c) => [c.r, c.c, c.rs, c.cs]);
    expect(shape(d)).toEqual(shape(drill)); // 칸 구조 동일
    const main = d.pages[0]!.table.cells.map((c) => c.text);
    for (const t of ["인원현황", "학생 재실", "총 인원", "대    응    내    용", "상황 개요", "대응 평가", "문제점 및\n향후 조치 사항"]) expect(main).toContain(t);
    expect(main.some((t) => t.includes("[실제 상황]"))).toBe(true);
    expect(checkDoc(d)).toEqual([]);
  });
  it("붙임 3: 익명 숫자만(대상·응답·미응답·교내/교외·지원 가능 여부), 미응답 추정 없음 안내", () => {
    const p3 = d.pages[3]!.table.cells.map((c) => c.text);
    for (const t of ["집계 대상 교직원", "10명", "응답", "7명", "미응답(추정 안 함)", "3명", "교내", "5명", "교외", "2명", "대피 지원 가능", "4명"]) expect(p3).toContain(t);
    expect(d.pages[3]!.footnote).toContain("교외·안전으로 추정하지 않습니다");
  });
  it("발령자·종료자 이름은 싣지 않음", () => {
    expect(text).not.toContain("발령자이름");
    expect(text).not.toContain("종료자이름");
  });
  it("소재 집계가 없으면 '—'(0명으로 채우지 않음)", () => {
    const none = buildDrillDoc(snap("real", { presence: null }), defaultManual());
    const p3 = none.pages[3]!.table.cells.map((c) => c.text);
    expect(p3).toContain("—");
    expect(p3).not.toContain("0명");
  });
  it("진행 중 기록은 '최종본 아님' 표시", () => {
    const live = buildDrillDoc(snap("real", { event: { ...snap("real").event, closedAt: null } }), defaultManual());
    expect(live.pages[0]!.footnote).toContain("진행 중 기록(최종본 아님)");
  });
});

describe("붙임 2 현장 제보·조치", () => {
  it("제보 없으면 '현장 제보 없음', 많으면 쪽 나눔·쪽마다 머리글·마지막 쪽에만 안내", () => {
    const empty = buildDrillDoc(snap("drill", { incidents: [] }), defaultManual());
    expect(empty.pages[2]!.table.cells.map((c) => c.text)).toContain("현장 제보 없음");
    const many = buildDrillDoc(snap("real", { incidents: Array.from({ length: INCIDENT_ROWS_PER_PAGE + 4 }, (_, i) => incident(i + 1)) }), defaultManual());
    const p2 = many.pages.filter((p) => p.title.startsWith("붙임 2."));
    expect(p2.map((p) => p.title)).toEqual(["붙임 2. 현장 제보·조치 현황 (1/2)", "붙임 2. 현장 제보·조치 현황 (2/2)"]);
    for (const p of p2) expect(p.table.cells[0]!.text).toBe("번호");
    expect(p2[0]!.footnote).toBe("※ 다음 쪽에 이어집니다.");
    expect(checkDoc(many)).toEqual([]);
  });
  it("처리 상태·추가/조치 건수·최근 조치가 그대로", () => {
    const d = buildDrillDoc(snap("drill"), defaultManual());
    const row = d.pages[2]!.table.cells.filter((c) => c.r === 1).map((c) => c.text);
    expect(row).toEqual(["1", "위험 발견", "복도 / 본관 1층", "10:05", "조치 중", "2 / 1", "복도에 연기\n└ 조치: 출입 통제"]);
  });
});

describe("개인정보 가림·검사", () => {
  it("maskPersonal: 전화번호·주민등록번호 형태·교직원 이름(긴 이름 먼저)을 가리고 개수를 셈", () => {
    const r = maskPersonal("김철수 선생님이 010-1234-5678로 연락, 김철 확인, 010101-3123456", ["김철", "김철수", "가"]);
    expect(r.text).toBe(`${MASK} 선생님이 ${MASK}로 연락, ${MASK} 확인, ${MASK}`);
    expect(r.masked).toBe(4);
    expect(maskPersonal("운동장 남쪽", ["김철수"])).toEqual({ text: "운동장 남쪽", masked: 0 });
  });
  it("scanDocPrivacy: 전화번호는 두 서식 모두, 교직원 이름은 실제 재난만 검사", () => {
    const manual = { ...defaultManual(), trainingNote: "담당 홍길동 010-9999-8888" };
    const drill = buildDrillDoc(snap("drill"), manual);
    expect(scanDocPrivacy(drill, ["홍길동"], { checkNames: false })).toEqual(["쪽 1: 전화번호 형태"]);
    const real = buildDrillDoc(snap("real"), manual);
    expect(scanDocPrivacy(real, ["홍길동"], { checkNames: true })).toEqual(["쪽 1: 전화번호 형태", "쪽 1: 교직원 이름"]);
    expect(scanDocPrivacy(buildDrillDoc(snap("real"), defaultManual()), ["홍길동"], { checkNames: true })).toEqual([]);
  });
});

describe("보고서 권한(기존 훈련일지 권한 유지)", () => {
  it("훈련일지 작성(drilllog.edit)은 기존대로 안전업무 담당만, 열람(drilllog.view)도 기존 그대로", () => {
    expect(capabilitiesFor("staff", ["safety_officer"])).toContain("drilllog.edit");
    for (const [role, duties] of [["admin", []], ["staff", ["principal"]], ["staff", ["vice_principal"]], ["staff", ["app_operator"]], ["homeroom", []]] as const) {
      expect(capabilitiesFor(role, [...duties])).not.toContain("drilllog.edit");
    }
    for (const [role, duties] of [["admin", []], ["staff", ["principal"]], ["staff", ["vice_principal"]], ["staff", ["safety_officer"]]] as const) expect(capabilitiesFor(role, [...duties])).toContain("drilllog.view");
    expect(capabilitiesFor("staff", [])).not.toContain("drilllog.view");
  });
  it("실제 재난 상황보고서 작성(realreport.edit)은 학교 관리자·안전업무 담당만(교장·교감은 열람만 — 확인 권한은 미확정)", () => {
    expect(capabilitiesFor("admin", [])).toContain("realreport.edit");
    expect(capabilitiesFor("staff", ["safety_officer"])).toContain("realreport.edit");
    for (const d of ["principal", "vice_principal", "app_operator"] as const) expect(capabilitiesFor("staff", [d])).not.toContain("realreport.edit");
    expect(capabilitiesFor("homeroom", [])).not.toContain("realreport.edit");
  });
});

import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { DrillDocPreview } from "../client/src/pages/drill/DrillDocPreview";
import { markDraft, textLines, USABLE_H } from "../shared/drillLog";
describe("A4 인쇄 품질(Phase 4-C)", () => {
  it("붙임 표의 머리글 행은 <thead>(쪽을 넘으면 반복), 행은 쪽 경계에서 쪼개지지 않음, 본문 표는 thead 없음", () => {
    const html = renderToStaticMarkup(createElement(DrillDocPreview, { doc: buildDrillDoc(snap("real"), defaultManual()) }));
    expect((html.match(/<thead/g) ?? []).length).toBe(2); // 머리글이 있는 표는 붙임 1(학급별)·붙임 2(제보) — 소재 통계 표는 머리글 없음
    expect(html).toContain("display:table-header-group");
    expect(html).toContain("break-inside:avoid");
    expect((html.match(/class="drill-page/g) ?? []).length).toBe(4);
  });
  it("실제 재난 주석은 '학생 재실'(모의훈련 표현 없음), 초안 표시는 본문 부제에만", () => {
    const d = buildDrillDoc(snap("real"), defaultManual());
    expect(d.pages[0]!.footnote).toContain("※ 총 인원: 교직원·학생 재실 인원 확인 후 기입");
    expect(d.pages[0]!.footnote).not.toContain("학생 참가");
    const draft = markDraft(d);
    expect(draft.pages[0]!.subtitle).toContain("작성 중 초안(최종본 아님)");
    expect(draft.pages.slice(1).every((p, i) => p.subtitle === d.pages[i + 1]!.subtitle)).toBe(true);
  });
  it("긴 제보 요약은 행 높이를 늘리고 쪽을 높이 합으로 나눔(어느 쪽도 A4 높이를 넘지 않음)", () => {
    const long = Array.from({ length: 14 }, (_, i) => incident(i + 1, { summary: "가".repeat(60), lastAction: "나".repeat(40), placeLabel: "급식실 / 본관 뒤편 출입구 옆" }));
    const d = buildDrillDoc(snap("drill", { incidents: long }), defaultManual());
    const p2 = d.pages.filter((p) => p.title.startsWith("붙임 2."));
    expect(p2.length).toBeGreaterThan(1);
    expect(checkDoc(d)).toEqual([]);
    expect(textLines("가".repeat(60), 60)).toBeGreaterThan(1);
    for (const p of p2) expect(p.table.rowsMm.reduce((a, b) => a + b, 0)).toBeLessThan(USABLE_H);
  });
});
