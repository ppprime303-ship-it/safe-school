// 화면 틀: PC는 좌측 메뉴 + 본문, 모바일은 상단 헤더 + 하단 주요 메뉴.
// 재난 상황이면 모든 화면 맨 위에 EmergencyBanner를 고정합니다.
import { useEffect, type ReactNode } from "react";
import type { ActiveEvent } from "../../lib/disaster";
import { Link, usePath } from "../../lib/router";
import { useSession } from "../../lib/session";
import { capsOf } from "../../lib/permissions";
import { EmergencyBanner } from "../ui/EmergencyBanner";
import { Icon, type IconName } from "../ui/Icon";
import { PrototypeNotice } from "../ui/PrototypeNotice";
import { StaffAlertBar } from "./StaffAlertBar";

export interface NavItem {
  href: string;
  label: string;
  icon: IconName;
  /** STEP 4: 모바일에서 하단 메뉴 대신 상단 머리글에 둘 항목(하단 메뉴 칸 수·배치를 바꾸지 않기 위함) */
  mobile?: "header" | "none";
  /** 이 경로들로 시작하면 머리글 항목을 '현재 화면'으로 표시(STEP 5: 안전교육·시설 자료 탭 공유) */
  activePrefixes?: string[];
  /** 모바일 머리글용 짧은 이름 */
  shortLabel?: string;
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
  // STEP 4: 승인된 교직원 모두 같은 안전교육 자료 안내(권한 검사 없음 — 소속 승인은 App.tsx 공통 검사)
  items.push({
    href: `/s/${schoolId}/education`,
    label: "안전교육 자료",
    icon: "book",
    mobile: "header",
    shortLabel: "교육자료",
    activePrefixes: [`/s/${schoolId}/education`, `/s/${schoolId}/facility-resources`],
  });
  // STEP 5: 시설 안전점검 자료 — PC 좌측 메뉴에만 별도 항목, 모바일은 머리글 '교육자료' → 화면 위 탭으로 이동(머리글 폭 유지)
  items.push({ href: `/s/${schoolId}/facility-resources`, label: "시설 안전 자료", icon: "building", mobile: "none" });
  items.push({ href: "/schools", label: has("members.manage") ? "학교" : "학교 선택", icon: "home" });
  return items;
}

const headerActive = (item: NavItem, path: string) => path === item.href || !!item.activePrefixes?.some((p) => path.startsWith(p));

export function AppHeader({ title, schoolName, links = [] }: { title: string; schoolName?: string; links?: NavItem[] }) {
  const { me, logout } = useSession();
  const path = usePath();
  return (
    <header className="border-b border-line bg-card">
      <div className="mx-auto flex min-h-14 max-w-6xl items-center gap-3 px-4">
        <div className="min-w-0 flex-1">
          <p className="truncate text-sm font-semibold text-ink-muted">{schoolName ?? "SAFE SCHOOL"}</p>
          <h1 className="truncate text-xl font-bold">{title}</h1>
        </div>
        {me && (
          <div className="flex items-center gap-2">
            {links.map((item) => (
              <Link
                key={item.href}
                href={item.href}
                aria-label={item.label}
                aria-current={headerActive(item, path) ? "page" : undefined}
                className={`flex min-h-touch min-w-touch shrink-0 flex-col items-center justify-center rounded-control px-1.5 text-xs font-bold lg:hidden ${headerActive(item, path) ? "bg-brand-soft text-brand" : "text-ink-muted hover:bg-brand-soft"}`}
              >
                <Icon name={item.icon} size={22} />
                <span className="whitespace-nowrap">{item.shortLabel ?? item.label}</span>
              </Link>
            ))}
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
          const active = path === item.href || (item.mobile === "none" && path.startsWith(`${item.href}/`));
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

export function MobileNavigation({ items: all }: { items: NavItem[] }) {
  const path = usePath();
  const items = all.filter((i) => i.mobile === undefined); // STEP 4·5: 머리글·숨김 항목은 하단 메뉴에서 제외(기존 하단 메뉴 그대로) // STEP 4: 머리글 항목은 하단 메뉴에서 제외(기존 하단 메뉴 그대로)
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
        {/* Beta PILOT 2 Phase 2: 교직원 앱 내 알림(실제 재난 소재 보고 / 모의훈련 안내 확인) */}
        {membership && <StaffAlertBar schoolId={membership.school.id} />}
        <PrototypeNotice compact />
        <AppHeader title={title} schoolName={membership?.school.name} links={items.filter((i) => i.mobile === "header")} />
        <main className="mx-auto w-full max-w-6xl flex-1 px-4 pt-4 pb-28 lg:pb-10">{children}</main>
      </div>
      <MobileNavigation items={items} />
    </div>
  );
}
