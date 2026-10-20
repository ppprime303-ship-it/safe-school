// 디자인 시스템 미리보기(/design): 모든 공통 컴포넌트와 두 핵심 화면을 '가상 데이터'로 보여 줍니다.
// 서버를 호출하지 않으며, 실제 학교·학생 정보가 없습니다.
import { useState } from "react";
import type { BoardData, ClassReportView } from "../lib/disaster";
import { BoardView } from "./board/BoardView";
import { ReportFormView } from "./report/ReportFormView";
import { ClassStatusCard } from "../components/ui/ClassStatusCard";
import { ConfirmDialog } from "../components/ui/ConfirmDialog";
import { EmergencyBanner } from "../components/ui/EmergencyBanner";
import { FormField, NumberStepper } from "../components/ui/FormField";
import { PrimaryButton } from "../components/ui/PrimaryButton";
import { StatCard } from "../components/ui/StatCard";
import { EmptyState, ErrorState, LoadingState, SaveStatus, type SaveState } from "../components/ui/States";
import { Badge, StatusBadge } from "../components/ui/StatusBadge";

const startedAt = new Date(Date.now() - 7 * 60_000).toISOString();
const at = (minAgo: number) => new Date(Date.now() - minAgo * 60_000).toISOString();

function sampleClasses(): ClassReportView[] {
  const list: ClassReportView[] = [];
  for (const grade of [1, 2, 3]) {
    for (let classNo = 1; classNo <= 5; classNo++) {
      const id = `${grade}-${classNo}`;
      const base = { classId: id, grade, classNo, label: `${grade}학년 ${classNo}반`, enrolledCount: 28 };
      const k = (grade - 1) * 5 + classNo;
      if (k % 6 === 0) list.push({ ...base, report: null });
      else if (k === 7)
        list.push({ ...base, report: { enrolledCount: 28, absentKnown: 1, evacuated: 25, unconfirmed: 2, injured: 0, note: "화장실 학생 확인 중", version: 2, reportedAt: at(2), reporterName: "가상 담임" } });
      else if (k === 11)
        list.push({ ...base, report: { enrolledCount: 28, absentKnown: 0, evacuated: 28, unconfirmed: 0, injured: 1, note: "계단 낙상 경상", version: 1, reportedAt: at(3), reporterName: "가상 담임" } });
      else list.push({ ...base, report: { enrolledCount: 28, absentKnown: k % 4 === 0 ? 1 : 0, evacuated: k % 4 === 0 ? 27 : 28, unconfirmed: 0, injured: 0, note: null, version: 1, reportedAt: at(4), reporterName: "가상 담임" } });
    }
  }
  return list;
}

const SWATCHES: [string, string, string][] = [
  ["메인 네이비", "bg-brand", "#183153 · 흰 글자 13.1:1"],
  ["보조 딥 틸 / 완료", "bg-accent", "#176A80 · 흰 글자 6.2:1"],
  ["긴급 위험", "bg-danger", "#B42318 · 흰 글자 6.6:1"],
  ["주의", "bg-warning", "#B45309 · 흰 글자 5.0:1"],
  ["미보고(중립)", "bg-neutral", "#3D4B63 · 흰 글자 8.8:1"],
  ["기본 텍스트", "bg-ink", "#172B4D · 카드 위 14.1:1"],
];

