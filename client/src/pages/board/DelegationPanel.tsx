// v0.1 담당 교사 부재 시 대리 보고 지정(발령 권한자 화면, 이번 훈련·상황 동안만)
// - 사유는 연락 미확인·보고 불가·관리자 판단뿐입니다. 보고가 늦다는 이유로 교사 상태(실종·부상)를 판단하지 않습니다.
// - 후보 순서는 학교급별 '제안'이며, 같은 학교의 다른 교직원을 직접 고를 수도 있습니다. 권한·학교 범위는 서버가 다시 검사합니다.
// - 대리 담당이 여러 학급을 맡아도 학급마다 따로 보고합니다. 상황을 종료하면 모든 대리 지정이 자동으로 끝납니다.
import { useState } from "react";
import { api, describeError } from "../../lib/api";
import type { ClassReportView } from "../../lib/disaster";
import { ConfirmDialog } from "../../components/ui/ConfirmDialog";
import { PrimaryButton } from "../../components/ui/PrimaryButton";
import { Badge } from "../../components/ui/StatusBadge";
import { SPECIAL_CLASS_NOTICE } from "@shared/headcount";

type Reason = "unreachable" | "unable" | "admin_decision";
const REASON_LABEL: Record<Reason, string> = { unreachable: "연락 미확인", unable: "보고 불가", admin_decision: "관리자 판단" };
interface Member {
  membershipId: string;
  name: string;
  role: string;
}
interface Suggestions {
  schoolLevel: "elementary" | "secondary";
  original: Member[];
  suggestions: { step: string; members: Member[] }[];
  candidates: Member[];
}

