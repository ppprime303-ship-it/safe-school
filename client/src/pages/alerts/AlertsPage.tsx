// 교직원 경보함: 우리 학교 지역 대상 공식 경보(원문 그대로)와 읽음 상태
// - 모의 경보는 항상 '모의' 표시. 실제 공식 API 연동은 아직 없습니다.
// - 경보를 받아도 학교 재난 발령·학부모 발송은 자동으로 하지 않습니다(관리자 판단).
import { useCallback, useEffect, useState } from "react";
import { api, ApiError } from "../../lib/api";
import { KIND_LABEL, MSG_LABEL, SEVERITY_META, type AlertItem, type RegionInfo } from "../../lib/alerts";
import { formatDateTime } from "../../lib/format";
import { Link } from "../../lib/router";
import { AppShell } from "../../components/layout/AppShell";
import { EmptyState, ErrorState, LoadingState } from "../../components/ui/States";
import { PrimaryButton } from "../../components/ui/PrimaryButton";
import { FormField } from "../../components/ui/FormField";

const POLL_MS = 30_000;

type Load = { kind: "loading" } | { kind: "error"; message: string } | { kind: "ready"; alerts: AlertItem[]; unreadCount: number };

export function AlertsPage({ schoolId, isAdmin }: { schoolId: string; isAdmin: boolean }) {
  const [load, setLoad] = useState<Load>({ kind: "loading" });
  const [open, setOpen] = useState<string | null>(null);

  const fetchAlerts = useCallback(async () => {
    try {
      const data = await api<{ alerts: AlertItem[]; unreadCount: number }>("GET", `/schools/${schoolId}/alerts`);
      setLoad({ kind: "ready", ...data });
    } catch (e) {
      setLoad((prev) => (prev.kind === "ready" ? prev : { kind: "error", message: e instanceof ApiError ? e.message : "불러오지 못했습니다." }));
    }
  }, [schoolId]);

  useEffect(() => {
    void fetchAlerts();
    const id = window.setInterval(() => void fetchAlerts(), POLL_MS);
    return () => window.clearInterval(id);
  }, [fetchAlerts]);

  const toggle = async (item: AlertItem) => {
    setOpen((o) => (o === item.matchId ? null : item.matchId));
    if (!item.read && item.result === "target") {
      try {
        await api("POST", `/schools/${schoolId}/alerts/${item.matchId}/read`, {});
        setLoad((prev) =>
          prev.kind === "ready"
            ? { ...prev, unreadCount: Math.max(0, prev.unreadCount - 1), alerts: prev.alerts.map((a) => (a.matchId === item.matchId ? { ...a, read: true } : a)) }
            : prev,
        );
      } catch {
        /* 읽음 표시는 다음 갱신 때 다시 시도 */
      }
    }
  };

  const targets = load.kind === "ready" ? load.alerts.filter((a) => a.result === "target") : [];
  const undetermined = load.kind === "ready" ? load.alerts.filter((a) => a.result === "undetermined") : [];

  return (
    <AppShell title="경보함" schoolId={schoolId}>
      <div className="mx-auto max-w-2xl space-y-4">
        {isAdmin && <RegionCard schoolId={schoolId} onChanged={() => void fetchAlerts()} />}
        <div className="flex justify-end">
          <Link href={`/s/${schoolId}/notices`} className="inline-flex min-h-touch items-center text-base font-bold text-accent underline underline-offset-4">
            작성한 학교 안내문 보기
          </Link>
        </div>
        <p className="rounded-control border border-line bg-card px-3 py-2 text-sm text-ink-muted">
          공식 경보 원문을 그대로 보여 줍니다. 이 앱은 119·112 신고, 공식 비상연락망, 교육청 공문을 대신하지 않습니다.
        </p>

        {load.kind === "loading" && <LoadingState label="경보를 불러오는 중…" />}
        {load.kind === "error" && <ErrorState message={load.message} onRetry={() => void fetchAlerts()} />}
        {load.kind === "ready" && (
          <>
            <h2 className="text-lg font-bold">
              우리 학교 대상 경보 <span className="text-ink-muted">· 읽지 않음 {load.unreadCount}건</span>
            </h2>
            {targets.length === 0 ? (
              <EmptyState icon="check-circle" title="우리 학교 지역에 해당하는 경보가 없습니다" message="새 경보는 30초마다 확인합니다." />
            ) : (
              <ul className="space-y-3">
                {targets.map((a) => (
                  <AlertCard key={a.matchId} item={a} open={open === a.matchId} onToggle={() => void toggle(a)} schoolId={schoolId} isAdmin={isAdmin} />
                ))}
              </ul>
            )}
            {isAdmin && undetermined.length > 0 && (
              <section aria-labelledby="undetermined-title" className="pt-2">
                <h2 id="undetermined-title" className="text-lg font-bold">미판정 경보(관리자만 보임)</h2>
                <p className="mt-1 text-sm text-ink-muted">학교 소재지나 경보 지역을 확정하지 못해 교직원에게 알리지 않은 경보입니다. 원문을 확인하고 필요하면 소재지를 확인하세요.</p>
                <ul className="mt-3 space-y-3">
                  {undetermined.map((a) => (
                    <AlertCard key={a.matchId} item={a} open={open === a.matchId} onToggle={() => void toggle(a)} schoolId={schoolId} isAdmin={isAdmin} />
                  ))}
                </ul>
              </section>
            )}
          </>
        )}
      </div>
    </AppShell>
  );
}

