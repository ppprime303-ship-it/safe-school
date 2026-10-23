// STEP 4 안전교육 자료 안내: 공식 기관의 안전교육 자료 제공처를 찾아 공식 사이트로 이동하도록 돕는 화면
// - 교육 이수·실적을 기록하지 않고, 개인정보를 입력받지 않으며, 서버 API·DB를 쓰지 않습니다(정적 안내 데이터).
// - 검색은 이 화면에 등록한 안내 정보만 대상으로 합니다(외부 사이트 내용 검색 아님).
// - 접근: App.tsx 의 학교 화면 공통 검사(로그인 + 승인된 소속)를 그대로 사용합니다(권한 로직 변경 없음).
import { useId, useMemo, useState } from "react";
import { AppShell } from "../../components/layout/AppShell";
import { Icon } from "../../components/ui/Icon";
import { PrimaryButton } from "../../components/ui/PrimaryButton";
import { EDUCATION_ALLOWED_HOSTS, EDUCATION_RESOURCES } from "../../data/educationResources";
import {
  AREA_LABEL,
  EDUCATION_AREAS,
  EMPTY_FILTER,
  LEVEL_LABEL,
  SCHOOL_LEVELS,
  countBy,
  filterResources,
  isFilterActive,
  isSafeExternalUrl,
  type EducationAreaId,
  type EducationResource,
  type ResourceFilter,
} from "../../lib/educationResources";

export const EDUCATION_TEXT = {
  title: "안전교육 자료 찾기",
  lead: "안전교육에 필요한 공식 교육자료를 찾아보세요.",
  source: "교육자료는 해당 기관의 공식 사이트에서 제공됩니다. 자료의 최신 내용과 이용 조건은 원문 사이트에서 확인해 주세요.",
  noRecord: "이 화면은 자료 제공처를 안내만 합니다. 교육 이수나 실적을 기록하지 않고, 개인정보를 입력받지 않습니다.",
  searchScope: "SAFE SCHOOL에 등록한 안내 정보(사이트명·기관·자료 유형·주제)에서만 찾습니다. 외부 사이트의 자료 내용을 검색하지 않습니다.",
  empty: "현재 확인된 자료가 없습니다",
} as const;

const chipClass = (on: boolean) =>
  `min-h-touch rounded-full border-2 px-3 py-1.5 text-base font-bold leading-snug whitespace-normal break-keep text-left ${
    on ? "border-brand bg-brand text-white" : "border-line-strong bg-card text-ink hover:bg-brand-soft"
  }`;

function ExternalLink({ href, label, siteName, variant }: { href: string; label: string; siteName: string; variant: "primary" | "secondary" }) {
  const cls =
    variant === "primary"
      ? "bg-brand text-white hover:bg-brand-hover"
      : "border-2 border-brand bg-card text-brand hover:bg-brand-soft";
  return (
    <a
      href={href}
      target="_blank"
      rel="noopener noreferrer"
      referrerPolicy="no-referrer"
      aria-label={`${siteName} ${label} (새 창에서 열림)`}
      data-testid="edu-external-link"
      className={`inline-flex min-h-touch w-full items-center justify-center gap-2 rounded-control px-4 py-2 text-center text-base font-bold leading-snug break-keep sm:w-auto ${cls}`}
    >
      <span>{label}</span>
      <Icon name="external" size={20} />
    </a>
  );
}

