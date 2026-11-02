// 기상특보 실제 응답 확인(승인 후 실행): npm run kma:verify
// - getPwnCd 1쪽과 getPwnStatus 1회만 호출합니다. 인증키·요청 주소는 출력하지 않습니다. 건수·응답 필드 이름·인천 구역 결과만 보여 줍니다.
// - 형식이 맞으면 KMA_WARNING_CONTRACT.verified 갱신을 검토하고 docs/integrations 에 기록합니다.
import { buildKmaStatusUrl, buildKmaWarningUrl, KmaWarningError, parseKmaStatus, parseKmaWarnings, summarizeWarnings, zonesForRegion } from "../server/src/integrations/kmaWarnings.js";

async function main() {
  const key = process.env.KMA_WARNING_SERVICE_KEY?.trim();
  if (!key) {
    console.error("KMA_WARNING_SERVICE_KEY 가 없어 호출하지 않았습니다.");
    process.exitCode = 1;
    return;
  }
  const now = new Date();
  try {
    const res = await fetch(buildKmaWarningUrl(key, 1, now), { signal: AbortSignal.timeout(20_000), headers: { Accept: "application/json" } });
    const body = await res.text();
    console.log(`[기상특보] ${now.toISOString()} HTTP ${res.status} · 형식 ${body.trimStart().startsWith("<") ? "XML" : "JSON"} · ${(res.headers.get("content-type") ?? "?").slice(0, 40)}`);
    const parsed = parseKmaWarnings(body);
    const item = (JSON.parse(body) as { response?: { body?: { items?: { item?: unknown } } } }).response?.body?.items?.item;
    const first = Array.isArray(item) ? item[0] : item;
    console.log(`  응답 ${parsed.received}건 / 전체 ${parsed.total ?? "?"}건, 버린 항목 ${parsed.rejected}건`);
    console.log(`  필드 이름: ${first && typeof first === "object" ? Object.keys(first).join(", ") : "(항목 없음)"}`);
    const zones = zonesForRegion({ sido: "인천광역시", sigungu: "영종구" })!;
    const mine = summarizeWarnings(parsed.rows.filter((r) => zones.target.has(r.areaCode)), now);
    console.log(`  인천영종 기준 ${mine.length}건: ${mine.map((w) => `${w.kind}${w.level ?? ""}/${w.status}`).join(", ") || "없음"}`);
    // 목록 결과를 보존하도록 현황 실패는 따로 표시
    await fetch(buildKmaStatusUrl(key), { signal: AbortSignal.timeout(20_000), headers: { Accept: "application/json" } })
      .then(async (r) => {
        const status = parseKmaStatus(await r.text());
        console.log(`  특보 현황: HTTP ${r.status}, ${status ? `인천 관련 ${status.lines.length}줄` : "자료 없음"}`);
      })
      .catch((e: unknown) => console.log(`  특보 현황 실패: ${e instanceof KmaWarningError ? `${e.kind} ${e.code ?? ""}` : "연결 실패"}`));
  } catch (error) {
    console.log(`[기상특보] 실패: ${error instanceof KmaWarningError ? `${error.kind}${error.code ? ` ${error.code}` : ""} — ${error.message}` : (error as { name?: string })?.name === "TimeoutError" ? "시간 초과" : "연결 실패"}`);
    process.exitCode = 1;
  }
}

void main();
