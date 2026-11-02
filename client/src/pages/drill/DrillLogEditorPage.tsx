// STEP 3-D 비상대피훈련일지 편집
// 화면 순서: 제목·작성 상태 → 원본 기록 변경 알림 → 시스템 기록(자동, 읽기 전용) → 담당자 입력 → 저장하기(작성 상태 함께) → 미리보기·내려받기 → 수정 이력
// - 시스템 기록(학급별 대피 보고)은 여기서 고치지 않습니다. 원본이 바뀌면 알리고, '다시 불러오기'를 골라야만 반영(판 +1)
// - 평가 O/X·비고·반영사항·소요 시간·교직원/학생 참가 인원은 담당자가 입력(자동 평가 없음)
// - 학생 대피 확인 수는 시스템(보고 학급 합)으로 표시, 미보고는 0이 아니라 '미보고'. 총 참가는 확인된 값만으로(shared/drillLog participantCounts)
// - 역할 담당자는 교직원 명단에서 고르거나(여러 명) 직접 입력 — 저장 형식은 기존과 같은 문자열
// - 입력한 문장(대피 장소 등)은 자동으로 고치지 않음. 오탈자 의심만 안내
// - PC(lg 이상)는 넓게: 참가 인원 4칸, 역할 한 줄 배치, 평가 2열. 모바일은 1열
// - '작성 완료'는 앱 안 문서 상태일 뿐 결재·보고 완료가 아님
// Beta PILOT 2 Phase 4: 같은 화면으로 실제 재난 '재난대피일지'도 작성(서식은 서버가 사건 mode 로 결정)
// - 실제 재난: 같은 칸·순서, 표제어만 다름. 교직원 이름을 적지 않음(명단 선택 없음, 개인정보 검사), 교직원 소재는 익명 집계만 표시
// - 진행 중 사건은 '작성 중'만, 완료(최종본)는 종료 후 종료 기록으로 다시 불러온 뒤. 최종본이 아니면 미리보기·인쇄에 '작성 중 초안' 표시
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { api, ApiError, describeError } from "../../lib/api";
import { formatDateTime } from "../../lib/format";
import { Link } from "../../lib/router";
import { AppShell } from "../../components/layout/AppShell";
import { ErrorState, LoadingState } from "../../components/ui/States";
import { PrimaryButton } from "../../components/ui/PrimaryButton";
import { ConfirmDialog } from "../../components/ui/ConfirmDialog";
import { autoEvacSentence, buildDrillDoc, defaultManual, editorLabels, markDraft, participantCounts, summarizeClasses, timeBasisNote, whenText, type DrillManual, type DrillSnapshot, type OX } from "@shared/drillLog";
import { DrillDocPreview } from "./DrillDocPreview";
import { StaffPicker, WHO_MAX, type StaffEntry } from "./StaffPicker";

interface Detail {
  log: {
    id: string;
    eventId: string;
    status: "draft" | "completed";
    version: number;
    autoTakenAt: string;
    createdByName: string | null;
    updatedByName: string | null;
    createdAt: string;
    updatedAt: string;
    // Phase 4
    mode?: "drill" | "real";
    eventStatus?: "active" | "closed";
    final?: boolean;
    refreshNeeded?: boolean;
    privacyIssues?: string[];
  };
  snapshot: DrillSnapshot;
  manual: DrillManual;
  sourceChanges: string[];
  canEdit: boolean;
  revisions: { version: number; status: "draft" | "completed"; changedAt: string; changedByName: string | null }[];
}

