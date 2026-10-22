// STEP 3-D 업무 담당자 지정(앱 운영담당·기존 관리자): 안전업무 담당·앱 운영담당은 여러 명, 겸임 가능
// 교장·교감 직책은 기관 확인 후 플랫폼 운영자가 등록(여기서는 표시만). 지정·해제는 비밀번호 재확인 후, 기록은 남음.
import { useSession } from "../../lib/session";
import { useState } from "react";
import { api, ApiError, describeError } from "../../lib/api";
import { PrimaryButton } from "../../components/ui/PrimaryButton";
import { ConfirmDialog } from "../../components/ui/ConfirmDialog";
import { Badge } from "../../components/ui/StatusBadge";
import { DUTY_LABEL, type StaffDuty } from "@shared/permissions";

export interface MemberDutyView {
  id: string;
  duty: StaffDuty;
  isActing: boolean;
  grantedVia: "school_app" | "platform_operator";
}
export interface DutyMember {
  id: string;
  role: "admin" | "homeroom" | "staff";
  user: { displayName: string; email: string };
  duties: MemberDutyView[];
}

const GRANTABLE: StaffDuty[] = ["safety_officer", "app_operator"];

export function DutyBadges({ duties }: { duties: MemberDutyView[] }) {
  return (
    <>
      {duties.map((d) => (
        <Badge key={d.id} tone={d.duty === "principal" || d.duty === "vice_principal" ? "info" : "neutral"}>
          {`${DUTY_LABEL[d.duty]}${d.isActing ? "(직무대리)" : ""}`}
        </Badge>
      ))}
    </>
  );
}

type Pending = { kind: "grant"; member: DutyMember; duty: StaffDuty } | { kind: "end"; member: DutyMember; duty: MemberDutyView };

