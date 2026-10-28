// STEP D 플랫폼 운영관리자 콘솔: 신규 학교 등록 승인(최초 학교 관리자 자격 확인)·처리 이력·감사 이력
// - 화면은 편의일 뿐, 권한·자기 승인 금지·중복 처리 방지는 서버가 요청마다 검사합니다.
// - 승인·반려는 최근 비밀번호 재확인(10분)이 필요합니다. 만료되면 비밀번호를 다시 묻고 같은 요청을 이어서 보냅니다.
// - 학교 관리자 화면(교직원 승인·학급 배정)과는 별개입니다. 이 화면에서는 학교 내부 데이터를 보지 않습니다.
import { useCallback, useEffect, useState, type ReactNode } from "react";
import { api, ApiError, describeError } from "../../lib/api";
import { formatDateTime } from "../../lib/format";
import { Link, navigate } from "../../lib/router";
import { AppShell } from "../../components/layout/AppShell";
import { ConfirmDialog } from "../../components/ui/ConfirmDialog";
import { FormField } from "../../components/ui/FormField";
import { PrimaryButton } from "../../components/ui/PrimaryButton";
import { EmptyState, ErrorState, LoadingState } from "../../components/ui/States";
import { Badge } from "../../components/ui/StatusBadge";

type RegStatus = "pending_verification" | "approved" | "rejected" | "withdrawn";
interface Registration {
  id: string;
  status: RegStatus;
  createdAt: string;
  applicantPosition: string | null;
  reviewedBy: string | null;
  reviewedAt: string | null;
  verificationMethod: string | null;
  verificationNote: string | null;
  school: { id: string; name: string; status: string; kindCode: string | null; address: string | null; eduOfficeName: string | null; infoSource: string; infoSyncedAt: string | null; externalCode: string | null };
  applicant: { id: string; displayName: string; email: string; emailVerified: boolean };
}
interface AuditEntry {
  id?: string;
  action: string;
  at: string;
  actorName: string | null;
  schoolName?: string | null;
  after: Record<string, unknown> | null;
}

const KIND_LABEL: Record<string, string> = { "02": "초등학교", "03": "중학교", "04": "고등학교", "05": "특수학교" };
const STATUS_BADGE: Record<RegStatus, { tone: "warning" | "success" | "danger" | "neutral"; label: string }> = {
  pending_verification: { tone: "warning", label: "확인 대기" },
  approved: { tone: "success", label: "승인" },
  rejected: { tone: "danger", label: "반려" },
  withdrawn: { tone: "neutral", label: "철회" },
};
export const PLATFORM_ACTION_LABEL: Record<string, string> = {
  "school.registration_applied": "학교 등록 신청",
  "school.registration_approved": "학교 등록 승인",
  "school.registration_rejected": "학교 등록 반려",
  "platform.operator_granted": "운영관리자 권한 부여",
  "platform.operator_revoked": "운영관리자 권한 회수",
  "user.email_code_issued_manually": "인증코드 수동 발급",
};

/** 운영관리자 여부를 확인하고, 아니면 권한 부족 안내만 보여 줍니다. */
function PlatformShell({ title, children }: { title: string; children: ReactNode }) {
  const [state, setState] = useState<"loading" | "ok" | "denied" | { error: string }>("loading");
  useEffect(() => {
    api<{ operator: boolean }>("GET", "/platform/me")
      .then((r) => setState(r.operator ? "ok" : "denied"))
      .catch((e) => setState({ error: describeError(e).message }));
  }, []);
  return (
    <AppShell title={title}>
      <nav aria-label="운영관리 메뉴" className="mb-4 flex flex-wrap gap-2">
        <Link href="/platform/approvals" className="inline-flex min-h-touch items-center rounded-control border-2 border-brand px-3 font-bold text-brand hover:bg-brand-soft">
          학교 등록 승인
        </Link>
        <Link href="/platform/audit" className="inline-flex min-h-touch items-center rounded-control border-2 border-brand px-3 font-bold text-brand hover:bg-brand-soft">
          감사 이력
        </Link>
      </nav>
      {state === "loading" && <LoadingState />}
      {state === "denied" && (
        <EmptyState
          icon="shield"
          title="플랫폼 운영관리자만 사용할 수 있습니다"
          message="학교 관리자 기능(교직원 승인·학급 배정)은 '학교 선택'에서 내 학교로 들어가 사용하세요. 운영관리자 권한은 화면에서 신청할 수 없습니다."
          action={<Link href="/schools" className="font-bold text-accent underline">학교 선택으로</Link>}
        />
      )}
      {typeof state === "object" && <ErrorState message={state.error} />}
      {state === "ok" && children}
    </AppShell>
  );
}