export function ResourceCard({
  resource: r,
  allowedHosts,
  selectedArea,
}: {
  resource: EducationResource;
  allowedHosts: readonly string[];
  selectedArea: EducationAreaId | "all";
}) {
  const safe = isSafeExternalUrl(r.url, allowedHosts);
  const homeSafe = r.homeUrl !== undefined && r.homeUrl !== r.url && isSafeExternalUrl(r.homeUrl, allowedHosts);
  const areaGuide = selectedArea !== "all" ? r.areaHowTo?.[selectedArea] : undefined;
  return (
    <article data-testid="edu-card" aria-labelledby={`edu-${r.id}`} className="flex min-w-0 flex-col rounded-card border-2 border-line bg-card p-4 shadow-card">
      <h3 id={`edu-${r.id}`} className="text-lg font-bold leading-snug break-keep">
        {r.name}
      </h3>
      <p className="mt-0.5 text-base font-semibold text-ink-muted">운영 기관 · {r.operator}</p>
      <p className="mt-3 text-base break-keep">{r.description}</p>

      <dl className="mt-3 space-y-2 text-base">
        <div>
          <dt className="text-sm font-bold text-ink-muted">제공 자료</dt>
          <dd>
            <ul className="mt-1 flex flex-wrap gap-1.5">
              {r.materialTypes.map((t) => (
                <li key={t} className="rounded-full bg-neutral-soft px-2.5 py-0.5 text-sm font-semibold break-keep">
                  {t}
                </li>
              ))}
            </ul>
          </dd>
        </div>
        <div>
          <dt className="text-sm font-bold text-ink-muted">대상 학교급</dt>
          <dd className="break-keep">{r.levels.map((l) => LEVEL_LABEL[l]).join(" · ")}</dd>
        </div>
        <div>
          <dt className="text-sm font-bold text-ink-muted">안전교육 영역</dt>
          <dd>
            <ul className="mt-1 flex flex-wrap gap-1.5" aria-label={`${r.name} 안전교육 영역`}>
              {r.areas.map((a) => (
                <li
                  key={a}
                  className={`rounded-full border px-2.5 py-0.5 text-sm font-semibold break-keep ${
                    a === selectedArea ? "border-brand bg-brand-soft text-brand" : "border-line text-ink"
                  }`}
                >
                  {AREA_LABEL[a]}
                </li>
              ))}
            </ul>
          </dd>
        </div>
      </dl>

      <div className="mt-3 rounded-control bg-page px-3 py-2">
        <p className="text-sm font-bold text-ink-muted">활용 안내</p>
        <p className="mt-0.5 text-base break-keep">{r.howTo}</p>
        {areaGuide && (
          <p className="mt-1 text-base font-semibold text-brand break-keep" data-testid="edu-area-guide">
            {AREA_LABEL[selectedArea as EducationAreaId]}: {areaGuide}
          </p>
        )}
      </div>

      <details className="mt-2 text-sm text-ink-muted">
        <summary className="flex min-h-touch cursor-pointer items-center font-semibold">대상·영역 근거 보기</summary>
        <p className="pb-1 break-keep">{r.basis}</p>
      </details>

      <div className="mt-auto flex flex-col gap-2 pt-3 sm:flex-row sm:flex-wrap">
        {safe ? (
          <ExternalLink href={r.url} label="공식 사이트로 이동" siteName={r.name} variant="primary" />
        ) : (
          <p role="note" data-testid="edu-blocked-link" className="rounded-control border-2 border-warning bg-warning-soft px-3 py-2 text-base font-bold text-warning-strong">
            링크 확인 필요 — 확인되지 않은 주소라 이동할 수 없습니다.
          </p>
        )}
        {homeSafe && <ExternalLink href={r.homeUrl!} label="기관 홈페이지" siteName={r.name} variant="secondary" />}
      </div>
      <p className="mt-2 text-sm text-ink-muted">링크 확인일 {r.verifiedAt}</p>
    </article>
  );
}