export function DesignPreviewPage() {
  const [dialog, setDialog] = useState(false);
  const [saveState, setSaveState] = useState<SaveState>({ kind: "idle" });
  const [stepper, setStepper] = useState(26);
  const classes = sampleClasses();
  const board: BoardData = { event: { id: "demo", mode: "drill", types: ["earthquake", "fire"], location: "본관", evacPlace: "운동장", message: null, startedAt }, serverTime: new Date().toISOString(), classes };

  return (
    <div className="min-h-dvh bg-page">
      <EmergencyBanner event={board.event} />
      <EmergencyBanner event={{ ...board.event, mode: "real", types: ["fire"] }} />
      <main className="mx-auto max-w-6xl space-y-10 px-4 py-6">
        <header>
          <h1 className="text-3xl font-bold">SAFE SCHOOL 디자인 시스템</h1>
          <p className="mt-1 text-base text-ink-muted">모든 수치는 가상 데이터입니다. 실제 학교·학생 정보가 없습니다.</p>
        </header>

        <section>
          <h2 className="text-xl font-bold">색상과 대비(WCAG 2.2 AA)</h2>
          <div className="mt-3 grid grid-cols-2 gap-3 sm:grid-cols-3">
            {SWATCHES.map(([name, cls, desc]) => (
              <div key={name} className="overflow-hidden rounded-card border border-line bg-card shadow-card">
                <div className={`${cls} flex h-16 items-end p-2 text-base font-bold text-white`}>가나다 123</div>
                <div className="p-2">
                  <p className="text-base font-bold">{name}</p>
                  <p className="text-sm text-ink-muted">{desc}</p>
                </div>
              </div>
            ))}
          </div>
        </section>

        <section>
          <h2 className="text-xl font-bold">글꼴 크기</h2>
          <div className="mt-3 space-y-1 rounded-card border border-line bg-card p-4">
            <p className="text-3xl font-bold">제목 30px · 700</p>
            <p className="text-xl font-bold">소제목 20px · 700</p>
            <p className="text-base font-semibold">메뉴·버튼 16px · 600~700</p>
            <p className="text-base">본문 16px · 450</p>
            <p className="tabular text-[2.25rem] font-extrabold">긴급 수치 36px · 800 — 1,234명</p>
          </div>
        </section>

        <section className="space-y-3">
          <h2 className="text-xl font-bold">버튼</h2>
          <div className="flex flex-wrap gap-2">
            <PrimaryButton>기본</PrimaryButton>
            <PrimaryButton variant="secondary">보조</PrimaryButton>
            <PrimaryButton variant="success" icon="check-circle">완료</PrimaryButton>
            <PrimaryButton variant="danger" icon="siren" onClick={() => setDialog(true)}>
              위험 작업(확인 창)
            </PrimaryButton>
            <PrimaryButton variant="ghost">텍스트</PrimaryButton>
            <PrimaryButton loading>저장</PrimaryButton>
          </div>
          <PrimaryButton size="xl" variant="success" icon="check-circle">
            재난 중 핵심 버튼(64px)
          </PrimaryButton>
        </section>

        <section className="space-y-3">
          <h2 className="text-xl font-bold">상태 표시(색 + 문구 + 아이콘)</h2>
          <div className="flex flex-wrap gap-2">
            <StatusBadge status="unreported" />
            <StatusBadge status="unconfirmed" />
            <StatusBadge status="injured" />
            <StatusBadge status="reported" />
          </div>
          <div className="flex flex-wrap gap-2">
            <Badge tone="success" icon="check-circle">사용 가능</Badge>
            <Badge tone="warning" icon="clock">가입 승인 대기</Badge>
            <Badge tone="danger" icon="x">가입 거절됨</Badge>
            <Badge tone="info">등록된 학교</Badge>
          </div>
          <div className="grid gap-2 sm:grid-cols-2">
            <SaveStatus state={{ kind: "saving" }} />
            <SaveStatus state={{ kind: "saved", at: "09:12:30" }} />
            <SaveStatus state={{ kind: "failed", message: "합계가 맞지 않습니다" }} />
            <SaveStatus state={{ kind: "queued", message: "통신이 연결되면 자동으로 다시 보냅니다" }} />
          </div>
        </section>

        <section className="space-y-3">
          <h2 className="text-xl font-bold">수치 카드·학급 카드</h2>
          <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
            <StatCard label="미확인 인원" icon="question" value="2" unit="명" tone="danger" sub="1개 학급 — 즉시 확인 필요" />
            <StatCard label="미보고 학급" icon="clock" value="2" unit="/ 15" tone="neutral" sub="보고 대기 인원 56명" />
            <StatCard label="부상자" icon="medical" value="1" unit="명" tone="warning" />
            <StatCard label="대피 확인" icon="users" value="358" unit="/ 420명" tone="success" progress={87} />
          </div>
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
            {[classes[5]!, classes[6]!, classes[10]!, classes[0]!].map((c) => (
              <ClassStatusCard key={c.classId} view={c} />
            ))}
          </div>
        </section>

        <section className="space-y-3">
          <h2 className="text-xl font-bold">입력</h2>
          <div className="grid gap-4 sm:grid-cols-2">
            <FormField label="기관 이메일" placeholder="name@school.go.kr" hint="학교에서 쓰는 이메일" />
            <FormField label="비밀번호" type="password" error="비밀번호는 10자 이상이어야 합니다." />
            <NumberStepper label="대피 확인 인원" value={stepper} onChange={setStepper} />
          </div>
        </section>

        <section className="space-y-3">
          <h2 className="text-xl font-bold">상태 화면</h2>
          <LoadingState />
          <ErrorState message="서버에 연결할 수 없습니다. 통신 상태를 확인하세요." onRetry={() => undefined} />
          <EmptyState icon="check-circle" title="진행 중인 재난 상황이 없습니다" message="재난이 발령되면 보고 화면이 바로 열립니다." />
        </section>

        <section className="space-y-3">
          <h2 className="text-xl font-bold">화면: 교직원 학급 보고</h2>
          <div className="rounded-card border-2 border-dashed border-line-strong p-3">
            <ReportFormView view={classes[1]!} saveState={saveState} onSubmit={() => setSaveState({ kind: "saved", at: "미리보기" })} />
          </div>
        </section>

        <section className="space-y-3">
          <h2 className="text-xl font-bold">화면: 관리자 상황판</h2>
          <div className="rounded-card border-2 border-dashed border-line-strong p-3">
            <BoardView data={board} connection={{ lastSuccessAt: new Date(Date.now() - 40_000), failing: true, message: "가상 장애" }} />
          </div>
        </section>
      </main>

      <ConfirmDialog open={dialog} title="실제 상황으로 발령할까요?" confirmLabel="실제 상황 발령" confirmPhrase="실제" onConfirm={() => setDialog(false)} onCancel={() => setDialog(false)}>
        <p>모든 교직원에게 알림이 가고 학부모 안내 초안이 만들어집니다. 훈련이라면 취소하고 '훈련'을 선택하세요.</p>
      </ConfirmDialog>
    </div>
  );
}
