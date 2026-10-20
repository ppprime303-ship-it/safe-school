// 관리자: 학급 구성과 재적 인원 일괄 입력(한 화면에서 모두 저장)
// - 학급이 없으면 학년별 학급 수만 입력해 한 번에 만듭니다(공시자료가 있으면 미리 채움).
// - 재적은 학급별 숫자만 입력하고 '저장' 한 번으로 모두 저장합니다. 공시자료의 학년 합계는 참고로만 보여 줍니다.
import { useCallback, useEffect, useMemo, useState } from "react";
import { api, describeError } from "../../lib/api";
import { formatDateTime } from "../../lib/format";
import { useSession } from "../../lib/session";
import { AppShell } from "../../components/layout/AppShell";
import { NumberStepper } from "../../components/ui/FormField";
import { Icon } from "../../components/ui/Icon";
import { PrimaryButton } from "../../components/ui/PrimaryButton";
import { ErrorState, LoadingState, SaveStatus, type SaveState } from "../../components/ui/States";

interface SchoolClass {
  id: string;
  grade: number;
  classNo: number;
  label: string;
  enrolledCount: number | null;
  enrolledConfirmedAt: string | null;
}
interface Proposal {
  snapshot: { sourceUrl: string; disclosureYear: number | null; baseDate: string | null; fetchedAt: string } | null;
  grades: { grade: number; publicClassCount: number | null; publicStudentCount: number | null }[];
}

const gradesForKind = (kind: string | null | undefined) => (kind === "03" || kind === "04" ? [1, 2, 3] : [1, 2, 3, 4, 5, 6]);

