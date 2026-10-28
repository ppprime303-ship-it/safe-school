// 학교 선택: 내 소속 학교로 시작하거나, 학교를 검색해 등록 신청(최초) 또는 가입 신청(이미 등록된 학교)
import { useState, type FormEvent } from "react";
import { api, ApiError } from "../lib/api";
import { formatDateTime } from "../lib/format";
import { homePath, roleSummary } from "../lib/permissions";
import { navigate } from "../lib/router";
import { useSession, type Membership } from "../lib/session";
import { AppShell } from "../components/layout/AppShell";
import { FormField } from "../components/ui/FormField";
import { Icon } from "../components/ui/Icon";
import { PrimaryButton } from "../components/ui/PrimaryButton";
import { Badge } from "../components/ui/StatusBadge";
import { EmptyState, ErrorState } from "../components/ui/States";
import { SCHOOLINFO_SIDO, sggOf } from "@shared/schoolinfoRegions";
import { JoinForm, type JoinBody } from "./JoinForm";
import { PlatformConsoleLink } from "./platform/PlatformPages";

const KINDS = [
  ["02", "초등"],
  ["03", "중"],
  ["04", "고등"],
  ["05", "특수"],
] as const;

// 학교알리미 시도·시군구 코드(공식 코드표 — shared/schoolinfoRegions.ts, 2026-07-01 전남광주통합특별시 반영)
const SIDOS: (readonly [string, string])[] = [["", "전체 시도"], ...SCHOOLINFO_SIDO];

// STEP B: 학교 목록의 출처·받은 시각(서버 services/schoolDirectory.ts searchDirectory)
interface SearchMeta {
  stale: boolean;
  syncedAt: string | null;
  source: "schoolinfo";
  sggRequired: boolean;
  refreshFailed: boolean;
}

interface SearchResult {
  externalCode: string;
  name: string;
  eduOfficeName: string | null;
  address: string | null;
  registeredSchool: { id: string; status: string } | null;
}

function membershipBadge(m: Membership) {
  if (m.status === "approved" && m.school.status === "active") return <Badge tone="success" icon="check-circle">사용 가능</Badge>;
  if (m.school.status === "pending_verification") return <Badge tone="warning" icon="clock">학교 등록 확인 대기</Badge>;
  if (m.status === "pending") return <Badge tone="warning" icon="clock">가입 승인 대기</Badge>;
  if (m.status === "rejected") return <Badge tone="danger" icon="x">가입 거절됨</Badge>;
  if (m.status === "revoked") return <Badge tone="neutral" icon="x">권한 회수됨</Badge>;
  return <Badge tone="neutral">{m.status}</Badge>;
}

