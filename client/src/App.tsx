// 화면 연결: 로그인 → (소속이 하나면 자동 선택) → 관리자는 상황판, 교직원은 학급 보고
import { useEffect } from "react";
import { matchPath, navigate, usePath } from "./lib/router";
import { SessionProvider, useSession } from "./lib/session";
import { LoadingState, ErrorState, EmptyState } from "./components/ui/States";
import { LoginPage } from "./pages/LoginPage";
import { SchoolSelectPage } from "./pages/SchoolSelectPage";
import { ReportPage } from "./pages/report/ReportPage";
import { BoardPage } from "./pages/board/BoardPage";
import { DesignPreviewPage } from "./pages/DesignPreviewPage";
import { AppShell } from "./components/layout/AppShell";

function Redirect({ to }: { to: string }) {
  useEffect(() => navigate(to, { replace: true }), [to]);
  return null;
}

function Routes() {
  const path = usePath();
  const { me, loading, error, refresh, current, usableMemberships } = useSession();

  // 디자인 미리보기는 로그인 없이 볼 수 있음(가상 데이터만 사용)
  if (path === "/design") return <DesignPreviewPage />;

  if (loading) return <LoadingState label="SAFE SCHOOL을 여는 중…" />;
  if (error)
    return (
      <div className="mx-auto max-w-md p-4">
        <ErrorState message={error.message} onRetry={() => void refresh()} />
      </div>
    );
  if (!me) return path === "/login" ? <LoginPage /> : <Redirect to="/login" />;
  if (path === "/login") return <Redirect to="/" />;

  if (path === "/") {
    if (!current) return <Redirect to="/schools" />;
    return <Redirect to={current.role === "admin" ? `/s/${current.school.id}/board` : `/s/${current.school.id}/report`} />;
  }
  if (path === "/schools") return <SchoolSelectPage />;

  const school = matchPath("/s/:schoolId/:screen", path);
  if (school) {
    const membership = usableMemberships.find((m) => m.school.id === school.schoolId);
    if (!membership) return <Redirect to="/schools" />;
    if (school.screen === "report") return <ReportPage schoolId={school.schoolId!} />;
    if (school.screen === "board") {
      if (membership.role !== "admin") return <Redirect to={`/s/${school.schoolId}/report`} />;
      return <BoardPage schoolId={school.schoolId!} />;
    }
  }

  return (
    <AppShell title="페이지 없음">
      <EmptyState icon="info" title="찾는 화면이 없습니다" action={<a href="/" className="font-bold text-accent underline">처음으로</a>} />
    </AppShell>
  );
}

export default function App() {
  return (
    <SessionProvider>
      <Routes />
    </SessionProvider>
  );
}
