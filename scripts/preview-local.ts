// Beta PILOT 2 화면 점검용 로컬 미리보기 계정 추가: `PREVIEW_CONFIRM=local npm run preview:setup`
//
// 안전 원칙
// - 이 PC의 로컬 DB에서만 실행합니다: NODE_ENV≠production, DATABASE_URL 호스트가 localhost/127.0.0.1, 스키마·DB 이름에 'prod' 없음,
//   PREVIEW_CONFIRM=local. 하나라도 아니면 아무것도 하지 않고 멈춥니다(운영·심사 DB 보호).
// - `npm run db:seed` 가 만든 데모 학교(is_demo)에만 계정을 추가합니다. 기존 데이터는 지우거나 바꾸지 않습니다(여러 번 실행해도 같음).
// - 비밀번호는 DEMO_PASSWORD(12자 이상)를 그대로 씁니다. 화면·로그에 출력하지 않습니다.
// - 가상 계정만: 실제 이름·연락처를 넣지 않습니다.
import { PrismaClient, type StaffDuty } from "@prisma/client";
import { hashPassword } from "../server/src/security/password.js";
import { grantDutyByPlatformOperator } from "../server/src/services/duties.js";

const EMAIL_DOMAIN = "demo.safeschool.invalid";
const ACCOUNTS: { email: string; name: string; duty: StaffDuty }[] = [
  { email: `principal@${EMAIL_DOMAIN}`, name: "데모 교장", duty: "principal" },
  { email: `safety@${EMAIL_DOMAIN}`, name: "데모 안전업무 담당", duty: "safety_officer" },
];

/** 로컬 미리보기 대상인지(순수 함수 — 테스트 가능) */
export function previewTargetProblem(env: Record<string, string | undefined>): string | null {
  if (env.NODE_ENV === "production") return "NODE_ENV=production 에서는 실행하지 않습니다.";
  if (env.PREVIEW_CONFIRM !== "local") return "PREVIEW_CONFIRM=local 을 함께 지정하세요(로컬 DB 확인).";
  if (!env.DATABASE_URL) return "DATABASE_URL 이 없습니다.";
  let url: URL;
  try {
    url = new URL(env.DATABASE_URL);
  } catch {
    return "DATABASE_URL 형식이 올바르지 않습니다.";
  }
  if (!["localhost", "127.0.0.1", "::1", "[::1]"].includes(url.hostname)) return `로컬 DB(localhost)에서만 실행합니다(현재 호스트: ${url.hostname}).`;
  const target = `${url.pathname} ${url.searchParams.get("schema") ?? ""}`.toLowerCase();
  if (target.includes("prod")) return "이름에 'prod' 가 들어간 DB·스키마에서는 실행하지 않습니다.";
  return null;
}

async function main() {
  const problem = previewTargetProblem(process.env);
  if (problem) {
    console.error(`[preview] 중단: ${problem}`);
    process.exit(1);
  }
  const password = process.env.DEMO_PASSWORD;
  if (!password || password.length < 12) throw new Error("DEMO_PASSWORD(12자 이상)가 필요합니다.");
  const prisma = new PrismaClient();
  try {
    const school = await prisma.school.findFirst({ where: { isDemo: true }, orderBy: { createdAt: "asc" } });
    if (!school) throw new Error("데모 학교가 없습니다. 먼저 `npm run db:seed` 를 실행하세요.");
    const passwordHash = await hashPassword(password);
    for (const a of ACCOUNTS) {
      const user = await prisma.user.upsert({ where: { email: a.email }, update: {}, create: { email: a.email, displayName: a.name, passwordHash, emailVerifiedAt: new Date() } });
      const m = await prisma.schoolMembership.upsert({
        where: { schoolId_userId: { schoolId: school.id, userId: user.id } },
        update: {},
        create: { schoolId: school.id, userId: user.id, role: "staff", status: "approved", approvalMethod: "roster", approvedAt: new Date() },
      });
      const has = await prisma.memberDuty.count({ where: { membershipId: m.id, duty: a.duty, endedAt: null } });
      if (!has) await grantDutyByPlatformOperator(prisma, { membershipId: m.id, duty: a.duty, operator: "로컬 미리보기", verificationMethod: "로컬 화면 점검용 가상 계정" });
      console.log(`[preview] ${a.email} (${a.name}) 준비 완료`);
    }
    console.log(`[preview] 학교: ${school.name} — 비밀번호는 DEMO_PASSWORD 와 같습니다.`);
  } finally {
    await prisma.$disconnect();
  }
}

if (process.argv[1] && /preview-local\.ts$/.test(process.argv[1])) {
  main().catch((e) => {
    console.error("[preview] 실패:", e instanceof Error ? e.message : e);
    process.exit(1);
  });
}
