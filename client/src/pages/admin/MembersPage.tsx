// 관리자: 교직원 가입 승인·거절(일괄)과 역할·담당 학급 배정
// 업무경감: 여러 명을 체크해 한 번에 승인. 승인은 확인 창 없이 바로(되돌리려면 권한 회수), 거절만 확인 창.
import { useCallback, useEffect, useMemo, useState } from "react";
import { api, ApiError, describeError } from "../../lib/api";
import { can } from "../../lib/permissions";
import { useSession } from "../../lib/session";
import { FormField } from "../../components/ui/FormField";
import { formatDateTime } from "../../lib/format";
import { AppShell } from "../../components/layout/AppShell";
import { ConfirmDialog } from "../../components/ui/ConfirmDialog";
import { Icon } from "../../components/ui/Icon";
import { PrimaryButton } from "../../components/ui/PrimaryButton";
import { EmptyState, ErrorState, LoadingState, SaveStatus, type SaveState } from "../../components/ui/States";
import { Badge } from "../../components/ui/StatusBadge";
import { DutiesSection, DutyBadges, type MemberDutyView } from "./DutiesSection";
import { POSITION_LABEL, REQUESTED_DUTY_LABEL, type RequestedDuty, type RequestedPosition } from "@shared/joinRequest";

type Role = "admin" | "homeroom" | "staff";
type Duty = "homeroom" | "assist" | "inspection";
interface Member {
  id: string;
  role: Role;
  status: "pending" | "approved" | "rejected" | "revoked";
  requestedAt: string;
  /** 가입 신청 정보(권한 아님) — 승인 판단 참고용. 실제 배정은 아래 '역할·학급'에서 확정 */
  request?: { duties: string[]; className: string | null; note: string | null; position?: string | null };
  user: { displayName: string; email: string };
  assignments: { duty: Duty; class: { id: string; label: string; schoolYear: number } }[];
  duties?: MemberDutyView[]; // STEP 3-D 직책·업무
}
interface SchoolClass {
  id: string;
  grade: number;
  classNo: number;
  label: string;
}

const ROLE_LABEL: Record<Role, string> = { admin: "관리자", homeroom: "담임교사", staff: "교직원" };

