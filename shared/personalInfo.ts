// Beta PILOT 2 Phase 1-2: 모든 교직원에게 보이는 자유 입력(발령 안내·장소 등)의 개인정보 입력 방지(화면·서버 공통)
// - 주민등록번호(외국인등록번호 포함) 형태: 쓸 이유가 없으므로 서버가 거부합니다.
// - 휴대전화번호 형태: 비상 연락처로 쓸 수도 있어 거부하지 않고 화면에서 경고만 합니다.
// - 이름은 형태로 가려낼 수 없으므로 안내 문구로만 막습니다(자동 판별하지 않음).

export const FREE_TEXT_PRIVACY_HINT = "학교 교직원 모두에게 보입니다. 학생·교직원 이름, 연락처, 건강 상태 등 개인정보는 적지 마세요.";

const RRN = /(?<!\d)\d{2}(0[1-9]|1[0-2])(0[1-9]|[12]\d|3[01])\s?-?\s?[1-8]\d{6}(?!\d)/;
const MOBILE = /(?<!\d)01[016789][\s.-]?\d{3,4}[\s.-]?\d{4}(?!\d)/;

export type PersonalInfoKind = "rrn" | "mobile";

export function findPersonalInfo(text: string | null | undefined): PersonalInfoKind[] {
  if (!text) return [];
  const found: PersonalInfoKind[] = [];
  if (RRN.test(text)) found.push("rrn");
  if (MOBILE.test(text)) found.push("mobile");
  return found;
}

export const RRN_REJECT_MESSAGE = "주민등록번호 형태의 숫자는 입력할 수 없습니다.";
export const MOBILE_WARNING = "휴대전화번호가 들어 있습니다. 모든 교직원에게 보이니 꼭 필요한 공용 연락처인지 확인하세요.";