const input = "mt-1 block min-h-touch w-full rounded-control border-2 border-line-strong bg-card px-3 text-lg";
const hint = "mt-1 block text-sm font-normal text-ink-muted";

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
  const [dlMsg, setDlMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const [pickFor, setPickFor] = useState<number | null>(null);
  const [staff, setStaff] = useState<StaffEntry[] | null>(null);
  const [staffErr, setStaffErr] = useState<string | null>(null);

  const openPicker = (i: number) => {
    setPickFor(i);
    if (staff || staffErr) return;
    api<{ staff: StaffEntry[] }>("GET", `/schools/${schoolId}/drill-log-staff`)
      .then((r) => setStaff(r.staff))
      .catch((e) => setStaffErr(`명단을 불러오지 못했습니다(${describeError(e).message}). 입력칸에 직접 적으세요.`));
  };

  const load = useCallback(async () => {
    try {
      const r = await api<Detail>("GET", `/schools/${schoolId}/drill-logs/${logId}`);
      const m = { ...defaultManual(), ...r.manual }; // 이전 저장본에 없는 항목(학생 참가 등)은 빈칸으로
      setD({ ...r, manual: m });
      setManual(m);
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

  const doc = useMemo(() => {
    if (!d || !manual) return null;
    const built = buildDrillDoc(d.snapshot, manual);
    return d.log.final && !dirty ? built : markDraft(built); // 최종본이 아니면(또는 저장 전 변경이 있으면) 초안 표시
  }, [d, manual, dirty]);
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
      const withRefresh = refreshAuto || (status === "completed" && !!d.log.refreshNeeded); // 종료 전에 불러온 기록이면 완료할 때 종료 기록으로 다시 불러옴
      const r = await api<{ version: number; changed: boolean }>("PATCH", `/schools/${schoolId}/drill-logs/${logId}`, { manual, status, expectedVersion: d.log.version, ...(withRefresh ? { refreshAuto: true } : {}) });
      await load();
      setMsg({
        ok: true,
        text: !r.changed
          ? "바뀐 내용이 없어 판 번호를 올리지 않았습니다."
          : `저장했습니다(판 ${r.version})${refreshAuto ? " · 시스템 기록을 다시 불러왔습니다" : ""}${status === "completed" ? " · 작성 완료는 결재·보고 완료가 아닙니다" : ""}.`,
      });
    } catch (e) {
      if (e instanceof ApiError && e.code === "version_conflict") setMsg({ ok: false, conflict: true, text: "다른 담당자가 먼저 저장했습니다. 지금 입력한 내용을 확인해 두고 최신 내용을 불러오세요." });
      else if (e instanceof ApiError && e.code === "privacy_check_failed") setMsg({ ok: false, text: `${e.message} (${((e.details?.issues as string[] | undefined) ?? []).join(", ")})` });
      else setMsg({ ok: false, text: describeError(e).message });
    } finally {
      savingRef.current = false;
      setSaving(false);
      setRefreshAsk(false);
    }
  };

  const download = async () => {
    setDownloading(true);
    setDlMsg(null);
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
      setDlMsg({ ok: true, text: `${name} 내려받기(판 ${d?.log.version ?? "-"})${dirty ? " — 저장하지 않은 변경은 들어가지 않았습니다" : ""}.` });
    } catch (e) {
      setDlMsg({ ok: false, text: describeError(e).message });
    } finally {
      setDownloading(false);
    }
  };

  if (err) return <AppShell title="훈련일지·재난대피일지" schoolId={schoolId}><ErrorState title={err.title} message={err.message} onRetry={() => void load()} /></AppShell>;
  if (!d || !manual || !doc) return <AppShell title="훈련일지·재난대피일지" schoolId={schoolId}><LoadingState label="보고서를 불러오는 중…" /></AppShell>;

  const s = d.snapshot;
  const sum = summarizeClasses(s.classes);
  const ro = !d.canEdit;
  const autoPlace = autoEvacSentence(s.event);
  const pc = participantCounts(s, manual);
  const recordedPlace = s.event.evacPlace?.trim() ?? "";
  const placeTypo = !!recordedPlace && !!manual.evacPlaceText.trim() && !manual.evacPlaceText.includes(recordedPlace);
  const unsavedForExport = dirty;
  const real = (d.log.mode ?? s.event.mode) === "real";
  const active = d.log.eventStatus === "active";
  const L = editorLabels(real ? "real" : "drill");
  const missingWords = pc.missing.map((m) => (m === "학생 참가" ? L.studentWord : m));
  const privacy = d.log.privacyIssues ?? [];

  return (
    <AppShell title={L.page} schoolId={schoolId}>
      <div className="mx-auto max-w-3xl space-y-4 text-base leading-relaxed lg:max-w-6xl print:max-w-none">
        <nav className="flex flex-wrap gap-3 text-base font-bold print:hidden">
          <Link href={`/s/${schoolId}/drill-logs`} className="inline-flex min-h-touch items-center text-accent underline underline-offset-4">훈련일지·재난대피일지 목록</Link>
        </nav>

        {/* 1. 제목·상태 */}
        <section className="rounded-card border border-line bg-card p-4 shadow-card print:hidden">
          <div className="flex flex-wrap items-center gap-2">
            <span className={`rounded-full border px-2.5 py-0.5 text-sm font-bold ${d.log.status === "completed" ? "border-success bg-success-soft text-success" : "border-warning bg-warning-soft text-warning-strong"}`}>
              {d.log.status === "completed" ? "작성 완료" : "작성 중"}
            </span>
            <span className="text-sm text-ink-muted">판 {d.log.version} · 최근 저장 {formatDateTime(d.log.updatedAt)}</span>
            {dirty && <span className="rounded-full border border-warning bg-warning-soft px-2 py-0.5 text-sm font-bold text-warning-strong">저장 안 된 변경 있음</span>}
            {real ? (
              <span className="rounded-full bg-danger px-2 py-0.5 text-sm font-bold text-white">실제 재난 기록</span>
            ) : (
              <span className="rounded-full border-2 border-dashed border-line-strong px-2 py-0.5 text-sm font-bold">모의훈련 기록</span>
            )}
            <span className={`rounded-full px-2 py-0.5 text-sm font-bold ${d.log.final ? "bg-success text-white" : "border border-line-strong"}`}>{d.log.final ? "최종본" : "작성 중 초안"}</span>
          </div>
          <h2 className="mt-2 text-xl font-extrabold">{doc.pages[0]!.title}</h2>
          <p className="text-sm text-ink-muted">{s.schoolName} · {whenText(s.event)}</p>
          {/* 확정 정책: 시스템 작성·수정자 정보는 권한 있는 사람의 이 상세 화면에서만(PDF·HWPX·인쇄본에는 싣지 않음) */}
          <dl className="mt-2 grid gap-x-4 gap-y-0.5 text-sm sm:grid-cols-[auto_1fr]" aria-label="보고서 관리 정보(출력물에는 포함되지 않음)">
            <dt className="font-bold">최초 작성</dt>
            <dd>{d.log.createdByName ?? "(알 수 없음)"} · {formatDateTime(d.log.createdAt)}</dd>
            <dt className="font-bold">최종 수정</dt>
            <dd>{d.log.updatedByName ?? "(알 수 없음)"} · {formatDateTime(d.log.updatedAt)}</dd>
            <dt className="font-bold">판·상태</dt>
            <dd>판 {d.log.version} · {d.log.status === "completed" ? "작성 완료" : "작성 중"}</dd>
          </dl>
          <p className="text-sm text-ink-muted">작성·수정자 정보는 학교 내부 관리용이며 PDF·한글 파일·인쇄본에는 들어가지 않습니다.</p>
          {ro &&<p className="mt-2 text-sm">열람 전용입니다. {real ? "재난대피일지 작성·수정은 학교 관리자·안전업무 담당이 합니다" : "훈련일지 작성·수정은 안전업무 담당이 합니다"}(미리보기·인쇄 가능).</p>}
        </section>

        {/* Phase 4: 진행 중·종료 기록 다시 불러오기·개인정보 검사 */}
        {active && (
          <section role="note" className="rounded-card border-2 border-warning bg-warning-soft p-4 font-semibold text-warning-strong print:hidden">
            진행 중인 상황입니다. 지금은 '작성 중'으로만 저장할 수 있고, 최종본(작성 완료·최종 PDF)은 상황이 종료된 뒤 종료 기록으로 다시 불러와 만듭니다.
          </section>
        )}
        {d.log.refreshNeeded && (
          <section role="note" className="rounded-card border-2 border-accent bg-accent-soft p-4 print:hidden">
            <p className="font-bold">상황이 종료되었습니다. 자동 기록이 종료 전에 불러온 것입니다.</p>
            <p className="text-sm">'작성 완료'로 저장하면 종료 기록으로 다시 불러온 뒤 완료합니다. 지금 바로 다시 불러올 수도 있습니다.</p>
            {!ro && <PrimaryButton className="mt-2" variant="secondary" disabled={saving} onClick={() => setRefreshAsk(true)}>종료 기록으로 다시 불러오기</PrimaryButton>}
          </section>
        )}
        {privacy.length > 0 && (
          <section role="alert" className="rounded-card border-2 border-danger bg-danger-soft p-4 text-danger print:hidden">
            <p className="font-bold">출력 문서에 개인정보로 보이는 내용이 있습니다(저장된 판 기준). 고치기 전에는 작성 완료·한글 내려받기를 할 수 없습니다.</p>
            <ul className="mt-1 list-disc pl-5 text-sm">{privacy.map((x) => <li key={x}>{x}</li>)}</ul>
            {real && <p className="mt-1 text-sm">실제 재난의 재난대피일지에는 교직원 이름을 적지 않습니다. 직위·부서로 적어 주세요.</p>}
          </section>
        )}

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
          <dl className="mt-2 grid grid-cols-[auto_1fr] gap-x-4 gap-y-2 text-base">
            <dt className="font-semibold text-ink-muted">일시</dt><dd>{whenText(s.event)}{!real && <> · 발령 {s.event.issuedByName ?? "-"} · 종료 {s.event.closedByName ?? "-"}</>}<span className="block text-sm text-ink-muted">{timeBasisNote(real ? "real" : "drill")}</span></dd>
            <dt className="font-semibold text-ink-muted">대피 장소 기록</dt><dd>{s.event.evacPlace ?? "기록 없음(직접 입력)"}</dd>
            <dt className="font-semibold text-ink-muted">학급 보고</dt>
            <dd>
              {sum.reportedCount} / {sum.total}학급 보고 · 대피 확인 {sum.evacuated}명 · 사전 파악 부재 {sum.absentKnown}명 · 미확인 {sum.unconfirmed}명 · 부상 {sum.injured}명
              {sum.unreported.length > 0 && <span className="font-bold text-danger"> · 미보고: {sum.unreported.join(", ")}</span>}
            </dd>
            {s.incidents !== undefined && (
              <>
                <dt className="font-semibold text-ink-muted">현장 제보</dt>
                <dd>
                  {s.incidents.length}건 · 조치 완료 {s.incidents.filter((i) => i.statusLabel === "조치 완료").length}건 · 조치 기록 {s.incidents.reduce((n, i) => n + i.actionCount, 0)}건
                  <span className="block text-sm text-ink-muted">제보자 이름 없이, 자유 기재의 교직원 이름·전화번호는 가려서 붙임 2에 들어갑니다{s.maskedCount ? `(가림 ${s.maskedCount}곳)` : ""}.</span>
                </dd>
              </>
            )}
            {real && (
              <>
                <dt className="font-semibold text-ink-muted">교직원 소재(익명)</dt>
                <dd>
                  {s.presence
                    ? `대상 ${s.presence.targetCount}명 · 응답 ${s.presence.respondedCount} · 미응답 ${s.presence.notRespondedCount} · 교내 ${s.presence.onCampus} · 교외 ${s.presence.offCampus} · 지원 가능 ${s.presence.available}`
                    : "집계 없음"}
                  <span className="block text-sm text-ink-muted">이름·위치·미응답자 명단은 보고서에 넣지 않습니다(숫자만, 붙임 3).</span>
                </dd>
              </>
            )}
          </dl>
          <p className="mt-2 text-sm text-ink-muted">학생 수는 보고된 학급의 '대피 확인' 합계입니다(재적·미보고 학급 제외). 보고 시각은 대피 완료 시각이 아닙니다. 학급별 내용은 붙임에 들어갑니다.</p>
        </section>

        {/* 4. 담당자 입력 */}
        <section className="rounded-card border-2 border-warning bg-card p-4 shadow-card print:hidden" aria-labelledby="manual-title">
          <h2 id="manual-title" className="text-lg font-bold">담당자 확인·입력</h2>
          <fieldset disabled={ro} className="mt-2 space-y-4">
            <div>
              <p className="font-bold">{L.people}</p>
              <div className="mt-1 grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
                <label className="block font-bold">{L.staff}
                  <input className={input} inputMode="numeric" value={manual.staffCount} onChange={(e) => set("staffCount", e.target.value.replace(/[^\d]/g, "").slice(0, 4))} placeholder="확인 후 입력" />
                  <span className={hint}>담당자가 확인해 입력합니다.</span>
                </label>
                <label className="block font-bold">{L.student}
                  <input className={input} inputMode="numeric" value={manual.studentCount} onChange={(e) => set("studentCount", e.target.value.replace(/[^\d]/g, "").slice(0, 5))} placeholder={L.studentPlaceholder} />
                  <span className={hint}>{L.studentHint}</span>
                  {!ro && !manual.studentCount && pc.evacComplete && pc.unconfirmed === 0 && pc.evacuated !== null && (
                    <button type="button" className="mt-1 min-h-touch rounded-control border-2 border-accent px-3 text-sm font-bold text-accent" onClick={() => set("studentCount", String(pc.evacuated))}>
                      대피 확인 {pc.evacuated}명을 넣기(전 학급 보고됨)
                    </button>
                  )}
                </label>
                <div className="font-bold" aria-live="polite">학생 대피 확인(시스템)
                  <p className="mt-1 flex min-h-touch items-center rounded-control border-2 border-dashed border-line-strong bg-page px-3 text-lg">
                    {pc.evacuated === null ? "보고 없음" : `${pc.evacuated}명`}
                  </p>
                  <span className={hint}>
                    {pc.evacuated === null ? "학급 대피 보고가 없어 0명으로 표시하지 않습니다." : `보고 ${pc.reportedCount}/${pc.classCount}개 학급 합계`}
                    {pc.unreported.length > 0 && <strong className="block text-danger">미보고 {pc.unreported.length}개 학급은 합계에서 뺐습니다.</strong>}
                    {pc.unconfirmed > 0 && <strong className="block text-warning-strong">소재 미확인 {pc.unconfirmed}명(별도).</strong>}
                  </span>
                </div>
                <label className="block font-bold">{L.total}
                  <input className={input} inputMode="numeric" value={manual.totalCount} onChange={(e) => set("totalCount", e.target.value.replace(/[^\d]/g, "").slice(0, 5))} placeholder={pc.totalAuto !== null ? `자동 ${pc.totalAuto}` : "확인 필요"} />
                  <span className={hint}>
                    {pc.totalSource === "auto" && `교직원 + ${L.studentWord} = ${pc.totalAuto}명(자동). 직접 입력하면 그 값을 씁니다.`}
                    {pc.totalSource === "none" && `${missingWords.join("·")} 인원을 입력하면 자동 계산합니다. 그 전에는 문서에 빈칸으로 둡니다.`}
                    {pc.totalSource === "manual" && (pc.totalAuto !== null && pc.totalAuto !== pc.total
                      ? <strong className="text-warning-strong">직접 입력값입니다. 교직원 + {L.studentWord} 합({pc.totalAuto}명)과 다릅니다 — 확인하세요.</strong>
                      : "직접 입력값을 씁니다.")}
                  </span>
                </label>
              </div>
            </div>
            <div>
              <p className="font-bold">역할 및 담당자</p>
              <p className="text-sm text-ink-muted">
                {real
                  ? "실제 재난의 재난대피일지에는 교직원 이름을 적지 않습니다. '안전업무 담당', '각 반 담임교사'처럼 직위·부서로 적으세요."
                  : "'명단에서 선택'으로 우리 학교 교직원을 여러 명 고를 수 있습니다. 명단에 없는 사람(외부 인력)이나 \"각 반 담임교사\" 같은 표현은 직접 입력하세요."}
              </p>
              <div className="mt-2 space-y-3 lg:space-y-2">
                <div className="hidden gap-2 px-1 text-sm font-bold text-ink-muted lg:grid lg:grid-cols-[minmax(0,1fr)_minmax(0,1.4fr)_auto_auto]" aria-hidden="true">
                  <span>구분</span><span>담당자</span><span className="w-32" /><span className="min-w-touch" />
                </div>
                {manual.roles.map((r, i) => (
                  <div key={i} className="grid grid-cols-[minmax(0,1fr)_auto] gap-2 rounded-control border border-line p-2 lg:grid-cols-[minmax(0,1fr)_minmax(0,1.4fr)_auto_auto] lg:border-0 lg:p-0">
                    <input aria-label={`역할 ${i + 1}`} className={`${input} mt-0`} value={r.part} maxLength={60} onChange={(e) => set("roles", manual.roles.map((x, j) => (j === i ? { ...x, part: e.target.value } : x)))} />
                    <button type="button" aria-label={`역할 ${i + 1} 지우기`} disabled={manual.roles.length <= 1} onClick={() => set("roles", manual.roles.filter((_, j) => j !== i))} className="min-h-touch min-w-touch rounded-control border-2 border-line-strong px-2 font-bold disabled:opacity-40 lg:order-last">−</button>
                    <input aria-label={`역할 ${i + 1} 담당자`} className={`${input} col-span-2 mt-0 lg:col-span-1`} value={r.who} maxLength={WHO_MAX} placeholder={real ? "직위·부서(이름 없이)" : "명단에서 선택 또는 직접 입력"} onChange={(e) => set("roles", manual.roles.map((x, j) => (j === i ? { ...x, who: e.target.value } : x)))} />
                    {!ro && !real && (
                      <button type="button" onClick={() => openPicker(i)} className="col-span-2 min-h-touch rounded-control border-2 border-brand px-3 font-bold text-brand lg:col-span-1 lg:w-32">
                        명단에서 선택
                      </button>
                    )}
                  </div>
                ))}
              </div>
              {manual.roles.length < 10 && <PrimaryButton className="mt-2" variant="ghost" onClick={() => set("roles", [...manual.roles, { part: "", who: "" }])}>역할 추가</PrimaryButton>}
            </div>
            <label className="block font-bold">{L.overview}
              <textarea className={`${input} py-2`} rows={2} maxLength={300} value={manual.trainingNote} onChange={(e) => set("trainingNote", e.target.value)} placeholder={L.overviewPlaceholder} />
            </label>
            <label className="block font-bold">대피(집결) 장소 문장
              <input className={input} maxLength={200} value={manual.evacPlaceText} onChange={(e) => set("evacPlaceText", e.target.value)} placeholder={autoPlace || "기록된 대피 장소가 없습니다 — 직접 입력"} />
              <span className={hint}>비워 두면 {autoPlace ? `'${autoPlace}'(기록 기준)` : "빈칸"}으로 들어갑니다. 입력한 문장은 고치지 않고 그대로 문서에 넣습니다.</span>
              {placeTypo && (
                <span role="note" className="mt-1 block rounded-control border-2 border-warning bg-warning-soft px-3 py-2 text-sm font-semibold text-warning-strong">
                  문장에 기록된 대피 장소({recordedPlace})가 들어 있지 않습니다. 오탈자가 없는지 확인하세요(자동으로 고치지 않습니다).
                </span>
              )}
            </label>
            <label className="block font-bold lg:max-w-xl">대피 소요 시간(측정값)
              <input className={input} maxLength={40} value={manual.durationText} onChange={(e) => set("durationText", e.target.value)} placeholder="예) 6분 51초 — 자동 계산하지 않음" />
              <span className={hint}>측정한 대피 소요 시간을 그대로 적습니다. 일시의 '총 시간'(발령~종료)이나 학급 보고 저장 시각으로 계산하지 않습니다.</span>
            </label>
            <div>
              <p className="font-bold">{L.evals}</p>
              <div className="mt-1 grid gap-2 lg:grid-cols-2">
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
            <label className="block font-bold">{L.improve}
              <textarea className={`${input} py-2`} rows={4} maxLength={1000} value={manual.improvements} onChange={(e) => set("improvements", e.target.value)} />
            </label>
            <p className="text-sm text-ink-muted">활동 사진은 내려받은 한글 파일의 사진 칸에 직접 넣으세요(앱에 저장하지 않음).</p>
          </fieldset>
        </section>

        {/* 5. 저장 */}
        <section className="rounded-card border border-line bg-card p-4 shadow-card print:hidden" aria-labelledby="save-title">
          <h2 id="save-title" className="text-lg font-bold">저장</h2>
          {ro && <p className="mt-1 text-sm text-ink-muted">열람 전용입니다.</p>}
          {!ro && (
            <div className="rounded-control border-2 border-line bg-page p-3">
              <fieldset>
                <legend className="font-bold">작성 상태</legend>
                <div className="mt-2 grid grid-cols-2 gap-2">
                  {(["draft", "completed"] as const).map((st) => (
                    <label key={st} className={`flex min-h-touch cursor-pointer items-center gap-2 rounded-control border-2 px-3 font-bold focus-within:outline focus-within:outline-3 focus-within:outline-accent ${status === st ? "border-brand bg-brand-soft text-brand" : "border-line-strong"} ${st === "completed" && active ? "opacity-50" : ""}`}>
                      <input type="radio" name="drill-status" checked={status === st} disabled={st === "completed" && active} onChange={() => setStatus(st)} className="size-5" />
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
        </section>

        {/* 6. 문서 출력(저장과 구분) */}
        <section className="rounded-card border-2 border-dashed border-line-strong bg-page p-4 print:hidden" aria-labelledby="out-title">
          <h2 id="out-title" className="text-lg font-bold">문서 출력 <span className="text-base font-semibold text-ink-muted">· 저장된 판 {d.log.version} 기준</span></h2>
          {unsavedForExport && <p role="note" className="mt-1 font-semibold text-warning-strong">저장하지 않은 변경은 한글 파일에 들어가지 않습니다. 먼저 '저장하기'를 누르세요.</p>}
          <div className="mt-3 grid gap-2 sm:grid-cols-3">
            <PrimaryButton variant="secondary" icon="file" loading={downloading} loadingText="만드는 중…" onClick={() => void download()}>한글(HWPX) 내려받기</PrimaryButton>
            <PrimaryButton variant="secondary" onClick={() => setPreview((p) => !p)} aria-expanded={preview}>{preview ? "미리보기 닫기" : "미리보기"}</PrimaryButton>
            <PrimaryButton variant="ghost" onClick={() => { setPreview(true); setTimeout(() => window.print(), 50); }}>인쇄 / PDF로 저장(A4)</PrimaryButton>
          </div>
          {dlMsg && (
            <div role={dlMsg.ok ? "status" : "alert"} className={`mt-3 rounded-control border-2 px-3 py-2 font-semibold ${dlMsg.ok ? "border-accent bg-accent-soft text-accent" : "border-danger bg-danger-soft text-danger"}`}>
              {dlMsg.ok ? "✓ " : ""}{dlMsg.text}
            </div>
          )}
          <p className="mt-2 text-sm text-ink-muted">HWPX는 저장된 판으로 만듭니다. 한글에서 열어 사진을 넣고 마무리한 뒤 K-에듀파인 결재 문서에 직접 첨부하세요. PDF는 브라우저 인쇄 창에서 대상 '<strong>PDF로 저장</strong>', 용지 A4, 여백 없음, 배경 그래픽 켬, 머리글·바닥글 끔으로 저장합니다.</p>
          {!d.log.final && <p className="mt-1 text-sm font-semibold text-warning-strong">최종본이 아니어서 문서 부제와 파일 이름에 '작성 중 초안'이 표시됩니다.</p>}
        </section>

        {preview && <DrillDocPreview doc={doc} />}

        <details className="rounded-card border border-line bg-card p-4 shadow-card print:hidden">
          <summary className="cursor-pointer py-2.5 text-lg font-bold">수정 이력 {d.revisions.length}판</summary>
          <p className="mt-1 text-sm text-ink-muted">내용이 바뀌어 저장될 때만 판 번호가 올라갑니다. 이전 판은 고치거나 지울 수 없습니다.</p>
          <ol className="mt-2 space-y-1 text-sm">
            {d.revisions.map((r) => (
              <li key={r.version}>판 {r.version}{r.version === d.log.version ? " (현재 판 · 한글 파일 기준)" : ""} · {r.status === "completed" ? "작성 완료" : "작성 중"} · {formatDateTime(r.changedAt)} · {r.changedByName ?? "(알 수 없음)"}</li>
            ))}
          </ol>
        </details>
      </div>

      <StaffPicker
        open={pickFor !== null}
        roleName={pickFor !== null ? manual.roles[pickFor]?.part ?? "" : ""}
        who={pickFor !== null ? manual.roles[pickFor]?.who ?? "" : ""}
        staff={staff}
        loadError={staffErr}
        onApply={(who) => pickFor !== null && set("roles", manual.roles.map((x, j) => (j === pickFor ? { ...x, who } : x)))}
        onClose={() => setPickFor(null)}
      />

      <ConfirmDialog open={refreshAsk} title="시스템 기록을 다시 불러올까요?" confirmLabel="다시 불러와 저장" tone="primary" loading={saving} onConfirm={() => void save(true)} onCancel={() => setRefreshAsk(false)}>
        <p>학급별 대피 보고 등 자동 항목을 지금 기록으로 바꾸고 새 판으로 저장합니다. 담당자 입력값은 그대로 두며, 이전 판은 수정 이력에 남습니다.</p>
      </ConfirmDialog>
    </AppShell>
  );
}
