// STEP 4 안전교육 자료 안내: 검색 → 간결한 기관 카드 선택 → (SAFE SCHOOL 안) 상세 확인 → 공식 사이트 이동
// - 교육 이수·실적을 기록하지 않고, 개인정보를 입력받지 않으며, 서버 API·DB를 쓰지 않습니다(정적 안내 데이터).
// - 검색은 이 화면에 등록한 안내 정보만 대상으로 합니다(외부 사이트 내용 검색 아님).
// - 검색어·필터는 주소 쿼리(?q=&level=&area=)에 보관 → 상세에서 돌아오기·뒤로 가기·새로고침 때 그대로 복원.
// - 접근: App.tsx 의 학교 화면 공통 검사(로그인 + 승인된 소속)를 그대로 사용합니다(권한 로직 변경 없음).
import { useEffect, useId, useMemo, useState, type ReactNode } from "react";
import { AppShell } from "../../components/layout/AppShell";
import { Icon } from "../../components/ui/Icon";
import { PrimaryButton } from "../../components/ui/PrimaryButton";
import { Link } from "../../lib/router";
import { EDUCATION_ALLOWED_HOSTS, EDUCATION_RESOURCES } from "../../data/educationResources";
import { ResourceTabs } from "../facility/FacilityResourcesPage";
import {
  AREA_LABEL,
  EDUCATION_AREAS,
  EMPTY_FILTER,
  LEVEL_LABEL,
  SCHOOL_LEVELS,
  areaSummary,
  filterFromSearch,
  filterResources,
  filterToSearch,
  findResource,
  isFilterActive,
  isSafeExternalUrl,
  levelSummary,
  type EducationAreaId,
  type EducationResource,
  type ResourceFilter,
  type SchoolLevelId,
} from "../../lib/educationResources";

export const EDUCATION_TEXT = {
  title: "안전교육 자료 찾기",
  lead: "학교 안전교육에 필요한 공식 자료 제공처를 찾아보세요.",
  sourceShort: "교육자료는 각 기관의 공식 사이트에서 제공됩니다.",
  source: "교육자료는 해당 기관의 공식 사이트에서 제공됩니다. 자료의 최신 내용과 이용 조건은 원문 사이트에서 확인해 주세요.",
  noRecord: "이 화면에서는 교육 이수·실적을 기록하지 않습니다.",
  searchScope: "SAFE SCHOOL에 등록한 안내 정보에서만 찾습니다(외부 사이트 내용 검색 아님).",
  empty: "현재 확인된 자료가 없습니다",
} as const;

const listHref = (schoolId: string, search: string) => `/s/${schoolId}/education${search}`;
const detailHref = (schoolId: string, id: string, search: string) => `/s/${schoolId}/education/${encodeURIComponent(id)}${search}`;

const badge = "inline-flex items-center rounded-full px-2.5 py-0.5 text-sm font-semibold leading-snug break-keep";

/** 통일된 기관 아이콘(공식 로고 사용 허가를 확인하지 못해 로고 이미지를 쓰지 않음 — 외부 이미지 로딩 실패도 없음) */
function OrgSymbol({ symbol, size = "md" }: { symbol: EducationResource["symbol"]; size?: "md" | "lg" }) {
  return (
    <span aria-hidden className={`flex shrink-0 items-center justify-center rounded-control bg-brand-soft text-brand ${size === "lg" ? "size-14" : "size-11"}`}>
      <Icon name={symbol} size={size === "lg" ? 30 : 24} />
    </span>
  );
}

