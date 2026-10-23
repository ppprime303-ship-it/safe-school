// 화면 연결: 로그인 → (소속이 하나면 자동 선택) → 관리자는 상황판, 교직원은 학급 보고
import { useEffect, type ReactElement } from "react";
import { matchPath, navigate, usePath } from "./lib/router";
import { SessionProvider, useSession } from "./lib/session";
import { LoadingState, ErrorState, EmptyState } from "./components/ui/States";
import { LoginPage } from "./pages/LoginPage";
import { SchoolSelectPage } from "./pages/SchoolSelectPage";
import { ReportPage } from "./pages/report/ReportPage";
import { BoardPage } from "./pages/board/BoardPage";
import { DesignPreviewPage } from "./pages/DesignPreviewPage";
import { StatusPage } from "./pages/StatusPage";
import { MembersPage } from "./pages/admin/MembersPage";
import { ClassesPage } from "./pages/admin/ClassesPage";
import { AlertsPage } from "./pages/alerts/AlertsPage";
import { NoticesPage } from "./pages/notices/NoticesPage";
import { NoticeEditorPage } from "./pages/notices/NoticeEditorPage";
import { AppShell } from "./components/layout/AppShell";
import { can, homePath } from "./lib/permissions";
import { DrillLogsPage } from "./pages/drill/DrillLogsPage";
import { DrillLogEditorPage } from "./pages/drill/DrillLogEditorPage";
import { EducationResourceDetailPage, EducationResourcesPage } from "./pages/education/EducationResourcesPage";
import { FacilityResourceDetailPage, FacilityResourcesPage } from "./pages/facility/FacilityResourcesPage";

function Redirect({ to }: { to: string }) {
  useEffect(() => navigate(to, { replace: true }), [to]);
  return null;
}

function Routes() {
  const path = usePath();
  const { me, loading, error, refresh, current, usableMemberships } = useSession();

  // 디자인 미리보기·시스템 상태는 로그인 없이 볼 수 있음(개인정보 없음)
  // 운영 빌드에서는 VITE_ENABLE_DESIGN_PREVIEW=true 로 빌드한 경우에만 노출
  if (path === "/design" && (!import.meta.env.PROD || import.meta.env.VITE_ENABLE_DESIGN_PREVIEW === "true")) return <DesignPreviewPage />;
  if (path === "/status") return <StatusPage />;

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
    return <Redirect to={homePath(current)} />;
  }
  if (path === "/schools") return <SchoolSelectPage />;

  // STEP 3-C 안내문 편집(새 안내문은 /s/:schoolId/notices/new?alert=<경보 ID>)
  // STEP 3-D 훈련일지 편집
  const drillRoute = matchPath("/s/:schoolId/drill-logs/:logId", path);
  if (drillRoute) {
    const m = usableMemberships.find((x) => x.school.id === drillRoute.schoolId);
    if (!m) return <Redirect to="/schools" />;
    if (!can(m, "drilllog.view")) return <Redirect to={homePath(m)} />;
    return <DrillLogEditorPage key={drillRoute.logId} schoolId={drillRoute.schoolId!} logId={drillRoute.logId!} />;
  }

  // STEP 4 안전교육 자료 상세(SAFE SCHOOL 안): 목록과 같은 공통 소속 검사만
  const eduRoute = matchPath("/s/:schoolId/education/:resourceId", path);
  if (eduRoute) {
    if (!usableMemberships.some((m) => m.school.id === eduRoute.schoolId)) return <Redirect to="/schools" />;
    return <EducationResourceDetailPage key={eduRoute.resourceId} schoolId={eduRoute.schoolId!} resourceId={eduRoute.resourceId!} />;
  }

  // STEP 5 시설 안전점검 자료 상세: 목록과 같은 공통 소속 검사만
  const facRoute = matchPath("/s/:schoolId/facility-resources/:resourceId", path);
  if (facRoute) {
    if (!usableMemberships.some((m) => m.school.id === facRoute.schoolId)) return <Redirect to="/schools" />;
    return <FacilityResourceDetailPage key={facRoute.resourceId} schoolId={facRoute.schoolId!} resourceId={facRoute.resourceId!} />;
  }

  const noticeRoute = matchPath("/s/:schoolId/notices/:noticeId", path);
  if (noticeRoute) {
    if (!usableMemberships.some((m) => m.school.id === noticeRoute.schoolId)) return <Redirect to="/schools" />;
    return <NoticeEditorPage key={noticeRoute.noticeId} schoolId={noticeRoute.schoolId!} noticeId={noticeRoute.noticeId!} />;
  }

  const school = matchPath("/s/:schoolId/:screen", path);
  if (school) {
    const membership = usableMemberships.find((m) => m.school.id === school.schoolId);
    if (!membership) return <Redirect to="/schools" />;
    if (school.screen === "report") return <ReportPage schoolId={school.schoolId!} />;
    if (school.screen === "alerts") return <AlertsPage schoolId={school.schoolId!} isAdmin={can(membership, "region.manage")} />;
    if (school.screen === "notices") return <NoticesPage key={window.location.search} schoolId={school.schoolId!} />;
    // STEP 4 안전교육 자료 안내: 승인된 소속 교직원 모두(역할·업무 무관 동일), 위의 공통 소속 검사만 사용
    if (school.screen === "education") return <EducationResourcesPage schoolId={school.schoolId!} />;
    // STEP 5 시설 안전점검 법령·지침·매뉴얼 안내: 승인된 소속 교직원 모두 동일
    if (school.screen === "facility-resources") return <FacilityResourcesPage schoolId={school.schoolId!} />;
    // 권한이 필요한 화면: 화면에서도 막고, 서버 API에서도 다시 검사합니다(STEP 3-D: 역할 대신 합산 권한).
    const guarded: Record<string, { cap: Parameters<typeof can>[1]; page: (id: string) => ReactElement }> = {
      board: { cap: "board.view", page: (id) => <BoardPage schoolId={id} /> },
      members: { cap: "members.manage", page: (id) => <MembersPage schoolId={id} /> },
      classes: { cap: "classes.manage", page: (id) => <ClassesPage schoolId={id} /> },
      "drill-logs": { cap: "drilllog.view", page: (id) => <DrillLogsPage schoolId={id} /> },
    };
    const g = guarded[school.screen!];
    if (g) {
      if (!can(membership, g.cap)) return <Redirect to={homePath(membership)} />;
      return g.page(school.schoolId!);
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