function AlertCard({ item, open, onToggle, schoolId, isAdmin }: { item: AlertItem; open: boolean; onToggle: () => void; schoolId: string; isAdmin: boolean }) {
  const a = item.alert;
  const sev = SEVERITY_META[a.severity];
  const msg = MSG_LABEL[a.msgType];
  const unread = !item.read && item.result === "target";
  return (
    <li className={`rounded-card border bg-card shadow-card ${unread ? "border-brand" : "border-line"}`}>
      <button type="button" onClick={onToggle} aria-expanded={open} className="block w-full p-4 text-left">
        <div className="flex flex-wrap items-center gap-1.5">
          {unread && <span className="rounded-full bg-brand px-2 py-0.5 text-sm font-bold text-white">새 경보</span>}
          {a.isMock && <span className="rounded-full border-2 border-dashed border-warning px-2 py-0.5 text-sm font-bold text-warning-strong">모의</span>}
          <span className={`rounded-full px-2 py-0.5 text-sm font-bold ${sev.badge}`}>{sev.label}</span>
          <span className="rounded-full bg-neutral-soft px-2 py-0.5 text-sm font-semibold text-neutral">{KIND_LABEL[a.kind]}</span>
          {msg && <span className="rounded-full bg-accent-soft px-2 py-0.5 text-sm font-bold text-accent">{msg}</span>}
          {item.cancelled && <span className="rounded-full bg-accent-soft px-2 py-0.5 text-sm font-bold text-accent">해제됨</span>}
          {item.expired && <span className="rounded-full bg-neutral-soft px-2 py-0.5 text-sm font-semibold text-neutral">기간 종료</span>}
          {item.noticeCount > 0 && <span className="rounded-full bg-brand-soft px-2 py-0.5 text-sm font-bold text-brand">안내문 {item.noticeCount}</span>}
        </div>
        <p className={`mt-2 text-lg ${unread ? "font-extrabold" : "font-bold"}`}>{a.title ?? a.body.slice(0, 40)}</p>
        <p className="mt-1 text-sm text-ink-muted">
          {a.issuer} · 발령 {formatDateTime(a.issuedAt)} · 대상 지역 {a.areasRaw}
          {item.rebroadcastCount > 0 && ` · 같은 내용 ${item.rebroadcastCount}회 재송출`}
        </p>
      </button>
      {open && (
        <div className="border-t border-line px-4 pb-4 pt-3">
          <p className="text-sm font-bold text-ink-muted">공식 경보 원문(수정되지 않음)</p>
          <blockquote className="mt-1 whitespace-pre-wrap rounded-control border-l-4 border-line-strong bg-page px-3 py-2 text-base">{a.body}</blockquote>
          <dl className="mt-3 grid grid-cols-[auto_1fr] gap-x-3 gap-y-1 text-sm">
            <dt className="font-semibold text-ink-muted">출처</dt>
            <dd>{a.isMock ? "모의 공급자(시연용 가상 경보)" : a.provider}</dd>
            <dt className="font-semibold text-ink-muted">수신</dt>
            <dd>{formatDateTime(a.receivedAt)}</dd>
            {a.expiresAt && (
              <>
                <dt className="font-semibold text-ink-muted">종료 예정</dt>
                <dd>{formatDateTime(a.expiresAt)}</dd>
              </>
            )}
            <dt className="font-semibold text-ink-muted">판정</dt>
            <dd>{item.reason}</dd>
          </dl>
          <div className="mt-3 rounded-control bg-brand-soft px-3 py-2 text-sm">
            {isAdmin ? (
              <>
                학교 대응이 필요하면{" "}
                <Link href={`/s/${schoolId}/board`} className="font-bold text-accent underline underline-offset-4">
                  상황판에서 재난 발령
                </Link>
                하세요. 경보만으로 자동 발령하지 않습니다.
              </>
            ) : (
              "학교 관리자의 안내를 따르세요. 재난이 발령되면 학급 보고 화면이 자동으로 열립니다."
            )}
          </div>
          {item.result === "target" && (
            <div className="mt-3 rounded-control border border-line px-3 py-3">
              <p className="text-base font-bold">학교 안내문</p>
              <p className="mt-0.5 text-sm text-ink-muted">
                상황별 예시문으로 학부모·교직원 안내문을 작성하고 복사해, 학교의 기존 채널에서 직접 보내세요(이 앱은 발송하지 않음).
                {item.cancelled && " 이 경보는 해제되었습니다 — 해제 안내 예시를 먼저 추천합니다."}
              </p>
              <div className="mt-2 flex flex-wrap items-center gap-3">
                <Link
                  href={`/s/${schoolId}/notices/new?alert=${a.id}`}
                  className="inline-flex min-h-touch items-center rounded-control bg-brand px-4 font-bold text-white hover:bg-brand-hover"
                >
                  안내문 작성
                </Link>
                {item.noticeCount > 0 && (
                  <Link href={`/s/${schoolId}/notices?alert=${a.id}`} className="font-bold text-accent underline underline-offset-4">
                    이 경보의 안내문 {item.noticeCount}건 보기
                  </Link>
                )}
              </div>
            </div>
          )}
        </div>
      )}
    </li>
  );
}

