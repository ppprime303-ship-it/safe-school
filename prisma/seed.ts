// 데모 데이터 넣기: `npm run db:seed`
//
// 안전 원칙
// - is_demo = true 인 "SAFE SCHOOL 데모초등학교"만 만들거나 갱신합니다. 실제 학교 데이터는 건드리지 않습니다.
// - 같은 slug의 학교가 이미 있는데 데모 학교가 아니면 아무것도 하지 않고 멈춥니다.
// - 여러 번 실행해도 결과가 같습니다(중복 생성 없음). 기존 데이터를 지우지 않습니다.
// - 테스트 계정 비밀번호는 환경변수 DEMO_PASSWORD(12자 이상)에서 읽습니다. 코드에 적지 않습니다.
// - 실제 학생·학부모 개인정보는 넣지 않습니다(반별 인원수만).

import { PrismaClient, type AssignmentDuty, type MemberRole } from "@prisma/client";
import { hashPassword } from "../server/src/security/password.js";
import { PILOT_SCHEMA, deploymentRole } from "../server/src/deploy/environment.js";

const prisma = new PrismaClient();

const DEMO_SLUG = "demo-school";
const DEMO_NAME = "SAFE SCHOOL 데모초등학교";
// 학년도(한국 시간 기준 올해)
const SCHOOL_YEAR = Number(new Intl.DateTimeFormat("en", { timeZone: "Asia/Seoul", year: "numeric" }).format(new Date()));
const GRADES = [1, 2, 3];
const CLASSES_PER_GRADE = 5;
const ENROLLED_PER_CLASS = 28;
const EMAIL_DOMAIN = "demo.safeschool.invalid"; // 실제로 메일이 가지 않는 예약 도메인

type DemoAccount = {
  email: string;
  name: string;
  role: MemberRole;
  assignments: { grade: number; classNo: number; duty: AssignmentDuty }[];
};

const ACCOUNTS: DemoAccount[] = [
  { email: `admin@${EMAIL_DOMAIN}`, name: "데모 관리자(교감)", role: "admin", assignments: [] },
  { email: `teacher11@${EMAIL_DOMAIN}`, name: "데모 1학년1반 담임", role: "homeroom", assignments: [{ grade: 1, classNo: 1, duty: "homeroom" }] },
  { email: `teacher12@${EMAIL_DOMAIN}`, name: "데모 1학년2반 담임", role: "homeroom", assignments: [{ grade: 1, classNo: 2, duty: "homeroom" }] },
  { email: `teacher21@${EMAIL_DOMAIN}`, name: "데모 2학년1반 담임", role: "homeroom", assignments: [{ grade: 2, classNo: 1, duty: "homeroom" }] },
  { email: `staff@${EMAIL_DOMAIN}`, name: "데모 보건교사", role: "staff", assignments: [{ grade: 1, classNo: 3, duty: "assist" }] },
];