export function ClassesPage({ schoolId }: { schoolId: string }) {
  const { usableMemberships } = useSession();
  const kind = usableMemberships.find((m) => m.school.id === schoolId)?.school.schoolKindCode;
  const [year, setYear] = useState<number | null>(null);
  const [classes, setClasses] = useState<SchoolClass[] | null>(null);
  const [proposal, setProposal] = useState<Proposal | null>(null);
  const [loadError, setLoadError] = useState<ReturnType<typeof describeError> | null>(null);
  const [draft, setDraft] = useState<Record<string, string>>({});
  const [saveState, setSaveState] = useState<SaveState>({ kind: "idle" });

  const load = useCallback(async () => {
    try {
      const c = await api<{ schoolYear: number; classes: SchoolClass[] }>("GET", `/schools/${schoolId}/classes`);
      setYear(c.schoolYear);
      setClasses(c.classes);
      setDraft(Object.fromEntries(c.classes.map((x) => [x.id, x.enrolledCount === null ? "" : String(x.enrolledCount)])));
      // 공시자료는 참고용: 실패해도 화면은 계속 사용
      const p = await api<Proposal>("GET", `/schools/${schoolId}/public-data?year=${c.schoolYear}`).catch(() => null);
      setProposal(p);
      setLoadError(null);
    } catch (e) {
      setLoadError(describeError(e));
    }
  }, [schoolId]);

  useEffect(() => {
    void load();
  }, [load]);

  const publicByGrade = useMemo(() => new Map((proposal?.grades ?? []).map((g) => [g.grade, g])), [proposal]);

  // 바뀐 학급과 아직 확인되지 않았지만 숫자가 입력된 학급만 저장
  const changes = useMemo(() => {
    if (!classes) return [];
    return classes
      .filter((c) => draft[c.id] !== undefined && draft[c.id] !== "")
      .map((c) => ({ c, value: Number(draft[c.id]) }))
      .filter(({ c, value }) => value !== c.enrolledCount || !c.enrolledConfirmedAt);
  }, [classes, draft]);
  const invalid = changes.some(({ value }) => !Number.isInteger(value) || value < 0 || value > 60);
  const unconfirmedCount = (classes ?? []).filter((c) => !c.enrolledConfirmedAt).length;

  const saveAll = async () => {
    setSaveState({ kind: "saving" });
    try {
      const r = await api<{ updated: number }>("PUT", `/schools/${schoolId}/classes/enrollment`, {
        items: changes.map(({ c, value }) => ({ classId: c.id, enrolledCount: value })),
      });
      setSaveState({ kind: "saved", at: `${r.updated}개 학급 재적 저장` });
      await load();
    } catch (e) {
      setSaveState({ kind: "failed", message: describeError(e).message });
    }
  };

  const addClass = async (grade: number, count: number) => {
    if (!year) return;
    setSaveState({ kind: "saving" });
    try {
      await api("POST", `/schools/${schoolId}/classes/apply-structure`, { schoolYear: year, grades: [{ grade, classCount: count }] });
      setSaveState({ kind: "saved", at: `${grade}학년 ${count}반 추가` });
      await load();
    } catch (e) {
      setSaveState({ kind: "failed", message: describeError(e).message });
    }
  };

  const grades = useMemo(() => [...new Set((classes ?? []).map((c) => c.grade))].sort((a, b) => a - b), [classes]);

  return (
    <AppShell title="학급·재적 관리" schoolId={schoolId}>
      {!classes && !loadError && <LoadingState />}
      {loadError && <ErrorState title={loadError.title} message={loadError.message} onRetry={loadError.retryable ? () => void load() : undefined} />}
      {classes && year && classes.length === 0 && (
        <CreateClasses schoolId={schoolId} year={year} grades={gradesForKind(kind)} publicByGrade={publicByGrade} onCreated={load} />
      )}
      {classes && classes.length > 0 && (
        <div className="space-y-4 pb-20">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <p className="text-base">
              <strong className="font-bold">{year}학년도</strong> · 학급 {classes.length}개 ·{" "}
              {unconfirmedCount > 0 ? <span className="font-bold text-warning-strong">재적 미확인 {unconfirmedCount}학급</span> : <span className="font-bold text-success">모든 학급 재적 확인됨</span>}
            </p>
            {proposal?.snapshot && (
              <p className="text-sm text-ink-muted">
                참고 공시자료: 학교알리미 {proposal.snapshot.disclosureYear ?? ""} 공시 · 조회 {formatDateTime(proposal.snapshot.fetchedAt)}
                {proposal.snapshot.baseDate && ` · 기준일 ${proposal.snapshot.baseDate.slice(0, 10)}`}
              </p>
            )}
          </div>
          <SaveStatus state={saveState} />

          {grades.map((g) => {
            const list = classes.filter((c) => c.grade === g);
            const sum = list.reduce((s, c) => s + (Number(draft[c.id]) || 0), 0);
            const pub = publicByGrade.get(g);
            return (
              <section key={g} aria-labelledby={`g${g}`} className="rounded-card border border-line bg-card p-4 shadow-card">
                <div className="flex flex-wrap items-baseline justify-between gap-2">
                  <h2 id={`g${g}`} className="text-xl font-bold">
                    {g}학년
                  </h2>
                  <p className="tabular text-base">
                    입력 합계 <strong className="font-extrabold">{sum}</strong>명
                    {pub?.publicStudentCount != null && <span className="text-ink-muted"> · 공시 합계 {pub.publicStudentCount}명(참고)</span>}
                  </p>
                </div>
                <div className="mt-3 grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-5">
                  {list.map((c) => (
                    <label key={c.id} className="block">
                      <span className="flex items-center gap-1 text-base font-bold">
                        {c.classNo}반
                        {c.enrolledConfirmedAt ? <Icon name="check-circle" size={16} className="text-success" label="확인됨" /> : <span className="text-sm font-semibold text-warning-strong">미확인</span>}
                      </span>
                      <span className="mt-1 flex items-center gap-1">
                        <input
                          type="number"
                          inputMode="numeric"
                          min={0}
                          max={60}
                          value={draft[c.id] ?? ""}
                          onChange={(e) => setDraft((d) => ({ ...d, [c.id]: e.target.value }))}
                          placeholder="재적"
                          aria-label={`${c.label} 재적`}
                          className={`tabular min-h-touch w-full rounded-control border-2 bg-card px-3 text-center text-xl font-extrabold ${c.enrolledConfirmedAt ? "border-line-strong" : "border-warning"}`}
                        />
                        <span className="text-base text-ink-muted">명</span>
                      </span>
                    </label>
                  ))}
                </div>
                <button
                  type="button"
                  onClick={() => void addClass(g, list.length + 1)}
                  className="mt-3 flex min-h-touch items-center gap-1 text-base font-bold text-accent"
                >
                  <Icon name="plus" size={18} /> {g}학년 {list.length + 1}반 추가
                </button>
              </section>
            );
          })}

          {/* 한 번에 저장(화면 하단 고정) */}
          <div className="fixed inset-x-0 bottom-16 z-20 border-t border-line bg-card/95 p-3 lg:bottom-0 lg:left-60">
            <div className="mx-auto flex max-w-6xl items-center justify-between gap-3">
              <p className="text-base font-semibold">{invalid ? <span className="text-danger">재적은 0~60 사이 숫자로 입력하세요</span> : `저장할 학급 ${changes.length}개`}</p>
              <PrimaryButton icon="check" disabled={changes.length === 0 || invalid} loading={saveState.kind === "saving"} onClick={() => void saveAll()}>
                재적 모두 저장
              </PrimaryButton>
            </div>
          </div>
        </div>
      )}
    </AppShell>
  );
}