export function MembersPage({ schoolId }: { schoolId: string }) {
  const [members, setMembers] = useState<Member[] | null>(null);
  const [classes, setClasses] = useState<SchoolClass[]>([]);
  const [loadError, setLoadError] = useState<ReturnType<typeof describeError> | null>(null);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [saveState, setSaveState] = useState<SaveState>({ kind: "idle" });
  const [confirmReject, setConfirmReject] = useState(false);
  const [editing, setEditing] = useState<string | null>(null);
  const [renaming, setRenaming] = useState<string | null>(null);
  const { usableMemberships } = useSession();
  const canRename = can(usableMemberships.find((x) => x.school.id === schoolId) ?? null, "members.rename"); // 서버도 매번 검사

  const load = useCallback(async () => {
    try {
      const [m, c] = await Promise.all([
        api<{ members: Member[] }>("GET", `/schools/${schoolId}/members`),
        api<{ classes: SchoolClass[] }>("GET", `/schools/${schoolId}/classes`),
      ]);
      setMembers(m.members);
      setClasses(c.classes);
      setLoadError(null);
    } catch (e) {
      setLoadError(describeError(e));
    }
  }, [schoolId]);

  useEffect(() => {
    void load();
  }, [load]);

  const pending = useMemo(() => (members ?? []).filter((m) => m.status === "pending"), [members]);
  const approved = useMemo(() => (members ?? []).filter((m) => m.status === "approved"), [members]);
  const allSelected = pending.length > 0 && pending.every((m) => selected.has(m.id));

  const toggle = (id: string) =>
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });

  const decide = async (decision: "approve" | "reject") => {
    const ids = [...selected];
    setSaveState({ kind: "saving" });
    try {
      const r = await api<{ processed: number; skipped: number }>("POST", `/schools/${schoolId}/members/${decision}`, { membershipIds: ids });
      setSaveState({
        kind: "saved",
        at: `${r.processed}명 ${decision === "approve" ? "승인" : "거절"}${r.skipped ? ` · ${r.skipped}명은 이미 처리됨` : ""}`,
      });
      setSelected(new Set());
      setConfirmReject(false);
      await load();
    } catch (e) {
      setSaveState({ kind: "failed", message: describeError(e).message });
      setConfirmReject(false);
    }
  };

  return (
    <AppShell title="교직원 관리" schoolId={schoolId}>
      {!members && !loadError && <LoadingState />}
      {loadError && <ErrorState title={loadError.title} message={loadError.message} onRetry={loadError.retryable ? () => void load() : undefined} />}
      {members && (
        <div className="space-y-6">
          <SaveStatus state={saveState} />

          {/* 승인 대기 */}
          <section aria-labelledby="pending" className="rounded-card border border-line bg-card p-4 shadow-card">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <h2 id="pending" className="text-xl font-bold">
                가입 승인 대기 <span className="tabular text-accent">{pending.length}</span>명
              </h2>
              {pending.length > 0 && (
                <label className="flex min-h-touch cursor-pointer items-center gap-2 text-base font-bold">
                  <input type="checkbox" className="size-6 accent-[var(--color-brand)]" checked={allSelected} onChange={() => setSelected(allSelected ? new Set() : new Set(pending.map((m) => m.id)))} />
                  전체 선택
                </label>
              )}
            </div>
            {pending.length === 0 ? (
              <p className="mt-2 text-base text-ink-muted">승인을 기다리는 교직원이 없습니다.</p>
            ) : (
              <>
                <p className="mt-1 text-sm text-ink-muted">우리 학교 교직원이 맞는지 확인한 뒤 승인하세요. 승인하면 학교 업무 화면을 쓸 수 있습니다.</p>
                <ul className="mt-3 divide-y divide-line">
                  {pending.map((m) => (
                    <li key={m.id}>
                      <label className="flex min-h-touch cursor-pointer items-center gap-3 py-2">
                        <input type="checkbox" className="size-6 shrink-0 accent-[var(--color-brand)]" checked={selected.has(m.id)} onChange={() => toggle(m.id)} />
                        <span className="min-w-0 flex-1">
                          <span className="block text-base font-bold">
                            {m.user.displayName} <span className="font-semibold text-ink-muted">· {ROLE_LABEL[m.role]} 신청</span>
                          </span>
                          <span className="block truncate text-sm text-ink-muted">
                            {m.user.email} · {formatDateTime(m.requestedAt)}
                          </span>
                          {m.request && (m.request.duties.length > 0 || m.request.className || m.request.note || m.request.position) && (
                            <span className="mt-1 block text-sm">
                              {m.request.position && <span className="font-semibold">{POSITION_LABEL[m.request.position as RequestedPosition] ?? m.request.position} · </span>}
                              <span className="font-semibold">신청 업무</span>{" "}
                              {m.request.duties.map((d) => REQUESTED_DUTY_LABEL[d as RequestedDuty] ?? d).join(", ") || "없음"}
                              {m.request.className && ` · ${m.request.className}`}
                              {m.request.note && <span className="block break-words text-ink-muted">메모: {m.request.note}</span>}
                            </span>
                          )}
                        </span>
                      </label>
                    </li>
                  ))}
                </ul>
                <div className="mt-3 grid gap-2 sm:grid-cols-2">
                  <PrimaryButton icon="check" disabled={selected.size === 0} loading={saveState.kind === "saving"} onClick={() => void decide("approve")}>
                    선택한 {selected.size}명 승인
                  </PrimaryButton>
                  <PrimaryButton variant="secondary" disabled={selected.size === 0 || saveState.kind === "saving"} onClick={() => setConfirmReject(true)}>
                    선택한 {selected.size}명 거절
                  </PrimaryButton>
                </div>
              </>
            )}
          </section>

          {/* 승인된 교직원과 배정 */}
          <section aria-labelledby="staff">
            <h2 id="staff" className="text-xl font-bold">
              교직원 <span className="tabular text-accent">{approved.length}</span>명
            </h2>
            {classes.length === 0 && (
              <p className="mt-2 rounded-control border-2 border-warning bg-warning-soft p-3 text-base font-semibold text-warning-strong">
                학급이 아직 없습니다. '학급' 메뉴에서 학급을 먼저 만들면 담당 학급을 배정할 수 있습니다.
              </p>
            )}
            <div className="mt-3 space-y-3">
              {approved.length === 0 && <EmptyState icon="users" title="승인된 교직원이 없습니다" />}
              {approved.map((m) =>
                renaming === m.id ? (
                  <NameEditor
                    key={m.id}
                    schoolId={schoolId}
                    member={m}
                    onDone={async (message) => {
                      setRenaming(null);
                      if (message) setSaveState({ kind: "saved", at: message });
                      await load();
                    }}
                  />
                ) : editing === m.id ? (
                  <AssignmentEditor
                    key={m.id}
                    schoolId={schoolId}
                    member={m}
                    classes={classes}
                    onDone={async (message) => {
                      setEditing(null);
                      if (message) setSaveState({ kind: "saved", at: message });
                      await load();
                    }}
                  />
                ) : (
                  <article key={m.id} className="flex flex-wrap items-center gap-3 rounded-card border border-line bg-card p-4 shadow-card">
                    <div className="min-w-0 flex-1">
                      <p className="flex flex-wrap items-center gap-2 text-lg font-bold">
                        {m.user.displayName}
                        <Badge tone={m.role === "admin" ? "info" : "neutral"}>{ROLE_LABEL[m.role]}</Badge>
                        <DutyBadges duties={m.duties ?? []} />
                      </p>
                      <p className="mt-0.5 text-base text-ink-muted">
                        {m.assignments.length > 0 ? m.assignments.map((a) => `${a.class.label}${a.duty === "assist" ? "(보조)" : ""}`).join(", ") : "담당 학급 없음"}
                      </p>
                    </div>
                    {canRename && (
                      <PrimaryButton variant="ghost" onClick={() => { setEditing(null); setRenaming(m.id); }}>
                        성명 정정
                      </PrimaryButton>
                    )}
                    {m.role !== "admin" && (
                      <PrimaryButton variant="secondary" onClick={() => { setRenaming(null); setEditing(m.id); }} disabled={classes.length === 0}>
                        담당 배정
                      </PrimaryButton>
                    )}
                  </article>
                ),
              )}
            </div>
          </section>

          {/* STEP 3-D 업무 담당자(안전업무 담당·앱 운영담당 지정, 교장·교감 표시) */}
          <DutiesSection
            schoolId={schoolId}
            members={approved.map((m) => ({ id: m.id, role: m.role, user: m.user, duties: m.duties ?? [] }))}
            onChanged={async (message) => {
              setSaveState({ kind: "saved", at: message });
              await load();
            }}
          />
        </div>
      )}

      <ConfirmDialog
        open={confirmReject}
        title={`${selected.size}명의 가입 신청을 거절할까요?`}
        confirmLabel="거절"
        loading={saveState.kind === "saving"}
        onConfirm={() => void decide("reject")}
        onCancel={() => setConfirmReject(false)}
      >
        <p>거절된 교직원은 학교 업무 화면을 쓸 수 없습니다. 잘못 거절했다면 본인이 다시 가입 신청할 수 있습니다.</p>
      </ConfirmDialog>
    </AppShell>
  );
}

