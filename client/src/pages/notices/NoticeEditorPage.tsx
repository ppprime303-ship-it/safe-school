// STEP 3-C 재난안전 안내문 작성 지원: 예시문 선택 → 편집·저장(판 번호) → 미리보기·복사 → 교사가 학교 기존 채널로 직접 발송
// - 결재·실제 발송·모의 발송 기능은 없습니다. 처리 이력은 교사가 직접 남기는 기록일 뿐입니다.
// - 예시 원본은 바뀌지 않으며, 저장되는 것은 교사가 고친 안내문입니다.
// - 취소된 안내문은 고칠 수 없고, '이 안내문으로 새 초안 만들기'로 새 ID의 초안을 만듭니다(원본·취소 기록 보존).
import { useCallback, useEffect, useMemo, useState } from "react";
import { api, ApiError, describeError } from "../../lib/api";
import type { AlertItem } from "../../lib/alerts";
import { CHANNEL_LABEL, NOTICE_STATUS_META, copyText, type ChannelKey, type NoticeAlertState, type NoticeDetail, type ReuseResult } from "../../lib/notices";
import { formatDateTime } from "../../lib/format";
import { Link, navigate } from "../../lib/router";
import { useSession } from "../../lib/session";
import { AppShell } from "../../components/layout/AppShell";
import { ErrorState, LoadingState } from "../../components/ui/States";
import { PrimaryButton } from "../../components/ui/PrimaryButton";
import { FormField } from "../../components/ui/FormField";
import { ConfirmDialog } from "../../components/ui/ConfirmDialog";
import {
  NOTICE_AUDIENCES,
  NOTICE_DISASTER_TYPES,
  NOTICE_EXAMPLES,
  NOTICE_GUIDE_TEXT,
  NOTICE_SITUATIONS,
  fillNoticeTemplate,
  findUnfilledGuides,
  noticeFillValuesFrom,
  recommendNoticeSituation,
  recommendNoticeType,
  type NoticeDisasterType,
  type NoticeExample,
  type NoticeFillValues,
} from "@shared/noticeExamples";

type Load =
  | { kind: "loading" }
  | { kind: "error"; title: string; message: string }
  | { kind: "new"; alert: NoticeAlertState }
  | { kind: "ready"; detail: NoticeDetail };

const toAlertState = (a: AlertItem): NoticeAlertState => ({
  id: a.alert.id, title: a.alert.title, body: a.alert.body, issuer: a.alert.issuer, areasRaw: a.alert.areasRaw, msgType: a.alert.msgType,
  isMock: a.alert.isMock, issuedAt: a.alert.issuedAt, expiresAt: a.alert.expiresAt, cancelled: a.cancelled, expired: a.expired,
});