/** 목록용 간결한 카드: 카드 전체가 SAFE SCHOOL 안의 상세 페이지 링크(외부 이동 단추 없음) */
export function ResourceSummaryCard({ resource: r, href }: { resource: EducationResource; href: string }) {
  return (
    <Link
      href={href}
      data-testid="edu-card"
      className="group flex min-h-touch w-full min-w-0 items-center gap-3 rounded-card border-2 border-line bg-card p-4 shadow-card transition-colors hover:border-brand hover:bg-brand-soft/40 focus-visible:border-brand focus-visible:outline-3 focus-visible:outline-offset-2 focus-visible:outline-brand"
    >
      <OrgSymbol symbol={r.symbol} />
      <span className="min-w-0 flex-1">
        <span className="block text-lg font-bold leading-snug break-keep text-ink [overflow-wrap:anywhere]">{r.name}</span>
        <span className="mt-0.5 block text-sm font-semibold text-ink-muted break-keep">{r.operator}</span>
        <span className="mt-2 flex flex-wrap gap-1.5">
          <span className={`${badge} bg-brand-soft text-brand`}>{levelSummary(r)}</span>
          <span className={`${badge} bg-neutral-soft text-ink`}>{areaSummary(r)}</span>
        </span>
      </span>
      <Icon name="chevron-right" size={24} className="shrink-0 text-ink-muted group-hover:text-brand" />
      <span className="sr-only">상세 정보 보기</span>
    </Link>
  );
}

function ExternalButton({ href, siteName, label = "공식 사이트 방문" }: { href: string; siteName: string; label?: string }) {
  return (
    <a
      href={href}
      target="_blank"
      rel="noopener noreferrer"
      referrerPolicy="no-referrer"
      aria-label={`${siteName} ${label} (새 창에서 열림)`}
      data-testid="edu-external-link"
      className="inline-flex min-h-14 w-full items-center justify-center gap-2 rounded-control bg-brand px-5 py-2 text-center text-lg font-bold leading-snug text-white break-keep hover:bg-brand-hover sm:w-auto"
    >
      <span>{label}</span>
      <Icon name="external" size={22} />
    </a>
  );
}

function SelectField<T extends string>({
  label,
  value,
  options,
  onChange,
}: {
  label: string;
  value: T;
  options: { value: T; label: string }[];
  onChange: (v: T) => void;
}) {
  const id = useId();
  return (
    <div className="min-w-0">
      <label htmlFor={id} className="text-base font-bold">
        {label}
      </label>
      <div className="relative mt-1.5">
        <select
          id={id}
          value={value}
          onChange={(e) => onChange(e.target.value as T)}
          className={`block min-h-touch w-full appearance-none rounded-control border-2 bg-card py-2 pr-10 pl-3 text-lg ${value !== "all" ? "border-brand font-bold text-brand" : "border-line-strong text-ink"}`}
        >
          {options.map((o) => (
            <option key={o.value} value={o.value}>
              {o.label}
            </option>
          ))}
        </select>
        <Icon name="chevron-right" size={20} className="pointer-events-none absolute top-1/2 right-3 -translate-y-1/2 rotate-90 text-ink-muted" />
      </div>
    </div>
  );
}

const LEVEL_OPTIONS: { value: SchoolLevelId | "all"; label: string }[] = [{ value: "all", label: "전체 학교급" }, ...SCHOOL_LEVELS.map((l) => ({ value: l.id, label: l.label }))];
const AREA_OPTIONS: { value: EducationAreaId | "all"; label: string }[] = [{ value: "all", label: "전체 영역" }, ...EDUCATION_AREAS.map((a) => ({ value: a.id, label: a.label }))];

