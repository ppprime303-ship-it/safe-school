// STEP 5 학교 시설 안전점검 법령·지침·매뉴얼 안내
// 흐름: 학교 관할 교육청 확인 → 최근 제정·개정 → 국가 공통 법령 → 우리 관할 교육청 → 전국 교육청 탐색 → 공공기관 → 상세 → 공식 원문
// - 안내만 합니다(점검 기록·결과 저장·보고 없음). 서버 API·DB를 새로 쓰지 않습니다(정적 데이터).
// - 관할 교육청은 학교 등록 정보(학교알리미 교육청명)로만 판정하고, 없으면 사용자가 이 기기에서 고르게 합니다(학교 정보는 바꾸지 않음).
// - 탐색 지역(필터)과 관할 교육청은 별개입니다. 주소 쿼리에는 검색어·탐색 지역·분야만 넣습니다.
import { useCallback, useEffect, useId, useMemo, useState, type ReactNode } from "react";
import { AppShell } from "../../components/layout/AppShell";
import { Icon, type IconName } from "../../components/ui/Icon";
import { PrimaryButton } from "../../components/ui/PrimaryButton";
import { Link } from "../../lib/router";
import { useSession } from "../../lib/session";
import { EDU_OFFICES, FACILITY_ALLOWED_HOSTS, FACILITY_DATA_CHECKED_AT, FACILITY_RESOURCES } from "../../data/facilityResources";
import {
  CATEGORY_LABEL,
  EMPTY_FACILITY_FILTER,
  FACILITY_AREAS,
  FACILITY_AREA_LABEL,
  REVISION_KIND_LABEL,
  SOURCE_TYPES,
  STATUS_LABEL,
  VERIFICATION_LABEL,
  areaSummaryOf,
  categoryOf,
  facilityFilterFromSearch,
  facilityFilterToSearch,
  filterFacilityResources,
  findFacilityResource,
  groupByCategory,
  isFacilityFilterActive,
  isRecent,
  isSafeExternalUrl,
  recentChanges,
  resolveHomeOffice,
  statusOf,
  type Category,
  type EduOffice,
  type FacilityAreaId,
  type FacilityFilter,
  type FacilityResource,
  type HomeOffice,
  type Revision,
} from "../../lib/facilityResources";

export const FACILITY_TEXT = {
  title: "학교 시설 안전점검 자료 찾기",
  lead: "우리 학교에 적용되는 공식 법령·지침·매뉴얼을 찾아 원문으로 확인하세요.",
  required:
    "이 화면은 학교 시설 안전관리 관련 법령·지침·매뉴얼을 찾아보는 안내 서비스입니다. 실제 적용 기준과 점검 절차는 현행 법령 및 관할 교육청의 유효한 지침에 따라 확인해야 합니다.",
  noRecord: "시설 점검 기록·결과를 저장하지 않습니다.",
  searchScope: "SAFE SCHOOL에 등록한 안내 정보에서만 찾습니다(법령·자료 원문 검색 아님).",
  noRecent: "현재 등록된 최근 개정 안내가 없습니다. 최신 정보는 공식 법령·교육청 사이트에서 확인해 주세요.",
  recentNote: "공식 연혁에서 확인해 등록한 내용만 표시합니다. 새 법령·지침을 자동으로 감지하지 않습니다.",
  chooseRegion: "학교 지역을 선택해 주세요",
  empty: "조건에 맞는 자료가 없습니다",
} as const;

/** 기기 시계 기준 오늘(YYYY-MM-DD, 현지 날짜) */
export function localToday(d = new Date()): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}
export const fmtDate = (d?: string) => (d ? `${Number(d.slice(0, 4))}. ${Number(d.slice(5, 7))}. ${Number(d.slice(8, 10))}.` : "확인 안 됨");

const listHref = (schoolId: string, search: string) => `/s/${schoolId}/facility-resources${search}`;
const detailHref = (schoolId: string, id: string, search: string) => `/s/${schoolId}/facility-resources/${encodeURIComponent(id)}${search}`;
const badge = "inline-flex items-center rounded-full px-2.5 py-0.5 text-sm font-semibold leading-snug break-keep";
const CATEGORY_BADGE: Record<Category, string> = {
  national: "bg-brand text-white",
  home: "bg-accent-soft text-accent border border-accent",
  other: "bg-neutral-soft text-ink",
  public: "bg-neutral-soft text-ink",
};
const ICON_OF: Record<Category, IconName> = { national: "file", home: "school", other: "school", public: "shield" };

