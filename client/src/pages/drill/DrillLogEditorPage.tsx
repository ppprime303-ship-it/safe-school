// STEP 3-D 비상대피훈련일지 편집
// 화면 순서: 제목·작성 상태 → 원본 기록 변경 알림 → 시스템 기록(자동, 읽기 전용) → 담당자 입력 → 저장하기(작성 상태 함께) → 미리보기·내려받기 → 수정 이력
// - 시스템 기록(학급별 대피 보고)은 여기서 고치지 않습니다. 원본이 바뀌면 알리고, '다시 불러오기'를 골라야만 반영(판 +1)
// - 평가 O/X·비고·반영사항·소요 시간·교직원 인원은 담당자가 입력(자동 평가 없음)
// - '작성 완료'는 앱 안 문서 상태일 뿐 결재·보고 완료가 아님
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { api, ApiError, describeError } from "../../lib/api";
import { formatDateTime } from "../../lib/format";
import { Link } from "../../lib/router";
import { AppShell } from "../../components/layout/AppShell";
import { ErrorState, LoadingState } from "../../components/ui/States";
import { PrimaryButton } from "../../components/ui/PrimaryButton";
import { ConfirmDialog } from "../../components/ui/ConfirmDialog";
import { autoEvacSentence, buildDrillDoc, summarizeClasses, whenText, type DrillManual, type DrillSnapshot, type OX } from "@shared/drillLog";
import { DrillDocPreview } from "./DrillDocPreview";

interface Detail {
  log: { id: string; eventId: string; status: "draft" | "completed"; version: number; autoTakenAt: string; createdByName: string | null; updatedByName: string | null; updatedAt: string };
  snapshot: DrillSnapshot;
  manual: DrillManual;
  sourceChanges: string[];
  canEdit: boolean;
  revisions: { version: number; status: "draft" | "completed"; changedAt: string; changedByName: string | null }[];
}

const input = "mt-1 block min-h-touch w-full rounded-control border-2 border-line-strong bg-card px-3 text-lg";

