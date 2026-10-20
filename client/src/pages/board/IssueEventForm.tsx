// 재난 발령(관리자): 진행 중 상황이 없을 때 상황판에 표시됩니다.
// - 훈련이 기본값입니다. 실제 상황은 확인 창에서 "실제"를 입력해야 발령됩니다(서버도 confirmReal 확인).
// - 공식 경보를 받았다고 자동 발령하지 않습니다. 발령은 학교장(관리자)의 판단입니다.
import { useState } from "react";
import { DISASTER_TYPES, type DisasterTypeKey } from "@shared/constants";
import { api, ApiError } from "../../lib/api";
import type { ActiveEvent, EventMode } from "../../lib/disaster";
import { ConfirmDialog } from "../../components/ui/ConfirmDialog";
import { FormField } from "../../components/ui/FormField";
import { PrimaryButton } from "../../components/ui/PrimaryButton";

const TYPE_KEYS = Object.keys(DISASTER_TYPES) as DisasterTypeKey[];

export function IssueEventForm({ schoolId, onIssued }: { schoolId: string; onIssued: () => void }) {
  const [type, setType] = useState<DisasterTypeKey | null>(null);
  const [mode, setMode] = useState<EventMode>("drill");
  const [evacPlace, setEvacPlace] = useState("");
  const [message, setMessage] = useState("");
  const [confirming, setConfirming] = useState(false);
  const [sending, setSending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const issue = async () => {
    if (!type) return;
    setSending(true);
    setError(null);
    try {
      await api<{ event: ActiveEvent }>("POST", `/schools/${schoolId}/events`, {
        primaryType: type,
        mode,
        evacPlace: evacPlace.trim() || null,
        message: message.trim() || null,
        confirmReal: mode === "real" ? true : undefined,
      });
      setConfirming(false);
      onIssued();
    } catch (e) {
      // 이미 다른 관리자가 발령했으면 그 상황을 바로 보여 줌
      if (e instanceof ApiError && e.code === "event_already_active") {
        setConfirming(false);
        onIssued();
        return;
      }
      setError(e instanceof ApiError ? e.message : "발령하지 못했습니다. 다시 시도하세요.");
    } finally {
      setSending(false);
    }
  };

  return (
    <section className="mx-auto max-w-2xl rounded-card border border-line bg-card p-5 shadow-card" aria-labelledby="issue-title">
      <h2 id="issue-title" className="text-xl font-extrabold">재난 발령</h2>
      <p className="mt-1 text-base text-ink-muted">발령하면 모든 교직원 화면에 담당 학급 보고 화면이 열립니다.</p>

      <fieldset className="mt-4">
        <legend className="text-base font-bold">구분</legend>
        <div className="mt-2 grid grid-cols-2 gap-2">
          {(["drill", "real"] as const).map((m) => (
            <button
              key={m}
              type="button"
              aria-pressed={mode === m}
              onClick={() => setMode(m)}
              className={`min-h-touch rounded-control border-2 px-3 text-lg font-bold ${
                mode === m ? (m === "real" ? "border-danger bg-danger text-white" : "border-brand bg-brand text-white") : "border-line-strong bg-card"
              }`}
            >
              {m === "drill" ? "훈련" : "실제 상황"}
            </button>
          ))}
        </div>
      </fieldset>

      <fieldset className="mt-4">
        <legend className="text-base font-bold">
          재난 유형<span className="ml-1 text-danger" aria-hidden>*</span>
        </legend>
        <div className="mt-2 grid grid-cols-2 gap-2 sm:grid-cols-4">
          {TYPE_KEYS.map((k) => (
            <button
              key={k}
              type="button"
              aria-pressed={type === k}
              onClick={() => setType(k)}
              className={`min-h-touch rounded-control border-2 px-2 text-base font-bold ${type === k ? "border-brand bg-brand-soft text-brand" : "border-line-strong bg-card"}`}
            >
              {DISASTER_TYPES[k]}
            </button>
          ))}
        </div>
      </fieldset>

      <FormField className="mt-4" label="대피 장소" hint="예: 운동장, 강당(선택)" maxLength={100} value={evacPlace} onChange={(e) => setEvacPlace(e.target.value)} />
      <FormField className="mt-3" label="교직원 안내" hint="짧게 적으세요(선택). 학생 이름은 적지 마세요." maxLength={500} value={message} onChange={(e) => setMessage(e.target.value)} />

      {error && !confirming && <p className="mt-3 font-semibold text-danger" role="alert">{error}</p>}
      <PrimaryButton
        className="mt-5"
        size="xl"
        fullWidth
        variant={mode === "real" ? "danger" : "primary"}
        disabled={!type}
        onClick={() => setConfirming(true)}
      >
        {mode === "real" ? "실제 상황 발령" : "훈련 발령"}
      </PrimaryButton>

      <ConfirmDialog
        open={confirming}
        title={mode === "real" ? "실제 상황으로 발령할까요?" : "훈련을 시작할까요?"}
        confirmLabel={mode === "real" ? "실제 상황 발령" : "훈련 발령"}
        tone={mode === "real" ? "danger" : "primary"}
        confirmPhrase={mode === "real" ? "실제" : undefined}
        loading={sending}
        onConfirm={() => void issue()}
        onCancel={() => setConfirming(false)}
      >
        <p>
          {type ? DISASTER_TYPES[type] : ""} · {mode === "real" ? "실제 상황" : "훈련"}
          {evacPlace.trim() ? ` · 대피 장소 ${evacPlace.trim()}` : ""}
        </p>
        <p className="mt-1">모든 교직원 화면에 즉시 표시됩니다. 학부모에게는 발송되지 않습니다.</p>
        {error && <p className="mt-2 font-semibold text-danger">{error}</p>}
      </ConfirmDialog>
    </section>
  );
}
