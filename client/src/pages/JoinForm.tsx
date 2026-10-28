// v0.1 교직원 가입 신청(간편 입력): 교직원 구분 → 담당 업무(복수) → 고른 업무에 필요한 칸만 표시
// - 담당 학생 수는 받지 않습니다. 학년·반은 학교급에 맞는 목록에서 고릅니다(휴대폰에서도 탭 몇 번).
// - 모두 '신청 정보'입니다. 학교 관리자가 확인·승인해야 학교 화면을 쓸 수 있고, 교장·교감을 골라도 관리자 권한은 생기지 않습니다.
import { useState } from "react";
import {
  CLASS_NUMBERS,
  POSITION_LABEL,
  POSITIONS,
  REQUESTED_DUTY_LABEL,
  describeRequestedClasses,
  gradeRange,
  requestedRoleOf,
  visibleDuties,
  type RequestedDuty,
  type RequestedPosition,
} from "@shared/joinRequest";
import { FormField } from "../components/ui/FormField";
import { PrimaryButton } from "../components/ui/PrimaryButton";

export interface JoinBody {
  role: "homeroom" | "staff";
  position: RequestedPosition;
  requestedDuties: RequestedDuty[];
  requestedClass?: string;
  note?: string;
}

const selectClass = "mt-1 block min-h-touch w-full rounded-control border-2 border-line-strong bg-card px-3 text-lg";

function GradeClassPicker({ label, kindCode, value, onChange, withClass = true }: { label: string; kindCode: string; value: { grade: string; classNo: string }; onChange: (v: { grade: string; classNo: string }) => void; withClass?: boolean }) {
  return (
    <fieldset>
      <legend className="text-base font-bold">{label}</legend>
      <div className={`mt-1 grid gap-2 ${withClass ? "grid-cols-2" : "grid-cols-1"}`}>
        <select aria-label={`${label} 학년`} value={value.grade} onChange={(e) => onChange({ ...value, grade: e.target.value })} className={selectClass}>
          <option value="">학년</option>
          {gradeRange(kindCode).map((g) => (
            <option key={g} value={g}>{g}학년</option>
          ))}
        </select>
        {withClass && (
          <select aria-label={`${label} 반`} value={value.classNo} onChange={(e) => onChange({ ...value, classNo: e.target.value })} className={selectClass}>
            <option value="">반</option>
            {CLASS_NUMBERS.map((n) => (
              <option key={n} value={n}>{n}반</option>
            ))}
          </select>
        )}
      </div>
    </fieldset>
  );
}

export function JoinForm({ kindCode, busy, onSubmit }: { kindCode: string; busy: boolean; onSubmit: (body: JoinBody) => void }) {
  const [position, setPosition] = useState<RequestedPosition | "">("");
  const [duties, setDuties] = useState<RequestedDuty[]>([]);
  const [homeroom, setHomeroom] = useState({ grade: "", classNo: "" });
  const [assistant, setAssistant] = useState({ grade: "", classNo: "" });
  const [gradeHead, setGradeHead] = useState({ grade: "", classNo: "" });
  const [specialName, setSpecialName] = useState("");
  const [note, setNote] = useState("");

  const has = (d: RequestedDuty) => duties.includes(d);
  const toggle = (d: RequestedDuty) => setDuties(has(d) ? duties.filter((x) => x !== d) : [...duties, d]);
  const pair = (v: { grade: string; classNo: string }) => (v.grade && v.classNo ? { grade: Number(v.grade), classNo: Number(v.classNo) } : null);

  const missing =
    !position ||
    (has("homeroom") && !pair(homeroom)) ||
    (has("assistant_homeroom") && !pair(assistant)) ||
    (has("grade_head") && !gradeHead.grade);

  const submit = () => {
    if (missing || !position) return;
    onSubmit({
      role: requestedRoleOf(duties),
      position,
      requestedDuties: duties,
      requestedClass: describeRequestedClasses({
        homeroom: has("homeroom") ? pair(homeroom) : null,
        assistant: has("assistant_homeroom") ? pair(assistant) : null,
        gradeHead: has("grade_head") && gradeHead.grade ? Number(gradeHead.grade) : null,
        specialClassName: has("special_class") ? specialName : null,
      }),
      note: note.trim() || undefined,
    });
  };

  return (
    <div className="mt-3 space-y-4">
      <fieldset>
        <legend className="text-base font-bold">교직원 구분</legend>
        <div className="mt-2 grid grid-cols-2 gap-2">
          {POSITIONS.map((p) => (
            <label key={p} className={`flex min-h-touch cursor-pointer items-center justify-center gap-2 rounded-control border-2 px-2 font-bold ${position === p ? "border-brand bg-brand-soft" : "border-line-strong bg-card"}`}>
              <input type="radio" name="position" className="sr-only" checked={position === p} onChange={() => setPosition(p)} />
              {POSITION_LABEL[p]}
            </label>
          ))}
        </div>
        {(position === "principal" || position === "vice_principal") && (
          <p className="mt-2 text-sm text-ink-muted">교장·교감 직책은 신청 정보로만 전달되며, 운영자 확인 전에는 관리자 권한이 생기지 않습니다.</p>
        )}
      </fieldset>

      <fieldset>
        <legend className="text-base font-bold">담당 업무(해당하는 것 모두, 없으면 건너뛰기)</legend>
        <div className="mt-2 grid grid-cols-1 gap-2 sm:grid-cols-2">
          {visibleDuties(kindCode).map((d) => (
            <label key={d} className={`flex min-h-touch cursor-pointer items-center gap-2 rounded-control border-2 px-3 ${has(d) ? "border-brand bg-brand-soft" : "border-line-strong bg-card"}`}>
              <input type="checkbox" className="size-5" checked={has(d)} onChange={() => toggle(d)} />
              <span className="text-base font-semibold">{REQUESTED_DUTY_LABEL[d]}</span>
            </label>
          ))}
        </div>
      </fieldset>

      {has("homeroom") && <GradeClassPicker label="담임 학급" kindCode={kindCode} value={homeroom} onChange={setHomeroom} />}
      {has("assistant_homeroom") && <GradeClassPicker label="부담임 학급" kindCode={kindCode} value={assistant} onChange={setAssistant} />}
      {has("grade_head") && <GradeClassPicker label="담당 학년" kindCode={kindCode} value={gradeHead} onChange={setGradeHead} withClass={false} />}
      {has("special_class") && (
        <FormField label="특수학급 이름(선택)" value={specialName} onChange={(e) => setSpecialName(e.target.value)} placeholder="예: 사랑반" maxLength={20} />
      )}
      <FormField label="승인 담당자에게 남길 말(선택)" value={note} onChange={(e) => setNote(e.target.value)} placeholder="예: 교무부 안전교육 담당" maxLength={200} />

      <p className="rounded-control bg-brand-soft p-3 text-sm">
        입력한 구분·업무·학급은 <strong>신청 정보</strong>입니다. 학교 관리자가 확인하고 승인한 뒤에 학교 화면을 쓸 수 있고, 실제 담당 학급도 그때 확정됩니다. 학생 이름·인원 등 학생 정보는 적지 마세요.
      </p>
      <PrimaryButton fullWidth onClick={submit} loading={busy} disabled={!!missing} loadingText="신청 중…">
        가입 신청
      </PrimaryButton>
    </div>
  );
}
