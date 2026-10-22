// STEP 3-D 화면용 권한 판정(서버가 요청마다 다시 검사하므로 화면 표시·이동용)
import { DUTY_LABEL, capabilitiesFor, type Capability, type StaffDuty } from "@shared/permissions";
import type { Membership } from "./session";

export function capsOf(m: Pick<Membership, "role" | "duties" | "capabilities"> | null | undefined): Capability[] {
  if (!m) return [];
  if (m.capabilities) return m.capabilities as Capability[];
  return capabilitiesFor(m.role, (m.duties ?? []) as StaffDuty[]); // 이전 서버 응답(직책 정보 없음) 호환
}

export const can = (m: Parameters<typeof capsOf>[0], cap: Capability) => capsOf(m).includes(cap);

/** 처음 열 화면: 전체 현황을 볼 수 있으면 상황판, 아니면 학급 보고 */
export const homePath = (m: Membership) => `/s/${m.school.id}/${can(m, "board.view") ? "board" : "report"}`;

/** '학교 관리자 · 안전업무 담당' 같은 표시 */
export function roleSummary(m: Pick<Membership, "role" | "duties" | "actingDuties">): string {
  const base = m.role === "admin" ? "학교 관리자" : m.role === "homeroom" ? "담임교사" : "교직원";
  const duties = (m.duties ?? []).map((d) => DUTY_LABEL[d as StaffDuty] + ((m.actingDuties ?? []).includes(d) ? "(직무대리)" : ""));
  return [base, ...duties].join(" · ");
}