export function DrillLogEditorPage({ schoolId, logId }: { schoolId: string; logId: string }) {
  const [d, setD] = useState<Detail | null>(null);
  const [err, setErr] = useState<ReturnType<typeof describeError> | null>(null);
  const [manual, setManual] = useState<DrillManual | null>(null);
  const [status, setStatus] = useState<"draft" | "completed">("draft");
  const [saving, setSaving] = useState(false);
  const savingRef = useRef(false);
  const [msg, setMsg] = useState<{ ok: boolean; text: string; conflict?: boolean } | null>(null);
  const [refreshAsk, setRefreshAsk] = useState(false);
  const [preview, setPreview] = useState(false);
  const [downloading, setDownloading] = useState(false);

  const load = useCallback(async () => {
    try {
      const r = await api<Detail>("GET", `/schools/${schoolId}/drill-logs/${logId}`);
      setD(r);
      setManual(r.manual);
      setStatus(r.log.status);
      setErr(null);
    } catch (e) {
      setErr(describeError(e));
    }
  }, [schoolId, logId]);
  useEffect(() => {
    void load();
  }, [load]);

  const dirty = !!d && !!manual && (JSON.stringify(manual) !== JSON.stringify(d.manual) || status !== d.log.status);
  useEffect(() => {
    if (!dirty) return;
    const warn = (e: BeforeUnloadEvent) => e.preventDefault();
    window.addEventListener("beforeunload", warn);
    return () => window.removeEventListener("beforeunload", warn);
  }, [dirty]);

  const doc = useMemo(() => (d && manual ? buildDrillDoc(d.snapshot, manual) : null), [d, manual]);
  const set = <K extends keyof DrillManual>(k: K, v: DrillManual[K]) => setManual((m) => (m ? { ...m, [k]: v } : m));

  const save = async (refreshAuto = false) => {
    if (!d || !manual || savingRef.current) return;
    if (!dirty && !refreshAuto) {
      setMsg({ ok: true, text: "바뀐 내용이 없어 저장하지 않았습니다." });
      return;
    }
    savingRef.current = true;
    setSaving(true);
    setMsg(null);
    try {
      const r = await api<{ version: number; changed: boolean }>("PATCH", `/schools/${schoolId}/drill-logs/${logId}`, { manual, status, expectedVersion: d.log.version, ...(refreshAuto ? { refreshAuto: true } : {}) });
      await load();
      setMsg({
        ok: true,
        text: !r.changed
          ? "바뀐 내용이 없어 판 번호를 올리지 않았습니다."
          : `저장했습니다(판 ${r.version})${refreshAuto ? " · 시스템 기록을 다시 불러왔습니다" : ""}${status === "completed" ? " · 작성 완료는 결재·보고 완료가 아닙니다" : ""}.`,
      });
    } catch (e) {
      if (e instanceof ApiError && e.code === "version_conflict") setMsg({ ok: false, conflict: true, text: "다른 담당자가 먼저 저장했습니다. 지금 입력한 내용을 확인해 두고 최신 내용을 불러오세요." });
      else setMsg({ ok: false, text: describeError(e).message });
    } finally {
      savingRef.current = false;
      setSaving(false);
      setRefreshAsk(false);
    }
  };

  const download = async () => {
    setDownloading(true);
    setMsg(null);
    try {
      const res = await fetch(`/api/schools/${schoolId}/drill-logs/${logId}/export.hwpx`, { credentials: "same-origin", headers: { "X-Requested-With": "safe-school" } });
      if (!res.ok) {
        const j = await res.json().catch(() => ({}));
        throw new ApiError(res.status, j.code ?? "http_error", j.message ?? "파일을 만들지 못했습니다.");
      }
      const cd = res.headers.get("Content-Disposition") ?? "";
      const name = decodeURIComponent(/filename\*=UTF-8''([^;]+)/.exec(cd)?.[1] ?? "drill-log.hwpx");
      const url = URL.createObjectURL(await res.blob());
      const a = document.createElement("a");
      a.href = url;
      a.download = name;
      document.body.appendChild(a);
      a.click();
      a.remove();
      setTimeout(() => URL.revokeObjectURL(url), 2000);
      setMsg({ ok: true, text: `${name} 내려받기${dirty ? " — 저장하지 않은 변경은 들어가지 않았습니다(저장된 판 기준)" : ""}.` });
    } catch (e) {
      setMsg({ ok: false, text: describeError(e).message });
    } finally {
      setDownloading(false);
    }
  };

  if (err) return <AppShell title="훈련일지" schoolId={schoolId}><ErrorState title={err.title} message={err.message} onRetry={() => void load()} /></AppShell>;
  if (!d || !manual || !doc) return <AppShell title="훈련일지" schoolId={schoolId}><LoadingState label="훈련일지를 불러오는 중…" /></AppShell>;

  const s = d.snapshot;
  const sum = summarizeClasses(s.classes);
  const ro = !d.canEdit;
  const autoPlace = autoEvacSentence(s.event);

  return (
    <AppShell title="훈련일지" schoolId={schoolId}>
      <div className="mx-auto max-w-3xl space-y-4 print:max-w-none">
        <nav className="flex flex-wrap gap-3 text-base font-bold print:hidden">
          <Link href={`/s/${schoolId}/drill-logs`} className="text-accent underline underline-offset-4">훈련일지 목록</Link>
        </nav>

        {/* 1. 제목·상태 */}
        <section className="rounded-card border border-line bg-card p-4 shadow-card print:hidden">
          <div className="flex flex-wrap items-center gap-2">
            <span className={`rounded-full border px-2.5 py-0.5 text-sm font-bold ${d.log.status === "completed" ? "border-success bg-success-soft text-success" : "border-warning bg-warning-soft text-warning-strong"}`}>
              {d.log.status === "completed" ? "작성 완료" : "작성 중"}
            </span>
            <span className="text-sm text-ink-muted">판 {d.log.version} · 최근 저장 {formatDateTime(d.log.updatedAt)}{d.log.updatedByName ? ` (${d.log.updatedByName})` : ""}</span>
            {dirty && <span className="rounded-full border border-warning bg-warning-soft px-2 py-0.5 text-sm font-bold text-warning-strong">저장 안 된 변경 있음</span>}
            <span className="rounded-full border-2 border-dashed border-line-strong px-2 py-0.5 text-sm font-bold">모의훈련 기록</span>
          </div>
          <h2 className="mt-2 text-xl font-extrabold">{doc.pages[0]!.title}</h2>
          <p className="text-sm text-ink-muted">{s.schoolName} · {whenText(s.event)}</p>
          {ro && <p className="mt-2 text-sm">열람 전용입니다. 훈련일지 작성·수정은 안전업무 담당이 합니다(미리보기·내려받기 가능).</p>}
        </section>

        {/* 2. 원본 기록 변경 알림 */}
        {d.sourceChanges.length > 0 && (
          <section role="alert" className="rounded-card border-2 border-warning bg-warning-soft p-4 text-warning-strong print:hidden">
            <p className="font-bold">⚠ 자동작성({formatDateTime(d.log.autoTakenAt)}) 이후 원본 기록이 바뀌었습니다. 문서에는 아직 반영하지 않았습니다.</p>
            <ul className="mt-1 list-disc pl-5 text-sm">{d.sourceChanges.map((c) => <li key={c}>{c}</li>)}</ul>
            {!ro && (
              <PrimaryButton className="mt-2" variant="secondary" disabled={saving} onClick={() => setRefreshAsk(true)}>
                시스템 기록 다시 불러오기
              </PrimaryButton>
            )}
          </section>
        )}

        {/* 3. 시스템 기록 */}
        <section className="rounded-card border border-line bg-card p-4 shadow-card print:hidden" aria-labelledby="auto-title">
          <h2 id="auto-title" className="text-lg font-bold">시스템 기록(자동 반영 · 여기서 고치지 않음)</h2>
          <dl className="mt-2 grid grid-cols-[auto_1fr] gap-x-3 gap-y-1 text-base">
            <dt className="font-semibold text-ink-muted">일시</dt><dd>{whenText(s.event)} · 발령 {s.event.issuedByName ?? "-"} · 종료 {s.event.closedByName ?? "-"}</dd>
            <dt className="font-semibold text-ink-muted">대피 장소 기록</dt><dd>{s.event.evacPlace ?? "기록 없음(직접 입력)"}</dd>
            <dt className="font-semibold text-ink-muted">학급 보고</dt>
            <dd>
              {sum.reportedCount} / {sum.total}학급 보고 · 대피 확인 {sum.evacuated}명 · 사전 파악 부재 {sum.absentKnown}명 · 미확인 {sum.unconfirmed}명 · 부상 {sum.injured}명
              {sum.unreported.length > 0 && <span className="font-bold text-danger"> · 미보고: {sum.unreported.join(", ")}</span>}
            </dd>
          </dl>
          <p className="mt-2 text-sm text-ink-muted">학생 수는 보고된 학급의 '대피 확인' 합계입니다(재적·미보고 학급 제외). 보고 시각은 대피 완료 시각이 아닙니다. 학급별 내용은 붙임에 들어갑니다.</p>
        </section>

        {/* 4. 담당자 입력 */}
        <section className="rounded-card border-2 border-warning bg-card p-4 shadow-card print:hidden" aria-labelledby="manual-title">
          <h2 id="manual-title" className="text-lg font-bold">담당자 확인·입력</h2>
          <fieldset disabled={ro} className="mt-2 space-y-4">
            <div className="grid gap-3 sm:grid-cols-2">
              <label className="block font-bold">교직원 참가 인원(명)
                <input className={input} inputMode="numeric" value={manual.staffCount} onChange={(e) => set("staffCount", e.target.value.replace(/[^\d]/g, "").slice(0, 4))} placeholder="확인 후 입력" />
              </label>
              <label className="block font-bold">총 참가 인원(명)
                <input className={input} inputMode="numeric" value={manual.totalCount} onChange={(e) => set("totalCount", e.target.value.replace(/[^\d]/g, "").slice(0, 5))} placeholder="자동 합산하지 않음" />
              </label>
            </div>
            <div>
              <p className="font-bold">역할 및 담당자</p>
              <div className="mt-1 space-y-2">
                {manual.roles.map((r, i) => (
                  <div key={i} className="grid grid-cols-[1fr_1fr_auto] gap-2">
                    <input aria-label={`역할 ${i + 1}`} className={input} value={r.part} maxLength={60} onChange={(e) => set("roles", manual.roles.map((x, j) => (j === i ? { ...x, part: e.target.value } : x)))} />
                    <input aria-label={`역할 ${i + 1} 담당자`} className={input} value={r.who} maxLength={60} placeholder="직책명 권장(실명 지양)" onChange={(e) => set("roles", manual.roles.map((x, j) => (j === i ? { ...x, who: e.target.value } : x)))} />
                    <button type="button" aria-label={`역할 ${i + 1} 지우기`} disabled={manual.roles.length <= 1} onClick={() => set("roles", manual.roles.filter((_, j) => j !== i))} className="min-h-touch min-w-touch rounded-control border-2 border-line-strong px-2 font-bold disabled:opacity-40">−</button>
                  </div>
                ))}
              </div>
              {manual.roles.length < 10 && <PrimaryButton className="mt-2" variant="ghost" onClick={() => set("roles", [...manual.roles, { part: "", who: "" }])}>역할 추가</PrimaryButton>}
            </div>
            <label className="block font-bold">훈련 개요(보충 설명)
              <textarea className={`${input} py-2`} rows={2} maxLength={300} value={manual.trainingNote} onChange={(e) => set("trainingNote", e.target.value)} placeholder="예) 사전 안전교육 후 1차 경보 대피, 2차 경보 운동장 대피" />
            </label>
            <label className="block font-bold">대피(집결) 장소 문장
              <input className={input} maxLength={200} value={manual.evacPlaceText} onChange={(e) => set("evacPlaceText", e.target.value)} placeholder={autoPlace || "기록된 대피 장소가 없습니다 — 직접 입력"} />
              <span className="mt-0.5 block text-sm font-normal text-ink-muted">비워 두면 {autoPlace ? `'${autoPlace}'(기록 기준)` : "빈칸"}으로 들어갑니다.</span>
            </label>
            <label className="block font-bold">대피 소요 시간(측정값)
              <input className={input} maxLength={40} value={manual.durationText} onChange={(e) => set("durationText", e.target.value)} placeholder="예) 6분 51초 — 자동 계산하지 않음" />
            </label>
            <div>
              <p className="font-bold">평가(O/X는 담당자 판단)</p>
              <div className="mt-1 space-y-2">
                {manual.evals.map((ev, i) => (
                  <div key={i} className="rounded-control border border-line p-2">
                    <p className="font-semibold">▪ {ev.item}</p>
                    <div className="mt-1 flex flex-wrap items-center gap-2">
                      <div role="radiogroup" aria-label={`${ev.item} 평가 결과`} className="flex gap-1">
                        {(["O", "X", ""] as OX[]).map((v) => (
                          <label key={v || "none"} className={`flex min-h-touch cursor-pointer items-center gap-1 rounded-control border-2 px-3 font-bold focus-within:outline focus-within:outline-3 focus-within:outline-accent ${ev.result === v ? "border-brand bg-brand-soft text-brand" : "border-line-strong"}`}>
                            <input type="radio" name={`ev${i}`} checked={ev.result === v} onChange={() => set("evals", manual.evals.map((x, j) => (j === i ? { ...x, result: v } : x)))} className="size-4" />
                            {v || "미평가"}
                          </label>
                        ))}
                      </div>
                      <input aria-label={`${ev.item} 비고`} className={`${input} mt-0 min-w-48 flex-1`} maxLength={80} value={ev.note} placeholder="비고" onChange={(e) => set("evals", manual.evals.map((x, j) => (j === i ? { ...x, note: e.target.value } : x)))} />
                    </div>
                  </div>
                ))}
              </div>
            </div>
            <label className="block font-bold">추후 대피훈련 시 반영사항
              <textarea className={`${input} py-2`} rows={4} maxLength={1000} value={manual.improvements} onChange={(e) => set("improvements", e.target.value)} />
            </label>
            <p className="text-sm text-ink-muted">활동 사진은 내려받은 한글 파일의 사진 칸에 직접 넣으세요(앱에 저장하지 않음).</p>
          </fieldset>
        </section>

        {/* 5. 저장·출력 */}
        <section className="rounded-card border border-line bg-card p-4 shadow-card print:hidden">
          {!ro && (
            <div className="rounded-control border-2 border-line bg-page p-3">
              <fieldset>
                <legend className="font-bold">작성 상태</legend>
                <div className="mt-2 grid grid-cols-2 gap-2">
                  {(["draft", "completed"] as const).map((st) => (
                    <label key={st} className={`flex min-h-touch cursor-pointer items-center gap-2 rounded-control border-2 px-3 font-bold focus-within:outline focus-within:outline-3 focus-within:outline-accent ${status === st ? "border-brand bg-brand-soft text-brand" : "border-line-strong"}`}>
                      <input type="radio" name="drill-status" checked={status === st} onChange={() => setStatus(st)} className="size-5" />
                      {st === "draft" ? "작성 중" : "작성 완료"}
                    </label>
                  ))}
                </div>
                <p className="mt-2 text-sm text-ink-muted">'작성 완료'는 앱 안의 문서 상태입니다. K-에듀파인 결재나 보고가 끝났다는 뜻이 아닙니다.</p>
              </fieldset>
              <PrimaryButton className="mt-3" size="lg" fullWidth icon="check" loading={saving} loadingText="저장 중…" disabled={!dirty} onClick={() => void save()}>
                저장하기
              </PrimaryButton>
              {!dirty && !saving && <p className="mt-1 text-center text-sm text-ink-muted">저장할 변경 사항이 없습니다.</p>}
            </div>
          )}
          {msg && (
            <div role={msg.ok ? "status" : "alert"} className={`mt-3 rounded-control border-2 px-3 py-2 font-semibold ${msg.ok ? "border-accent bg-accent-soft text-accent" : "border-danger bg-danger-soft text-danger"}`}>
              {msg.ok ? "✓ " : ""}{msg.text}
              {msg.conflict && <PrimaryButton className="mt-2" variant="secondary" icon="refresh" onClick={() => void load()}>최신 내용 불러오기(화면의 입력은 사라짐)</PrimaryButton>}
            </div>
          )}
          <div className="mt-3 grid gap-2 sm:grid-cols-3">
            <PrimaryButton variant="secondary" icon="file" loading={downloading} loadingText="만드는 중…" onClick={() => void download()}>한글(HWPX) 내려받기</PrimaryButton>
            <PrimaryButton variant="secondary" onClick={() => setPreview((p) => !p)} aria-expanded={preview}>{preview ? "미리보기 닫기" : "미리보기"}</PrimaryButton>
            <PrimaryButton variant="ghost" onClick={() => { setPreview(true); setTimeout(() => window.print(), 50); }}>인쇄 / PDF로 저장</PrimaryButton>
          </div>
          <p className="mt-2 text-sm text-ink-muted">HWPX는 저장된 판으로 만듭니다. 한글에서 열어 사진을 넣고 마무리한 뒤 K-에듀파인 결재 문서에 직접 첨부하세요. PDF는 브라우저 인쇄 기능으로 만드는 보조 출력입니다.</p>
        </section>

        {preview && <DrillDocPreview doc={doc} />}

        <details className="rounded-card border border-line bg-card p-4 shadow-card print:hidden">
          <summary className="cursor-pointer text-lg font-bold">수정 이력 {d.revisions.length}판</summary>
          <ol className="mt-2 space-y-1 text-sm">
            {d.revisions.map((r) => (
              <li key={r.version}>판 {r.version} · {r.status === "completed" ? "작성 완료" : "작성 중"} · {formatDateTime(r.changedAt)} · {r.changedByName ?? "(알 수 없음)"}</li>
            ))}
          </ol>
        </details>
      </div>

      <ConfirmDialog open={refreshAsk} title="시스템 기록을 다시 불러올까요?" confirmLabel="다시 불러와 저장" tone="primary" loading={saving} onConfirm={() => void save(true)} onCancel={() => setRefreshAsk(false)}>
        <p>학급별 대피 보고 등 자동 항목을 지금 기록으로 바꾸고 새 판으로 저장합니다. 담당자 입력값은 그대로 두며, 이전 판은 수정 이력에 남습니다.</p>
      </ConfirmDialog>
    </AppShell>
  );
}
