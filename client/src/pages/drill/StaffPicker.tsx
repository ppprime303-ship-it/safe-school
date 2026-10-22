// 역할 담당자 고르기: 같은 학교의 승인된 교직원 이름 목록에서 검색·여러 명 선택(STEP 3-D UI 개선)
// - 결과는 기존과 같은 자유 문자열(who)에 "이름, 이름"으로 들어갑니다 → 기존 저장값·직접 입력(외부 인력)과 호환
// - 명단에 없는 글자(예: "각 반 담임교사", 외부 강사)는 그대로 남깁니다. 선택을 바꾸지 않으면 문자열도 바꾸지 않습니다.
// - 목록은 이름·직책·담임 학급만 받습니다(이메일·연락처 없음).
import { useEffect, useId, useMemo, useRef, useState } from "react";
import { PrimaryButton } from "../../components/ui/PrimaryButton";

export interface StaffEntry {
  id: string;
  name: string;
  roleLabel: string;
  duties: string[];
  classes: string[];
}

export const WHO_MAX = 60;
/** "홍길동, 김철수" → ["홍길동", "김철수"] (쉼표·가운뎃점 구분) */
export const splitWho = (who: string) => who.split(/\s*[,，、]\s*/).map((t) => t.trim()).filter(Boolean);

/** 선택 결과를 문자열로: 명단에 없는 기존 글자는 앞에 그대로 두고, 고른 이름을 뒤에 붙임 */
export function mergeWho(current: string, staffNames: Set<string>, selected: string[]): string {
  const kept = splitWho(current).filter((t) => !staffNames.has(t));
  return [...kept, ...selected].join(", ");
}

export function StaffPicker({
  open,
  roleName,
  who,
  staff,
  loadError,
  onApply,
  onClose,
}: {
  open: boolean;
  roleName: string;
  who: string;
  staff: StaffEntry[] | null;
  loadError: string | null;
  onApply: (who: string) => void;
  onClose: () => void;
}) {
  const ref = useRef<HTMLDialogElement>(null);
  const titleId = useId();
  const [q, setQ] = useState("");
  const [picked, setPicked] = useState<string[]>([]);
  const names = useMemo(() => new Set((staff ?? []).map((s) => s.name)), [staff]);

  useEffect(() => {
    const d = ref.current;
    if (!d) return;
    if (open && !d.open) {
      setQ("");
      d.showModal();
    } else if (!open && d.open) d.close();
  }, [open]);
  // 열 때·명단이 도착할 때 현재 문자열에 들어 있는 이름을 미리 체크
  useEffect(() => {
    if (open) setPicked(splitWho(who).filter((t) => names.has(t)));
  }, [open, who, names]);

  const initial = splitWho(who).filter((t) => names.has(t));
  const unchanged = initial.length === picked.length && initial.every((n, i) => picked[i] === n);
  const result = mergeWho(who, names, picked);
  const tooLong = [...result].length > WHO_MAX;
  const shown = (staff ?? []).filter((s) => {
    const k = q.trim();
    return !k || [s.name, s.roleLabel, ...s.duties, ...s.classes].some((v) => v.includes(k));
  });
  const toggle = (name: string) => setPicked((p) => (p.includes(name) ? p.filter((n) => n !== name) : [...p, name]));

  return (
    <dialog
      ref={ref}
      aria-labelledby={titleId}
      onCancel={(e) => {
        e.preventDefault();
        onClose();
      }}
      className="m-auto w-[min(94vw,36rem)] rounded-card border-0 bg-card p-0 text-ink shadow-xl backdrop:bg-ink/60"
    >
      <div className="flex max-h-[85vh] flex-col p-5">
        <h2 id={titleId} className="text-xl font-bold">담당자 선택 — {roleName || "역할"}</h2>
        <p className="mt-1 text-sm text-ink-muted">우리 학교 승인 교직원 명단입니다. 여러 명을 고를 수 있습니다. 명단에 없는 사람(외부 인력)은 입력칸에 직접 적으세요.</p>
        <label className="mt-3 block font-bold">
          이름·직책·학급 검색
          <input value={q} onChange={(e) => setQ(e.target.value)} className="mt-1 block min-h-touch w-full rounded-control border-2 border-line-strong bg-card px-3 text-lg" placeholder="예) 김, 담임, 3학년" autoComplete="off" />
        </label>
        <div className="mt-3 min-h-24 flex-1 overflow-y-auto rounded-control border border-line">
          {loadError ? (
            <p role="alert" className="p-3 font-semibold text-danger">{loadError}</p>
          ) : !staff ? (
            <p className="p-3 text-ink-muted">명단을 불러오는 중…</p>
          ) : shown.length === 0 ? (
            <p className="p-3 text-ink-muted">{staff.length ? "검색 결과가 없습니다." : "승인된 교직원이 없습니다."}</p>
          ) : (
            <ul>
              {shown.map((s) => (
                <li key={s.id} className="border-b border-line last:border-b-0">
                  <label className="flex min-h-touch cursor-pointer items-center gap-3 px-3 py-2 focus-within:bg-brand-soft">
                    <input type="checkbox" className="size-5" checked={picked.includes(s.name)} onChange={() => toggle(s.name)} />
                    <span className="text-lg font-bold">{s.name}</span>
                    <span className="text-sm text-ink-muted">{[s.roleLabel, ...s.duties, ...s.classes.map((c) => `${c} 담임`)].filter(Boolean).join(" · ")}</span>
                  </label>
                </li>
              ))}
            </ul>
          )}
        </div>
        <div className="mt-3 rounded-control bg-page px-3 py-2 text-base">
          <span className="font-bold">들어갈 내용: </span>
          {result || <span className="text-ink-muted">(비어 있음)</span>}
          {tooLong && <p role="alert" className="mt-1 text-sm font-bold text-danger">{WHO_MAX}자를 넘습니다. 인원을 줄이거나 "○○○ 외 3명"처럼 직접 입력하세요.</p>}
        </div>
        <div className="mt-4 grid grid-cols-2 gap-2">
          <PrimaryButton variant="ghost" onClick={onClose}>취소</PrimaryButton>
          <PrimaryButton
            disabled={tooLong || !!loadError || !staff}
            onClick={() => {
              if (!unchanged) onApply(result);
              onClose();
            }}
          >
            적용
          </PrimaryButton>
        </div>
      </div>
    </dialog>
  );
}