export function NoticeEditorPage({ schoolId, noticeId }: { schoolId: string; noticeId: string }) {
  const { usableMemberships } = useSession();
  const schoolName = usableMemberships.find((m) => m.school.id === schoolId)?.school.name ?? null;
  const isNew = noticeId === "new";
  const [load, setLoad] = useState<Load>({ kind: "loading" });
  const [title, setTitle] = useState("");
  const [body, setBody] = useState("");
  const [exampleKey, setExampleKey] = useState<string | null>(null);
  const [baseline, setBaseline] = useState({ title: "", body: "", exampleKey: null as string | null });
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<{ message: string; conflict?: boolean } | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [pendingExample, setPendingExample] = useState<NoticeExample | null>(null);
  const [preview, setPreview] = useState(false);
  const [cancelOpen, setCancelOpen] = useState(false);
  const [reuseOpen, setReuseOpen] = useState(false);

  const fetchData = useCallback(async () => {
    setError(null);
    try {
      if (isNew) {
        const alertId = new URLSearchParams(window.location.search).get("alert");
        const data = await api<{ alerts: AlertItem[] }>("GET", `/schools/${schoolId}/alerts`);
        const item = data.alerts.find((a) => a.alert.id === alertId && a.result === "target");
        if (!item) {
          setLoad({ kind: "error", title: "경보를 찾을 수 없습니다", message: "경보함에서 우리 학교 대상 경보를 열고 '안내문 작성'을 누르세요." });
          return;
        }
        setLoad({ kind: "new", alert: toAlertState(item) });
        setTitle("");
        setBody("");
        setExampleKey(null);
        setBaseline({ title: "", body: "", exampleKey: null });
      } else {
        const detail = await api<NoticeDetail>("GET", `/schools/${schoolId}/notices/${noticeId}`);
        setLoad({ kind: "ready", detail });
        setTitle(detail.notice.title);
        setBody(detail.notice.body);
        setExampleKey(detail.notice.exampleKey);
        setBaseline({ title: detail.notice.title, body: detail.notice.body, exampleKey: detail.notice.exampleKey });
      }
    } catch (e) {
      const d = describeError(e);
      setLoad({ kind: "error", title: d.title, message: d.message });
    }
  }, [isNew, noticeId, schoolId]);
  useEffect(() => {
    setLoad({ kind: "loading" });
    void fetchData();
  }, [fetchData]);

  const detail = load.kind === "ready" ? load.detail : null;
  const alert = load.kind === "ready" ? load.detail.alert : load.kind === "new" ? load.alert : null;
  const editable = load.kind === "new" || (detail?.canEdit ?? false);
  const dirty = title !== baseline.title || body !== baseline.body || exampleKey !== baseline.exampleKey;

  // 저장하지 않은 채 창을 닫으려 하면 브라우저 확인
  useEffect(() => {
    if (!dirty) return;
    const warn = (e: BeforeUnloadEvent) => e.preventDefault();
    window.addEventListener("beforeunload", warn);
    return () => window.removeEventListener("beforeunload", warn);
  }, [dirty]);

  const fillValues = useMemo(
    () => (alert ? noticeFillValuesFrom({ schoolName: detail?.schoolName ?? schoolName, alert, disasterType: null }) : {}),
    [alert, detail?.schoolName, schoolName],
  );

  const applyExample = (ex: NoticeExample) => {
    const values = { ...fillValues, 재난유형: NOTICE_DISASTER_TYPES[ex.disasterType] };
    setTitle(fillNoticeTemplate(ex.title, values));
    setBody(fillNoticeTemplate(ex.body, values));
    setExampleKey(ex.key);
    setPendingExample(null);
    setNotice(`'${ex.label}' 예시를 불러왔습니다. [ … 입력하세요] 부분을 학교 상황에 맞게 고치세요.`);
  };
  const chooseExample = (ex: NoticeExample) => {
    if (title.trim() || body.trim()) setPendingExample(ex); // 작성 중인 글이 있으면 덮어쓰기 확인
    else applyExample(ex);
  };

  const save = async (status: "draft" | "completed") => {
    if (!title.trim() || !body.trim()) {
      setError({ message: "제목과 본문을 입력하세요." });
      return;
    }
    setSaving(true);
    setError(null);
    setNotice(null);
    try {
      if (load.kind === "new") {
        const r = await api<{ id: string }>("POST", `/schools/${schoolId}/notices`, { alertId: load.alert.id, title, body, exampleKey });
        if (status === "completed") {
          await api("PATCH", `/schools/${schoolId}/notices/${r.id}`, { title, body, status, expectedVersion: 1 });
        }
        setBaseline({ title, body, exampleKey });
        navigate(`/s/${schoolId}/notices/${r.id}`, { replace: true });
        return;
      }
      if (!detail) return;
      const payload: Record<string, unknown> = { title, body, status, expectedVersion: detail.notice.version };
      if (exampleKey !== baseline.exampleKey) payload.exampleKey = exampleKey;
      const r = await api<{ version: number; changed: boolean }>("PATCH", `/schools/${schoolId}/notices/${detail.notice.id}`, payload);
      await fetchData();
      setNotice(r.changed ? `저장했습니다(판 ${r.version}).` : "바뀐 내용이 없어 판 번호를 올리지 않았습니다.");
    } catch (e) {
      if (e instanceof ApiError && e.code === "version_conflict") {
        setError({ message: "다른 사람이 먼저 저장했습니다. 지금 화면의 글을 복사해 두고 최신 내용을 불러오세요.", conflict: true });
      } else {
        setError({ message: describeError(e).message });
      }
    } finally {
      setSaving(false);
    }
  };

  const unfilled = findUnfilledGuides(`${title}\n${body}`);
  const status = detail?.notice.status ?? "draft";

  return (
    <AppShell title={isNew ? "안내문 작성" : "안내문"} schoolId={schoolId}>
      <div className="mx-auto max-w-5xl space-y-4">
        <div className="flex flex-wrap gap-3 text-base font-bold">
          <Link href={`/s/${schoolId}/notices`} className="text-accent underline underline-offset-4">
            안내문 목록
          </Link>
          <Link href={`/s/${schoolId}/alerts`} className="text-accent underline underline-offset-4">
            경보함
          </Link>
        </div>
        <p role="note" className="rounded-control border-2 border-brand bg-brand-soft px-3 py-2 text-base font-semibold text-brand">
          {NOTICE_GUIDE_TEXT.feature}
        </p>

        {load.kind === "loading" && <LoadingState label="안내문을 불러오는 중…" />}
        {load.kind === "error" && <ErrorState title={load.title} message={load.message} onRetry={() => void fetchData()} />}

        {alert && (
          <>
            <AlertContext alert={alert} detail={detail} schoolId={schoolId} />

            {detail?.notice.status === "cancelled" && (
              <CancelledPanel detail={detail} onReuse={() => setReuseOpen(true)} schoolId={schoolId} />
            )}

            <div className={`grid gap-4 ${editable ? "lg:grid-cols-[minmax(0,20rem)_minmax(0,1fr)]" : ""}`}>
              {editable && <ExamplePicker alert={alert} currentKey={exampleKey} onPick={chooseExample} fillValues={fillValues} />}

              <section aria-labelledby="editor-title" className="min-w-0 rounded-card border border-line bg-card p-4 shadow-card">
                <div className="flex flex-wrap items-center gap-2">
                  <h2 id="editor-title" className="text-lg font-bold">
                    {editable ? "안내문 편집" : "안내문 내용"}
                  </h2>
                  {detail && (
                    <span className={`rounded-full px-2 py-0.5 text-sm font-bold ${NOTICE_STATUS_META[detail.notice.status].badge}`}>
                      {NOTICE_STATUS_META[detail.notice.status].label}
                    </span>
                  )}
                  {detail && <span className="text-sm text-ink-muted">판 {detail.notice.version} · 작성 {detail.notice.createdByName ?? "(알 수 없음)"}</span>}
                  {dirty && editable && <span className="rounded-full bg-warning-soft px-2 py-0.5 text-sm font-bold text-warning-strong">저장 안 됨</span>}
                </div>
                {detail && !detail.canEdit && detail.notice.status !== "cancelled" && (
                  <p className="mt-2 text-sm text-ink-muted">작성자와 학교 관리자만 고칠 수 있습니다. 미리보기와 복사는 할 수 있습니다.</p>
                )}
                <p className="mt-2 text-sm text-ink-muted">{NOTICE_GUIDE_TEXT.example}</p>

                {editable ? (
                  <div className="mt-3 space-y-3">
                    <FormField label="제목" value={title} maxLength={200} onChange={(e) => setTitle(e.target.value)} required />
                    <div>
                      <label htmlFor="notice-body" className="block text-base font-bold">
                        본문<span className="ml-1 text-danger" aria-hidden>*</span>
                      </label>
                      <textarea
                        id="notice-body"
                        value={body}
                        maxLength={5000}
                        rows={16}
                        onChange={(e) => setBody(e.target.value)}
                        className="mt-1.5 block w-full rounded-control border-2 border-line-strong bg-card px-3 py-2 text-base leading-relaxed"
                      />
                      <p className="mt-1 text-right text-sm text-ink-muted">{body.length.toLocaleString("ko-KR")} / 5,000자</p>
                    </div>
                  </div>
                ) : (
                  <NoticePreview title={title} body={body} className="mt-3" />
                )}

                {unfilled.length > 0 && (
                  <div className="mt-3 rounded-control border-2 border-warning bg-warning-soft px-3 py-2 text-sm text-warning-strong">
                    <p className="font-bold">아직 채우지 않은 입력 안내 {unfilled.length}곳 — 복사·발송 전에 확인하세요</p>
                    <ul className="mt-1 list-disc pl-5">
                      {unfilled.slice(0, 6).map((g) => (
                        <li key={g}>{g}</li>
                      ))}
                    </ul>
                  </div>
                )}

                {notice && (
                  <p role="status" aria-live="polite" className="mt-3 rounded-control bg-accent-soft px-3 py-2 font-semibold text-accent">
                    {notice}
                  </p>
                )}
                {error && (
                  <div role="alert" className="mt-3 rounded-control border-2 border-danger bg-danger-soft px-3 py-2 font-semibold text-danger">
                    <p>{error.message}</p>
                    {error.conflict && (
                      <PrimaryButton className="mt-2" variant="secondary" icon="refresh" onClick={() => void fetchData()}>
                        최신 내용 불러오기(화면의 글은 사라짐)
                      </PrimaryButton>
                    )}
                  </div>
                )}

                <div className="mt-4 flex flex-wrap gap-2">
                  {editable && (
                    <>
                      <PrimaryButton loading={saving} loadingText="저장 중…" onClick={() => void save(status === "completed" ? "completed" : "draft")}>
                        {isNew ? "저장(작성 중)" : "저장"}
                      </PrimaryButton>
                      {status !== "completed" ? (
                        <PrimaryButton variant="success" icon="check" disabled={saving} onClick={() => void save("completed")}>
                          작성 완료로 저장
                        </PrimaryButton>
                      ) : (
                        <PrimaryButton variant="secondary" disabled={saving} onClick={() => void save("draft")}>
                          작성 중으로 바꿔 저장
                        </PrimaryButton>
                      )}
                    </>
                  )}
                  {editable && (
                    <PrimaryButton variant="ghost" onClick={() => setPreview((p) => !p)} aria-expanded={preview}>
                      {preview ? "미리보기 닫기" : "미리보기"}
                    </PrimaryButton>
                  )}
                </div>
                {preview && editable && <NoticePreview title={title} body={body} className="mt-3" />}

                <CopyBar title={title} body={body} />
                <p className="mt-2 text-sm text-ink-muted">
                  복사한 글은 학교의 기존 발송 채널(학교 알림 앱, 문자, 가정통신문 등)에서 교사가 직접 보내세요. 이 앱은 발송하지 않습니다.
                </p>

                {detail && detail.canEdit && detail.notice.status !== "cancelled" && (
                  <div className="mt-4 border-t border-line pt-3">
                    <PrimaryButton variant="ghost" className="text-danger" onClick={() => setCancelOpen(true)}>
                      이 안내문 취소
                    </PrimaryButton>
                    <p className="text-sm text-ink-muted">취소한 안내문은 고치거나 되돌릴 수 없고, 내용을 복사해 새 초안으로 다시 만들 수 있습니다.</p>
                  </div>
                )}
              </section>
            </div>

            {detail && <RevisionsPanel detail={detail} />}
            {detail && <RecordsPanel detail={detail} schoolId={schoolId} onChanged={() => void fetchData()} />}
          </>
        )}
      </div>

      <ConfirmDialog
        open={pendingExample !== null}
        title="작성 중인 글을 예시로 바꿀까요?"
        confirmLabel="예시로 바꾸기"
        tone="primary"
        onConfirm={() => pendingExample && applyExample(pendingExample)}
        onCancel={() => setPendingExample(null)}
      >
        <p>편집 영역의 제목과 본문이 '{pendingExample?.label}' 예시로 바뀝니다. 저장하기 전까지는 서버의 안내문이 바뀌지 않습니다.</p>
      </ConfirmDialog>

      {detail && (
        <CancelDialog
          open={cancelOpen}
          detail={detail}
          schoolId={schoolId}
          onClose={() => setCancelOpen(false)}
          onDone={() => {
            setCancelOpen(false);
            void fetchData();
          }}
        />
      )}
      {detail && reuseOpen && <ReuseDialog detail={detail} schoolId={schoolId} onClose={() => setReuseOpen(false)} />}
    </AppShell>
  );
}

