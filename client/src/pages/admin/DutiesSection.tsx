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

/**
 * STEP 3-E: 교직원 한 명의 업무 행(모바일 겹침 수정).
 * ① 이름 ② 현재 업무 배지 ③ 권한 변경 단추를 줄로 나눕니다. 모바일(~639px)은 단추를 한 줄에 하나(전체 폭·줄바꿈 허용),
 * 640px 이상은 2열, PC(lg)는 이름 오른쪽에 나란히. '지정'은 남색 테두리 + 더하기, '해제'는 빨간 테두리 + X로 구분.
 * 동작(비밀번호 재확인·권한 검사·감사 로그)은 부모(DutiesSection)와 서버가 그대로 처리합니다.
 */
export function DutyMemberRow({ member: m, isSelf, onEnd, onGrant }: { member: DutyMember; isSelf: boolean; onEnd: (d: MemberDutyView) => void; onGrant: (duty: StaffDuty) => void }) {
  return (
    <li className="py-3 lg:flex lg:items-center lg:gap-4" data-testid="duty-member">
      <div className="min-w-0 lg:flex-1">
        <p className="text-base font-bold break-keep [overflow-wrap:anywhere]">{m.user.displayName}</p>
        <div className="mt-1 flex flex-wrap items-center gap-1.5" aria-label={`${m.user.displayName} 현재 업무`}>
          {m.duties.length ? <DutyBadges duties={m.duties} /> : <span className="text-sm text-ink-muted">지정된 업무 없음</span>}
        </div>
      </div>
      <div className="mt-2 grid grid-cols-1 gap-2 sm:grid-cols-2 lg:mt-0 lg:flex lg:shrink-0 lg:flex-wrap lg:justify-end">
        {GRANTABLE.map((duty) => {
          const cur = m.duties.find((d) => d.duty === duty);
          return cur ? (
            <PrimaryButton
              key={duty}
              variant="dangerOutline"
              icon="x"
              className="w-full whitespace-normal text-center leading-snug break-keep lg:w-auto"
              onClick={() => onEnd(cur)}
            >
              {DUTY_LABEL[duty]} 해제
            </PrimaryButton>
          ) : isSelf ? (
            <span key={duty} className="flex min-h-touch items-center rounded-control border border-dashed border-line-strong px-3 text-sm text-ink-muted break-keep">
              {DUTY_LABEL[duty]}: 본인은 다른 담당자가 지정
            </span>
          ) : (
            <PrimaryButton
              key={duty}
              variant="secondary"
              icon="plus"
              className="w-full whitespace-normal text-center leading-snug break-keep lg:w-auto"
              onClick={() => onGrant(duty)}
            >
              {DUTY_LABEL[duty]} 지정
            </PrimaryButton>
          );
        })}
      </div>
    </li>
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
      {/* STEP 3-E 모바일 배치: ① 이름 ② 현재 업무 ③ 권한 변경 단추를 줄로 나눔. 모바일은 단추 한 줄에 하나(전체 폭), 중간 폭은 2열, PC(lg)는 이름 옆 오른쪽 정렬 */}
      <ul className="mt-3 divide-y divide-line" data-testid="duty-members">
        {members.map((m) => (
          <DutyMemberRow
            key={m.id}
            member={m}
            isSelf={m.user.email === myEmail}
            onEnd={(cur) => { setReason("업무분장 변경"); setPending({ kind: "end", member: m, duty: cur }); }}
            onGrant={(duty) => setPending({ kind: "grant", member: m, duty })}
          />
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
