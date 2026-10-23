// 화면 틀: PC는 좌측 메뉴 + 본문, 모바일은 상단 헤더 + 하단 주요 메뉴.
// 재난 상황이면 모든 화면 맨 위에 EmergencyBanner를 고정합니다.
import { useEffect, type ReactNode } from "react";
import type { ActiveEvent } from "../../lib/disaster";
import { Link, usePath } from "../../lib/router";
import { useSession } from "../../lib/session";
import { capsOf } from "../../lib/permissions";
import { EmergencyBanner } from "../ui/EmergencyBanner";
import { Icon, type IconName } from "../ui/Icon";

export interface NavItem {
  href: string;
  label: string;
  icon: IconName;
}

// STEP 3-D: 메뉴는 역할 대신 합산 권한(직책·업무 겸임 반영)으로 결정
export function navItemsFor(schoolId: string | null, caps: readonly string[] | null): NavItem[] {
  if (!schoolId) return [{ href: "/schools", label: "학교 선택", icon: "school" }];
  const has = (c: string) => !!caps && caps.includes(c);
  const items: NavItem[] = [];
  if (has("board.view")) items.push({ href: `/s/${schoolId}/board`, label: "상황판", icon: "dashboard" });
  items.push({ href: `/s/${schoolId}/report`, label: "학급 보고", icon: "clipboard" });
  items.push({ href: `/s/${schoolId}/alerts`, label: "경보", icon: "bell" });
  if (has("drilllog.view")) items.push({ href: `/s/${schoolId}/drill-logs`, label: "훈련일지", icon: "file" });
  if (has("members.manage")) items.push({ href: `/s/${schoolId}/members`, label: "교직원", icon: "users" });
  if (has("classes.manage")) items.push({ href: `/s/${schoolId}/classes`, label: "학급", icon: "school" });
  items.push({ href: "/schools", label: has("members.manage") ? "학교" : "학교 선택", icon: "home" });
  return items;
}

export function AppHeader({ title, schoolName }: { title: string; schoolName?: string }) {
  const { me, logout } = useSession();
  return (
    <header className="border-b border-line bg-card">
      <div className="mx-auto flex min-h-14 max-w-6xl items-center gap-3 px-4">
        <div className="min-w-0 flex-1">
          <p className="truncate text-sm font-semibold text-ink-muted">{schoolName ?? "SAFE SCHOOL"}</p>
          <h1 className="truncate text-xl font-bold">{title}</h1>
        </div>
        {me && (
          <div className="flex items-center gap-2">
            <span className="hidden text-base font-semibold sm:inline">{me.user.displayName}</span>
            {me.deviceKind === "shared" && (
              <span className="rounded-full border border-warning bg-warning-soft px-2 py-0.5 text-sm font-bold text-warning-strong">공용 기기</span>
            )}
            <button
              type="button"
              onClick={() => void logout()}
              className="flex min-h-touch min-w-touch items-center justify-center gap-1 rounded-control px-2 text-base font-semibold text-ink-muted hover:bg-brand-soft lg:hidden"
              aria-label="로그아웃"
            >
              <Icon name="logout" size={22} />
            </button>
          </div>
        )}
      </div>
    </header>
  );
}

export function Sidebar({ items, schoolName }: { items: NavItem[]; schoolName?: string }) {
  const path = usePath();
  const { me, logout } = useSession();
  return (
    <nav aria-label="주 메뉴" className="sticky top-0 hidden h-dvh w-60 shrink-0 flex-col bg-brand text-white lg:flex">
      <div className="px-5 py-5">
        <p className="text-xl font-extrabold tracking-tight">SAFE SCHOOL</p>
        {schoolName && <p className="mt-0.5 truncate text-sm font-semibold text-on-brand-muted">{schoolName}</p>}
      </div>
      <ul className="flex-1 space-y-1 px-3">
        {items.map((item) => {
          const active = path === item.href;
          return (
            <li key={item.href}>
              <Link
                href={item.href}
                aria-current={active ? "page" : undefined}
                className={`flex min-h-touch items-center gap-3 rounded-control px-3 text-base font-bold ${active ? "bg-white text-brand" : "text-white hover:bg-brand-hover"}`}
              >
                <Icon name={item.icon} size={22} />
                {item.label}
              </Link>
            </li>
          );
        })}
      </ul>
      {me && (
        <div className="border-t border-white/20 p-3">
          <p className="truncate px-2 text-sm text-on-brand-muted">{me.user.email}</p>
          <button type="button" onClick={() => void logout()} className="mt-1 flex min-h-touch w-full items-center gap-2 rounded-control px-2 text-base font-semibold hover:bg-brand-hover">
            <Icon name="logout" size={20} />
            로그아웃
          </button>
        </div>
      )}
    </nav>
  );
}

export function MobileNavigation({ items }: { items: NavItem[] }) {
  const path = usePath();
  if (items.length < 2) return null;
  // STEP 3-E: 겸임으로 메뉴가 6개 이상이면(모바일 390px 기준 칸당 약 55px) 글자를 줄이고 줄바꿈하지 않음
  const dense = items.length > 5;
  return (
    <nav aria-label="주 메뉴" className="fixed inset-x-0 bottom-0 z-30 border-t border-line bg-card pb-[env(safe-area-inset-bottom)] lg:hidden">
      <ul className="mx-auto flex max-w-xl">
        {items.map((item) => {
          const active = path === item.href;
          return (
            <li key={item.href} className="flex-1">
              <Link
                href={item.href}
                aria-current={active ? "page" : undefined}
                className={`flex min-h-16 flex-col items-center justify-center gap-0.5 font-bold ${dense ? "text-xs tracking-tight" : "text-sm"} ${active ? "text-brand" : "text-ink-muted"}`}
              >
                <span className={`flex h-8 ${dense ? "w-11" : "w-14"} items-center justify-center rounded-full ${active ? "bg-brand-soft" : ""}`}>
                  <Icon name={item.icon} size={22} />
                </span>
                <span className="whitespace-nowrap">{item.label}</span>
              </Link>
            </li>
          );
        })}
      </ul>
    </nav>
  );
}

export function AppShell({
  title,
  schoolId,
  children,
  event,
}: {
  title: string;
  schoolId?: string;
  children: ReactNode;
  event?: ActiveEvent | null;
}) {
  const { usableMemberships, selectSchool, current } = useSession();
  const membership = schoolId ? usableMemberships.find((m) => m.school.id === schoolId) ?? null : null;
  // 주소로 들어온 학교를 '선택한 학교'로 기억(다음 접속 때 바로 열림)
  useEffect(() => {
    if (membership && current?.school.id !== membership.school.id) selectSchool(membership.school.id);
  }, [membership, current, selectSchool]);
  const items = navItemsFor(membership?.school.id ?? null, membership ? capsOf(membership) : null);
  return (
    <div className="flex min-h-dvh">
      <Sidebar items={items} schoolName={membership?.school.name} />
      <div className="flex min-w-0 flex-1 flex-col">
        {event && <EmergencyBanner event={event} />}
        <AppHeader title={title} schoolName={membership?.school.name} />
        <main className="mx-auto w-full max-w-6xl flex-1 px-4 pt-4 pb-28 lg:pb-10">{children}</main>
      </div>
      <MobileNavigation items={items} />
    </div>
  );
}
