import { useEffect, useState } from "react";

// STEP 1 화면: 서버·DB 연결 상태만 보여 줍니다. 로그인·업무 화면은 STEP 2부터 추가합니다.
type Health =
  | { state: "loading" }
  | { state: "ok"; dbLatencyMs: number; serverTime: string }
  | { state: "error"; message: string };

export default function App() {
  const [health, setHealth] = useState<Health>({ state: "loading" });

  useEffect(() => {
    let cancelled = false;
    fetch("/api/health")
      .then(async (res) => {
        const body = await res.json();
        if (cancelled) return;
        if (res.ok && body.db === "ok") {
          setHealth({ state: "ok", dbLatencyMs: body.dbLatencyMs, serverTime: body.serverTime });
        } else {
          setHealth({ state: "error", message: body.message ?? "서버 상태를 확인할 수 없습니다." });
        }
      })
      .catch(() => {
        if (!cancelled) setHealth({ state: "error", message: "서버에 연결할 수 없습니다." });
      });
    return () => {
      cancelled = true;
    };
  }, []);

  return (
    <main className="min-h-dvh bg-white text-navy-900">
      <header className="bg-navy-900 px-4 py-5 text-white">
        <h1 className="text-2xl font-bold tracking-tight">SAFE SCHOOL</h1>
        <p className="mt-1 text-sm text-white/80">학교 재난안전 통합 업무지원 시스템</p>
      </header>

      <section className="mx-auto max-w-xl px-4 py-8">
        <h2 className="text-lg font-semibold">시스템 상태</h2>
        <div className="mt-3 rounded-lg border border-slate-200 p-4" role="status" aria-live="polite">
          {health.state === "loading" && <p>확인 중…</p>}
          {health.state === "ok" && (
            <p className="font-medium text-teal-600">
              ● 정상 — 서버와 데이터베이스가 연결되었습니다 (응답 {health.dbLatencyMs}ms)
            </p>
          )}
          {health.state === "error" && <p className="font-medium text-alert-real">▲ 오류 — {health.message}</p>}
        </div>
        <p className="mt-6 text-sm text-slate-600">
          개발 단계: STEP 1(기본 구조·DB). 로그인과 업무 화면은 다음 단계에서 추가됩니다.
        </p>
        <p className="mt-2 text-sm text-slate-600">
          재난 시 앱에 접속할 수 없으면 학교의 기존 비상대응 절차(방송·비상연락망)를 따르세요.
        </p>
      </section>
    </main>
  );
}