// ───────────── 연결 경보(공식 원문은 읽기만) ─────────────
function AlertContext({ alert, detail, schoolId }: { alert: NoticeAlertState; detail: NoticeDetail | null; schoolId: string }) {
  const warnings: string[] = [];
  if (detail?.notice.sourceNoticeId) warnings.push(NOTICE_GUIDE_TEXT.reusePast);
  if (alert.cancelled && detail?.notice.status !== "cancelled") warnings.push("연결된 경보는 이미 해제되었습니다. 해제 안내가 아니라면 내용을 확인하세요.");
  else if (alert.expired && detail?.notice.status !== "cancelled") warnings.push("연결된 경보의 유효 시각이 지났습니다. 현재도 유효한 상황인지 확인하세요.");
  if (detail?.source && !detail.source.sameAlert) warnings.push("원본과 다른 경보에 연결했습니다. 본문의 경보 제목·발령 시각·지역을 새 경보에 맞게 고치세요.");
  return (
    <section aria-labelledby="alert-ctx" className="rounded-card border border-line bg-card p-4 shadow-card">
      <div className="flex flex-wrap items-center gap-1.5">
        <h2 id="alert-ctx" className="text-base font-bold text-ink-muted">
          연결된 공식 경보
        </h2>
        {alert.isMock && <span className="rounded-full border-2 border-dashed border-warning px-2 py-0.5 text-sm font-bold text-warning-strong">모의</span>}
        {alert.msgType === "cancel" && <span className="rounded-full bg-accent-soft px-2 py-0.5 text-sm font-bold text-accent">해제 안내</span>}
        {alert.cancelled && <span className="rounded-full bg-accent-soft px-2 py-0.5 text-sm font-bold text-accent">해제됨</span>}
        {alert.expired && <span className="rounded-full bg-neutral-soft px-2 py-0.5 text-sm font-semibold text-neutral">기간 종료</span>}
        {(alert.cancelled || alert.expired) && <span className="rounded-full bg-neutral-soft px-2 py-0.5 text-sm font-semibold text-neutral">과거 경보</span>}
      </div>
      <p className="mt-1 text-lg font-bold">{alert.title ?? alert.body.slice(0, 40)}</p>
      <p className="text-sm text-ink-muted">
        {alert.issuer} · 발령 {formatDateTime(alert.issuedAt)} · 대상 지역 {alert.areasRaw}
      </p>
      <details className="mt-2">
        <summary className="cursor-pointer text-sm font-bold text-accent">공식 경보 원문 보기(수정되지 않음)</summary>
        <blockquote className="mt-1 whitespace-pre-wrap rounded-control border-l-4 border-line-strong bg-page px-3 py-2 text-base">{alert.body}</blockquote>
      </details>
      {warnings.length > 0 && (
        <ul role="alert" className="mt-3 space-y-1 rounded-control border-2 border-warning bg-warning-soft px-3 py-2 text-sm font-semibold text-warning-strong">
          {warnings.map((w) => (
            <li key={w}>⚠ {w}</li>
          ))}
        </ul>
      )}
      {detail?.source && (
        <p className="mt-2 text-sm">
          원본(취소됨):{" "}
          <Link href={`/s/${schoolId}/notices/${detail.source.id}`} className="font-bold text-accent underline underline-offset-4">
            {detail.source.title}
          </Link>
          {detail.source.cancelReason && <span className="text-ink-muted"> · 취소 사유: {detail.source.cancelReason}</span>}
        </p>
      )}
    </section>
  );
}