export function DelegationPanel({ schoolId, eventId, classes, onChanged }: { schoolId: string; eventId: string; classes: ClassReportView[]; onChanged: () => void }) {
  const [target, setTarget] = useState<ClassReportView | null>(null);
  const [sugg, setSugg] = useState<Suggestions | null>(null);
  const [pick, setPick] = useState("");
  const [reason, setReason] = useState<Reason>("unreachable");
  const [basis, setBasis] = useState("");
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<string | null>(null);

  const open = async (c: ClassReportView) => {
    setTarget(c);
    setSugg(null);
    setPick("");
    setReason("unreachable");
    setBasis("");
    setMessage(null);
    try {
      setSugg(await api<Suggestions>("GET", `/schools/${schoolId}/events/${eventId}/classes/${c.classId}/delegation-suggestions`));
    } catch (e) {
      setMessage(describeError(e).message);
    }
  };

  const submit = async () => {
    if (!target || !pick) return;
    setBusy(true);
    try {
      await api("POST", `/schools/${schoolId}/events/${eventId}/classes/${target.classId}/delegation`, {
        delegateMembershipId: pick,
        reason,
        basis: basis.trim() || undefined,
        replacesDelegationId: target.delegation?.id,
      });
      setTarget(null);
      onChanged();
    } catch (e) {
      setMessage(describeError(e).message);
    } finally {
      setBusy(false);
    }
  };

  const end = async (c: ClassReportView, why: "returned" | "revoked") => {
    if (!c.delegation) return;
    setBusy(true);
    try {
      await api("POST", `/schools/${schoolId}/events/${eventId}/delegations/${c.delegation.id}/end`, { reason: why });
      onChanged();
    } catch (e) {
      setMessage(describeError(e).message);
    } finally {
      setBusy(false);
    }
  };

  const sorted = [...classes].sort((a, b) => Number(!!a.report) - Number(!!b.report) || a.grade - b.grade || a.classNo - b.classNo);
  return (
    <section aria-labelledby="delegation" className="rounded-card border border-line bg-card p-4 shadow-card">
      <h2 id="delegation" className="text-xl font-bold">담당 교사 부재 시 대리 보고</h2>
      <p className="mt-1 text-sm text-ink-muted">
        담당 교사와 연락이 되지 않거나 보고할 수 없을 때, <strong>이번 상황 동안만</strong> 같은 학교 교직원에게 그 학급 보고를 맡깁니다. 보고가 늦다는 것만으로 교사의 상태를 판단하지 마세요. 상황을 종료하면 자동으로 해제됩니다.
      </p>
      {/* Beta PILOT 2 Phase 1-3 */}
      <p className="mt-1 text-sm font-semibold">
        학급 보고는 담임과 여기서 지정한 대리 담당만 할 수 있습니다(관리자도 같음). 자기 자신은 지정할 수 없으니, 직접 맡아야 하면 다른 발령 권한자가 지정해 주세요.
      </p>
      <p className="mt-2 rounded-control bg-page p-3 text-sm">{SPECIAL_CLASS_NOTICE}</p>
      {message && !target && <p role="alert" className="mt-2 font-semibold text-danger">{message}</p>}
      <ul className="mt-3 divide-y divide-line">
        {sorted.map((c) => (
          <li key={c.classId} className="flex flex-wrap items-center justify-between gap-2 py-2">
            <span className="text-base">
              <strong>{c.label}</strong> {c.report ? <Badge tone="success">보고됨</Badge> : <Badge tone="warning">미보고</Badge>}
              {c.delegation && (
                <span className="mt-0.5 block text-sm">
                  대리 담당 <strong>{c.delegation.delegateName}</strong> · {REASON_LABEL[c.delegation.reason]}
                  {c.delegation.basis && ` · ${c.delegation.basis}`}
                </span>
              )}
            </span>
            <span className="flex flex-wrap gap-2">
              <PrimaryButton variant="secondary" onClick={() => void open(c)} disabled={busy}>
                {c.delegation ? "다른 사람으로 바꾸기" : "대리 지정"}
              </PrimaryButton>
              {c.delegation && (
                <>
                  <PrimaryButton variant="ghost" onClick={() => void end(c, "returned")} disabled={busy}>
                    원 담당 복귀
                  </PrimaryButton>
                  <PrimaryButton variant="dangerOutline" onClick={() => void end(c, "revoked")} disabled={busy}>
                    대리 해제
                  </PrimaryButton>
                </>
              )}
            </span>
          </li>
        ))}
      </ul>

      <ConfirmDialog open={!!target} title={`${target?.label ?? ""} 대리 보고 담당 지정`} confirmLabel="지정" tone="primary" loading={busy} onConfirm={() => void submit()} onCancel={() => setTarget(null)}>
        {!sugg && !message && <p>후보를 불러오는 중…</p>}
        {message && <p role="alert" className="font-semibold text-danger">{message}</p>}
        {sugg && (
          <div className="space-y-3">
            {sugg.original.length > 0 && <p className="text-sm text-ink-muted">원 담임: {sugg.original.map((m) => m.name).join(", ")}</p>}
            <fieldset>
              <legend className="font-bold">추천 순서({sugg.schoolLevel === "elementary" ? "초등: 학년부장 → 교감" : "중·고: 부담임 → 학년부장"})</legend>
              {sugg.suggestions.map((s) => (
                <div key={s.step} className="mt-1">
                  <p className="text-sm font-semibold">{s.step}</p>
                  {s.members.length === 0 && <p className="text-sm text-ink-muted">등록된 사람이 없습니다.</p>}
                  {s.members.map((m) => (
                    <label key={m.membershipId} className="flex min-h-touch items-center gap-2">
                      <input type="radio" name="delegate" checked={pick === m.membershipId} onChange={() => setPick(m.membershipId)} className="size-5" />
                      {m.name}
                    </label>
                  ))}
                </div>
              ))}
            </fieldset>
            <label className="block">
              <span className="font-bold">그 밖의 교직원(직접 지정)</span>
              <select value={pick} onChange={(e) => setPick(e.target.value)} className="mt-1 block min-h-touch w-full rounded-control border-2 border-line-strong bg-card px-3 text-base">
                <option value="">선택하세요</option>
                {sugg.candidates.map((m) => (
                  <option key={m.membershipId} value={m.membershipId}>
                    {m.name}
                  </option>
                ))}
              </select>
            </label>
            <fieldset>
              <legend className="font-bold">사유</legend>
              <div className="mt-1 grid grid-cols-1 gap-2 sm:grid-cols-3">
                {(Object.keys(REASON_LABEL) as Reason[]).map((r) => (
                  <label key={r} className={`flex min-h-touch items-center gap-2 rounded-control border-2 px-2 ${reason === r ? "border-brand bg-brand-soft" : "border-line-strong"}`}>
                    <input type="radio" name="reason" checked={reason === r} onChange={() => setReason(r)} className="size-5" />
                    {REASON_LABEL[r]}
                  </label>
                ))}
              </div>
            </fieldset>
            <label className="block">
              <span className="font-bold">지정 근거(선택)</span>
              <input value={basis} onChange={(e) => setBasis(e.target.value)} maxLength={200} placeholder="예: 무전 응답 없음, 학교 비상계획 2순위" className="mt-1 block min-h-touch w-full rounded-control border-2 border-line-strong px-3 text-base" />
            </label>
          </div>
        )}
      </ConfirmDialog>
    </section>
  );
}
