// v0.1 공개 평가 안내(모든 화면 공통). 정식 서비스가 아님을 항상 보이게 둡니다.
export const PROTOTYPE_LABEL = "SAFE SCHOOL — Prototype / Pilot v0.1";
export const PROTOTYPE_NOTICE =
  "SAFE SCHOOL은 개발 중인 프로토타입입니다. 실제 재난대응 업무를 대체하지 않습니다. 평가에서는 실제 학생 개인정보 및 실제 재난 상황을 입력하지 마세요.";

export function PrototypeNotice({ compact = false }: { compact?: boolean }) {
  return (
    <p role="note" className={`border-warning bg-warning-soft text-warning-strong ${compact ? "border-b px-4 py-1.5 text-xs sm:text-sm" : "rounded-control border-2 p-3 text-sm"}`}>
      <strong>{PROTOTYPE_LABEL}</strong> · {PROTOTYPE_NOTICE}
    </p>
  );
}
