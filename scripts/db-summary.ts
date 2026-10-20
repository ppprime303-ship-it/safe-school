// `npm run db:summary` : 현재 DB에 무엇이 들어 있는지 개수만 보여 줍니다(개인정보 출력 없음).
// 서버 재시작 후 데이터가 남아 있는지 확인할 때도 씁니다.
import { PrismaClient } from "@prisma/client";

const prisma = new PrismaClient();

async function main() {
  const schools = await prisma.school.findMany({
    select: { name: true, slug: true, isDemo: true, _count: { select: { classes: true, memberships: true, events: true } } },
    orderBy: { createdAt: "asc" },
  });
  if (schools.length === 0) {
    console.log("[summary] 학교 데이터가 없습니다.");
  }
  for (const s of schools) {
    const enrolled = await prisma.schoolClass.aggregate({
      where: { school: { slug: s.slug } },
      _sum: { enrolledCount: true },
    });
    console.log(
      `[summary] ${s.name} (${s.isDemo ? "데모" : "실제"}) — 학급 ${s._count.classes}개, 재적 ${enrolled._sum.enrolledCount ?? 0}명, 소속 교직원 ${s._count.memberships}명, 재난 상황 기록 ${s._count.events}건`,
    );
  }
  console.log(`[summary] 감사 로그 ${await prisma.auditLog.count()}건`);
}

main()
  .catch((error) => {
    console.error("[summary] 실패:", error instanceof Error ? error.message : error);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