// ───────────── 예시문 선택(7개 유형 × 학부모·교직원·해제) ─────────────
function ExamplePicker({ alert, currentKey, onPick, fillValues }: { alert: NoticeAlertState; currentKey: string | null; onPick: (ex: NoticeExample) => void; fillValues: NoticeFillValues }) {
  const recommendedType = recommendNoticeType(alert);
  const recommendedSituation = recommendNoticeSituation(alert);
  const [type, setType] = useState<NoticeDisasterType>(recommendedType);
  const list = NOTICE_EXAMPLES.filter((e) => e.disasterType === type);
  return (
    <section aria-labelledby="examples-title" className="min-w-0 rounded-card border border-line bg-card p-4 shadow-card">
      <h2 id="examples-title" className="text-lg font-bold">
        상황별 예시문
      </h2>
      <p className="mt-1 text-sm text-ink-muted">카드를 누르면 편집 영역에 불러옵니다. 확인된 학교명·경보·발령 시각·지역만 채웁니다.</p>
      <div role="tablist" aria-label="재난 유형" className="mt-3 flex flex-wrap gap-1.5">
        {(Object.keys(NOTICE_DISASTER_TYPES) as NoticeDisasterType[]).map((t) => (
          <button
            key={t}
            type="button"
            role="tab"
            aria-selected={type === t}
            onClick={() => setType(t)}
            className={`min-h-touch rounded-control border-2 px-3 text-base font-bold ${type === t ? "border-brand bg-brand text-white" : "border-line-strong bg-card text-ink"}`}
          >
            {NOTICE_DISASTER_TYPES[t]}
            {t === recommendedType && <span className="sr-only"> 추천</span>}
            {t === recommendedType && <span aria-hidden> ★</span>}
          </button>
        ))}
      </div>
      <ul className="mt-3 space-y-2">
        {list.map((ex) => {
          const recommended = ex.disasterType === recommendedType && ex.situation === recommendedSituation;
          const selected = ex.key === currentKey;
          return (
            <li key={ex.key}>
              <button
                type="button"
                onClick={() => onPick(ex)}
                className={`block w-full rounded-control border-2 p-3 text-left hover:border-brand ${selected ? "border-brand bg-brand-soft" : "border-line bg-card"}`}
              >
                <span className="flex flex-wrap items-center gap-1.5">
                  <span className="rounded-full bg-neutral-soft px-2 py-0.5 text-sm font-bold text-neutral">{NOTICE_AUDIENCES[ex.audience]}</span>
                  <span className="rounded-full bg-neutral-soft px-2 py-0.5 text-sm font-bold text-neutral">{NOTICE_SITUATIONS[ex.situation]}</span>
                  {recommended && <span className="rounded-full bg-accent-soft px-2 py-0.5 text-sm font-bold text-accent">추천</span>}
                  {selected && <span className="rounded-full bg-brand px-2 py-0.5 text-sm font-bold text-white">불러옴</span>}
                </span>
                <span className="mt-1 block font-bold">{ex.label}</span>
                <span className="mt-0.5 line-clamp-2 block text-sm text-ink-muted">
                  {fillNoticeTemplate(ex.body, { ...fillValues, 재난유형: NOTICE_DISASTER_TYPES[ex.disasterType] }).split("\n").slice(1, 3).join(" ")}
                </span>
              </button>
            </li>
          );
        })}
      </ul>
    </section>
  );
}

