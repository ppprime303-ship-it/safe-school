// SAFE SCHOOL 운영자 도구(학교 사용자 화면에는 없음). Replit Shell에서만 실행합니다.
//
//   npm run operator -- list
//   npm run operator -- approve <신청ID> --by "운영자 이름" --method "공문 확인" [--note "메모"]
//   npm run operator -- reject  <신청ID> --by "운영자 이름" [--note "사유"]
//   (STEP 3-D 직책·업무 — 기관 확인을 마친 경우에만)
//   npm run operator -- duties <학교ID>                                  직책·업무 현황
//   npm run operator -- duty-add <소속ID> principal|vice_principal --by "운영자" --method "공문 확인" [--acting] [--note "메모"]
//   npm run operator -- duty-add <소속ID> safety_officer|app_operator --by "운영자" [--method "확인 방법"]
//   npm run operator -- duty-end <학교ID> <직책·업무ID> --by "운영자" --reason "전보"
//
// 관리자 자격 확인 방식(공문, 학교 대표전화 확인 등)은 학교·교육청과 정해야 합니다.
// 확인 방식이 정해지기 전에는 승인하지 말고 '관리자 승인 대기'로 둡니다.
import { PrismaClient } from "@prisma/client";
import { reviewSchoolRegistration } from "../server/src/services/schoolRegistration.js";
import { endDuty, grantDutyByPlatformOperator, listDuties } from "../server/src/services/duties.js";

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
  const DUTIES = ["principal", "vice_principal", "safety_officer", "app_operator"] as const;
  if (command === "duties" && id) {
    const { duties } = await listDuties(prisma, id);
    if (duties.length === 0) console.log("[operator] 등록된 직책·업무가 없습니다.");
    for (const d of duties) console.log(`- ${d.id} ${d.label}${d.isActing ? "(직무대리)" : ""} ${d.name} [${d.endedAt ? `종료 ${d.endedAt} ${d.endReason}` : "진행 중"}] 지정: ${d.grantedBy ?? "-"}`);
    return;
  }
  if (command === "duty-add" && id) {
    const duty = rest[0] as (typeof DUTIES)[number];
    if (!DUTIES.includes(duty)) throw new Error("직책·업무는 principal | vice_principal | safety_officer | app_operator 중 하나입니다.");
    const by = flag(rest, "by");
    if (!by) throw new Error("--by \"운영자 이름\" 이 필요합니다.");
    const r = await grantDutyByPlatformOperator(prisma, { membershipId: id, duty, operator: by, verificationMethod: flag(rest, "method"), isActing: rest.includes("--acting"), note: flag(rest, "note") });
    console.log(`[operator] 등록 완료: ${r.id}`);
    return;
  }
  if (command === "duty-end" && id) {
    const dutyId = rest[0];
    const by = flag(rest, "by");
    const reason = flag(rest, "reason");
    if (!dutyId || !by || !reason) throw new Error("duty-end <학교ID> <직책·업무ID> --by 이름 --reason 사유");
    await endDuty(prisma, { schoolId: id, dutyId, reason, actorLabel: by, via: "platform_operator" });
    console.log(`[operator] 종료 완료: ${dutyId}`);
    return;
  }
  console.log("사용법: npm run operator -- list | approve <ID> --by 이름 --method 방법 | reject <ID> --by 이름 | duties <학교ID> | duty-add <소속ID> <직책> --by 이름 [--method 방법] | duty-end <학교ID> <ID> --by 이름 --reason 사유");
}

main()
  .catch((error) => {
    console.error("[operator] 실패:", error instanceof Error ? error.message : error);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