// 사용자가 이 기기에서 고른 관할 지역(학교 정보에 없을 때만) — 기기별 편의 저장, 실패해도 동작
const officeKey = (schoolId: string) => `ss.facility.office.${schoolId}`;
export function readUserOffice(schoolId: string): string | null {
  try {
    return window.localStorage.getItem(officeKey(schoolId));
  } catch {
    return null;
  }
}
function writeUserOffice(schoolId: string, id: string | null) {
  try {
    if (id) window.localStorage.setItem(officeKey(schoolId), id);
    else window.localStorage.removeItem(officeKey(schoolId));
  } catch {
    /* 저장 불가(사생활 보호 모드 등) — 이번 화면에서만 적용 */
  }
}

/** 안전교육 자료 ↔ 시설 안전점검 자료 전환 탭(모바일 머리글 '교육자료' 하나로 두 화면을 오가기 위함) */
export function ResourceTabs({ schoolId, active }: { schoolId: string; active: "education" | "facility" }) {
  const tabs = [
    { id: "education", label: "안전교육 자료", href: `/s/${schoolId}/education` },
    { id: "facility", label: "시설 안전점검 자료", href: `/s/${schoolId}/facility-resources` },
  ] as const;
  return (
    <nav aria-label="안전 자료 종류" className="mx-auto mb-4 grid max-w-4xl grid-cols-2 gap-1 rounded-control border border-line bg-card p-1">
      {tabs.map((t) => (
        <Link
          key={t.id}
          href={t.href}
          aria-current={active === t.id ? "page" : undefined}
          className={`flex min-h-touch items-center justify-center rounded-control px-2 text-center text-base font-bold leading-snug break-keep ${active === t.id ? "bg-brand text-white" : "text-ink-muted hover:bg-brand-soft"}`}
        >
          {t.label}
        </Link>
      ))}
    </nav>
  );
}

function officeName(offices: readonly EduOffice[], id: string | null | undefined) {
  return offices.find((o) => o.id === id)?.name ?? null;
}

/** 간결한 자료 카드: 아이콘·자료명·기관·구분/유형 배지(최대 3)·분야 요약·화살표. 카드 전체가 내부 상세 링크 */
export function FacilityCard({ resource: r, href, category, offices, recent }: { resource: FacilityResource; href: string; category: Category; offices: readonly EduOffice[]; recent: boolean }) {
  const office = offices.find((o) => o.id === r.officeId);
  const catText = category === "home" || category === "other" ? `${CATEGORY_LABEL[category]} · ${office?.short ?? ""}` : CATEGORY_LABEL[category];
  return (
    <Link
      href={href}
      data-testid="fac-card"
      data-category={category}
      className="group flex min-h-touch w-full min-w-0 items-center gap-3 rounded-card border-2 border-line bg-card p-4 shadow-card transition-colors hover:border-brand hover:bg-brand-soft/40 focus-visible:border-brand focus-visible:outline-3 focus-visible:outline-offset-2 focus-visible:outline-brand"
    >
      <span aria-hidden className="flex size-11 shrink-0 items-center justify-center rounded-control bg-brand-soft text-brand">
        <Icon name={ICON_OF[category]} size={24} />
      </span>
      <span className="min-w-0 flex-1">
        <span className="block text-lg font-bold leading-snug break-keep text-ink [overflow-wrap:anywhere]">{r.title}</span>
        <span className="mt-0.5 block text-sm font-semibold text-ink-muted break-keep">{r.organization}</span>
        <span className="mt-2 flex flex-wrap gap-1.5">
          <span className={`${badge} ${CATEGORY_BADGE[category]}`}>{catText}</span>
          <span className={`${badge} border border-line text-ink`}>{SOURCE_TYPES[r.sourceType].label}</span>
          {recent && <span className={`${badge} bg-warning-soft text-warning-strong`} data-testid="fac-new">최근 개정</span>}
        </span>
        <span className="mt-1.5 block text-sm text-ink-muted break-keep">{areaSummaryOf(r)}</span>
      </span>
      <Icon name="chevron-right" size={24} className="shrink-0 text-ink-muted group-hover:text-brand" />
      <span className="sr-only">상세 정보 보기</span>
    </Link>
  );
}

function revisionLine(rev: Revision) {
  return [REVISION_KIND_LABEL[rev.kind], rev.number, rev.promulgatedAt ? `공포 ${fmtDate(rev.promulgatedAt)}` : null, rev.effectiveAt ? `시행 ${fmtDate(rev.effectiveAt)}` : null].filter(Boolean).join(" · ");
}