// ───────────── 미리보기·복사 ─────────────
function NoticePreview({ title, body, className = "" }: { title: string; body: string; className?: string }) {
  return (
    <div className={`rounded-card border-2 border-line-strong bg-page p-4 ${className}`} aria-label="안내문 미리보기">
      <p className="text-sm font-bold text-ink-muted">미리보기</p>
      <p className="mt-2 text-lg font-bold">{title || "(제목 없음)"}</p>
      <p className="mt-2 whitespace-pre-wrap text-base leading-relaxed">{body || "(본문 없음)"}</p>
    </div>
  );
}

function CopyBar({ title, body }: { title: string; body: string }) {
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const [manual, setManual] = useState<string | null>(null);
  const copy = async (label: string, text: string) => {
    if (!text.trim()) {
      setMsg({ ok: false, text: `${label}이(가) 비어 있습니다.` });
      return;
    }
    const ok = await copyText(text);
    setManual(ok ? null : text);
    setMsg(ok ? { ok: true, text: `${label}을(를) 복사했습니다.` } : { ok: false, text: "자동 복사가 되지 않았습니다. 아래 글을 길게 눌러 직접 복사하세요." });
  };
  return (
    <div className="mt-4 rounded-control border border-line bg-page p-3">
      <p className="text-base font-bold">복사</p>
      <div className="mt-2 flex flex-wrap gap-2">
        <PrimaryButton variant="secondary" icon="copy" onClick={() => void copy("제목", title)}>
          제목 복사
        </PrimaryButton>
        <PrimaryButton variant="secondary" icon="copy" onClick={() => void copy("본문", body)}>
          본문 복사
        </PrimaryButton>
        <PrimaryButton variant="secondary" icon="copy" onClick={() => void copy("제목과 본문", `${title}\n\n${body}`)}>
          전체 복사
        </PrimaryButton>
      </div>
      {msg && (
        <p role="status" aria-live="polite" className={`mt-2 font-semibold ${msg.ok ? "text-accent" : "text-danger"}`}>
          {msg.text}
        </p>
      )}
      {manual && (
        <textarea readOnly value={manual} rows={6} onFocus={(e) => e.currentTarget.select()} className="mt-2 block w-full rounded-control border-2 border-line-strong bg-card px-3 py-2 text-base" />
      )}
    </div>
  );
}

