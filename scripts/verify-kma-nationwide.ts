// 기상특보 계약 검증 보조(승인 후 1회 실행): 전국 목록을 어댑터로 해석해 '발효 중' 판정 결과를 기상청 공식 특보 현황 원문과 대조합니다.
// - getPwnCd 1쪽 + getPwnStatus 1회. 인증키·요청 주소는 출력하지 않습니다. 저장·알림 없음.
// - 출력: 상태별 건수, 발효 중으로 판정한 (종류·강도 → 구역 수), 공식 현황 원문 중 '발표 중 특보' 부분(공개 정보).
import { buildKmaStatusUrl, buildKmaWarningUrl, KmaWarningError, parseKmaWarnings, summarizeWarnings } from "../server/src/integrations/kmaWarnings.js";

async function main() {
  const key = process.env.KMA_WARNING_SERVICE_KEY?.trim();
  if (!key) throw new Error("KMA_WARNING_SERVICE_KEY 없음");
  const now = new Date();
  const res = await fetch(buildKmaWarningUrl(key, 1, now), { signal: AbortSignal.timeout(20_000), headers: { Accept: "application/json" } });
  const parsed = parseKmaWarnings(await res.text());
  const states = summarizeWarnings(parsed.rows, now);
  const by: Record<string, number> = {};
  for (const s of states) by[s.status] = (by[s.status] ?? 0) + 1;
  console.log(`[목록] HTTP ${res.status}, 행 ${parsed.received}/${parsed.total ?? "?"}, 버림 ${parsed.rejected}, 구역·종류별 상태 ${JSON.stringify(by)}`);
  const active = states.filter((s) => s.status === "active");
  const groups = new Map<string, string[]>();
  for (const s of active) groups.set(`${s.kind}${s.level ?? ""}`, [...(groups.get(`${s.kind}${s.level ?? ""}`) ?? []), s.areaName]);
  for (const [k, areas] of groups) console.log(`  발효 중 판정: ${k} — ${areas.length}개 구역 (${areas.slice(0, 12).join(", ")}${areas.length > 12 ? " …" : ""})`);
  const unknown = states.filter((s) => s.status === "unknown");
  if (unknown.length) console.log(`  상태 미판정 ${unknown.length}건 (예: ${unknown.slice(0, 3).map((u) => `${u.kind}${u.level ?? ""}/${u.areaName}`).join(", ")})`);
  const st = await fetch(buildKmaStatusUrl(key), { signal: AbortSignal.timeout(20_000), headers: { Accept: "application/json" } });
  const body = JSON.parse(await st.text()) as { response?: { header?: { resultCode?: string }; body?: { items?: { item?: Record<string, unknown> | Record<string, unknown>[] } } } };
  const items = body.response?.body?.items?.item;
  const list = Array.isArray(items) ? items : items ? [items] : [];
  const latest = list.sort((a, b) => String(b.tmFc).localeCompare(String(a.tmFc)))[0];
  console.log(`[현황] HTTP ${st.status}, 결과코드 ${body.response?.header?.resultCode}, 발표시각 ${latest?.tmFc ?? "-"}, 발효시각 ${latest?.tmEf ?? "-"}`);
  const t6 = String(latest?.t6 ?? "");
  console.log(`  공식 현황(t6) 원문:\n${t6.split(/\s*(?=\bo\s)/).map((l) => "    " + l.trim().slice(0, 300)).join("\n")}`);
}
main().catch((e) => { console.log(`실패: ${e instanceof KmaWarningError ? `${e.kind} ${e.code ?? ""}` : (e as Error).message}`); process.exitCode = 1; });
