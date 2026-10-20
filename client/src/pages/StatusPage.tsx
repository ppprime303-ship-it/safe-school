// 시스템 상태(/status): STEP 1의 '서버·DB 연결 상태' 화면을 새 디자인으로 옮긴 것. 로그인 없이 확인할 수 있습니다.
// 개인정보 없이 서버·DB 연결 여부와 응답 시간만 보여 줍니다.
import { useCallback, useEffect, useState } from "react";
import { api, ApiError } from "../lib/api";
import { formatTime } from "../lib/format";
import { Link } from "../lib/router";
import { Icon } from "../components/ui/Icon";
import { PrimaryButton } from "../components/ui/PrimaryButton";

type Health =
  | { state: "loading" }
  | { state: "ok"; dbLatencyMs: number; serverTime: string; version: string }
  | { state: "degraded"; message: string; serverTime?: string }
  | { state: "offline"; message: string };

export function StatusPage() {
  const [health, setHealth] = useState<Health>({ state: "loading" });
  const [checkedAt, setCheckedAt] = useState<Date | null>(null);

  const check = useCallback(async () => {
    setHealth({ state: "loading" });
    try {
      const body = await api<{ status: string; db: string; dbLatencyMs: number; serverTime: string; version: string }>("GET", "/health");
      setHealth({ state: "ok", dbLatencyMs: body.dbLatencyMs, serverTime: body.serverTime, version: body.version });
    } catch (e) {
      if (e instanceof ApiError && e.status === 503) setHealth({ state: "degraded", message: e.message });
      else setHealth({ state: "offline", message: e instanceof ApiError ? e.message : "서버에 연결할 수 없습니다." });
    } finally {
      setCheckedAt(new Date());
    }
  }, []);

  useEffect(() => {
    void check();
  }, [check]);

  const box =
    health.state === "ok"
      ? { cls: "border-success bg-success-soft text-success", icon: "check-circle" as const, title: "정상 — 서버와 데이터베이스가 연결되었습니다" }
      : health.state === "loading"
        ? { cls: "border-line bg-card text-ink-muted", icon: "clock" as const, title: "확인 중…" }
        : { cls: "border-danger bg-danger-soft text-danger", icon: "alert" as const, title: health.state === "degraded" ? "서버는 켜져 있지만 데이터베이스에 연결할 수 없습니다" : "서버에 연결할 수 없습니다" };

  return (
    <div className="min-h-dvh bg-page">
      <header className="bg-brand px-4 py-5 text-white">
        <div className="mx-auto max-w-xl">
          <p className="text-2xl font-extrabold tracking-tight">SAFE SCHOOL</p>
          <p className="mt-1 text-base text-on-brand-muted">시스템 상태</p>
        </div>
      </header>
      <main className="mx-auto max-w-xl space-y-4 px-4 py-6">
        <div role="status" aria-live="polite" className={`flex items-start gap-3 rounded-card border-2 p-4 ${box.cls}`}>
          <Icon name={box.icon} size={26} />
          <div>
            <p className="text-lg font-bold">{box.title}</p>
            {health.state === "ok" && (
              <p className="tabular mt-1 text-base text-ink">
                DB 응답 {health.dbLatencyMs}ms · 서버 시각 {formatTime(health.serverTime)} · 버전 {health.version}
              </p>
            )}
            {(health.state === "degraded" || health.state === "offline") && <p className="mt-1 text-base text-ink">{health.message}</p>}
          </div>
        </div>
        <div className="flex flex-wrap items-center justify-between gap-2">
          <p className="tabular text-sm text-ink-muted">마지막 확인 {checkedAt ? formatTime(checkedAt) : "–"}</p>
          <PrimaryButton variant="secondary" icon="refresh" onClick={() => void check()} loading={health.state === "loading"} loadingText="확인 중…">
            다시 확인
          </PrimaryButton>
        </div>
        <p className="text-base text-ink-muted">재난 시 앱에 접속할 수 없으면 학교의 기존 비상대응 절차(방송·비상연락망)를 따르세요.</p>
        <Link href="/" className="inline-flex min-h-touch items-center font-bold text-accent underline underline-offset-4">
          SAFE SCHOOL로 돌아가기
        </Link>
      </main>
    </div>
  );
}