function Section({ id, title, note, children, action }: { id: string; title: string; note?: ReactNode; children: ReactNode; action?: ReactNode }) {
  return (
    <section aria-labelledby={id} className="space-y-2" data-testid={`fac-section-${id}`}>
      <div className="flex flex-wrap items-end justify-between gap-x-3 gap-y-1">
        <h2 id={id} className="text-lg font-bold">
          {title}
        </h2>
        {action}
      </div>
      {note && <p className="text-sm text-ink-muted break-keep">{note}</p>}
      {children}
    </section>
  );
}

function MoreToggle({ shown, total, open, onToggle, label }: { shown: number; total: number; open: boolean; onToggle: () => void; label: string }) {
  if (total <= shown && !open) return null;
  return (
    <button type="button" onClick={onToggle} aria-expanded={open} className="inline-flex min-h-touch items-center rounded-control px-2 text-base font-bold text-accent hover:underline">
      {open ? `${label} 접기` : `${label} 전체 보기(${total})`}
    </button>
  );
}

export function FacilityResourcesView({
  schoolId,
  schoolEduOfficeName,
  today,
  resources = FACILITY_RESOURCES,
  offices = EDU_OFFICES,
  initialFilter = EMPTY_FACILITY_FILTER,
  initialUserOffice = null,
  onFilterChange,
  onUserOfficeChange,
}: {
  schoolId: string;
  schoolEduOfficeName?: string | null;
  today: string;
  resources?: readonly FacilityResource[];
  offices?: readonly EduOffice[];
  initialFilter?: FacilityFilter;
  initialUserOffice?: string | null;
  onFilterChange?: (f: FacilityFilter) => void;
  onUserOfficeChange?: (id: string | null) => void;
}) {
  const [filter, setFilter] = useState<FacilityFilter>(initialFilter);
  const [userOffice, setUserOffice] = useState<string | null>(initialUserOffice);
  const [open, setOpen] = useState<Record<string, boolean>>({});
  const home: HomeOffice = resolveHomeOffice(offices, schoolEduOfficeName, userOffice);
  const homeName = officeName(offices, home.officeId);
  const active = isFacilityFilterActive(filter);
  const results = useMemo(() => filterFacilityResources(resources, filter, offices), [resources, filter, offices]);
  const groups = useMemo(() => groupByCategory(results, home.officeId), [results, home.officeId]);
  const recent = useMemo(() => recentChanges(resources, today, home.officeId), [resources, today, home.officeId]);
  const search = facilityFilterToSearch(filter);
  useEffect(() => onFilterChange?.(filter), [filter, onFilterChange]);
  const set = (patch: Partial<FacilityFilter>) => setFilter((f) => ({ ...f, ...patch }));
  const reset = () => setFilter(EMPTY_FACILITY_FILTER);
  const ids = { search: useId(), region: useId(), area: useId(), home: useId() };
  const toggle = (k: string) => setOpen((o) => ({ ...o, [k]: !o[k] }));
  const chooseHome = (id: string | null) => {
    setUserOffice(id);
    onUserOfficeChange?.(id);
  };

  const card = (r: FacilityResource) => (
    <li key={r.id} className="flex min-w-0">
      <FacilityCard resource={r} href={detailHref(schoolId, r.id, search)} category={categoryOf(r, home.officeId)} offices={offices} recent={isRecent(r, today)} />
    </li>
  );
  const limited = (key: string, list: FacilityResource[], n: number) => (active || open[key] ? list : list.slice(0, n));
  const grid = "grid grid-cols-1 gap-3 md:grid-cols-2";
  const RECENT_MAX = 4;
  const nationalHidden = groups.national.length === 0 && resources.some((r) => r.tier === "national");

  return (
    <div className="mx-auto max-w-4xl space-y-6">
      {/* ① 제목·필수 안내 */}
      <section aria-labelledby="fac-title">
        <div className="flex items-start gap-3">
          <span className="flex size-11 shrink-0 items-center justify-center rounded-full bg-brand-soft text-brand" aria-hidden>
            <Icon name="building" size={24} />
          </span>
          <div className="min-w-0">
            <h2 id="fac-title" className="text-xl font-bold break-keep">
              {FACILITY_TEXT.title}
            </h2>
            <p className="mt-0.5 text-base text-ink-muted break-keep">{FACILITY_TEXT.lead}</p>
          </div>
        </div>
        <p role="note" className="mt-3 flex items-start gap-2 text-sm text-ink-muted break-keep" data-testid="fac-required">
          <Icon name="info" size={18} className="mt-0.5 shrink-0 text-accent" />
          <span>
            {FACILITY_TEXT.required} {FACILITY_TEXT.noRecord}
          </span>
        </p>
      </section>

      {/* ② 학교 관할 정보(탐색 지역과 별개) */}
      <section aria-labelledby={ids.home} className="rounded-card border-2 border-accent bg-accent-soft p-4" data-testid="fac-home">
        {home.source === "school" ? (
          <>
            <h2 id={ids.home} className="text-base font-bold break-keep">
              내 학교 관할 교육청: <span className="text-accent">{homeName}</span>
            </h2>
            <p className="mt-0.5 text-sm text-ink-muted">학교 등록 정보(학교알리미 교육청명) 기준입니다.</p>
          </>
        ) : (
          <>
            <h2 id={ids.home} className="text-base font-bold break-keep">
              {home.source === "user" ? (
                <>
                  내 학교 관할 교육청(이 기기에서 선택): <span className="text-accent">{homeName}</span>
                </>
              ) : (
                FACILITY_TEXT.chooseRegion
              )}
            </h2>
            <p className="mt-0.5 text-sm text-ink-muted break-keep">
              학교 등록 정보에 관할 교육청이 없어 직접 선택합니다. 이 기기에서만 쓰이며 학교 정보는 바뀌지 않습니다.
            </p>
            <label htmlFor={`${ids.home}-sel`} className="sr-only">
              내 학교 관할 교육청 선택
            </label>
            <select
              id={`${ids.home}-sel`}
              value={userOffice ?? ""}
              onChange={(e) => chooseHome(e.target.value || null)}
              className="mt-2 block min-h-touch w-full rounded-control border-2 border-line-strong bg-card px-3 text-lg sm:max-w-sm"
            >
              <option value="">선택 안 함</option>
              {offices.map((o) => (
                <option key={o.id} value={o.id}>
                  {o.name}
                </option>
              ))}
            </select>
          </>
        )}
        {home.officeId && offices.find((o) => o.id === home.officeId)?.note && <p className="mt-2 text-sm break-keep">{offices.find((o) => o.id === home.officeId)!.note}</p>}
      </section>

      {/* ③ 최근 제정·개정 */}
      <Section
        id="fac-recent"
        title="최근 제정·개정된 안전 관련 법령·지침"
        note={`${FACILITY_TEXT.recentNote} 자료 확인일 ${fmtDate(FACILITY_DATA_CHECKED_AT)}`}
        action={<MoreToggle shown={RECENT_MAX} total={recent.length} open={!!open.recent} onToggle={() => toggle("recent")} label="최근 개정" />}
      >
        {recent.length === 0 ? (
          <p className="rounded-card border border-dashed border-line-strong bg-card p-4 text-base break-keep" data-testid="fac-no-recent">
            {FACILITY_TEXT.noRecent}
          </p>
        ) : (
          <ul className="divide-y divide-line rounded-card border border-line bg-card" data-testid="fac-recent-list">
            {(open.recent ? recent : recent.slice(0, RECENT_MAX)).map((c) => (
              <li key={`${c.resource.id}-${c.revision.number ?? c.date}`}>
                <Link href={detailHref(schoolId, c.resource.id, search)} className="flex min-h-touch items-center gap-3 px-4 py-3 hover:bg-brand-soft/40" data-testid="fac-recent-item">
                  <span className="min-w-0 flex-1">
                    <span className="flex flex-wrap gap-1.5">
                      <span className={`${badge} bg-warning-soft text-warning-strong`}>{c.badge}</span>
                      <span className={`${badge} ${c.phase === "scheduled" ? "border border-warning text-warning-strong" : "bg-success-soft text-success"}`}>{c.phase === "scheduled" ? "시행 예정" : "시행 중"}</span>
                      <span className={`${badge} ${CATEGORY_BADGE[c.category]}`}>{CATEGORY_LABEL[c.category]}</span>
                    </span>
                    <span className="mt-1 block text-base font-bold break-keep [overflow-wrap:anywhere]">{c.resource.title}</span>
                    <span className="block text-sm text-ink-muted break-keep">{revisionLine(c.revision)}</span>
                  </span>
                  <Icon name="chevron-right" size={22} className="shrink-0 text-ink-muted" />
                </Link>
              </li>
            ))}
          </ul>
        )}
      </Section>

      {/* 검색·필터 */}
      <section aria-label="자료 찾기 조건" className="space-y-3 rounded-card border border-line bg-card p-4">
        <div>
          <label htmlFor={ids.search} className="text-base font-bold">
            법령명·매뉴얼명·기관명 검색
          </label>
          <div className="relative mt-1.5">
            <Icon name="search" size={20} className="pointer-events-none absolute top-1/2 left-3 -translate-y-1/2 text-ink-muted" />
            <input
              id={ids.search}
              type="search"
              value={filter.query}
              maxLength={50}
              autoComplete="off"
              enterKeyHint="search"
              placeholder="예: 안전점검, 매뉴얼"
              aria-describedby={`${ids.search}-help`}
              onChange={(e) => set({ query: e.target.value })}
              className="block min-h-touch w-full rounded-control border-2 border-line-strong bg-card py-2 pr-3 pl-10 text-lg"
            />
          </div>
          <p id={`${ids.search}-help`} className="mt-1 text-sm text-ink-muted break-keep">
            {FACILITY_TEXT.searchScope}
          </p>
        </div>
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
          <div className="min-w-0">
            <label htmlFor={ids.region} className="text-base font-bold">
              제공 기관·지역
            </label>
            <select
              id={ids.region}
              value={filter.region}
              onChange={(e) => set({ region: e.target.value })}
              className={`mt-1.5 block min-h-touch w-full rounded-control border-2 bg-card px-3 text-lg ${filter.region !== "all" ? "border-brand font-bold text-brand" : "border-line-strong"}`}
            >
              <option value="all">전체</option>
              <option value="national">전국 공통(국가 법령)</option>
              {offices.map((o) => (
                <option key={o.id} value={o.id}>
                  {o.name}
                  {o.id === home.officeId ? " (우리 관할)" : ""}
                </option>
              ))}
            </select>
          </div>
          <div className="min-w-0">
            <label htmlFor={ids.area} className="text-base font-bold">
              시설 점검 분야
            </label>
            <select
              id={ids.area}
              value={filter.area}
              onChange={(e) => set({ area: e.target.value as FacilityAreaId | "all" })}
              className={`mt-1.5 block min-h-touch w-full rounded-control border-2 bg-card px-3 text-lg ${filter.area !== "all" ? "border-brand font-bold text-brand" : "border-line-strong"}`}
            >
              <option value="all">전체 분야</option>
              {FACILITY_AREAS.map((a) => (
                <option key={a.id} value={a.id}>
                  {a.label}
                </option>
              ))}
            </select>
          </div>
        </div>
        {filter.region !== "all" && (
          <p className="text-sm break-keep" data-testid="fac-browsing">
            현재 탐색 중: <strong>{filter.region === "national" ? "전국 공통(국가 법령)" : officeName(offices, filter.region)}</strong>
            {home.officeId && filter.region !== "national" && filter.region !== home.officeId && " — 우리 관할이 아닌 타 지역 참고자료입니다."}
          </p>
        )}
        <div className="flex min-h-touch flex-wrap items-center justify-between gap-2">
          <p className="text-base font-bold" aria-live="polite">
            자료 <span data-testid="fac-count">{results.length}</span>건
          </p>
          {active && (
            <PrimaryButton variant="ghost" icon="refresh" onClick={reset}>
              필터 초기화
            </PrimaryButton>
          )}
        </div>
      </section>

      {results.length === 0 ? (
        <div data-testid="fac-empty" className="rounded-card border-2 border-dashed border-line-strong bg-card p-6 text-center">
          <h2 className="text-lg font-bold">{FACILITY_TEXT.empty}</h2>
          <p className="mt-1 text-base text-ink-muted break-keep">
            {filter.query.trim() ? `등록한 안내 정보에서 '${filter.query.trim()}'에 맞는 자료를 찾지 못했습니다.` : "선택한 기관·분야에 등록된 확인 자료가 없습니다."} 조건을 바꾸거나 필터를 초기화해 주세요.
          </p>
          <div className="mt-4 flex justify-center">
            <PrimaryButton variant="secondary" icon="refresh" onClick={reset}>
              필터 초기화
            </PrimaryButton>
          </div>
        </div>
      ) : (
        <>
          {groups.national.length > 0 && (
            <Section
              id="fac-national"
              title="국가 공통 핵심 법령"
              note="국가법령정보센터의 현행 원문으로 연결합니다."
              action={!active && <MoreToggle shown={3} total={groups.national.length} open={!!open.national} onToggle={() => toggle("national")} label="법령" />}
            >
              <ul className={grid}>{limited("national", groups.national, 3).map(card)}</ul>
            </Section>
          )}
          {nationalHidden && (
            <p className="text-sm">
              <button type="button" onClick={() => set({ region: "national", area: "all" })} className="inline-flex min-h-touch items-center font-bold text-accent underline underline-offset-4">
                국가 공통 법령 보기
              </button>
            </p>
          )}

          {(groups.home.length > 0 || (home.officeId && !active)) && (
            <Section id="fac-home-office" title={`우리 지역 교육청 지침·매뉴얼${homeName ? ` — ${homeName}` : ""}`} note="자료마다 적용 대상과 시행 시점을 원문에서 확인해 주세요.">
              {groups.home.length > 0 ? <ul className={grid}>{groups.home.map(card)}</ul> : <p className="text-base text-ink-muted">우리 관할 교육청의 확인된 자료가 아직 없습니다.</p>}
            </Section>
          )}

          {groups.other.length > 0 && (
            <Section
              id="fac-other"
              title={home.officeId ? "전국 교육청 자료 탐색(타 지역 참고자료)" : "전국 교육청 자료 탐색"}
              note={home.officeId ? "다른 지역 교육청 자료는 참고용이며 우리 학교의 의무 지침이 아닐 수 있습니다." : "관할 교육청을 선택하면 해당 교육청 자료를 먼저 보여 줍니다."}
              action={!active && <MoreToggle shown={4} total={groups.other.length} open={!!open.other} onToggle={() => toggle("other")} label="교육청 자료" />}
            >
              <ul className={grid}>{limited("other", groups.other, 4).map(card)}</ul>
            </Section>
          )}

          {groups.public.length > 0 && (
            <Section id="fac-public" title="공공기관 참고자료">
              <ul className={grid}>{groups.public.map(card)}</ul>
            </Section>
          )}
        </>
      )}

      <section aria-labelledby="fac-external" className="px-1 text-sm text-ink-muted">
        <h2 id="fac-external" className="text-base font-bold text-ink">
          외부 사이트 이용 안내
        </h2>
        <p className="mt-1 break-keep">
          원문은 각 기관의 공식 사이트에서 새 창으로 열립니다. 법령 전문을 이 앱에 복제하지 않으며, SAFE SCHOOL은 외부 사이트에 학교·개인 정보를 보내지 않습니다.
        </p>
      </section>
    </div>
  );
}

