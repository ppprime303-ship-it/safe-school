// 학급 대피 보고 화면(표시 전용 — 데이터는 props로 받음, 디자인 미리보기에서도 사용)
// 업무경감 설계: ① 화면을 열면 담당 학급·재적이 자동 표시 ② '전원 대피 확인' 한 번 또는 대피 확인 인원만 조정
// ③ 보고. 미확인 인원은 자동 계산. 결석·부상·메모는 필요할 때만 펼쳐서 입력.
import { FREE_TEXT_PRIVACY_NOTICE } from "@shared/privacy";
import { useState } from "react";
import { ENROLLED_CHANGE_REASONS } from "@shared/constants";
import { computeUnconfirmed, validateReport, type ClassReportView, type ReportInput } from "../../lib/disaster";
import { formatTime } from "../../lib/format";
import { NumberStepper } from "../../components/ui/FormField";
import { Icon } from "../../components/ui/Icon";
import { PrimaryButton } from "../../components/ui/PrimaryButton";
import { SaveStatus, type SaveState } from "../../components/ui/States";
import { StatusBadge } from "../../components/ui/StatusBadge";
import { deriveClassStatus } from "../../lib/disaster";

type Reason = NonNullable<ReportInput["enrolledChangeReason"]>;

export function ReportFormView({
  view,
  saveState,
  onSubmit,
}: {
  view: ClassReportView;
  saveState: SaveState;
  onSubmit: (input: ReportInput) => void;
}) {
  const baseEnrolled = view.report?.enrolledCount ?? view.enrolledCount;
  const [enrolled, setEnrolled] = useState<number>(baseEnrolled ?? 0);
  const [needEnrolled] = useState(baseEnrolled === null); // 관리자가 재적을 확인하지 않은 학급
  const [editEnrolled, setEditEnrolled] = useState(baseEnrolled === null);
  const [reason, setReason] = useState<Reason | null>(null);
  const [absent, setAbsent] = useState(view.report?.absentKnown ?? 0);
  const [evacuated, setEvacuated] = useState(view.report?.evacuated ?? Math.max(0, (baseEnrolled ?? 0) - (view.report?.absentKnown ?? 0)));
  const [injured, setInjured] = useState(view.report?.injured ?? 0);
  const [note, setNote] = useState(view.report?.note ?? "");
  const [moreOpen, setMoreOpen] = useState(Boolean(view.report && (view.report.absentKnown || view.report.injured || view.report.note)));

  const enrolledChanged = baseEnrolled !== null && enrolled !== baseEnrolled;
  const unconfirmed = computeUnconfirmed(enrolled, evacuated, absent);
  const error =
    validateReport({ enrolledCount: enrolled, evacuated, absentKnown: absent, injured }) ??
    (enrolledChanged && !reason ? "재적을 바꾼 사유를 고르세요." : null);
  const saving = saveState.kind === "saving";

  const submit = (all: boolean) => {
    const ev = all ? enrolled - absent : evacuated;
    if (all) setEvacuated(ev);
    onSubmit({
      evacuated: ev,
      absentKnown: absent,
      injured,
      enrolledCount: enrolled,
      enrolledChangeReason: enrolledChanged ? reason : null,
      note: note.trim() || null,
      expectedVersion: view.report?.version ?? null,
    });
  };

  return (
    <div className="mx-auto max-w-xl space-y-4">
      {/* 학급과 현재 상태 */}
      <section className="rounded-card border border-line bg-card p-4 shadow-card">
        <div className="flex items-center justify-between gap-2">
          <h2 className="text-2xl font-bold">{view.label}</h2>
          <StatusBadge status={deriveClassStatus(view)} size="sm" />
        </div>
        {!editEnrolled ? (
          <p className="mt-1 flex flex-wrap items-center gap-x-2 text-lg">
            재적 <strong className="tabular text-2xl font-extrabold">{enrolled}</strong>명
            <button type="button" onClick={() => setEditEnrolled(true)} className="min-h-touch text-base font-bold text-accent underline underline-offset-4">
              재적이 다른가요?
            </button>
          </p>
        ) : (
          <div className="mt-3 space-y-2">
            {needEnrolled && <p className="text-base font-semibold text-warning-strong">학교에서 재적을 아직 확인하지 않았습니다. 현재 재적을 입력하세요.</p>}
            <NumberStepper label="재적" value={enrolled} onChange={setEnrolled} />
            {enrolledChanged && (
              <div role="group" aria-label="재적 변경 사유" className="flex flex-wrap gap-2">
                {(Object.keys(ENROLLED_CHANGE_REASONS) as Reason[]).map((r) => (
                  <button
                    key={r}
                    type="button"
                    aria-pressed={reason === r}
                    onClick={() => setReason(r)}
                    className={`min-h-touch rounded-full border-2 px-4 text-base font-bold ${reason === r ? "border-brand bg-brand text-white" : "border-line-strong bg-card"}`}
                  >
                    {ENROLLED_CHANGE_REASONS[r]}
                  </button>
                ))}
              </div>
            )}
          </div>
        )}
        {view.report && <p className="mt-1 text-sm text-ink-muted">이전 보고 {formatTime(view.report.reportedAt)} · 수정하면 이력이 남습니다</p>}
      </section>

      {/* 가장 빠른 경로: 전원 대피 확인 */}
      <PrimaryButton
        variant="success"
        size="xl"
        fullWidth
        icon="check-circle"
        disabled={saving || Boolean(validateReport({ enrolledCount: enrolled, evacuated: enrolled - absent, absentKnown: absent, injured })) || (enrolledChanged && !reason)}
        onClick={() => submit(true)}
      >
        전원 대피 확인 ({enrolled - absent}명) 보고
      </PrimaryButton>

      {/* 일부만 확인된 경우 */}
      <section className="rounded-card border border-line bg-card p-4 shadow-card">
        <h3 className="text-lg font-bold">일부만 확인된 경우</h3>
        <div className="mt-2">
          <NumberStepper label="대피 확인 인원" value={evacuated} onChange={setEvacuated} max={Math.max(0, enrolled - absent)} />
        </div>
        <div
          className={`mt-3 flex items-center justify-between rounded-control border-2 px-4 py-3 ${unconfirmed > 0 ? "border-danger bg-danger-soft text-danger" : "border-line bg-page text-ink"}`}
          aria-live="polite"
        >
          <span className="flex items-center gap-2 text-lg font-bold">
            <Icon name={unconfirmed > 0 ? "question" : "check"} size={24} />
            미확인 인원(자동 계산)
          </span>
          <span className="tabular text-[2rem] font-extrabold">{unconfirmed < 0 ? "–" : unconfirmed}</span>
        </div>

        <button
          type="button"
          aria-expanded={moreOpen}
          onClick={() => setMoreOpen((v) => !v)}
          className="mt-3 flex min-h-touch w-full items-center justify-between rounded-control px-1 text-base font-bold text-accent"
        >
          결석·부상·메모 추가 {absent + injured > 0 && `(결석 ${absent} · 부상 ${injured})`}
          <Icon name="chevron-right" size={20} className={moreOpen ? "rotate-90" : ""} />
        </button>
        {moreOpen && (
          <div className="mt-2 space-y-4 border-t border-line pt-3">
            <NumberStepper label="사전 파악 부재" hint="결석·조퇴·외부 활동처럼 미리 알고 있는 인원" value={absent} onChange={setAbsent} max={enrolled} />
            <NumberStepper label="부상자" hint="대피 여부와 관계없이 다친 인원" value={injured} onChange={setInjured} max={enrolled} />
            <label className="block text-base font-bold">
              메모(선택)
              <textarea
                value={note}
                onChange={(e) => setNote(e.target.value)}
                rows={2}
                maxLength={300}
                placeholder="예: 화장실에 있던 학생 1명 확인 중"
                className="mt-1.5 block w-full rounded-control border-2 border-line-strong bg-card p-3 text-base"
              />
              <span className="mt-1 block text-sm font-normal text-ink-muted">{FREE_TEXT_PRIVACY_NOTICE}</span>
            </label>
            <p className="text-sm text-ink-muted">학생 이름 등 개인정보는 적지 마세요.</p>
          </div>
        )}

        {error && (
          <p role="alert" className="mt-3 flex items-center gap-2 text-base font-semibold text-danger">
            <Icon name="alert" size={20} /> {error}
          </p>
        )}
        <PrimaryButton className="mt-4" size="lg" fullWidth disabled={Boolean(error)} loading={saving} loadingText="저장 중…" onClick={() => submit(false)}>
          {view.report ? "수정 보고" : "보고하기"}
        </PrimaryButton>
      </section>

      <SaveStatus state={saveState} />
    </div>
  );
}
