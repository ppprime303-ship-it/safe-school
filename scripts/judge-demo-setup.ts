// STEP 6 심사위원 시연 환경 준비(국내 VPS 운영 서버 셸에서 운영자만 실행)
//
//   계획만 보기(기본, DB 읽기만):
//     npm run judge:setup -- --layout independent
//   실제 생성(승인 후, 한 번):
//     JUDGE_SETUP_CONFIRM=safeschool_prod_judge npm run judge:setup -- --layout independent --apply --out /root/judge-accounts.txt [--sample-drill]
//
// 안전 원칙
// - DATABASE_URL·DEPLOY_PROFILE=production·DEPLOY_DB_SCHEMA 를 배포와 같은 방식으로 검증합니다(public·test·demo 스키마 거부).
// - 마이그레이션이 끝난 스키마에만 씁니다(스키마를 만들거나 마이그레이션하지 않음). 기존 데이터를 지우거나 덮어쓰지 않습니다.
// - 이미 있는 학교(slug)·계정(이메일)은 건너뜁니다. 같은 slug가 시연 학교가 아니면 중단합니다. 기존 계정 비밀번호를 바꾸지 않습니다.
// - 비밀번호는 무작위로 만들고 화면·로그에 출력하지 않습니다. --out 파일(저장소 밖, 새 파일, 권한 600)에만 씁니다.
// - 실제 이메일 인증을 우회하는 화면·API는 만들지 않습니다. 운영자가 서버 셸에서 직접 만든 계정만 '확인됨'으로 둡니다(기존 db:seed 와 같은 방식).
// - --sample-drill: 학교마다 지난 모의훈련 1건(일부 학급 미보고) + 훈련일지를 기존 서비스 함수로 만듭니다(검증 규칙 그대로).
import fs from "node:fs";
import { PrismaClient } from "@prisma/client";
import { resolveDeployTarget } from "../server/src/deploy/dbTarget.js";
import {
  JUDGE_VERIFICATION_NOTE,
  buildJudgePlan,
  generatePassword,
  judgeApplyErrors,
  passwordFileErrors,
  passwordFileText,
  validateJudgePlan,
  type JudgeLayout,
} from "../server/src/deploy/judgeDemo.js";
import { hashPassword } from "../server/src/security/password.js";
import { safeErrorSummary } from "../server/src/security/safeLog.js";
import { grantDutyByPlatformOperator } from "../server/src/services/duties.js";
import { closeEvent, issueEvent, submitReport } from "../server/src/services/events.js";
import { createDrillLog } from "../server/src/services/drillLogs.js";

const args = process.argv.slice(2);
const flag = (n: string) => args.includes(`--${n}`);
const opt = (n: string) => (args.includes(`--${n}`) ? args[args.indexOf(`--${n}`) + 1] : undefined);
const log = (m: string) => console.log(`[judge-setup] ${m}`);
let writing = false; // --apply 로 쓰기를 시작했는지(실패 안내 문구 구분)
const fail = (msgs: string[]): never => {
  console.error(
    writing
      ? "[judge-setup] 중단 — 일부 학교·계정이 이미 만들어졌을 수 있습니다. 원인을 고친 뒤 같은 명령을 다시 실행하면 이미 있는 항목은 건너뜁니다(삭제·초기화하지 마세요):"
      : "[judge-setup] 중단 — 아무것도 바꾸지 않았습니다:",
  );
  for (const m of msgs) console.error(` - ${m}`);
  process.exit(1);
};
const SCHOOL_YEAR = Number(new Intl.DateTimeFormat("en", { timeZone: "Asia/Seoul", year: "numeric" }).format(new Date()));