// ───────────── 취소·재사용 ─────────────
function CancelledPanel({ detail, onReuse, schoolId }: { detail: NoticeDetail; onReuse: () => void; schoolId: string }) {
  const draft = detail.reusedBy.find((r) => r.status === "draft");
  return (
    <section className="rounded-card border-2 border-line-strong bg-neutral-soft p-4">
      <h2 className="text-lg font-bold">취소된 안내문</h2>
      <p className="mt-1">
        {detail.notice.cancelledAt && `${formatDateTime(detail.notice.cancelledAt)} 취소`} · 사유: {detail.notice.cancelReason}
      </p>
      <p className="mt-1 text-sm text-ink-muted">원본과 취소 기록은 그대로 보존됩니다. 고치거나 되돌릴 수는 없습니다.</p>
      {detail.reusedBy.length > 0 && (
        <ul className="mt-2 text-sm">
          {detail.reusedBy.map((r) => (
            <li key={r.id}>
              이 안내문으로 만든 초안:{" "}
              <Link href={`/s/${schoolId}/notices/${r.id}`} className="font-bold text-accent underline underline-offset-4">
                {r.title}
              </Link>{" "}
              ({NOTICE_STATUS_META[r.status].label})
            </li>
          ))}
        </ul>
      )}
      <PrimaryButton className="mt-3" icon="file" onClick={draft ? () => navigate(`/s/${schoolId}/notices/${draft.id}`) : onReuse}>
        {draft ? "작성 중인 새 초안 열기" : "이 안내문으로 새 초안 만들기"}
      </PrimaryButton>
      <p className="mt-1 text-sm text-ink-muted">{NOTICE_GUIDE_TEXT.reuse}</p>
    </section>
  );
}

function CancelDialog({ open, detail, schoolId, onClose, onDone }: { open: boolean; detail: NoticeDetail; schoolId: string; onClose: () => void; onDone: () => void }) {
  const [reason, setReason] = useState("");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const confirm = async () => {
    if (!reason.trim()) {
      setErr("취소 사유를 입력하세요.");
      return;
    }
    setBusy(true);
    setErr(null);
    try {
      await api("POST", `/schools/${schoolId}/notices/${detail.notice.id}/cancel`, { reason: reason.trim(), expectedVersion: detail.notice.version });
      setReason("");
      onDone();
    } catch (e) {
      setErr(describeError(e).message);
    } finally {
      setBusy(false);
    }
  };
  return (
    <ConfirmDialog open={open} title="이 안내문을 취소할까요?" confirmLabel="안내문 취소" cancelLabel="닫기" loading={busy} onConfirm={() => void confirm()} onCancel={onClose}>
      <p>취소한 안내문은 고치거나 되돌릴 수 없습니다. 기록은 남고, 필요하면 내용을 복사해 새 초안을 만들 수 있습니다.</p>
      <label className="mt-3 block font-bold" htmlFor="cancel-reason">
        취소 사유
      </label>
      <input
        id="cancel-reason"
        value={reason}
        maxLength={200}
        onChange={(e) => setReason(e.target.value)}
        className="mt-1 block min-h-touch w-full rounded-control border-2 border-line-strong px-3 text-lg"
      />
      {err && (
        <p role="alert" className="mt-2 font-semibold text-danger">
          {err}
        </p>
      )}
    </ConfirmDialog>
  );
}