function DetailBlock({ title, children }: { title: string; children: ReactNode }) {
  return (
    <section className="border-t border-line pt-4">
      <h3 className="text-base font-bold text-ink-muted">{title}</h3>
      <div className="mt-1.5 text-base break-keep">{children}</div>
    </section>
  );
}

const OPEN_LABEL: Record<FacilityResource["urlKind"], string> = {
  current: "현행 법령 원문 확인",
  version: "공식 원문 확인",
  direct: "공식 원문 자료 열기",
  board: "공식 자료실 열기",
  home: "기관 홈페이지 열기",
};
const URL_KIND_TEXT: Record<FacilityResource["urlKind"], string> = {
  current: "국가법령정보센터의 현행 법령 바로가기(항상 현재 시행 중인 판)",
  version: "확인한 특정 판의 원문",
  direct: "확인한 자료 원문(파일)",
  board: "확인한 공식 자료실·게시판(개별 자료는 원문에서 확인)",
  home: "기관 홈페이지·부서 안내(자료 원문 주소는 확인하지 못함)",
};

export function FacilityResourceDetailView({
  schoolId,
  resourceId,
  search = "",
  homeOfficeId,
  today,
  resources = FACILITY_RESOURCES,
  offices = EDU_OFFICES,
  allowedHosts = FACILITY_ALLOWED_HOSTS,
}: {
  schoolId: string;
  resourceId: string;
  search?: string;
  homeOfficeId: string | null;
  today: string;
  resources?: readonly FacilityResource[];
  offices?: readonly EduOffice[];
  allowedHosts?: readonly string[];
}) {
  const back = listHref(schoolId, facilityFilterToSearch(facilityFilterFromSearch(search, offices)));
  const backSearch = facilityFilterToSearch(facilityFilterFromSearch(search, offices));
  const r = findFacilityResource(resources, resourceId);
  const backLink = (
    <Link href={back} data-testid="fac-back" className="inline-flex min-h-touch items-center gap-1 rounded-control pr-2 text-base font-bold text-accent hover:underline">
      <Icon name="chevron-left" size={22} />
      목록으로 돌아가기
    </Link>
  );
  if (!r)
    return (
      <div className="mx-auto max-w-3xl space-y-3">
        {backLink}
        <div data-testid="fac-not-found" className="rounded-card border-2 border-dashed border-line-strong bg-card p-6 text-center">
          <h2 className="text-lg font-bold">찾는 자료가 없습니다</h2>
          <p className="mt-1 text-base text-ink-muted">주소가 바뀌었거나 등록되지 않은 자료입니다. 목록에서 다시 골라 주세요.</p>
        </div>
      </div>
    );

  const category = categoryOf(r, homeOfficeId);
  const status = statusOf(r, today);
  const office = offices.find((o) => o.id === r.officeId);
  const safe = isSafeExternalUrl(r.officialUrl, allowedHosts);
  const versionSafe = r.versionUrl !== undefined && isSafeExternalUrl(r.versionUrl, allowedHosts);
  const officeHome = office && office.homepage !== r.officialUrl && isSafeExternalUrl(office.homepage, allowedHosts) ? office.homepage : null;
  const related = (r.relatedIds ?? []).map((id) => findFacilityResource(resources, id)).filter((x): x is FacilityResource => !!x);
  const recent = isRecent(r, today);
  const textLink = (href: string, label: string, testid: string) => (
    <a href={href} target="_blank" rel="noopener noreferrer" referrerPolicy="no-referrer" data-testid={testid} className="inline-flex min-h-touch items-center gap-1 font-bold text-accent underline underline-offset-4 [overflow-wrap:anywhere]">
      {label}
      <Icon name="external" size={16} />
      <span className="sr-only">(새 창에서 열림)</span>
    </a>
  );

  return (
    <div className="mx-auto max-w-3xl space-y-3">
      {backLink}
      <article aria-labelledby="fac-detail-title" className="space-y-4 rounded-card border border-line bg-card p-4 shadow-card sm:p-6">
        <header className="flex flex-col items-start gap-3 sm:flex-row">
          <span aria-hidden className="flex size-14 shrink-0 items-center justify-center rounded-control bg-brand-soft text-brand">
            <Icon name={ICON_OF[category]} size={30} />
          </span>
          <div className="min-w-0 max-w-full">
            <h2 id="fac-detail-title" className="text-xl font-bold leading-snug break-keep [overflow-wrap:anywhere] sm:text-2xl">
              {r.title}
            </h2>
            <p className="mt-0.5 text-base font-semibold text-ink-muted break-keep">제공 기관 · {r.organization}</p>
            <div className="mt-2 flex flex-wrap gap-1.5" data-testid="fac-detail-badges">
              <span className={`${badge} ${CATEGORY_BADGE[category]}`}>{CATEGORY_LABEL[category]}</span>
              <span className={`${badge} border border-line`}>{SOURCE_TYPES[r.sourceType].label}</span>
              <span className={`${badge} ${status === "in_force" ? "bg-success-soft text-success" : status === "scheduled" ? "border border-warning text-warning-strong" : "bg-neutral-soft text-ink"}`}>{STATUS_LABEL[status]}</span>
              {recent && <span className={`${badge} bg-warning-soft text-warning-strong`}>최근 개정</span>}
            </div>
          </div>
        </header>

        {category === "other" && (
          <p role="note" className="rounded-control border-2 border-warning bg-warning-soft px-3 py-2 text-base font-semibold text-warning-strong break-keep" data-testid="fac-other-note">
            {homeOfficeId ? "우리 관할이 아닌 다른 지역 교육청 자료입니다. 참고용이며 우리 학교의 의무 지침이 아닐 수 있습니다." : "관할 교육청을 확인하지 못했습니다. 이 교육청 자료가 우리 학교에 적용되는지 확인해 주세요."}
          </p>
        )}

        <DetailBlock title="주요 내용">
          <p>{r.description}</p>
        </DetailBlock>
        <DetailBlock title="적용 대상·관련 지역">
          <p>{r.appliesTo}</p>
          <p className="mt-1 text-sm text-ink-muted">{r.tier === "national" ? "전국 공통" : r.tier === "public" ? "공공기관 자료" : `${office?.name ?? ""} 자료`}</p>
        </DetailBlock>
        <DetailBlock title="관련 시설 분야">
          {r.facilityAreas.length ? (
            <ul className="flex flex-wrap gap-1.5">
              {r.facilityAreas.map((a) => (
                <li key={a} className={`${badge} border border-line`}>
                  {FACILITY_AREA_LABEL[a]}
                </li>
              ))}
            </ul>
          ) : (
            <p className="text-ink-muted">기관 안내 카드라 시설 분야를 정하지 않았습니다.</p>
          )}
        </DetailBlock>
        <DetailBlock title="제정·개정 정보">
          {r.revisions.length ? (
            <ol className="space-y-1" data-testid="fac-revisions">
              {r.revisions.map((rev, i) => (
                <li key={`${rev.number ?? i}`} className={i === 0 ? "font-semibold" : "text-ink-muted"}>
                  {i === 0 && <span className="mr-1 text-sm text-ink-muted">확인한 최근 판 ·</span>}
                  {revisionLine(rev)}
                  {rev.effectiveAt && rev.effectiveAt > today && <span className={`${badge} ml-1 border border-warning text-warning-strong`}>시행 예정</span>}
                </li>
              ))}
            </ol>
          ) : (
            <p className="text-ink-muted">제정·개정 정보를 확인하지 못했습니다. 발행·개정일은 원문에서 확인해 주세요.</p>
          )}
        </DetailBlock>
        <DetailBlock title="자료 확인 정보">
          <p>
            링크 확인일 {fmtDate(r.verifiedAt)} · 확인 상태: {VERIFICATION_LABEL[r.verification]}
          </p>
          <p className="mt-1 text-sm text-ink-muted">확인일은 SAFE SCHOOL이 링크를 확인한 날이며, 법령·지침의 개정일이 아닙니다.</p>
        </DetailBlock>
        <DetailBlock title="자료를 찾는 방법">
          <p>{r.howTo}</p>
        </DetailBlock>
        <DetailBlock title="적용 시 주의사항">
          <p>{r.applicabilityNote}</p>
        </DetailBlock>
        <DetailBlock title="연결 주소">
          <ul className="space-y-1">
            <li>'{OPEN_LABEL[r.urlKind]}' 단추: {URL_KIND_TEXT[r.urlKind]}</li>
            {versionSafe && <li>확인한 판 원문: {textLink(r.versionUrl!, "확인한 판 열기", "fac-version-link")}</li>}
            {officeHome && <li>기관 홈페이지: {textLink(officeHome, new URL(officeHome).hostname, "fac-home-link")}</li>}
          </ul>
        </DetailBlock>
        {related.length > 0 && (
          <DetailBlock title="관련 자료">
            <ul className="space-y-0.5">
              {related.map((x) => (
                <li key={x.id}>
                  <Link href={detailHref(schoolId, x.id, backSearch)} className="inline-flex min-h-touch items-center font-bold text-accent underline underline-offset-4 break-keep">
                    {x.title}
                  </Link>
                </li>
              ))}
            </ul>
          </DetailBlock>
        )}
        <p role="note" className="rounded-control bg-page px-3 py-2 text-sm text-ink-muted break-keep" data-testid="fac-required">
          {FACILITY_TEXT.required}
        </p>
        <div className="border-t border-line pt-4">
          {safe ? (
            <a
              href={r.officialUrl}
              target="_blank"
              rel="noopener noreferrer"
              referrerPolicy="no-referrer"
              aria-label={`${r.title} ${OPEN_LABEL[r.urlKind]} (새 창에서 열림)`}
              data-testid="fac-external-link"
              className="inline-flex min-h-14 w-full items-center justify-center gap-2 rounded-control bg-brand px-5 py-2 text-center text-lg font-bold leading-snug text-white break-keep hover:bg-brand-hover sm:w-auto"
            >
              <span>{OPEN_LABEL[r.urlKind]}</span>
              <Icon name="external" size={22} />
            </a>
          ) : (
            <p role="note" data-testid="fac-blocked-link" className="rounded-control border-2 border-warning bg-warning-soft px-3 py-2 text-base font-bold text-warning-strong">
              링크 확인 필요 — 확인되지 않은 주소라 이동할 수 없습니다.
            </p>
          )}
        </div>
      </article>
    </div>
  );
}