export function DutiesSection({ schoolId, members, onChanged }: { schoolId: string; members: DutyMember[]; onChanged: (msg: string) => void | Promise<void> }) {
  const { me } = useSession();
  const myEmail = me?.user.email ?? null; // 자기 자신에게는 지정 불가(서버에서도 거부)
  const [pending, setPending] = useState<Pending | null>(null);
  const [reason, setReason] = useState("업무분장 변경");
  const [needReauth, setNeedReauth] = useState(false);
  const [password, setPassword] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const holders = (duty: StaffDuty) => members.filter((m) => m.duties.some((d) => d.duty === duty));

  const run = async (p: Pending) => {
    setBusy(true);
    setError(null);
    try {
      if (p.kind === "grant") await api("POST", `/schools/${schoolId}/duties`, { membershipId: p.member.id, duty: p.duty });
      else await api("POST", `/schools/${schoolId}/duties/${p.duty.id}/end`, { reason: reason.trim() });
      setPending(null);
      await onChanged(`${p.member.user.displayName}: ${DUTY_LABEL[p.kind === "grant" ? p.duty : p.duty.duty]} ${p.kind === "grant" ? "지정" : "해제"}`);
    } catch (e) {
      if (e instanceof ApiError && e.code === "reauth_required") setNeedReauth(true);
      else setError(describeError(e).message);
    } finally {
      setBusy(false);
    }
  };

  const reauthThenRun = async () => {
    setBusy(true);
    setError(null);
    try {
      await api("POST", "/auth/reauth", { password });
      setPassword("");
      setNeedReauth(false);
      if (pending) await run(pending);
    } catch (e) {
      setError(describeError(e).message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <section aria-labelledby="duties-title" className="rounded-card border border-line bg-card p-4 shadow-card">
      <h2 id="duties-title" className="text-xl font-bold">
        업무 담당자
      </h2>
      <p className="mt-1 text-sm text-ink-muted">
        안전업무 담당(재난 발령·종료, 훈련일지 작성)과 앱 운영담당(교직원 승인·배정)은 여러 명 지정할 수 있고, 한 사람이 겸임할 수 있습니다. 계정은 그대로이고 권한만
        바뀌며, 지정·해제 기록은 남습니다. 교장·교감 직책은 기관 확인 후 플랫폼 운영자가 등록합니다.
      </p>
      <dl className="mt-3 grid gap-2 sm:grid-cols-2">
        {(["principal", "vice_principal", "safety_officer", "app_operator"] as StaffDuty[]).map((d) => (
          <div key={d} className="rounded-control border border-line px-3 py-2">
            <dt className="text-sm font-bold text-ink-muted">{DUTY_LABEL[d]}</dt>
            <dd className="text-base font-semibold">{holders(d).map((m) => m.user.displayName).join(", ") || "없음"}</dd>
          </div>
        ))}
      </dl>
      <ul className="mt-3 divide-y divide-line">
        {members.map((m) => (
          <li key={m.id} className="flex flex-wrap items-center gap-2 py-2">
            <span className="min-w-0 flex-1 text-base font-bold">
              {m.user.displayName} <DutyBadges duties={m.duties} />
            </span>
            {GRANTABLE.map((duty) => {
              const cur = m.duties.find((d) => d.duty === duty);
              return cur ? (
                <PrimaryButton key={duty} variant="ghost" className="text-danger" onClick={() => { setReason("업무분장 변경"); setPending({ kind: "end", member: m, duty: cur }); }}>
                  {DUTY_LABEL[duty]} 해제
                </PrimaryButton>
              ) : (
                m.user.email === myEmail ? (
                  <span key={duty} className="text-sm text-ink-muted">{DUTY_LABEL[duty]}: 본인은 다른 담당자가 지정</span>
                ) : (
                  <PrimaryButton key={duty} variant="secondary" onClick={() => setPending({ kind: "grant", member: m, duty })}>
                    {DUTY_LABEL[duty]} 지정
                  </PrimaryButton>
                )
              );
            })}
          </li>
        ))}
      </ul>

      <ConfirmDialog
        open={pending !== null && !needReauth}
        title={pending ? `${pending.member.user.displayName} — ${DUTY_LABEL[pending.kind === "grant" ? pending.duty : pending.duty.duty]} ${pending.kind === "grant" ? "지정" : "해제"}` : ""}
        confirmLabel={pending?.kind === "grant" ? "지정" : "해제"}
        tone={pending?.kind === "grant" ? "primary" : "danger"}
        loading={busy}
        onConfirm={() => pending && void run(pending)}
        onCancel={() => { setPending(null); setError(null); }}
      >
        {pending?.kind === "grant" ? (
          <p>
            {pending.duty === "safety_officer"
              ? "실제 재난·모의훈련 발령과 종료, 전체 대피 현황 열람, 훈련일지 작성·수정을 할 수 있게 됩니다."
              : "교직원 가입 승인·거절, 담당 학급 배정, 업무 담당자 지정을 할 수 있게 됩니다."}
          </p>
        ) : (
          <>
            <p>해제하면 다음 요청부터 해당 권한이 사라집니다. 작성한 문서와 기록은 그대로 남습니다.</p>
            <label className="mt-3 block font-bold" htmlFor="duty-end-reason">해제 사유</label>
            <input id="duty-end-reason" value={reason} maxLength={200} onChange={(e) => setReason(e.target.value)} className="mt-1 block min-h-touch w-full rounded-control border-2 border-line-strong px-3 text-lg" />
          </>
        )}
        {error && <p role="alert" className="mt-2 font-semibold text-danger">{error}</p>}
      </ConfirmDialog>

      <ConfirmDialog open={needReauth} title="비밀번호를 다시 확인합니다" confirmLabel="확인 후 계속" tone="primary" loading={busy} onConfirm={() => void reauthThenRun()} onCancel={() => { setNeedReauth(false); setPending(null); setError(null); }}>
        <p>권한을 바꾸는 작업이라 비밀번호를 다시 확인합니다.</p>
        <label className="mt-3 block font-bold" htmlFor="reauth-pw">비밀번호</label>
        <input id="reauth-pw" type="password" autoComplete="current-password" value={password} onChange={(e) => setPassword(e.target.value)} className="mt-1 block min-h-touch w-full rounded-control border-2 border-line-strong px-3 text-lg" />
        {error && <p role="alert" className="mt-2 font-semibold text-danger">{error}</p>}
      </ConfirmDialog>
    </section>
  );
}