function AssignmentEditor({
  schoolId,
  member,
  classes,
  onDone,
}: {
  schoolId: string;
  member: Member;
  classes: SchoolClass[];
  onDone: (message: string | null) => void | Promise<void>;
}) {
  const [role, setRole] = useState<"homeroom" | "staff">(member.role === "staff" ? "staff" : "homeroom");
  const [picked, setPicked] = useState<Set<string>>(() => new Set(member.assignments.map((a) => a.class.id)));
  const [state, setState] = useState<SaveState>({ kind: "idle" });
  const grades = [...new Set(classes.map((c) => c.grade))].sort((a, b) => a - b);

  const save = async () => {
    setState({ kind: "saving" });
    // 담임은 '담임' 업무, 교직원은 '보조(대리 보고)' 업무로 배정(입력 단계를 줄이기 위해 역할로 결정)
    const duty: Duty = role === "homeroom" ? "homeroom" : "assist";
    try {
      await api("PUT", `/schools/${schoolId}/members/${member.id}/assignments`, {
        role,
        assignments: [...picked].map((classId) => ({ classId, duty })),
      });
      await onDone(`${member.user.displayName} 배정 저장`);
    } catch (e) {
      setState({ kind: "failed", message: describeError(e).message });
    }
  };

  return (
    <article className="rounded-card border-2 border-brand bg-card p-4 shadow-card">
      <p className="text-lg font-bold">{member.user.displayName} · 담당 배정</p>
      <div role="group" aria-label="역할" className="mt-3 grid grid-cols-2 gap-2">
        {(["homeroom", "staff"] as const).map((r) => (
          <button
            key={r}
            type="button"
            aria-pressed={role === r}
            onClick={() => setRole(r)}
            className={`min-h-touch rounded-control border-2 text-base font-bold ${role === r ? "border-brand bg-brand text-white" : "border-line-strong bg-card"}`}
          >
            {ROLE_LABEL[r]}
          </button>
        ))}
      </div>
      <p className="mt-3 text-base font-bold">{role === "homeroom" ? "담임 학급" : "대리 보고할 학급(보조)"}</p>
      {grades.map((g) => (
        <div key={g} className="mt-2">
          <p className="text-sm font-semibold text-ink-muted">{g}학년</p>
          <div className="mt-1 flex flex-wrap gap-2">
            {classes
              .filter((c) => c.grade === g)
              .map((c) => {
                const on = picked.has(c.id);
                return (
                  <button
                    key={c.id}
                    type="button"
                    aria-pressed={on}
                    onClick={() =>
                      setPicked((prev) => {
                        const next = new Set(prev);
                        if (next.has(c.id)) next.delete(c.id);
                        else next.add(c.id);
                        return next;
                      })
                    }
                    className={`flex min-h-touch items-center gap-1 rounded-full border-2 px-4 text-base font-bold ${on ? "border-accent bg-accent text-white" : "border-line-strong bg-card"}`}
                  >
                    {on && <Icon name="check" size={18} />}
                    {c.classNo}반
                  </button>
                );
              })}
          </div>
        </div>
      ))}
      <div className="mt-4 grid gap-2 sm:grid-cols-2">
        <PrimaryButton onClick={() => void save()} loading={state.kind === "saving"} loadingText="저장 중…">
          배정 저장
        </PrimaryButton>
        <PrimaryButton variant="ghost" onClick={() => void onDone(null)} disabled={state.kind === "saving"}>
          취소
        </PrimaryButton>
      </div>
      {state.kind === "failed" && (
        <div className="mt-3">
          <SaveStatus state={state} />
        </div>
      )}
    </article>
  );
}

