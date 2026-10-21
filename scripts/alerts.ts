// 공식 경보 수집 운영 도구(모의 공급자 전용 — 실제 공식 API 어댑터는 아직 없음)
//
//   npm run alerts -- scenarios                     모의 시나리오 목록
//   npm run alerts -- collect incheon-heatwave      모의 시나리오 1회 수집(학교 매칭 포함)
//   npm run alerts -- status                        최근 수집 기록·경보 수
//   npm run alerts -- regroup                       재송출 묶음 점검(바꿀 내용만 출력, 변경 없음)
//   npm run alerts -- regroup --apply               재송출 묶음 정리 적용(학교별 판정 기록만 수정, 경보 원문은 그대로)
//
// 대상 DB는 DATABASE_URL(및 schema 매개변수)입니다. 시연은 safeschool_browser_demo 스키마로 실행하세요.
// 운영 환경(NODE_ENV=production)에서는 모의 수집을 거부합니다. 비밀값은 출력하지 않습니다.
import { PrismaClient } from "@prisma/client";
import { collectOnce } from "../server/src/alerts/collector.js";
import { MOCK_SCENARIOS } from "../server/src/alerts/mockScenarios.js";
import { regroupRebroadcasts } from "../server/src/alerts/grouping.js";
import { writeAudit } from "../server/src/services/audit.js";
import { assertMockAllowed, MockAlertSource } from "../server/src/alerts/providers.js";

async function main() {
  const [command, arg] = process.argv.slice(2);
  if (command === "scenarios" || !command) {
    console.log("모의 경보 시나리오:", Object.keys(MOCK_SCENARIOS).join(", "));
    return;
  }
  const prisma = new PrismaClient();
  try {
    const schema = (await prisma.$queryRaw<{ s: string }[]>`SELECT current_schema() AS s`)[0]?.s;
    console.log(`[alerts] 대상 스키마: ${schema}`);
    if (command === "collect") {
      assertMockAllowed(process.env.NODE_ENV ?? "development");
      const scenario = arg ? MOCK_SCENARIOS[arg] : undefined;
      if (!scenario) throw new Error(`시나리오를 지정하세요: ${Object.keys(MOCK_SCENARIOS).join(", ")}`);
      const result = await collectOnce(prisma, new MockAlertSource(scenario), { minIntervalMs: 0 });
      console.log(`[alerts] 모의 수집 결과: ${result.status}, 받은 ${result.fetched}건, 새로 저장 ${result.inserted}건, 중복 ${result.duplicates}건, 학교 새 알림 ${result.newTargetMatches}건`);
    } else if (command === "status") {
      const runs = await prisma.alertCollectionRun.findMany({ orderBy: { startedAt: "desc" }, take: 5 });
      for (const r of runs) console.log(`  ${r.startedAt.toISOString()} ${r.provider} ${r.status} 받은 ${r.fetchedCount} 새 ${r.newCount} 중복 ${r.duplicateCount}${r.errorMessage ? ` (${r.errorMessage})` : ""}`);
      const [alerts, mock] = await Promise.all([prisma.officialAlert.count(), prisma.officialAlert.count({ where: { isMock: true } })]);
      console.log(`[alerts] 저장된 경보 ${alerts}건(모의 ${mock}건)`);
    } else if (command === "regroup") {
      // 소재지를 나중에 확인한 학교 등에서 재송출 경보가 따로 표시되던 기존 데이터를 같은 기준으로 정리
      const apply = process.argv.includes("--apply");
      const schools = await prisma.school.findMany({ where: { status: "active" }, select: { id: true, name: true } });
      let total = 0;
      for (const school of schools) {
        const changes = apply
          ? await prisma.$transaction(async (tx) => {
              const c = await regroupRebroadcasts(tx, school.id);
              if (c.length) {
                await writeAudit(tx, { schoolId: school.id, action: "alerts.regrouped", targetType: "school", targetId: school.id, after: { changed: c.length, changes: c.map((x) => ({ matchId: x.matchId, from: x.from, to: x.to })) } });
              }
              return c;
            })
          : await regroupRebroadcasts(prisma, school.id, { dryRun: true });
        total += changes.length;
        if (changes.length) console.log(`  ${school.name}: ${changes.length}건 ${apply ? "정리함" : "정리 필요"}`);
      }
      console.log(`[alerts] 재송출 묶음 ${apply ? "정리" : "점검"} 결과: ${total}건${apply ? "" : " (적용하려면 --apply)"}`);
    } else {
      throw new Error(`알 수 없는 명령: ${command}`);
    }
  } finally {
    await prisma.$disconnect();
  }
}

main().catch((error) => {
  console.error("[alerts] 실패:", error instanceof Error ? error.message : error);
  process.exitCode = 1;
});