function ReuseDialog({ detail, schoolId, onClose }: { detail: NoticeDetail; schoolId: string; onClose: () => void }) {
  const [mode, setMode] = useState<"same" | "other">("same");
  const [alerts, setAlerts] = useState<AlertItem[] | null>(null);
  const [alertId, setAlertId] = useState("");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  useEffect(() => {
    api<{ alerts: AlertItem[] }>("GET", `/schools/${schoolId}/alerts`)
      .then((d) => setAlerts(d.alerts.filter((a) => a.result === "target")))
      .catch(() => setAlerts([]));
  }, [schoolId]);
  const confirm = async () => {
    if (mode === "other" && !alertId) {
      setErr("연결할 경보를 고르세요.");
      return;
    }
    setBusy(true);
    setErr(null);
    try {
      const r = await api<ReuseResult>("POST", `/schools/${schoolId}/notices/${detail.notice.id}/reuse`, mode === "other" ? { alertId } : {});
      onClose();
      navigate(`/s/${schoolId}/notices/${r.id}`);
    } catch (e) {
      setErr(describeError(e).message);
      setBusy(false);
    }
  };
  return (
    <ConfirmDialog open title="이 안내문으로 새 초안 만들기" confirmLabel="새 초안 만들기" tone="primary" loading={busy} onConfirm={() => void confirm()} onCancel={onClose}>
      <p>{NOTICE_GUIDE_TEXT.reuse}</p>
      <p className="mt-2 text-sm text-warning-strong">{NOTICE_GUIDE_TEXT.reusePast}</p>
      {detail.alert.cancelled && <p className="mt-2 text-sm font-bold text-warning-strong">원본에 연결된 경보는 이미 해제되었습니다.</p>}
      <fieldset className="mt-3 space-y-2">
        <legend className="font-bold">연결할 경보</legend>
        <label className="flex items-start gap-2">
          <input type="radio" name="reuse-alert" checked={mode === "same"} onChange={() => setMode("same")} className="mt-1 size-5" />
          <span>원본과 같은 경보({detail.alert.title ?? detail.alert.body.slice(0, 30)})</span>
        </label>
        <label className="flex items-start gap-2">
          <input type="radio" name="reuse-alert" checked={mode === "other"} onChange={() => setMode("other")} className="mt-1 size-5" />
          <span>다른 경보(우리 학교 대상 경보만)</span>
        </label>
        {mode === "other" && (
          <select
            value={alertId}
            onChange={(e) => setAlertId(e.target.value)}
            aria-label="연결할 경보"
            className="block min-h-touch w-full rounded-control border-2 border-line-strong bg-card px-3 text-base"
          >
            <option value="">{alerts === null ? "불러오는 중…" : "경보를 고르세요"}</option>
            {(alerts ?? []).map((a) => (
              <option key={a.alert.id} value={a.alert.id}>
                {(a.alert.title ?? a.alert.body.slice(0, 30)) + ` · ${formatDateTime(a.alert.issuedAt)}${a.cancelled ? " · 해제됨" : ""}${a.alert.msgType === "cancel" ? " · 해제 안내" : ""}`}
              </option>
            ))}
          </select>
        )}
      </fieldset>
      {err && (
        <p role="alert" className="mt-2 font-semibold text-danger">
          {err}
        </p>
      )}
    </ConfirmDialog>
  );
}

// ───────────── 수정 이력·처리 이력 ─────────────
function RevisionsPanel({ detail }: { detail: NoticeDetail }) {
  return (
    <details className="rounded-card border border-line bg-card p-4 shadow-card">
      <summary className="cursor-pointer text-lg font-bold">수정 이력 {detail.revisions.length}판</summary>
      <p className="mt-1 text-sm text-ink-muted">저장할 때마다 DB가 판 번호와 함께 자동으로 기록하며, 고치거나 지울 수 없습니다.</p>
      <ol className="mt-3 space-y-2">
        {detail.revisions.map((r) => (
          <li key={r.version} className="rounded-control border border-line p-3">
            <p className="text-sm">
              <strong>판 {r.version}</strong> · {NOTICE_STATUS_META[r.status].label} · {formatDateTime(r.changedAt)} · {r.changedByName ?? "(알 수 없음)"}
            </p>
            <details className="mt-1">
              <summary className="cursor-pointer text-sm font-bold text-accent">이 판 내용 보기</summary>
              <p className="mt-1 font-bold">{r.title}</p>
              <p className="mt-1 whitespace-pre-wrap text-sm">{r.body}</p>
            </details>
          </li>
        ))}
      </ol>
    </details>
  );
}