/** Beta PILOT 2: 표시 성명 정정(학교 관리자). 현재 성명 확인 → 새 성명·사유 → 확인(필요하면 비밀번호 재확인). 성명 외에는 바뀌지 않음 */
function NameEditor({ schoolId, member, onDone }: { schoolId: string; member: Member; onDone: (message: string | null) => void | Promise<void> }) {
  const [name, setName] = useState(member.user.displayName);
  const [reason, setReason] = useState("");
  const [confirming, setConfirming] = useState(false);
  const [needReauth, setNeedReauth] = useState(false);
  const [password, setPassword] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const next = name.normalize("NFC").trim().replace(/\s+/g, " ");
  const ready = next.length >= 2 && next !== member.user.displayName && reason.trim().length >= 2;

  const run = async () => {
    setBusy(true);
    setError(null);
    try {
      await api("PUT", `/schools/${schoolId}/members/${member.id}/display-name`, { displayName: next, expectedCurrentName: member.user.displayName, reason: reason.trim() });
      setConfirming(false);
      await onDone(`성명 정정: ${member.user.displayName} → ${next}`);
    } catch (e) {
      if (e instanceof ApiError && e.code === "reauth_required") setNeedReauth(true);
      else {
        setConfirming(false);
        setError(describeError(e).message);
      }
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
      await run();
    } catch (e) {
      setError(describeError(e).message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <article className="rounded-card border-2 border-brand bg-card p-4 shadow-card">
      <p className="text-lg font-bold">성명 정정</p>
      <p className="mt-1 text-base">
        현재 등록 성명: <strong>{member.user.displayName}</strong> <span className="text-ink-muted">({member.user.email})</span>
      </p>
      <p className="mt-1 text-sm text-ink-muted">성명만 바뀝니다. 이메일·비밀번호·역할·담당 학급·대리 보고 지정은 그대로이고, 과거 보고 기록은 계정 기준으로 유지됩니다. 바꾸기 전 성명과 사유는 기록에 남아 잘못 바꿔도 다시 정정할 수 있습니다.</p>
      <FormField className="mt-3" label="새 성명" autoComplete="off" maxLength={30} value={name} onChange={(e) => setName(e.target.value)} />
      <FormField className="mt-3" label="정정 사유" hint="예: 가입 시 별명 입력, 오타" maxLength={200} value={reason} onChange={(e) => setReason(e.target.value)} />
      {error && <p className="mt-3 font-semibold text-danger" role="alert">{error}</p>}
      <div className="mt-4 grid gap-2 sm:grid-cols-2">
        <PrimaryButton disabled={!ready} onClick={() => setConfirming(true)}>
          정정하기
        </PrimaryButton>
        <PrimaryButton variant="ghost" onClick={() => void onDone(null)} disabled={busy}>
          취소
        </PrimaryButton>
      </div>

      <ConfirmDialog open={confirming && !needReauth} title="성명을 정정할까요?" confirmLabel="정정" tone="primary" loading={busy} onConfirm={() => void run()} onCancel={() => setConfirming(false)}>
        <p>
          <strong>{member.user.displayName}</strong> → <strong>{next}</strong>
        </p>
        <p className="mt-1 text-sm">사유: {reason.trim()}</p>
      </ConfirmDialog>
      <ConfirmDialog
        open={needReauth}
        title="비밀번호를 다시 확인합니다"
        confirmLabel="확인 후 계속"
        tone="primary"
        loading={busy}
        onConfirm={() => void reauthThenRun()}
        onCancel={() => {
          setNeedReauth(false);
          setConfirming(false);
        }}
      >
        <label className="mt-3 block font-bold" htmlFor="rename-reauth-pw">
          비밀번호
        </label>
        <input id="rename-reauth-pw" type="password" autoComplete="current-password" value={password} onChange={(e) => setPassword(e.target.value)} className="mt-1 block min-h-touch w-full rounded-control border-2 border-line-strong px-3 text-lg" />
        {error && <p className="mt-2 font-semibold text-danger">{error}</p>}
      </ConfirmDialog>
    </article>
  );
}