export function EducationResourcesView({
  schoolId,
  resources = EDUCATION_RESOURCES,
  initialFilter = EMPTY_FILTER,
  onFilterChange,
}: {
  schoolId: string;
  resources?: readonly EducationResource[];
  initialFilter?: ResourceFilter;
  onFilterChange?: (f: ResourceFilter) => void;
}) {
  const [filter, setFilter] = useState<ResourceFilter>(initialFilter);
  const results = useMemo(() => filterResources(resources, filter), [resources, filter]);
  const active = isFilterActive(filter);
  const searchId = useId();
  const search = filterToSearch(filter);
  useEffect(() => onFilterChange?.(filter), [filter, onFilterChange]);
  const set = (patch: Partial<ResourceFilter>) => setFilter((f) => ({ ...f, ...patch }));
  const reset = () => setFilter(EMPTY_FILTER);

  return (
    <div className="mx-auto max-w-4xl space-y-5">
      <section aria-labelledby="edu-title">
        <div className="flex items-start gap-3">
          <span className="flex size-11 shrink-0 items-center justify-center rounded-full bg-brand-soft text-brand" aria-hidden>
            <Icon name="book" size={24} />
          </span>
          <div className="min-w-0">
            <h2 id="edu-title" className="text-xl font-bold">
              {EDUCATION_TEXT.title}
            </h2>
            <p className="mt-0.5 text-base text-ink-muted break-keep">{EDUCATION_TEXT.lead}</p>
          </div>
        </div>
        <p role="note" className="mt-3 flex items-start gap-2 text-base font-semibold break-keep">
          <Icon name="info" size={20} className="mt-0.5 shrink-0 text-accent" />
          <span>
            {EDUCATION_TEXT.sourceShort} <span className="text-sm font-normal text-ink-muted">{EDUCATION_TEXT.noRecord}</span>
          </span>
        </p>
      </section>

      <section aria-label="자료 찾기 조건" className="space-y-3 rounded-card border border-line bg-card p-4">
        <div>
          <label htmlFor={searchId} className="text-base font-bold">
            사이트·주제 검색
          </label>
          <div className="relative mt-1.5">
            <Icon name="search" size={20} className="pointer-events-none absolute top-1/2 left-3 -translate-y-1/2 text-ink-muted" />
            <input
              id={searchId}
              type="search"
              value={filter.query}
              maxLength={50}
              autoComplete="off"
              enterKeyHint="search"
              placeholder="예: 교통, 동영상"
              aria-describedby={`${searchId}-help`}
              onChange={(e) => set({ query: e.target.value })}
              className="block min-h-touch w-full rounded-control border-2 border-line-strong bg-card py-2 pr-3 pl-10 text-lg"
            />
          </div>
          <p id={`${searchId}-help`} className="mt-1 text-sm text-ink-muted break-keep">
            {EDUCATION_TEXT.searchScope}
          </p>
        </div>
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
          <SelectField label="학교급" value={filter.level} options={LEVEL_OPTIONS} onChange={(level) => set({ level })} />
          <SelectField label="안전교육 영역" value={filter.area} options={AREA_OPTIONS} onChange={(area) => set({ area })} />
        </div>
      </section>

      <section aria-labelledby="edu-results" className="space-y-3">
        <div className="flex min-h-touch flex-wrap items-center justify-between gap-2">
          <h2 id="edu-results" className="text-lg font-bold" aria-live="polite">
            자료 제공처 <span data-testid="edu-count">{results.length}</span>곳
          </h2>
          {active && (
            <PrimaryButton variant="ghost" icon="refresh" onClick={reset}>
              필터 초기화
            </PrimaryButton>
          )}
        </div>
        {results.length === 0 ? (
          <div data-testid="edu-empty" className="rounded-card border-2 border-dashed border-line-strong bg-card p-6 text-center">
            <div className="mx-auto flex size-12 items-center justify-center rounded-full bg-brand-soft text-brand">
              <Icon name="info" size={26} />
            </div>
            <h3 className="mt-3 text-lg font-bold">{EDUCATION_TEXT.empty}</h3>
            <p className="mt-1 text-base text-ink-muted break-keep">
              {filter.query.trim()
                ? `등록한 안내 정보에서 '${filter.query.trim()}'에 맞는 자료 제공처를 찾지 못했습니다.`
                : "선택한 조건에 맞는 공식 자료 제공처를 아직 확인하지 못했습니다."}{" "}
              조건을 바꾸거나 필터를 초기화해 주세요.
            </p>
            <div className="mt-4 flex justify-center">
              <PrimaryButton variant="secondary" icon="refresh" onClick={reset}>
                필터 초기화
              </PrimaryButton>
            </div>
          </div>
        ) : (
          <ul className="grid grid-cols-1 gap-3 md:grid-cols-2">
            {results.map((r) => (
              <li key={r.id} className="flex min-w-0">
                <ResourceSummaryCard resource={r} href={detailHref(schoolId, r.id, search)} />
              </li>
            ))}
          </ul>
        )}
      </section>

      <section aria-labelledby="edu-external" className="rounded-card bg-page px-1 text-sm text-ink-muted">
        <h2 id="edu-external" className="text-base font-bold text-ink">
          외부 사이트 이용 안내
        </h2>
        <p className="mt-1 break-keep">
          {EDUCATION_TEXT.source} 공식 사이트는 새 창에서 열리며, SAFE SCHOOL은 외부 사이트에 로그인 정보나 개인정보를 보내지 않습니다.
        </p>
      </section>
    </div>
  );
}

