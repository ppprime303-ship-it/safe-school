// STEP 3-C 안내문 '저장하기' 한 버튼의 요청 계획(화면 로직, 순수 함수 — tests/notice-save.test.ts)
// - 작성 상태(작성 중/작성 완료)는 별도 선택 UI의 값이며, 저장할 때 함께 반영합니다.
// - 상태를 바꾸지 않고 본문만 고치면 기존 상태를 그대로 보냅니다(의도치 않은 상태 변경 없음).
// - 바뀐 것이 없으면 요청하지 않습니다(판 번호를 올리지 않음).
// - 서버 API·판 번호·409 충돌 처리·감사 기록은 그대로입니다(PATCH 한 번 = 판 +1).
export type EditableStatus = "draft" | "completed";

export interface NoticeDraftState {
  title: string;
  body: string;
  exampleKey: string | null;
  status: EditableStatus;
}

export type SavePlan =
  | { kind: "invalid"; message: string }
  | { kind: "none" }
  | { kind: "create"; create: { alertId: string; title: string; body: string; exampleKey: string | null }; thenStatus: EditableStatus }
  | { kind: "update"; payload: { title: string; body: string; status: EditableStatus; expectedVersion: number; exampleKey?: string | null } };

export function isNoticeDirty(baseline: NoticeDraftState, current: NoticeDraftState): boolean {
  return (
    baseline.title !== current.title ||
    baseline.body !== current.body ||
    baseline.exampleKey !== current.exampleKey ||
    baseline.status !== current.status
  );
}

export function planNoticeSave(params:
  | { mode: "new"; alertId: string; current: NoticeDraftState }
  | { mode: "edit"; version: number; baseline: NoticeDraftState; current: NoticeDraftState }): SavePlan {
  const c = params.current;
  if (!c.title.trim() || !c.body.trim()) return { kind: "invalid", message: "제목과 본문을 입력하세요." };
  if (params.mode === "new") {
    // 새 안내문은 DB 규칙상 '작성 중'으로 만들어지고, '작성 완료'를 골랐다면 이어서 상태만 바꿔 저장(판 2)
    return { kind: "create", create: { alertId: params.alertId, title: c.title, body: c.body, exampleKey: c.exampleKey }, thenStatus: c.status };
  }
  if (!isNoticeDirty(params.baseline, c)) return { kind: "none" };
  const payload: Extract<SavePlan, { kind: "update" }>["payload"] = {
    title: c.title,
    body: c.body,
    status: c.status,
    expectedVersion: params.version,
  };
  if (c.exampleKey !== params.baseline.exampleKey) payload.exampleKey = c.exampleKey;
  return { kind: "update", payload };
}

/** 저장 결과 메시지(짧게). '작성 완료'는 결재·발송 완료가 아님을 함께 알립니다. */
export function saveMessage(version: number, status: EditableStatus, statusChanged: boolean): string {
  if (statusChanged && status === "completed") return `저장했습니다(판 ${version}) · 작성 완료로 표시 — 결재·발송은 학교 절차대로 진행하세요.`;
  if (statusChanged) return `저장했습니다(판 ${version}) · 작성 중으로 표시`;
  return `저장했습니다(판 ${version}).`;
}