function useSchoolOffice(schoolId: string) {
  const { usableMemberships } = useSession();
  const m = usableMemberships.find((x) => x.school.id === schoolId);
  return m?.school.eduOfficeName ?? null;
}

export function FacilityResourcesPage({ schoolId }: { schoolId: string }) {
  const eduOfficeName = useSchoolOffice(schoolId);
  const [initial] = useState(() => facilityFilterFromSearch(window.location.search, EDU_OFFICES));
  const [userOffice] = useState(() => readUserOffice(schoolId));
  const sync = useCallback(
    (f: FacilityFilter) => {
      const next = listHref(schoolId, facilityFilterToSearch(f));
      if (window.location.pathname + window.location.search !== next) window.history.replaceState(window.history.state, "", next);
    },
    [schoolId],
  );
  return (
    <AppShell title="시설 안전 자료" schoolId={schoolId}>
      <ResourceTabs schoolId={schoolId} active="facility" />
      <FacilityResourcesView
        schoolId={schoolId}
        schoolEduOfficeName={eduOfficeName}
        today={localToday()}
        initialFilter={initial}
        initialUserOffice={userOffice}
        onFilterChange={sync}
        onUserOfficeChange={(id) => writeUserOffice(schoolId, id)}
      />
    </AppShell>
  );
}

export function FacilityResourceDetailPage({ schoolId, resourceId }: { schoolId: string; resourceId: string }) {
  const eduOfficeName = useSchoolOffice(schoolId);
  const home = resolveHomeOffice(EDU_OFFICES, eduOfficeName, readUserOffice(schoolId));
  return (
    <AppShell title="시설 안전 자료" schoolId={schoolId}>
      <FacilityResourceDetailView schoolId={schoolId} resourceId={resourceId} search={window.location.search} homeOfficeId={home.officeId} today={localToday()} />
    </AppShell>
  );
}