function CreateClasses({
  schoolId,
  year,
  grades,
  publicByGrade,
  onCreated,
}: {
  schoolId: string;
  year: number;
  grades: number[];
  publicByGrade: Map<number, { publicClassCount: number | null; publicStudentCount: number | null }>;
  onCreated: () => Promise<void>;
}) {
  const [counts, setCounts] = useState<Record<number, number>>(() =>
    Object.fromEntries(grades.map((g) => [g, publicByGrade.get(g)?.publicClassCount ?? 0])),
  );
  const [state, setState] = useState<SaveState>({ kind: "idle" });
  const total = Object.values(counts).reduce((a, b) => a + b, 0);

  const create = async () => {
    setState({ kind: "saving" });
    try {
      const r = await api<{ created: number }>("POST", `/schools/${schoolId}/classes/apply-structure`, {
        schoolYear: year,
        grades: grades.map((g) => ({ grade: g, classCount: counts[g] ?? 0 })),
      });
      setState({ kind: "saved", at: `${r.created}개 학급 생성` });
      await onCreated();
    } catch (e) {
      setState({ kind: "failed", message: describeError(e).message });
    }
  };

  return (
    <section className="mx-auto max-w-xl rounded-card border border-line bg-card p-5 shadow-card">
      <h2 className="text-xl font-bold">{year}학년도 학급 만들기</h2>
      <p className="mt-1 text-base text-ink-muted">학년별 학급 수만 입력하면 학급이 한 번에 만들어집니다. 재적은 다음 화면에서 한꺼번에 입력합니다.</p>
      <div className="mt-4 grid gap-4 sm:grid-cols-2">
        {grades.map((g) => {
          const pub = publicByGrade.get(g);
          return (
            <NumberStepper
              key={g}
              label={`${g}학년 학급 수`}
              hint={pub?.publicClassCount != null ? `공시자료 ${pub.publicClassCount}학급(참고)` : undefined}
              value={counts[g] ?? 0}
              max={30}
              onChange={(v) => setCounts((c) => ({ ...c, [g]: v }))}
            />
          );
        })}
      </div>
      <PrimaryButton className="mt-5" size="lg" fullWidth disabled={total === 0} loading={state.kind === "saving"} onClick={() => void create()}>
        학급 {total}개 만들기
      </PrimaryButton>
      {state.kind === "failed" && (
        <div className="mt-3">
          <SaveStatus state={state} />
        </div>
      )}
    </section>
  );
}
