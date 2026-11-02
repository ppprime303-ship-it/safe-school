// 학교알리미 실제 응답 확인: npx tsx scripts/verify-schoolinfo.ts --kind 02 --sgg 28155 --basic-only [--dry-run]
// - 호출 수는 schoolinfoVerifyPlan.ts 가 실행 전에 정합니다. --basic-only 는 정확히 1회, --dry-run 은 0회. 재시도 없음.
// - 학년별 자료는 --basic-only 없이 --pban-yr <공시연도> 를 줄 때만 추가 호출합니다.
// - 인증키·요청 주소의 키는 출력하지 않습니다. 필드 이름, 행 수, 학교코드·학교명·지역 앞부분만 보여 줍니다(공개 학교 정보).
import { createSchoolinfoClient, EXPECTED_BASIC_FIELDS, EXPECTED_GRADE_FIELDS, API_TYPE_BASIC_INFO, inspectFields, SchoolinfoError } from "../server/src/integrations/schoolinfo.js";
import { planSchoolinfoVerify } from "./schoolinfoVerifyPlan.js";

async function main() {
  const argv = process.argv.slice(2);
  const plan = planSchoolinfoVerify(argv);
  console.log(`[호출 계획] ${plan.calls.length}회: ${plan.calls.map((c) => c.label).join(", ") || "없음"} · 학교급 ${plan.kind} · 시군구 ${plan.sgg || "-"}`);
  if (plan.error) {
    console.error(plan.error);
    process.exitCode = 1;
    return;
  }
  if (argv.includes("--dry-run")) return;
  const apiKey = process.env.SCHOOLINFO_API_KEY;
  if (!apiKey) {
    console.error("SCHOOLINFO_API_KEY 가 없어 호출하지 않았습니다.");
    process.exitCode = 1;
    return;
  }
  const mask = (s: string) => s.split(apiKey).join("***");
  const client = createSchoolinfoClient({ apiKey, timeoutMs: 60_000 });
  for (const call of plan.calls) {
    try {
      const { rows, sourceUrl } = await client.fetch({ apiType: call.apiType, schulKndCode: plan.kind, sidoCode: plan.sgg.slice(0, 2), sggCode: plan.sgg, pbanYr: call.pbanYr });
      const expected = call.apiType === API_TYPE_BASIC_INFO ? EXPECTED_BASIC_FIELDS : EXPECTED_GRADE_FIELDS;
      const result = inspectFields(rows, expected);
      console.log(`[${call.label}] 응답 ${rows.length}행 (출처: ${sourceUrl})`);
      console.log(`  없는 기대 필드: ${result.missing.join(", ") || "없음"}`);
      console.log(`  응답 필드 ${result.fieldNames.length}개: ${result.fieldNames.join(", ")}`);
      for (const r of rows.slice(0, 5)) {
        const o = r as Record<string, unknown>;
        console.log(`  - ${String(o.SCHUL_CODE)} · ${String(o.SCHUL_NM)} · ${String(o.ADRCD_NM ?? "-")} · 폐교 ${String(o.ABSCH_YN ?? "-")}`);
      }
    } catch (error) {
      console.log(`[${call.label}] 실패: ${error instanceof SchoolinfoError ? `${error.kind} — ${mask(error.message)}` : "알 수 없는 오류"}`);
      process.exitCode = 1;
    }
  }
}

void main();