function RecordsPanel({ detail, schoolId, onChanged }: { detail: NoticeDetail; schoolId: string; onChanged: () => void }) {
  const { me, usableMemberships } = useSession();
  const isAdmin = usableMemberships.find((m) => m.school.id === schoolId)?.role === "admin";
  const [channel, setChannel] = useState<ChannelKey | "">("");
  const [audience, setAudience] = useState("");
  const [sent, setSent] = useState(false);
  const [sentAt, setSentAt] = useState("");
  const [memo, setMemo] = useState("");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [voidId, setVoidId] = useState<string | null>(null);
  const [voidReason, setVoidReason] = useState("");
  const cancelled = detail.notice.status === "cancelled";

  const add = async () => {
    setBusy(true);
    setErr(null);
    try {
      await api("POST", `/schools/${schoolId}/notices/${detail.notice.id}/records`, {
        channel: channel || null,
        audienceCategory: audience.trim() || null,
        sentByTeacher: sent,
        sentAt: sent && sentAt ? new Date(sentAt).toISOString() : null,
        memo: memo.trim() || null,
      });
      setChannel("");
      setAudience("");
      setSent(false);
      setSentAt("");
      setMemo("");
      onChanged();
    } catch (e) {
      const d = e instanceof ApiError && e.details?.fields ? Object.values(e.details.fields as Record<string, string>).join(" ") : describeError(e).message;
      setErr(d);
    } finally {
      setBusy(false);
    }
  };
  const doVoid = async (id: string) => {
    if (!voidReason.trim()) {
      setErr("무효 처리 사유를 입력하세요.");
      return;
    }
    setBusy(true);
    setErr(null);
    try {
      await api("POST", `/schools/${schoolId}/notices/${detail.notice.id}/records/${id}/void`, { reason: voidReason.trim() });
      setVoidId(null);
      setVoidReason("");
      onChanged();
    } catch (e) {
      setErr(describeError(e).message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <details className="rounded-card border border-line bg-card p-4 shadow-card">
      <summary className="cursor-pointer text-lg font-bold">처리 이력(선택) {detail.records.length}건</summary>
      <p className="mt-1 text-sm text-ink-muted">{NOTICE_GUIDE_TEXT.record} 학부모 이름·연락처는 적지 마세요.</p>
      {detail.records.length > 0 && (
        <ul className="mt-3 space-y-2">
          {detail.records.map((r) => (
            <li key={r.id} className={`rounded-control border border-line p-3 text-sm ${r.voidedAt ? "opacity-70" : ""}`}>
              <p>
                {r.voidedAt && <strong className="text-danger">[무효] </strong>}
                {r.channel ? CHANNEL_LABEL[r.channel] : "채널 미기록"}
                {r.audienceCategory && ` · 대상: ${r.audienceCategory}`}
                {r.sentByTeacher ? ` · 교사 입력 '발송 완료'${r.sentAt ? ` ${formatDateTime(r.sentAt)}` : ""}` : " · 발송 전"}
              </p>
              {r.memo && <p className="text-ink-muted">비고: {r.memo}</p>}
              <p className="text-ink-muted">
                기록 {r.recordedByName ?? "(알 수 없음)"} · {formatDateTime(r.recordedAt)}
                {r.voidReason && ` · 무효 사유: ${r.voidReason}`}
              </p>
              {!r.voidedAt && (r.recordedById === me?.user.id || isAdmin) && (
                voidId === r.id ? (
                  <div className="mt-2 flex flex-wrap gap-2">
                    <input
                      value={voidReason}
                      onChange={(e) => setVoidReason(e.target.value)}
                      maxLength={200}
                      aria-label="무효 처리 사유"
                      placeholder="무효 처리 사유"
                      className="min-h-touch flex-1 rounded-control border-2 border-line-strong px-3"
                    />
                    <PrimaryButton variant="danger" loading={busy} onClick={() => void doVoid(r.id)}>
                      무효 처리
                    </PrimaryButton>
                    <PrimaryButton variant="ghost" onClick={() => setVoidId(null)}>
                      닫기
                    </PrimaryButton>
                  </div>
                ) : (
                  <button type="button" onClick={() => setVoidId(r.id)} className="mt-1 min-h-touch font-bold text-danger underline underline-offset-4">
                    잘못 입력했어요(무효 처리)
                  </button>
                )
              )}
            </li>
          ))}
        </ul>
      )}
      {!cancelled ? (
        <div className="mt-4 space-y-3 border-t border-line pt-3">
          <label className="block font-bold" htmlFor="rec-channel">
            사용한 채널(기록용 분류)
          </label>
          <select
            id="rec-channel"
            value={channel}
            onChange={(e) => setChannel(e.target.value as ChannelKey | "")}
            className="block min-h-touch w-full rounded-control border-2 border-line-strong bg-card px-3 text-base"
          >
            <option value="">선택 안 함</option>
            {(Object.keys(CHANNEL_LABEL) as ChannelKey[]).map((k) => (
              <option key={k} value={k}>
                {CHANNEL_LABEL[k]}
              </option>
            ))}
          </select>
          <FormField label="대상 범주" hint="예: 전교 학부모, 3학년 학부모, 교직원 (개인 이름·연락처 금지)" value={audience} maxLength={100} onChange={(e) => setAudience(e.target.value)} />
          <label className="flex items-center gap-2 font-bold">
            <input type="checkbox" checked={sent} onChange={(e) => setSent(e.target.checked)} className="size-5" />
            교사가 직접 발송을 마쳤습니다
          </label>
          {sent && <FormField label="발송 일시(선택)" type="datetime-local" value={sentAt} onChange={(e) => setSentAt(e.target.value)} />}
          <FormField label="비고(선택)" value={memo} maxLength={500} onChange={(e) => setMemo(e.target.value)} />
          <PrimaryButton variant="secondary" loading={busy} onClick={() => void add()}>
            처리 이력 남기기
          </PrimaryButton>
        </div>
      ) : (
        <p className="mt-3 text-sm text-ink-muted">취소된 안내문에는 처리 이력을 새로 남길 수 없습니다.</p>
      )}
      {err && (
        <p role="alert" className="mt-2 font-semibold text-danger">
          {err}
        </p>
      )}
    </details>
  );
}