function DetailSection({ title, children }: { title: string; children: ReactNode }) {
  return (
    <section className="border-t border-line pt-4">
      <h3 className="text-base font-bold text-ink-muted">{title}</h3>
      <div className="mt-1.5 text-base break-keep">{children}</div>
    </section>
  );
}

export function EducationResourceDetailView({
  schoolId,
  resourceId,
  search = "",
  resources = EDUCATION_RESOURCES,
  allowedHosts = EDUCATION_ALLOWED_HOSTS,
}: {
  schoolId: string;
  resourceId: string;
  search?: string;
  resources?: readonly EducationResource[];
  allowedHosts?: readonly string[];
}) {
  // 돌아갈 목록 주소: 받은 쿼리를 한 번 해석해 허용된 값만 다시 만듦(임의 값이 주소로 새지 않게)
  const back = listHref(schoolId, filterToSearch(filterFromSearch(search)));
  const r = findResource(resources, resourceId);
  const backLink = (
    <Link href={back} data-testid="edu-back" className="inline-flex min-h-touch items-center gap-1 rounded-control pr-2 text-base font-bold text-accent hover:underline">
      <Icon name="chevron-left" size={22} />
      목록으로 돌아가기
    </Link>
  );
  if (!r)
    return (
      <div className="mx-auto max-w-3xl space-y-3">
        {backLink}
        <div data-testid="edu-not-found" className="rounded-card border-2 border-dashed border-line-strong bg-card p-6 text-center">
          <h2 className="text-lg font-bold">찾는 자료 제공처가 없습니다</h2>
          <p className="mt-1 text-base text-ink-muted">주소가 바뀌었거나 등록되지 않은 기관입니다. 목록에서 다시 골라 주세요.</p>
        </div>
      </div>
    );

  const safe = isSafeExternalUrl(r.url, allowedHosts);
  const homeLink = r.homeUrl !== undefined && r.homeUrl !== r.url && isSafeExternalUrl(r.homeUrl, allowedHosts) ? r.homeUrl : null;
  const guides = r.areas.filter((a) => r.areaHowTo?.[a]);
  return (
    <div className="mx-auto max-w-3xl space-y-3">
      {backLink}
      <article aria-labelledby="edu-detail-title" className="space-y-4 rounded-card border border-line bg-card p-4 shadow-card sm:p-6">
        <header className="flex flex-col items-start gap-3 sm:flex-row">
          <OrgSymbol symbol={r.symbol} size="lg" />
          <div className="min-w-0 max-w-full">
            <h2 id="edu-detail-title" className="text-xl font-bold leading-snug break-keep [overflow-wrap:anywhere] sm:text-2xl">
              {r.name}
            </h2>
            <p className="mt-0.5 text-base font-semibold text-ink-muted break-keep">운영 기관 · {r.operator}</p>
          </div>
        </header>

        <p className="text-lg break-keep">{r.description}</p>

        <DetailSection title="추천 학교급">
          <ul className="flex flex-wrap gap-1.5">
            {r.levels.map((l) => (
              <li key={l} className={`${badge} bg-brand-soft text-brand`}>
                {LEVEL_LABEL[l]}
              </li>
            ))}
          </ul>
        </DetailSection>

        <DetailSection title="관련 안전교육 영역">
          <ul className="flex flex-wrap gap-1.5" aria-label={`${r.name} 안전교육 영역`}>
            {r.areas.map((a) => (
              <li key={a} className={`${badge} border border-line text-ink`}>
                {AREA_LABEL[a]}
              </li>
            ))}
          </ul>
          {guides.length > 0 && (
            <ul className="mt-2 space-y-1" data-testid="edu-area-guide">
              {guides.map((a) => (
                <li key={a} className="text-base">
                  <span className="font-bold text-brand">{AREA_LABEL[a]}</span>: {r.areaHowTo![a]}
                </li>
              ))}
            </ul>
          )}
        </DetailSection>

        <DetailSection title="제공 교육자료 유형">
          <ul className="list-disc space-y-0.5 pl-5">
            {r.materialTypes.map((t) => (
              <li key={t}>{t}</li>
            ))}
          </ul>
        </DetailSection>

        <DetailSection title="교육자료를 찾는 방법">
          <p>{r.howTo}</p>
        </DetailSection>

        <DetailSection title="자료실 위치">
          <p>{r.menuPath ?? "사이트 메뉴 주소를 확인하지 못해 기관 홈페이지로 연결합니다. 홈페이지에서 위의 방법으로 찾아 주세요."}</p>
        </DetailSection>

        <DetailSection title="연결 주소">
          <ul className="space-y-1">
            <li>
              '공식 사이트 방문' 단추: {r.urlKind === "direct" ? "확인된 공식 자료실로 바로 연결" : "기관 홈페이지로 연결"}
            </li>
            {homeLink && (
              <li>
                기관 홈페이지:{" "}
                <a href={homeLink} target="_blank" rel="noopener noreferrer" referrerPolicy="no-referrer" data-testid="edu-home-link" className="inline-flex min-h-touch items-center gap-1 font-bold text-accent underline underline-offset-4">
                  {new URL(homeLink).hostname}
                  <Icon name="external" size={16} />
                  <span className="sr-only">(새 창에서 열림)</span>
                </a>
              </li>
            )}
            <li className="text-sm text-ink-muted">링크 확인일 {r.verifiedAt}</li>
          </ul>
          <details className="mt-1 text-sm text-ink-muted">
            <summary className="flex min-h-touch cursor-pointer items-center font-semibold">학교급·영역 분류 근거</summary>
            <p className="pb-1 break-keep">{r.basis}</p>
          </details>
        </DetailSection>

        <DetailSection title="외부 사이트 이용 안내">
          <ul className="list-disc space-y-0.5 pl-5 text-ink-muted">
            <li>{EDUCATION_TEXT.source}</li>
            <li>공식 사이트는 새 창(새 탭)에서 열립니다. 자료 내려받기·로그인·이용 조건은 해당 기관 안내를 따릅니다.</li>
            <li>SAFE SCHOOL은 외부 사이트에 로그인 정보나 개인정보를 보내지 않으며, 교육 이수·실적을 기록하지 않습니다.</li>
          </ul>
        </DetailSection>

        <div className="border-t border-line pt-4">
          {safe ? (
            <ExternalButton href={r.url} siteName={r.name} />
          ) : (
            <p role="note" data-testid="edu-blocked-link" className="rounded-control border-2 border-warning bg-warning-soft px-3 py-2 text-base font-bold text-warning-strong">
              링크 확인 필요 — 확인되지 않은 주소라 이동할 수 없습니다.
            </p>
          )}
        </div>
      </article>
    </div>
  );
}