function RegistrationCard({ r }: { r: Registration }) {
  const badge = STATUS_BADGE[r.status];
  return (
    <li>
      <Link href={`/platform/approvals/${r.id}`} className="block rounded-card border border-line bg-card p-4 shadow-card hover:border-brand">
        <div className="flex flex-wrap items-start justify-between gap-2">
          <div className="min-w-0">
            <p className="text-lg font-bold">{r.school.name}</p>
            <p className="text-sm text-ink-muted">{[KIND_LABEL[r.school.kindCode ?? ""] ?? null, r.school.eduOfficeName, r.school.address].filter(Boolean).join(" · ")}</p>
          </div>
          <Badge tone={badge.tone}>{badge.label}</Badge>
        </div>
        <p className="mt-2 text-base">
          신청자 <strong>{r.applicant.displayName}</strong>
          {r.applicantPosition && ` · ${r.applicantPosition}`} <span className="text-ink-muted">({r.applicant.email})</span>
        </p>
        <p className="text-sm text-ink-muted">
          신청 {formatDateTime(r.createdAt)}
          {r.reviewedAt && ` · 처리 ${formatDateTime(r.reviewedAt)} (${r.reviewedBy ?? "-"})`}
        </p>
      </Link>
    </li>
  );
}

export function PlatformApprovalsPage() {
  const [tab, setTab] = useState<"pending" | "processed">("pending");
  const [data, setData] = useState<{ registrations: Registration[]; pendingCount: number } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const load = useCallback(async () => {
    setData(null);
    try {
      setData(await api("GET", `/platform/approvals?status=${tab}`));
      setError(null);
    } catch (e) {
      setError(describeError(e).message);
    }
  }, [tab]);
  useEffect(() => {
    void load();
  }, [load]);
  return (
    <PlatformShell title="학교 등록 승인">
      <div role="tablist" aria-label="신청 구분" className="grid grid-cols-2 gap-2 sm:max-w-md">
        {(["pending", "processed"] as const).map((t) => (
          <button
            key={t}
            role="tab"
            aria-selected={tab === t}
            type="button"
            onClick={() => setTab(t)}
            className={`min-h-touch rounded-control border-2 font-bold ${tab === t ? "border-brand bg-brand text-white" : "border-line-strong bg-card"}`}
          >
            {t === "pending" ? `확인 대기${data ? ` ${data.pendingCount}` : ""}` : "처리 완료"}
          </button>
        ))}
      </div>
      <p className="mt-3 text-sm text-ink-muted">
        학교를 검색해 찾았다는 것만으로 신청자의 소속이 확인된 것은 아닙니다. 학교 대표전화·공문 등으로 관리자 자격을 확인한 뒤 승인하세요.
      </p>
      <div className="mt-3">
        {!data && !error && <LoadingState />}
        {error && <ErrorState message={error} onRetry={() => void load()} />}
        {data && data.registrations.length === 0 && <EmptyState icon="check-circle" title={tab === "pending" ? "확인을 기다리는 신청이 없습니다" : "처리한 신청이 없습니다"} />}
        {data && data.registrations.length > 0 && (
          <ul className="space-y-3">
            {data.registrations.map((r) => (
              <RegistrationCard key={r.id} r={r} />
            ))}
          </ul>
        )}
      </div>
    </PlatformShell>
  );
}

