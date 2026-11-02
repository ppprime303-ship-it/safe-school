// Phase 4 화면 검증에서 발견: 재난대피일지 편집 화면에 '훈련 발령'·'학생 참가' 등 모의훈련 표현이 남아 있던 결함의 회귀 방지
import fs from "node:fs";
import { describe, expect, it } from "vitest";
import { editorLabels, timeBasisNote } from "../shared/drillLog";

describe("재난대피일지 편집 화면 문구", () => {
  it("실제 재난 표제어·안내·입력 예시에 훈련·참가 표현 없음", () => {
    const text = JSON.stringify(editorLabels("real")) + timeBasisNote("real");
    expect(text).not.toMatch(/훈련|참가/);
    expect(timeBasisNote("real")).toContain("재난 발령~종료");
    expect(editorLabels("real")).toMatchObject({ page: "재난대피일지", student: "학생 재실(명)", total: "총 인원(명)", improve: "문제점 및 향후 조치 사항" });
  });

  it("모의훈련 표제어·안내는 기존 그대로", () => {
    expect(timeBasisNote("drill")).toContain("훈련 발령~종료");
    expect(editorLabels("drill")).toMatchObject({ page: "훈련일지", people: "참가 인원", staff: "교직원 참가(명)", student: "학생 참가(명)", total: "총 참가(명)", overview: "훈련 개요(보충 설명)", improve: "추후 대피훈련 시 반영사항" });
  });

  it("편집 화면 코드에 서식 구분 없는 모의훈련 문구를 직접 쓰지 않음", () => {
    const src = fs.readFileSync("client/src/pages/drill/DrillLogEditorPage.tsx", "utf8");
    for (const fixed of ["TIME_BASIS_NOTE", "교직원 참가(명)", "실제 참가 학생 수", "교직원 + 학생 참가", "사전 안전교육 후"]) expect(src).not.toContain(fixed);
  });

  it("소재 화면의 요약 링크는 터치 영역 확보", () => {
    const src = fs.readFileSync("client/src/pages/presence/PresencePage.tsx", "utf8");
    expect(src).toMatch(/staff-presence\?event=\$\{eventId\}`\} className="[^"]*min-h-touch/);
  });
});
