// STEP 3-C UI 개선: '저장하기' 한 버튼의 요청 계획(순수 함수, DB 없음)
import { describe, expect, it } from "vitest";
import { isNoticeDirty, planNoticeSave, saveMessage, type NoticeDraftState } from "../client/src/lib/noticeSave.js";

const base: NoticeDraftState = { title: "폭염 안내", body: "본문", exampleKey: "heatwave.parent.issued", status: "completed" };

describe("저장하기 한 버튼", () => {
  it("본문만 고치면 기존 작성 상태(작성 완료)를 그대로 보낸다", () => {
    const plan = planNoticeSave({ mode: "edit", version: 3, baseline: base, current: { ...base, body: "본문 수정" } });
    expect(plan).toEqual({ kind: "update", payload: { title: "폭염 안내", body: "본문 수정", status: "completed", expectedVersion: 3 } });
  });

  it("작성 상태만 바꿔도 저장 요청 1건(판 +1), 예시 키는 바뀔 때만 보낸다", () => {
    const plan = planNoticeSave({ mode: "edit", version: 3, baseline: base, current: { ...base, status: "draft" } });
    expect(plan).toEqual({ kind: "update", payload: { title: "폭염 안내", body: "본문", status: "draft", expectedVersion: 3 } });
    const withExample = planNoticeSave({ mode: "edit", version: 3, baseline: base, current: { ...base, exampleKey: "heatwave.staff.issued" } });
    expect(withExample).toMatchObject({ kind: "update", payload: { exampleKey: "heatwave.staff.issued" } });
    const cleared = planNoticeSave({ mode: "edit", version: 3, baseline: base, current: { ...base, exampleKey: null } });
    expect(cleared).toMatchObject({ kind: "update", payload: { exampleKey: null } });
  });

  it("바뀐 것이 없으면 요청하지 않는다(판 번호 유지)", () => {
    expect(planNoticeSave({ mode: "edit", version: 3, baseline: base, current: { ...base } })).toEqual({ kind: "none" });
    expect(isNoticeDirty(base, { ...base })).toBe(false);
    expect(isNoticeDirty(base, { ...base, status: "draft" })).toBe(true);
  });

  it("빈 제목·본문은 요청하지 않는다", () => {
    expect(planNoticeSave({ mode: "edit", version: 1, baseline: base, current: { ...base, title: "  " } })).toMatchObject({ kind: "invalid" });
    expect(planNoticeSave({ mode: "new", alertId: "a", current: { ...base, body: "\n" } })).toMatchObject({ kind: "invalid" });
  });

  it("새 안내문: 작성 중으로 만든 뒤, 작성 완료를 골랐으면 이어서 상태만 바꾼다", () => {
    expect(planNoticeSave({ mode: "new", alertId: "a1", current: { ...base, status: "draft" } })).toEqual({
      kind: "create", create: { alertId: "a1", title: "폭염 안내", body: "본문", exampleKey: "heatwave.parent.issued" }, thenStatus: "draft",
    });
    expect(planNoticeSave({ mode: "new", alertId: "a1", current: base })).toMatchObject({ kind: "create", thenStatus: "completed" });
  });

  it("저장 메시지: 작성 완료는 결재·발송 완료가 아님을 알린다", () => {
    expect(saveMessage(4, "completed", true)).toContain("결재·발송은 학교 절차대로");
    expect(saveMessage(4, "draft", false)).toBe("저장했습니다(판 4).");
  });
});
