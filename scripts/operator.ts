// SAFE SCHOOL 운영자 도구(학교 사용자 화면에는 없음). Replit Shell에서만 실행합니다.
//
//   npm run operator -- list
//   npm run operator -- approve <신청ID> --by "운영자 이름" --method "공문 확인" [--note "메모"]
//   npm run operator -- reject  <신청ID> --by "운영자 이름" [--note "사유"]
//
// 관리자 자격 확인 방식(공문, 학교 대표전화 확인 등)은 학교·교육청과 정해야 합니다.
// 확인 방식이 정해지기 전에는 승인하지 말고 '관리자 승인 대기'로 둡니다.
import { PrismaClient } from "@prisma/client";
import { reviewSchoolRegistration } from "../server/src/services/schoolRegistration.js";

const prisma = new PrismaClient();

function flag(args: string[], name: string): string | undefined {
  const i = args.indexOf(`--${name}`);
  return i >= 0 ? args[i + 1] : undefined;
}

async function main() {
  const [command, id, ...rest] = process.argv.slice(2);
  if (command === "list" || !command) {
    const pending = await prisma.schoolRegistration.findMany({
      where: { status: "pending_verification" },
      include: { school: { select: { name: true, address: true, eduOfficeName: true } }, applicant: { select: { displayName: true, email: true } } },
      orderBy: { createdAt: "asc" },
    });
    if (pending.length === 0) console.log("[operator] 대기 중인 학교 등록 신청이 없습니다.");
    for (const r of pending) {
      console.log(
        `- ${r.id}\n  학교: ${r.school.name} (${r.school.eduOfficeName ?? "-"}, ${r.school.address ?? "-"})\n  신청자: ${r.applicant.displayName} <${r.applicant.email}> 직위: ${r.applicantPosition ?? "-"}\n  신청일: ${r.createdAt.toISOString()}`,
      );
    }
    return;
  }
  if ((command === "approve" || command === "reject") && id) {
    const reviewer = flag(rest, "by");
    if (!reviewer) throw new Error("--by \"운영자 이름\" 이 필요합니다.");
    const result = await reviewSchoolRegistration(prisma, {
      registrationId: id,
      decision: command,
      reviewer,
      verificationMethod: flag(rest, "method"),
      note: flag(rest, "note"),
    });
    console.log(`[operator] ${command === "approve" ? "승인" : "거절"} 완료: ${result.id} (${result.status})`);
    return;
  }
  console.log("사용법: npm run operator -- list | approve <ID> --by 이름 --method 방법 | reject <ID> --by 이름");
}

main()
  .catch((error) => {
    console.error("[operator] 실패:", error instanceof Error ? error.message : error);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
