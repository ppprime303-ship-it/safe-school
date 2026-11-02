// 경보함의 기상특보: 기상청 자료를 읽기 전용으로 표시합니다. 학교 재난 발령과 연결되지 않으며, 조회 실패를 '특보 없음'으로 보이지 않게 합니다.
import { useCallback, useEffect, useState } from "react";
import { WEATHER_ERROR_LABEL, WEATHER_STATUS_LABEL, type SchoolWeatherWarnings, type WeatherWarningView } from "@shared/weatherWarnings";
import { api, ApiError } from "../../lib/api";
import { formatDateTime } from "../../lib/format";

const POLL_MS = 5 * 60_000;

function WarningRow({ w }: { w: WeatherWarningView }) {
  const released = w.status === "released";
  return (
    <li className={`rounded-control border p-3 ${released ? "border-line bg-page" : "border-warning bg-warning-soft"}`}>
      <p className={`text-base font-bold ${released ? "text-ink-muted" : ""}`}>
        {w.kind}{w.level ?? ""} · {WEATHER_STATUS_LABEL[w.status]}
      </p>
      <p className="mt-0.5 text-sm">
        {w.areaName}
        {w.relevance === "undetermined" && " · 우리 학교 포함 여부 확인 필요"}
      </p>
      <p className="tabular mt-0.5 text-sm text-ink-muted">
        발표 {formatDateTime(w.issuedAt)}
        {w.effectiveAt && ` · 발효 ${formatDateTime(w.effectiveAt)}`}
        {w.releasedAt && ` · 해제 ${formatDateTime(w.releasedAt)}`}
      </p>
    </li>
  );
}

export function WeatherWarningsCard({ schoolId }: { schoolId: string }) {
  const [data, setData] = useState<SchoolWeatherWarnings | null>(null);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      setData(await api<SchoolWeatherWarnings>("GET", `/schools/${schoolId}/weather-warnings`));
      setError(null);
    } catch (e) {
      setError(e instanceof ApiError ? e.message : "기상특보를 불러오지 못했습니다.");
    }
  }, [schoolId]);

  useEffect(() => {
    void load();
    const id = window.setInterval(() => void load(), POLL_MS);
    return () => window.clearInterval(id);
  }, [load]);

  const active = data?.warnings.filter((w) => w.status !== "released") ?? [];
  const released = data?.warnings.filter((w) => w.status === "released") ?? [];

  return (
    <section aria-labelledby="weather-title" className="rounded-card border border-line bg-card p-4 shadow-card">
      <h2 id="weather-title" className="text-lg font-bold">기상특보</h2>
      {error && <p role="alert" className="mt-1 font-semibold text-danger">{error}</p>}
      {!data && !error && <p className="mt-1 text-ink-muted">불러오는 중…</p>}
      {data?.state === "not_configured" && <p className="mt-1 text-sm text-ink-muted">기상특보 조회가 연결되어 있지 않습니다. 기상청 등 공식 경로로 확인하세요.</p>}
      {data?.state === "failing" && (
        <p role="status" className="mt-1 text-sm font-bold text-danger">
          기상특보를 받아오지 못했습니다{data.errorKind ? `(${WEATHER_ERROR_LABEL[data.errorKind]})` : ""}. 특보가 없다는 뜻이 아닙니다. 기상청 등 공식 경로로 확인하세요.
        </p>
      )}
      {data?.state === "ok" && (
        <>
          {!data.regionSupported && <p className="mt-1 text-sm font-semibold text-warning-strong">이 학교 지역은 아직 특보구역과 연결되어 있지 않아 표시할 수 없습니다. 기상청 등 공식 경로로 확인하세요.</p>}
          {data.stale && <p role="status" className="mt-1 text-sm font-bold text-warning-strong">이전 조회 자료입니다{data.errorKind ? `(새 조회 실패: ${WEATHER_ERROR_LABEL[data.errorKind]})` : ""}. 현재 상황과 다를 수 있습니다.</p>}
          {data.partial && <p className="mt-1 text-sm font-semibold text-warning-strong">자료가 많아 일부만 받았습니다.</p>}
          {data.regionSupported && active.length === 0 && !data.statusText?.lines.length && <p className="mt-1 text-base">최근 {data.windowDays}일 발표분 중 우리 학교 지역에 발효 중인 특보가 없습니다.</p>}
          {!!data.statusText?.lines.length && (
            <div className="mt-2 rounded-control border border-line bg-page p-3 text-sm">
              <p className="font-bold">기상청 특보 현황 원문(인천 관련 줄){data.statusText.at && ` · ${formatDateTime(data.statusText.at)} 기준`}</p>
              <ul className="mt-1 space-y-0.5">
                {data.statusText.lines.map((l) => (
                  <li key={l}>{l}</li>
                ))}
              </ul>
            </div>
          )}
          {active.length + released.length > 0 && (
            <ul className="mt-2 space-y-2">
              {[...active, ...released].map((w) => (
                <WarningRow key={w.key} w={w} />
              ))}
            </ul>
          )}
        </>
      )}
      {data && data.state !== "not_configured" && (
        <p className="mt-2 text-sm text-ink-muted">
          출처: {data.source}{!data.contractVerified && "(응답 형식 확인 전 시범 조회)"} · 마지막 조회 {data.fetchedAt ? formatDateTime(data.fetchedAt) : "없음"} · 최근 {data.windowDays}일 발표 기준. 실제 기상 자료이며 시연용 가상 사건과 무관하고, 학교 재난을 자동 발령하지 않습니다.
        </p>
      )}
    </section>
  );
}