export function PlatformApprovalDetailPage({ id }: { id: string }) {
  const [data, setData] = useState<{ registration: Registration; history: { id: string; status: RegStatus; createdAt: string; applicantName: string }[]; audit: AuditEntry[] } | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [method, setMethod] = useState("");
  const [note, setNote] = useState("");
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<{ tone: "ok" | "err"; text: string } | null>(null);
  const [pending, setPending] = useState<"approve" | "reject" | null>(null);
  const [needReauth, setNeedReauth] = useState(false);
  const [password, setPassword] = useState("");

  const load = useCallback(async () => {
    try {
      setData(await api("GET", `/platform/approvals/${id}`));
      setLoadError(null);
    } catch (e) {
      setLoadError(describeError(e).message);
    }
  }, [id]);
  useEffect(() => {
    void load();
  }, [load]);

  const submit = async (decision: "approve" | "reject") => {
    setBusy(true);
    setMessage(null);
    try {
      await api("POST", `/platform/approvals/${id}/${decision}`, decision === "approve" ? { verificationMethod: method, note: note || undefined } : { note });
      setMessage({ tone: "ok", text: decision === "approve" ? "승인했습니다. 신청자는 이제 학교 관리자로 학교 공간을 사용할 수 있습니다." : "반려했습니다. 같은 학교에 다른 교직원이 다시 신청할 수 있습니다." });
      setPending(null);
      await load();
    } catch (e) {
      if (e instanceof ApiError && e.code === "reauth_required") {
        setPending(decision);
        setNeedReauth(true);
      } else {
        setMessage({ tone: "err", text: describeError(e).message });
        setPending(null);
        if (e instanceof ApiError && e.status === 409) await load(); // 다른 운영자가 먼저 처리함 → 최신 상태로
      }
    } finally {
      setBusy(false);
    }
  };

  const reauthThenRun = async () => {
    setBusy(true);
    try {
      await api("POST", "/auth/reauth", { password });
      setNeedReauth(false);
      setPassword("");
      if (pending) await submit(pending);
    } catch (e) {
      setMessage({ tone: "err", text: describeError(e).message });
    } finally {
      setBusy(false);
    }
  };

  const r = data?.registration;
  return (
    <PlatformShell title="학교 등록 신청 상세">
      <p className="mb-3">
        <Link href="/platform/approvals" className="font-bold text-accent underline">← 신청 목록</Link>
      </p>
      {!data && !loadError && <LoadingState />}
      {loadError && <ErrorState message={loadError} onRetry={() => void load()} />}
      {r && (
        <div className="grid gap-4 lg:grid-cols-2">
          <section className="rounded-card border border-line bg-card p-4 shadow-card" aria-labelledby="school-info">
            <div className="flex items-start justify-between gap-2">
              <h2 id="school-info" className="text-xl font-bold">{r.school.name}</h2>
              <Badge tone={STATUS_BADGE[r.status].tone}>{STATUS_BADGE[r.status].label}</Badge>
            </div>
            <dl className="mt-3 grid grid-cols-[7rem_1fr] gap-x-2 gap-y-1 text-base">
              <dt className="font-semibold text-ink-muted">학교급</dt><dd>{KIND_LABEL[r.school.kindCode ?? ""] ?? "-"}</dd>
              <dt className="font-semibold text-ink-muted">관할 교육청</dt><dd>{r.school.eduOfficeName ?? "-"}</dd>
              <dt className="font-semibold text-ink-muted">주소</dt><dd className="break-words">{r.school.address ?? "-"}</dd>
              <dt className="font-semibold text-ink-muted">학교코드</dt><dd>{r.school.externalCode ?? "-"}</dd>
              <dt className="font-semibold text-ink-muted">정보 출처</dt><dd>{r.school.infoSource === "schoolinfo" ? "학교알리미" : r.school.infoSource}{r.school.infoSyncedAt && ` (${formatDateTime(r.school.infoSyncedAt)})`}</dd>
            </dl>
            <h3 className="mt-4 text-lg font-bold">신청자</h3>
            <dl className="mt-1 grid grid-cols-[7rem_1fr] gap-x-2 gap-y-1 text-base">
              <dt className="font-semibold text-ink-muted">이름</dt><dd>{r.applicant.displayName}</dd>
              <dt className="font-semibold text-ink-muted">이메일</dt><dd className="break-all">{r.applicant.email} {r.applicant.emailVerified ? <Badge tone="success">인증됨</Badge> : <Badge tone="warning">미인증</Badge>}</dd>
              <dt className="font-semibold text-ink-muted">직위</dt><dd>{r.applicantPosition ?? "-"}</dd>
              <dt className="font-semibold text-ink-muted">신청 일시</dt><dd>{formatDateTime(r.createdAt)}</dd>
            </dl>
            {r.status !== "pending_verification" && (
              <p className="mt-3 rounded-control bg-page p-3 text-base">
                처리: {r.reviewedBy ?? "-"} · {r.reviewedAt ? formatDateTime(r.reviewedAt) : "-"}
                {r.verificationMethod && <span className="block">확인 방법: {r.verificationMethod}</span>}
                {r.verificationNote && <span className="block">메모: {r.verificationNote}</span>}
              </p>
            )}
          </section>

          <section className="space-y-4">
            {r.status === "pending_verification" && (
              <div className="rounded-card border border-line bg-card p-4 shadow-card">
                <h2 className="text-xl font-bold">자격 확인과 처리</h2>
                <p className="mt-1 text-sm text-ink-muted">
                  이메일 인증은 '이 주소를 가진 사람'만 확인합니다. 그 사람이 이 학교의 관리자(교장·교감 등)인지는 학교 대표전화·공문 등으로 따로 확인하세요. 본인이 신청한 건은 처리할 수 없습니다.
                </p>
                <FormField className="mt-3" label="자격 확인 방법(승인 시 필수)" value={method} onChange={(e) => setMethod(e.target.value)} placeholder="예: 학교 대표전화로 교감 재직 확인" maxLength={100} />
                <FormField className="mt-3" label="메모(반려 시 필수)" value={note} onChange={(e) => setNote(e.target.value)} placeholder="예: 학교 확인 결과 재직하지 않음" maxLength={500} />
                {message && (
                  <p role={message.tone === "err" ? "alert" : "status"} className={`mt-3 rounded-control border-2 p-3 font-semibold ${message.tone === "err" ? "border-danger bg-danger-soft text-danger" : "border-success bg-success-soft text-success"}`}>
                    {message.text}
                  </p>
                )}
                <div className="mt-4 grid gap-2 sm:grid-cols-2">
                  <PrimaryButton icon="check" disabled={method.trim().length < 2} loading={busy && pending !== "reject"} onClick={() => void submit("approve")}>
                    승인
                  </PrimaryButton>
                  <PrimaryButton variant="dangerOutline" icon="x" disabled={note.trim().length < 2 || busy} onClick={() => void submit("reject")}>
                    반려
                  </PrimaryButton>
                </div>
              </div>
            )}
            {r.status !== "pending_verification" && message && (
              <p role="status" className="rounded-control border-2 border-success bg-success-soft p-3 font-semibold text-success">{message.text}</p>
            )}
            <div className="rounded-card border border-line bg-card p-4 shadow-card">
              <h2 className="text-lg font-bold">이 신청의 처리 기록</h2>
              <ul className="mt-2 space-y-1 text-base">
                {data.audit.map((a, i) => (
                  <li key={i}>
                    {formatDateTime(a.at)} · {PLATFORM_ACTION_LABEL[a.action] ?? a.action}
                    {a.actorName && ` · ${a.actorName}`}
                    {typeof a.after?.via === "string" && ` (${a.after.via === "web" ? "웹 콘솔" : "서버 명령"})`}
                  </li>
                ))}
              </ul>
              {data.history.length > 0 && (
                <>
                  <h3 className="mt-3 font-bold">같은 학교의 이전 신청</h3>
                  <ul className="mt-1 space-y-1 text-sm text-ink-muted">
                    {data.history.map((h) => (
                      <li key={h.id}>{formatDateTime(h.createdAt)} · {h.applicantName} · {STATUS_BADGE[h.status].label}</li>
                    ))}
                  </ul>
                </>
              )}
            </div>
          </section>
        </div>
      )}
      <ConfirmDialog
        open={needReauth}
        title="비밀번호를 다시 확인합니다"
        confirmLabel="확인 후 계속"
        tone="primary"
        loading={busy}
        onConfirm={() => void reauthThenRun()}
        onCancel={() => {
          setNeedReauth(false);
          setPending(null);
          setPassword("");
        }}
      >
        <p>학교 등록 승인·반려는 중요한 작업이라 비밀번호를 다시 확인합니다(10분 유지).</p>
        <label className="mt-3 block font-bold" htmlFor="platform-reauth-pw">비밀번호</label>
        <input id="platform-reauth-pw" type="password" autoComplete="current-password" value={password} onChange={(e) => setPassword(e.target.value)} className="mt-1 block min-h-touch w-full rounded-control border-2 border-line-strong px-3 text-lg" />
      </ConfirmDialog>
    </PlatformShell>
  );
}