export function EducationResourcesView({
  resources = EDUCATION_RESOURCES,
  allowedHosts = EDUCATION_ALLOWED_HOSTS,
  initialFilter = EMPTY_FILTER,
}: {
  resources?: readonly EducationResource[];
  allowedHosts?: readonly string[];
  initialFilter?: ResourceFilter;
}) {
  const [filter, setFilter] = useState<ResourceFilter>(initialFilter);
  const results = useMemo(() => filterResources(resources, filter), [resources, filter]);
  const counts = useMemo(() => countBy(resources, filter), [resources, filter]);
  const active = isFilterActive(filter);
  const searchId = useId();
  const set = (patch: Partial<ResourceFilter>) => setFilter((f) => ({ ...f, ...patch }));
  const reset = () => setFilter(EMPTY_FILTER);

  return (
    <div className="mx-auto max-w-5xl space-y-5">
      <section aria-labelledby="edu-title" className="space-y-3">
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
        <div role="note" className="rounded-control border-2 border-accent bg-accent-soft px-3 py-2.5 text-base break-keep">
          <p className="flex items-start gap-2 font-semibold">
            <Icon name="info" size={20} className="mt-0.5 shrink-0 text-accent" />
            <span>{EDUCATION_TEXT.source}</span>
          </p>
          <p className="mt-1 pl-7 text-ink-muted">{EDUCATION_TEXT.noRecord}</p>
        </div>
      </section>

      <section aria-label="자료 찾기 조건" className="space-y-4 rounded-card border border-line bg-card p-4">
        <div>
          <label htmlFor={searchId} className="text-base font-bold">
            사이트명·주제 검색
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
              placeholder="예: 교통, 동영상, 표준안"
              aria-describedby={`${searchId}-help`}
              onChange={(e) => set({ query: e.target.value })}
              className="block min-h-touch w-full rounded-control border-2 border-line-strong bg-card py-2 pr-3 pl-10 text-lg"
            />
          </div>
          <p id={`${searchId}-help`} className="mt-1 text-sm text-ink-muted break-keep">
            {EDUCATION_TEXT.searchScope}
          </p>
        </div>

        <fieldset>
          <legend className="text-base font-bold">학교급</legend>
          <div role="group" aria-label="학교급 선택" className="mt-1.5 flex flex-wrap gap-2">
            <button type="button" aria-pressed={filter.level === "all"} onClick={() => set({ level: "all" })} className={chipClass(filter.level === "all")}>
              전체
            </button>
            {SCHOOL_LEVELS.map((l) => (
              <button key={l.id} type="button" aria-pressed={filter.level === l.id} onClick={() => set({ level: l.id })} className={chipClass(filter.level === l.id)}>
                {l.label} <span className="font-semibold opacity-80">{counts.level[l.id]}</span>
              </button>
            ))}
          </div>
        </fieldset>

        <fieldset>
          <legend className="text-base font-bold">안전교육 영역(7대 표준안)</legend>
          <div role="group" aria-label="안전교육 영역 선택" className="mt-1.5 flex flex-wrap gap-2">
            <button type="button" aria-pressed={filter.area === "all"} onClick={() => set({ area: "all" })} className={chipClass(filter.area === "all")}>
              전체
            </button>
            {EDUCATION_AREAS.map((a) => (
              <button key={a.id} type="button" aria-pressed={filter.area === a.id} onClick={() => set({ area: a.id })} className={chipClass(filter.area === a.id)}>
                {a.label} <span className="font-semibold opacity-80">{counts.area[a.id]}</span>
              </button>
            ))}
          </div>
          <p className="mt-1 text-sm text-ink-muted">숫자는 조건에 맞는 자료 제공처 수입니다.</p>
        </fieldset>
      </section>

      <section aria-labelledby="edu-results" className="space-y-3">
        <div className="flex flex-wrap items-center justify-between gap-2">
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
          <ul className="grid grid-cols-1 gap-4 md:grid-cols-2">
            {results.map((r) => (
              <li key={r.id} className="flex min-w-0">
                <ResourceCard resource={r} allowedHosts={allowedHosts} selectedArea={filter.area} />
              </li>
            ))}
          </ul>
        )}
      </section>

      <section aria-labelledby="edu-orgs" className="rounded-card border border-line bg-card p-4">
        <h2 id="edu-orgs" className="text-lg font-bold">
          자료 제공 기관 목록
        </h2>
        <ul className="mt-2 divide-y divide-line">
          {resources.map((r) => (
            <li key={r.id} className="flex flex-col gap-0.5 py-2 sm:flex-row sm:items-baseline sm:gap-3">
              <span className="text-base font-bold break-keep">{r.name}</span>
              <span className="text-base text-ink-muted break-keep">{r.operator}</span>
              <span className="text-sm text-ink-muted sm:ml-auto">링크 확인일 {r.verifiedAt}</span>
            </li>
          ))}
        </ul>
      </section>

      <section aria-labelledby="edu-external" className="rounded-card border border-line bg-card p-4">
        <h2 id="edu-external" className="text-lg font-bold">
          외부 사이트 이용 안내
        </h2>
        <ul className="mt-2 list-disc space-y-1 pl-5 text-base break-keep">
          <li>'공식 사이트로 이동'을 누르면 새 창(새 탭)에서 해당 기관 사이트가 열립니다.</li>
          <li>자료 내려받기·회원 로그인·이용 조건은 각 기관 사이트의 안내를 따릅니다.</li>
          <li>SAFE SCHOOL은 외부 사이트에 로그인 정보나 개인정보를 보내지 않습니다.</li>
          <li>링크가 열리지 않거나 내용이 바뀌었으면 학교 앱 운영담당에게 알려 주세요.</li>
        </ul>
      </section>
    </div>
  );
}

export function EducationResourcesPage({ schoolId }: { schoolId: string }) {
  return (
    <AppShell title="안전교육 자료" schoolId={schoolId}>
      <EducationResourcesView />
    </AppShell>
  );
}
