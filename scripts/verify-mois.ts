// 긴급재난문자 실제 응답 형식 확인(승인 후 실행): npm run mois:verify
// - 1쪽만 호출합니다. DB에 저장하지 않고 수집을 켜지 않습니다. 인증키·요청 주소·문자 본문은 출력하지 않습니다.
// - 결과 코드·필드 이름·건수·지역·발송 시각만 보여 줍니다. 이 도구의 성공만으로 verified 를 바꾸지 않습니다(공식 명세 대조 필요).
import { buildRequestUrl, kstYmd, normalizeMoisCbs, type MoisCbsRecord } from "../server/src/alerts/moisCbs.js";
import { sanitizeError } from "../server/src/alerts/collector.js";

async function main() {
  const key = process.env.MOIS_CBS_SERVICE_KEY?.trim();
  if (!key) {
    console.error("MOIS_CBS_SERVICE_KEY 가 없어 호출하지 않았습니다.");
    process.exitCode = 1;
    return;
  }
  const now = new Date();
  try {
    const res = await fetch(buildRequestUrl(key, 1, kstYmd(now, 1)), { signal: AbortSignal.timeout(20_000), headers: { Accept: "application/json" } });
    const body = await res.text();
    console.log(`[긴급재난문자] ${now.toISOString()} HTTP ${res.status}`);
    if (body.trimStart().startsWith("<")) {
      const code = /<returnReasonCode>\s*(\d{1,3})/.exec(body)?.[1] ?? /<resultCode>\s*(\d{1,3})/.exec(body)?.[1] ?? "-";
      const name = /<returnAuthMsg>\s*([A-Z_]{1,80})/.exec(body)?.[1] ?? "-";
      console.log(`  XML 응답 코드 ${code} ${name}`);
      process.exitCode = 1;
      return;
    }
    const data = JSON.parse(body) as { header?: { resultCode?: unknown }; totalCount?: unknown; body?: unknown };
    console.log(`  최상위 필드: ${Object.keys(data).join(", ")} / 결과 코드 ${String(data.header?.resultCode ?? "-").slice(0, 10)} / 전체 ${String(data.totalCount ?? "?").slice(0, 10)}건`);
    const rows = Array.isArray(data.body) ? (data.body as MoisCbsRecord[]) : [];
    console.log(`  항목 필드: ${rows[0] ? Object.keys(rows[0]).join(", ") : "(항목 없음)"}`);
    const ok = rows.map((r) => normalizeMoisCbs(r)).filter((n) => n !== null);
    console.log(`  해석 성공 ${ok.length}/${rows.length}건`);
    for (const n of ok.slice(0, 5)) console.log(`  - ${n.issuedAt.toISOString()} · ${n.areasRaw.slice(0, 80)}`);
  } catch (error) {
    console.log(`[긴급재난문자] 실패: ${sanitizeError(error).split(key).join("***")}`);
    process.exitCode = 1;
  }
}

void main();
