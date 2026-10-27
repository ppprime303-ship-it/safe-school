// 학교알리미 실제 응답 확인: npm run schoolinfo:verify -- [--kind 02] [--sido 11] [--sgg 11110]
// - STEP A: --sgg(5자리, shared/schoolinfoRegions.ts)를 주면 시군구 단위로 요청(시군구가 필수인 인증키 확인용)
// - 인증키·요청 주소의 키는 출력하지 않습니다. 응답 '필드 이름'과 기대 필드 존재 여부, 행 수만 보여 줍니다.
// - 결과를 docs/data-sources.md 에 기록하고, 학년별 자료 필드가 모두 확인되면 SCHOOLINFO_GRADE_DATA=enabled 로 켭니다.
import {
  API_TYPE_BASIC_INFO,
  API_TYPE_GRADE_CLASS_STUDENTS,
  createSchoolinfoClient,
  EXPECTED_BASIC_FIELDS,
  EXPECTED_GRADE_FIELDS,
  inspectFields,
  SchoolinfoError,
} from "../server/src/integrations/schoolinfo.js";

function flag(name: string, fallback: string): string {
  const i = process.argv.indexOf(`--${name}`);
  return i >= 0 && process.argv[i + 1] ? process.argv[i + 1]! : fallback;
}

async function check(label: string, apiType: string, expected: readonly string[], kind: string, sido: string, sgg?: string) {
  const client = createSchoolinfoClient({ apiKey: process.env.SCHOOLINFO_API_KEY, timeoutMs: 60000 });
  try {
    const { rows, sourceUrl } = await client.fetch({ apiType, schulKndCode: kind, sidoCode: sgg ? sgg.slice(0, 2) : sido, sggCode: sgg });
    const result = inspectFields(rows, expected);
    console.log(`\n[${label}] apiType=${apiType} 응답 ${rows.length}행 (출처: ${sourceUrl})`);
    console.log(`  확인된 기대 필드: ${result.present.join(", ") || "없음"}`);
    console.log(`  없는 기대 필드:   ${result.missing.join(", ") || "없음"}`);
    console.log(`  응답 필드 이름 전체(${result.fieldNames.length}개): ${result.fieldNames.join(", ")}`);
    return rows.length > 0 && result.missing.length === 0;
  } catch (error) {
    console.log(`\n[${label}] 실패: ${error instanceof SchoolinfoError ? `${error.kind} — ${error.message}` : "알 수 없는 오류"}`);
    return false;
  }
}

async function main() {
  if (!process.env.SCHOOLINFO_API_KEY) {
    console.error("SCHOOLINFO_API_KEY 를 Replit Secrets에 넣어 주세요(값은 출력되지 않습니다).");
    process.exitCode = 1;
    return;
  }
  const kind = flag("kind", "02");
  const sido = flag("sido", "11");
  const sgg = process.argv.includes("--sgg") ? flag("sgg", "") || undefined : undefined;
  const basicOk = await check("학교기본정보", API_TYPE_BASIC_INFO, EXPECTED_BASIC_FIELDS, kind, sido, sgg);
  const gradeOk = await check("학년별·학급별 학생수", API_TYPE_GRADE_CLASS_STUDENTS, EXPECTED_GRADE_FIELDS, kind, sido, sgg);
  console.log("\n결론");
  console.log(`  학교 검색(기본정보): ${basicOk ? "사용 가능" : "확인 필요 — 위 '없는 기대 필드'를 Claude에게 전달"}`);
  console.log(`  학년별 공시자료: ${gradeOk ? "필드 확인됨 → Secrets에 SCHOOLINFO_GRADE_DATA=enabled 설정 가능" : "꺼진 상태 유지(SCHOOLINFO_GRADE_DATA 설정하지 않음)"}`);
}

void main();