export function PlatformAuditPage() {
  const [entries, setEntries] = useState<AuditEntry[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    api<{ entries: AuditEntry[] }>("GET", "/platform/audit")
      .then((r) => setEntries(r.entries))
      .catch((e) => setError(describeError(e).message));
  }, []);
  return (
    <PlatformShell title="운영 감사 이력">
      <p className="text-sm text-ink-muted">학교 등록 신청·승인·반려, 운영관리자 권한 부여·회수, 인증코드 수동 발급 기록입니다(최근 50건). 학교 내부 업무 기록은 포함하지 않습니다.</p>
      <div className="mt-3">
        {!entries && !error && <LoadingState />}
        {error && <ErrorState message={error} />}
        {entries && entries.length === 0 && <EmptyState icon="file" title="기록이 없습니다" />}
        {entries && entries.length > 0 && (
          <ul className="divide-y divide-line rounded-card border border-line bg-card shadow-card">
            {entries.map((a, i) => (
              <li key={a.id ?? i} className="p-3 text-base">
                <span className="font-bold">{PLATFORM_ACTION_LABEL[a.action] ?? a.action}</span>
                {a.schoolName && ` · ${a.schoolName}`}
                <span className="block text-sm text-ink-muted">
                  {formatDateTime(a.at)} · {a.actorName ?? (typeof a.after?.by === "string" ? `${a.after.by}(서버 명령)` : typeof a.after?.reviewer === "string" ? `${a.after.reviewer}(서버 명령)` : "신청자 본인")}
                </span>
              </li>
            ))}
          </ul>
        )}
      </div>
    </PlatformShell>
  );
}

/** 학교 선택 화면에서 운영관리자에게만 콘솔 바로가기를 보여 줍니다. */
export function PlatformConsoleLink() {
  const [show, setShow] = useState(false);
  useEffect(() => {
    api<{ operator: boolean }>("GET", "/platform/me")
      .then((r) => setShow(r.operator))
      .catch(() => setShow(false));
  }, []);
  if (!show) return null;
  return (
    <PrimaryButton variant="secondary" icon="shield" fullWidth onClick={() => navigate("/platform/approvals")}>
      플랫폼 운영관리 — 학교 등록 승인
    </PrimaryButton>
  );
}