export function SchoolSelectPage() {
  const { me, selectSchool, refresh } = useSession();
  const [kind, setKind] = useState<string>("02");
  const [sido, setSido] = useState("");
  const [sgg, setSgg] = useState("");
  const [q, setQ] = useState("");
  const [searching, setSearching] = useState(false);
  const [results, setResults] = useState<SearchResult[] | null>(null);
  const [listInfo, setListInfo] = useState<SearchMeta | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [actionFor, setActionFor] = useState<string | null>(null);
  const [position, setPosition] = useState("");
  const [busy, setBusy] = useState(false);
  const [done, setDone] = useState<string | null>(null);
  const [withdrawBusy, setWithdrawBusy] = useState(false);

  const memberships = me?.memberships ?? [];

  const start = (m: Membership) => {
    selectSchool(m.school.id);
    navigate(homePath(m));
  };

  const search = async (e: FormEvent) => {
    e.preventDefault();
    setSearching(true);
    setError(null);
    setDone(null);
    try {
      const params = new URLSearchParams({ q, kind, ...(sido ? { sido } : {}), ...(sido && sgg ? { sgg } : {}) });
      const res = await api<{ results: SearchResult[]; warning?: string } & SearchMeta>("GET", `/school-directory?${params}`);
      setResults(res.results);
      setListInfo({ stale: res.stale, syncedAt: res.syncedAt, source: res.source, sggRequired: res.sggRequired, refreshFailed: res.refreshFailed });
      setNotice(res.warning ?? null);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "검색하지 못했습니다.");
    } finally {
      setSearching(false);
    }
  };

  const act = async (fn: () => Promise<string>) => {
    setBusy(true);
    setError(null);
    try {
      setDone(await fn());
      setActionFor(null);
      await refresh();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "처리하지 못했습니다.");
    } finally {
      setBusy(false);
    }
  };

  const register = (r: SearchResult) =>
    act(async () => {
      await api("POST", "/school-registrations", { externalCode: r.externalCode, applicantPosition: position || undefined });
      return `${r.name} 등록 신청이 접수되었습니다. 관리자 자격 확인 후 학교 공간이 열립니다.`;
    });

  const withdraw = async (registrationId: string) => {
    if (!window.confirm("학교 등록 신청을 철회하시겠습니까? 승인 대기 중인 신청만 철회할 수 있습니다.")) return;
    setWithdrawBusy(true);
    setError(null);
    try {
      await api("POST", `/school-registrations/${registrationId}/withdraw`);
      setDone("학교 등록 신청을 철회했습니다.");
      await refresh();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "신청 철회에 실패했습니다.");
    } finally {
      setWithdrawBusy(false);
    }
  };
  const join = (r: SearchResult, body: JoinBody) =>
    act(async () => {
      await api("POST", `/schools/${r.registeredSchool!.id}/join-requests`, body);
      return `${r.name} 가입을 신청했습니다. 학교 관리자가 승인하면 사용할 수 있습니다.`;
    });

  return (
    <AppShell title="학교 선택">
      <div className="grid gap-6 lg:grid-cols-2">
        <section aria-labelledby="my-schools">
          <h2 id="my-schools" className="text-xl font-bold">
            내 학교
          </h2>
          <div className="mt-3 space-y-3">
            <PlatformConsoleLink />
            {memberships.length === 0 && (
              <EmptyState icon="school" title="아직 소속된 학교가 없습니다" message="오른쪽에서 학교를 찾아 가입을 신청하세요." />
            )}
            {memberships.map((m) => {
              const usable = m.status === "approved" && m.school.status === "active";
              const pendingRegistration = me?.registrations.find((r) => r.schoolId === m.school.id && r.status === "pending_verification");
              return (
                <article key={m.id} className="rounded-card border border-line bg-card p-4 shadow-card">
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <h3 className="text-lg font-bold">{m.school.name}</h3>
                    {membershipBadge(m)}
                  </div>
                  <p className="mt-1 text-base text-ink-muted">
                    {roleSummary(m)}
                    {m.assignments.length > 0 && ` · ${m.assignments.map((a) => a.class.label).join(", ")}`}
                  </p>
                  {usable ? (
                    <PrimaryButton className="mt-3" fullWidth icon="chevron-right" onClick={() => start(m)}>
                      이 학교로 시작
                    </PrimaryButton>
                  ) : pendingRegistration ? (
                    <div className="mt-3 space-y-2">
                      <p className="text-sm text-ink-muted">관리자 자격 확인을 기다리고 있습니다.</p>
                      <PrimaryButton
                        variant="secondary"
                        fullWidth
                        loading={withdrawBusy}
                        disabled={withdrawBusy}
                        onClick={() => void withdraw(pendingRegistration.id)}
                      >
                        학교 등록 신청 철회
                      </PrimaryButton>
                    </div>
                  ) : (
                    m.status === "pending" && <p className="mt-2 text-sm text-ink-muted">승인되면 이 화면에서 바로 시작할 수 있습니다.</p>
                  )}
                </article>
              );
            })}
          </div>
        </section>

        <section aria-labelledby="find-school">
          <h2 id="find-school" className="text-xl font-bold">
            학교 찾기
          </h2>
          <form onSubmit={search} className="mt-3 space-y-3 rounded-card border border-line bg-card p-4 shadow-card">
            <fieldset>
              <legend className="text-base font-bold">학교급</legend>
              <div className="mt-1.5 grid grid-cols-4 gap-2">
                {KINDS.map(([value, label]) => (
                  <label key={value} className={`flex min-h-touch cursor-pointer items-center justify-center rounded-control border-2 text-base font-bold ${kind === value ? "border-brand bg-brand text-white" : "border-line-strong bg-card"}`}>
                    <input type="radio" name="kind" value={value} checked={kind === value} onChange={() => setKind(value)} className="sr-only" />
                    {label}
                  </label>
                ))}
              </div>
            </fieldset>
            <label className="block text-base font-bold">
              시도
              <select
                value={sido}
                onChange={(e) => {
                  setSido(e.target.value);
                  setSgg("");
                }}
                className="mt-1.5 block min-h-touch w-full rounded-control border-2 border-line-strong bg-card px-3 text-lg"
              >
                {SIDOS.map(([v, l]) => (
                  <option key={v} value={v}>
                    {l}
                  </option>
                ))}
              </select>
            </label>
            {sido && (
              <label className="block text-base font-bold">
                시군구{" "}
                <span className="font-normal text-ink-muted">
                  {listInfo?.sggRequired ? "(학교알리미에서 목록을 받으려면 꼭 선택하세요)" : "(선택하면 최신 목록을 받아옵니다)"}
                </span>
                <select value={sgg} onChange={(e) => setSgg(e.target.value)} className="mt-1.5 block min-h-touch w-full rounded-control border-2 border-line-strong bg-card px-3 text-lg">
                  <option value="">전체 시군구</option>
                  {sggOf(sido).map(([v, l]) => (
                    <option key={v} value={v}>
                      {l}
                    </option>
                  ))}
                </select>
              </label>
            )}
            <FormField label="학교명" value={q} onChange={(e) => setQ(e.target.value)} placeholder="예: 안전초" minLength={2} required />
            <PrimaryButton type="submit" fullWidth icon="search" loading={searching} loadingText="찾는 중…" disabled={q.trim().length < 2}>
              학교 검색
            </PrimaryButton>
            <p className="text-sm text-ink-muted">학교 정보는 학교알리미 공시자료에서 가져오며 다시 입력할 필요가 없습니다.</p>
          </form>

          <div className="mt-4 space-y-3">
            {done && (
              <p role="status" className="flex gap-2 rounded-control border-2 border-success bg-success-soft p-3 text-base font-semibold text-success">
                <Icon name="check-circle" size={22} /> {done}
              </p>
            )}
            {notice && (
              <p className="flex gap-2 rounded-control border-2 border-warning bg-warning-soft p-3 text-base font-semibold text-warning-strong">
                <Icon name="wifi-off" size={22} /> {notice}
              </p>
            )}
            {listInfo && results && (
              <p className="text-sm text-ink-muted">
                출처: 학교알리미 공시정보 ·{" "}
                {listInfo.syncedAt ? `목록 받은 시각 ${formatDateTime(listInfo.syncedAt)}` : "받은 목록 없음"}
                {listInfo.stale && " · 오래되었거나 새로 받지 못한 목록"}
                {listInfo.refreshFailed && " · 이번 검색에서 새로 받기 실패"}
              </p>
            )}
            {error && <ErrorState title="처리하지 못했습니다" message={error} />}
            {results && results.length === 0 && <EmptyState icon="search" title="검색 결과가 없습니다" message="학교급과 시도를 확인하고 다시 검색하세요." />}
            {results?.map((r) => {
              const registered = r.registeredSchool;
              const mine = memberships.some((m) => m.school.id === registered?.id);
              const open = actionFor === r.externalCode;
              return (
                <article key={r.externalCode} className="rounded-card border border-line bg-card p-4 shadow-card">
                  <div className="flex flex-wrap items-start justify-between gap-2">
                    <div>
                      <h3 className="text-lg font-bold">{r.name}</h3>
                      <p className="text-sm text-ink-muted">{[r.eduOfficeName, r.address].filter(Boolean).join(" · ")}</p>
                      <p className="text-xs text-ink-muted">학교알리미 학교코드 {r.externalCode}</p>
                    </div>
                    {registered ? (
                      registered.status === "active" ? <Badge tone="info">등록된 학교</Badge> : <Badge tone="warning" icon="clock">등록 확인 중</Badge>
                    ) : (
                      <Badge tone="neutral">미등록</Badge>
                    )}
                  </div>

                  {mine ? (
                    <p className="mt-2 text-base font-semibold text-ink-muted">이미 신청했거나 소속된 학교입니다(왼쪽 '내 학교').</p>
                  ) : !open ? (
                    <PrimaryButton className="mt-3" variant="secondary" fullWidth onClick={() => { setActionFor(r.externalCode); setPosition(""); }}>
                      {registered ? "이 학교에 가입 신청" : "이 학교 처음 등록하기"}
                    </PrimaryButton>
                  ) : registered ? (
                    <JoinForm kindCode={kind} busy={busy} onSubmit={(body) => void join(r, body)} />
                  ) : (
                    <div className="mt-3 space-y-3">
                      <p className="rounded-control bg-brand-soft p-3 text-base">
                        첫 등록자에게 관리자 권한이 자동으로 주어지지 <strong>않습니다</strong>. SAFE SCHOOL 운영자가 관리자 자격을 확인한 뒤 학교 공간이 열립니다.
                      </p>
                      <FormField label="직위(선택)" value={position} onChange={(e) => setPosition(e.target.value)} placeholder="예: 교감, 안전업무 담당" maxLength={50} />
                      <PrimaryButton fullWidth onClick={() => void register(r)} loading={busy} loadingText="신청 중…">
                        등록 신청
                      </PrimaryButton>
                    </div>
                  )}
                </article>
              );
            })}
          </div>
        </section>
      </div>
    </AppShell>
  );
}