async function main() {
  const layout = (opt("layout") ?? "independent") as JudgeLayout;
  if (layout !== "independent" && layout !== "shared") fail(["--layout 은 independent 또는 shared"]);
  const apply = flag("apply");
  const plan = buildJudgePlan(layout);
  const planErrors = validateJudgePlan(plan);
  if (planErrors.length) fail(planErrors);

  const target = resolveDeployTarget(process.env);
  if (!target.ok) return fail(target.errors);
  log(`대상: ${target.summary}`);
  if (target.profile !== "production") fail(["DEPLOY_PROFILE=production 대상에서만 실행합니다(Replit 시연 DB 금지)."]);

  const db = new PrismaClient({ datasourceUrl: target.url, log: ["error"] });
  try {
    // 읽기 전용 점검: 마이그레이션 완료 여부, 이미 있는 학교·계정
    const rows = await db.$queryRaw<{ ok: boolean }[]>`SELECT to_regclass(format('%I._prisma_migrations', ${target.schema}::text)) IS NOT NULL AS ok`;
    if (!rows[0]?.ok) fail([`${target.schema} 에 마이그레이션 기록이 없습니다. 먼저 'npm run deploy:migrate'로 스키마를 만드세요.`]);
    const existingSchools = await db.school.findMany({ where: { slug: { in: plan.schools.map((s) => s.slug) } }, select: { slug: true, isDemo: true } });
    const foreign = existingSchools.filter((s) => !s.isDemo);
    if (foreign.length) fail([`시연 학교가 아닌 학교가 같은 slug를 씁니다: ${foreign.map((s) => s.slug).join(", ")}`]);
    const existingUsers = await db.user.findMany({ where: { email: { in: plan.accounts.map((a) => a.email) } }, select: { email: true } });
    const existingEmails = new Set(existingUsers.map((u) => u.email));
    const newAccounts = plan.accounts.filter((a) => !existingEmails.has(a.email));

    log(`구성: ${layout === "independent" ? "심사위원별 독립 가상 학교" : "가상 학교 1곳·역할별 계정"} — 학교 ${plan.schools.length}곳, 계정 ${plan.accounts.length}개`);
    for (const s of plan.schools) log(`  학교 ${s.slug} ${existingSchools.some((x) => x.slug === s.slug) ? "(이미 있음 — 건너뜀)" : "(새로 만듦)"} ${s.name} · 학급 ${s.grades.length * s.classesPerGrade}개`);
    for (const a of plan.accounts) log(`  계정 ${a.email} ${existingEmails.has(a.email) ? "(이미 있음 — 비밀번호 유지)" : "(새로 만듦)"} · ${a.roleLabel}`);

    if (!apply) {
      log("계획만 표시했습니다(DB 변경 없음). 실제 생성은 승인 후 --apply 로 실행하세요.");
      return;
    }

    const applyErrors = judgeApplyErrors(target, process.env.JUDGE_SETUP_CONFIRM);
    const out = opt("out");
    if (newAccounts.length) applyErrors.push(...passwordFileErrors(out, process.cwd(), !!out && fs.existsSync(out)));
    if (applyErrors.length) fail(applyErrors);

    // 비밀번호 파일을 먼저 만들어(새 파일만, 600) 쓰기 가능한지 확인 — 계정 생성 후 파일 실패로 비밀번호를 잃지 않게
    const passwords = new Map(newAccounts.map((a) => [a.email, generatePassword()]));
    writing = true;
    let fd: number | null = null;
    if (newAccounts.length) fd = fs.openSync(out!, "wx", 0o600);

    const schoolIdByKey = new Map<string, string>();
    const classIdBy = new Map<string, string>();
    for (const s of plan.schools) {
      const sch = await db.school.upsert({
        where: { slug: s.slug },
        update: {},
        create: { slug: s.slug, name: s.name, isDemo: true, schoolKindCode: "02", status: "active", activatedAt: new Date(), eduOfficeName: s.eduOfficeName },
      });
      schoolIdByKey.set(s.key, sch.id);
      for (const grade of s.grades)
        for (let classNo = 1; classNo <= s.classesPerGrade; classNo++) {
          const c = await db.schoolClass.upsert({
            where: { schoolId_schoolYear_grade_classNo: { schoolId: sch.id, schoolYear: SCHOOL_YEAR, grade, classNo } },
            update: {},
            create: { schoolId: sch.id, schoolYear: SCHOOL_YEAR, grade, classNo, label: `${grade}학년 ${classNo}반`, enrolledCount: s.enrolledPerClass, enrolledConfirmedAt: new Date() },
          });
          classIdBy.set(`${s.key}:${grade}-${classNo}`, c.id);
        }
    }

    const fileRows: { email: string; password: string; roleLabel: string; schoolName: string }[] = [];
    const memberBy = new Map<string, { membershipId: string; userId: string }>();
    for (const a of plan.accounts) {
      const schoolId = schoolIdByKey.get(a.schoolKey)!;
      const isNew = passwords.has(a.email);
      const user = isNew
        ? await db.user.create({ data: { email: a.email, displayName: a.displayName, passwordHash: await hashPassword(passwords.get(a.email)!), emailVerifiedAt: new Date() } })
        : await db.user.findUniqueOrThrow({ where: { email: a.email } });
      await db.userIdentity.upsert({
        where: { provider_providerSubject: { provider: "password", providerSubject: user.id } },
        update: {},
        create: { userId: user.id, provider: "password", providerSubject: user.id },
      });
      const m = await db.schoolMembership.upsert({
        where: { schoolId_userId: { schoolId, userId: user.id } },
        update: {},
        create: { schoolId, userId: user.id, role: a.role, status: "approved", approvalMethod: a.role === "admin" ? "bootstrap" : "roster", approvedAt: new Date() },
      });
      memberBy.set(a.key, { membershipId: m.id, userId: user.id });
      for (const asg of a.assignments) {
        const classId = classIdBy.get(`${a.schoolKey}:${asg.grade}-${asg.classNo}`)!;
        await db.classAssignment.upsert({
          where: { membershipId_classId_duty: { membershipId: m.id, classId, duty: asg.duty } },
          update: {},
          create: { membershipId: m.id, classId, duty: asg.duty },
        });
      }
      const active = await db.memberDuty.findMany({ where: { membershipId: m.id, endedAt: null }, select: { duty: true } });
      for (const duty of a.duties)
        if (!active.some((d) => d.duty === duty))
          await grantDutyByPlatformOperator(db, { membershipId: m.id, duty, operator: "심사 시연 준비(운영자)", verificationMethod: JUDGE_VERIFICATION_NOTE, note: "STEP 6 심사위원 시연" });
      if (isNew) fileRows.push({ email: a.email, password: passwords.get(a.email)!, roleLabel: a.roleLabel, schoolName: plan.schools.find((s) => s.key === a.schoolKey)!.name });
    }
    if (fd !== null) {
      fs.writeSync(fd, passwordFileText(fileRows, new Date().toISOString()));
      fs.closeSync(fd);
      log(`새 계정 ${fileRows.length}개의 비밀번호를 ${out} 에 저장했습니다(권한 600, 화면에는 출력하지 않음).`);
    }

    if (flag("sample-drill")) {
      for (const s of plan.schools) {
        const schoolId = schoolIdByKey.get(s.key)!;
        const already = await db.disasterEvent.count({ where: { schoolId, mode: "drill" } });
        if (already) {
          log(`  ${s.slug}: 훈련 기록이 이미 있어 예시 훈련을 만들지 않습니다.`);
          continue;
        }
        // 발령·종료는 발령 권한 계정, 보고는 학교 관리자(대리) 또는 배정된 담임
        const actors = plan.accounts.filter((a) => a.schoolKey === s.key);
        const issuer = actors.find((a) => a.role === "admin" || a.duties.some((d) => d === "safety_officer" || d === "principal" || d === "vice_principal"))!;
        const issuerM = memberBy.get(issuer.key)!;
        const ev = await issueEvent(db, { schoolId, actorUserId: issuerM.userId, primaryType: "fire", mode: "drill", location: "본관 1층(가상)", evacPlace: "운동장", message: "심사 시연용 예시 모의훈련(가상)" });
        const evId = ev.id;
        let n = 0;
        for (const grade of s.grades)
          for (let classNo = 1; classNo <= s.classesPerGrade; classNo++) {
            if (grade === s.grades.at(-1) && classNo === s.classesPerGrade) continue; // 마지막 학급은 미보고로 둠(상황판 '미보고' 확인용)
            const reporter = issuer.role === "admin" ? issuer : actors.find((a) => a.assignments.some((x) => x.grade === grade && x.classNo === classNo));
            if (!reporter) continue;
            const rm = memberBy.get(reporter.key)!;
            await submitReport(db, {
              schoolId,
              eventId: evId,
              classId: classIdBy.get(`${s.key}:${grade}-${classNo}`)!,
              actorUserId: rm.userId,
              membershipId: rm.membershipId,
              role: reporter.role,
              idempotencyKey: `judge-sample-${s.key}-${grade}-${classNo}`,
              input: { evacuated: s.enrolledPerClass - 1, absentKnown: 1, injured: 0, enrolledCount: s.enrolledPerClass, enrolledChangeReason: null, note: null, expectedVersion: null },
            });
            n++;
          }
        await closeEvent(db, { schoolId, eventId: evId, actorUserId: issuerM.userId });
        if (actors.some((a) => a.duties.includes("safety_officer"))) {
          const so = memberBy.get(actors.find((a) => a.duties.includes("safety_officer"))!.key)!;
          await createDrillLog(db, { schoolId, eventId: evId, actorUserId: so.userId });
        }
        log(`  ${s.slug}: 예시 모의훈련 1건(보고 ${n}개 학급, 미보고 포함) + 훈련일지`);
      }
    }
    log("완료. 비밀번호 파일은 심사위원에게 안전하게 전달한 뒤 서버에서 삭제하세요.");
  } catch (e) {
    fail([safeErrorSummary(e)]);
  } finally {
    await db.$disconnect().catch(() => {});
  }
}

main().catch((e) => fail([safeErrorSummary(e)]));