async function main() {
  // STEP 7: 실제 학교 시범운영 스키마에는 데모 데이터를 절대 넣지 않습니다(ALLOW_DEMO_SEED 로도 허용 안 됨).
  let urlSchema: string | null = null;
  try {
    urlSchema = new URL(process.env.DATABASE_URL ?? "").searchParams.get("schema");
  } catch {
    urlSchema = null;
  }
  if (deploymentRole(process.env) === "pilot" || urlSchema === PILOT_SCHEMA || process.env.DEPLOY_DB_SCHEMA?.trim() === PILOT_SCHEMA) {
    throw new Error("실제 학교 시범운영 환경(safeschool_prod_pilot)에는 데모 데이터를 넣을 수 없습니다.");
  }
  // 운영 환경에서는 명시적으로 허용한 경우에만 데모 데이터를 넣습니다(실데이터·데모 분리).
  if (process.env.NODE_ENV === "production" && process.env.ALLOW_DEMO_SEED !== "true") {
    throw new Error("운영 환경에서는 데모 시드를 실행하지 않습니다. 시연용 배포라면 ALLOW_DEMO_SEED=true 를 일시적으로 설정하세요.");
  }
  const demoPassword = process.env.DEMO_PASSWORD ?? "";
  if (demoPassword.length < 12) {
    throw new Error("DEMO_PASSWORD(12자 이상)를 Replit Secrets에 먼저 넣어 주세요.");
  }

  const existing = await prisma.school.findUnique({ where: { slug: DEMO_SLUG } });
  if (existing && !existing.isDemo) {
    throw new Error(`slug '${DEMO_SLUG}' 학교가 데모 학교가 아닙니다. 실제 데이터 보호를 위해 중단합니다.`);
  }

  const school = await prisma.school.upsert({
    where: { slug: DEMO_SLUG },
    update: { name: DEMO_NAME },
    create: { slug: DEMO_SLUG, name: DEMO_NAME, isDemo: true, schoolKindCode: "02", status: "active", activatedAt: new Date() },
  });

  // 학급: 1~3학년 × 5반 × 28명
  const classIdByKey = new Map<string, string>();
  for (const grade of GRADES) {
    for (let classNo = 1; classNo <= CLASSES_PER_GRADE; classNo++) {
      const cls = await prisma.schoolClass.upsert({
        where: { schoolId_schoolYear_grade_classNo: { schoolId: school.id, schoolYear: SCHOOL_YEAR, grade, classNo } },
        update: {}, // 이미 있으면 그대로 둠(관리자가 고친 재적을 덮어쓰지 않음)
        create: {
          schoolId: school.id,
          schoolYear: SCHOOL_YEAR,
          grade,
          classNo,
          label: `${grade}학년 ${classNo}반`,
          enrolledCount: ENROLLED_PER_CLASS,
          enrolledConfirmedAt: new Date(),
        },
      });
      classIdByKey.set(`${grade}-${classNo}`, cls.id);
    }
  }

  // 테스트 계정: 명단 일괄 승인(roster) 방식으로 승인된 상태
  const passwordHash = await hashPassword(demoPassword);
  let adminId: string | null = null;
  for (const account of ACCOUNTS) {
    const user = await prisma.user.upsert({
      where: { email: account.email },
      update: { displayName: account.name, passwordHash },
      create: { email: account.email, displayName: account.name, passwordHash, emailVerifiedAt: new Date() },
    });
    if (account.role === "admin") adminId = user.id;

    await prisma.userIdentity.upsert({
      where: { provider_providerSubject: { provider: "password", providerSubject: user.id } },
      update: {},
      create: { userId: user.id, provider: "password", providerSubject: user.id },
    });

    const membership = await prisma.schoolMembership.upsert({
      where: { schoolId_userId: { schoolId: school.id, userId: user.id } },
      update: { role: account.role },
      create: {
        schoolId: school.id,
        userId: user.id,
        role: account.role,
        status: "approved",
        approvalMethod: account.role === "admin" ? "bootstrap" : "roster",
        approvedAt: new Date(),
      },
    });

    for (const a of account.assignments) {
      const classId = classIdByKey.get(`${a.grade}-${a.classNo}`);
      if (!classId) continue;
      await prisma.classAssignment.upsert({
        where: { membershipId_classId_duty: { membershipId: membership.id, classId, duty: a.duty } },
        update: {},
        create: { membershipId: membership.id, classId, duty: a.duty },
      });
    }
  }

  await prisma.auditLog.create({
    data: {
      schoolId: school.id,
      actorUserId: adminId,
      action: "demo.seed",
      targetType: "school",
      targetId: school.id,
      after: { classes: classIdByKey.size, accounts: ACCOUNTS.length },
    },
  });

  const classCount = await prisma.schoolClass.count({ where: { schoolId: school.id, schoolYear: SCHOOL_YEAR } });
  const enrolled = await prisma.schoolClass.aggregate({ where: { schoolId: school.id, schoolYear: SCHOOL_YEAR }, _sum: { enrolledCount: true } });
  console.log(`[seed] ${DEMO_NAME}: 학급 ${classCount}개, 재적 합계 ${enrolled._sum.enrolledCount ?? 0}명, 테스트 계정 ${ACCOUNTS.length}개`);
  console.log(`[seed] 테스트 계정 이메일: ${ACCOUNTS.map((a) => a.email).join(", ")}`);
}

main()
  .catch((error) => {
    console.error("[seed] 실패:", error instanceof Error ? error.message : error);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