/** 목록: 처음 열 때 주소 쿼리에서 검색어·필터를 읽고, 바뀔 때마다 주소를 바꿔 둠(기록을 쌓지 않는 replaceState) */
export function EducationResourcesPage({ schoolId }: { schoolId: string }) {
  const [initial] = useState(() => filterFromSearch(window.location.search));
  const sync = useMemo(
    () => (f: ResourceFilter) => {
      const next = listHref(schoolId, filterToSearch(f));
      if (window.location.pathname + window.location.search !== next) window.history.replaceState(window.history.state, "", next);
    },
    [schoolId],
  );
  return (
    <AppShell title="안전교육 자료" schoolId={schoolId}>
      {/* STEP 5: 시설 안전점검 자료로 가는 탭(모바일 머리글 '교육자료' 하나로 두 화면) */}
      <ResourceTabs schoolId={schoolId} active="education" />
      <EducationResourcesView schoolId={schoolId} initialFilter={initial} onFilterChange={sync} />
    </AppShell>
  );
}

export function EducationResourceDetailPage({ schoolId, resourceId }: { schoolId: string; resourceId: string }) {
  return (
    <AppShell title="안전교육 자료" schoolId={schoolId}>
      <EducationResourceDetailView schoolId={schoolId} resourceId={resourceId} search={window.location.search} />
    </AppShell>
  );
}