const SIDO_OPTIONS = [
  "서울특별시", "부산광역시", "대구광역시", "인천광역시", "광주광역시", "대전광역시", "울산광역시", "세종특별자치시",
  "경기도", "강원특별자치도", "충청북도", "충청남도", "전북특별자치도", "전라남도", "경상북도", "경상남도", "제주특별자치도",
];

function RegionCard({ schoolId, onChanged }: { schoolId: string; onChanged: () => void }) {
  const [info, setInfo] = useState<RegionInfo | null>(null);
  const [editing, setEditing] = useState(false);
  const [sido, setSido] = useState("");
  const [sigungu, setSigungu] = useState("");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      const data = await api<RegionInfo>("GET", `/schools/${schoolId}/region`);
      setInfo(data);
      setSido(data.region?.sido ?? "");
      setSigungu(data.region?.sigungu ?? "");
    } catch (e) {
      setError(e instanceof ApiError ? e.message : "소재지를 불러오지 못했습니다.");
    }
  }, [schoolId]);
  useEffect(() => {
    void load();
  }, [load]);

  const save = async () => {
    setSaving(true);
    setError(null);
    try {
      await api("PUT", `/schools/${schoolId}/region`, { sido, sigungu: sigungu.trim() || null });
      setEditing(false);
      await load();
      onChanged();
    } catch (e) {
      setError(e instanceof ApiError ? e.message : "저장하지 못했습니다.");
    } finally {
      setSaving(false);
    }
  };

  const r = info?.region;
  return (
    <section className="rounded-card border border-line bg-card p-4 shadow-card" aria-labelledby="region-title">
      <h2 id="region-title" className="text-lg font-bold">경보 수신 지역(학교 소재지)</h2>
      {!info && !error && <p className="mt-1 text-ink-muted">불러오는 중…</p>}
      {info && !editing && (
        <>
          <p className="mt-1 text-xl font-extrabold">{r ? `${r.sido}${r.sigungu ? ` ${r.sigungu}` : ""}` : "확인되지 않음"}</p>
          <p className="mt-1 text-sm text-ink-muted">
            {r?.confirmed ? `관리자 확인 ${formatDateTime(r.confirmedAt!)}` : r ? "학교 주소에서 자동 추출 · 관리자 확인 전" : "주소로 지역을 알 수 없어 경보가 '미판정'으로 남습니다."}
            {info.address && ` · 주소: ${info.address}`}
          </p>
          <PrimaryButton className="mt-3" variant={r?.confirmed ? "secondary" : "primary"} onClick={() => setEditing(true)}>
            {r?.confirmed ? "소재지 수정" : "소재지 확인"}
          </PrimaryButton>
        </>
      )}
      {editing && (
        <div className="mt-2 space-y-3">
          <label className="block text-base font-bold" htmlFor="sido-select">
            시도
          </label>
          <select
            id="sido-select"
            value={sido}
            onChange={(e) => setSido(e.target.value)}
            className="block min-h-touch w-full rounded-control border-2 border-line-strong bg-card px-3 text-lg"
          >
            <option value="">선택하세요</option>
            {SIDO_OPTIONS.map((s) => (
              <option key={s} value={s}>
                {s}
              </option>
            ))}
          </select>
          <FormField label="시군구" hint="예: 남동구, 수원시 장안구 (세종시는 비워 두세요)" value={sigungu} onChange={(e) => setSigungu(e.target.value)} maxLength={30} />
          <div className="flex gap-2">
            <PrimaryButton loading={saving} disabled={!sido} onClick={() => void save()}>
              확인 저장
            </PrimaryButton>
            <PrimaryButton variant="ghost" onClick={() => setEditing(false)}>
              취소
            </PrimaryButton>
          </div>
        </div>
      )}
      {error && <p className="mt-2 font-semibold text-danger" role="alert">{error}</p>}
    </section>
  );
}
