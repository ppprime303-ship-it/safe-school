// STEP 6 심사위원 시연 환경 준비·초기화(국내 VPS 심사 환경 셸에서 운영자만 실행)
//
//   계획만 보기(기본, DB 읽기만):
//     npm run judge:setup
//   실제 구성(승인 후, 한 번):
//     JUDGE_SETUP_CONFIRM=safeschool_prod_judge npm run judge:setup -- --apply --out /root/judge-accounts.txt [--sample-drill]
//   심사 사이 초기화(진행 중인 모의 상황만 종료 — 기록 삭제 없음):
//     JUDGE_SETUP_CONFIRM=safeschool_prod_judge npm run judge:setup -- --reset-active
//
// 실제 학교 시범운영 환경 차단(두 겹)
//  1) 코드: DEPLOY_PROFILE=production + DEPLOY_DB_SCHEMA=safeschool_prod_judge 일 때만(시범운영 safeschool_prod_pilot 거부)
//  2) DB: 실행 계정이 심사 외 SAFE SCHOOL 스키마에 USAGE 권한이 있으면 거부(심사 전용 최소 권한 계정 필수 — deploy/sql/roles.sql)
//     + 심사 스키마에 시연 학교가 아닌 학교가 있으면 거부
//
// 안전 원칙
// - 마이그레이션이 끝난 스키마에만 씁니다. 기존 데이터를 지우거나 덮어쓰지 않습니다(이미 있으면 건너뜀, 기존 비밀번호 유지).
// - 비밀번호는 무작위로 만들고 화면·로그에 출력하지 않습니다. --out 파일(저장소 밖, 새 파일, 권한 600)에만 씁니다.
// - 인증 우회 화면·API를 만들지 않습니다(운영자 셸 전용, 기존 db:seed 와 같은 방식으로 '이메일 확인됨').
// - 예시 훈련은 기존 서비스 함수(발령·보고·종료·훈련일지)로 만들어 검증 규칙을 그대로 거칩니다.
import fs from "node:fs";
import { PrismaClient } from "@prisma/client";
import { resolveDeployTarget } from "../server/src/deploy/dbTarget.js";
import {
  JUDGE_SLUG_PREFIX,
  JUDGE_VERIFICATION_NOTE,
  buildJudgePlan,
  generatePassword,
  judgeApplyErrors,
  judgeDataIsolationErrors,
  judgeDbIsolationErrors,
  judgeTargetErrors,
  passwordFileErrors,
  passwordFileText,
  validateJudgePlan,
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
let writing = false; // 쓰기를 시작했는지(실패 안내 문구 구분)
const fail = (msgs: string[]): never => {
  console.error(
    writing
      ? "[judge-setup] 중단 — 일부 항목이 이미 만들어졌을 수 있습니다. 원인을 고친 뒤 같은 명령을 다시 실행하면 이미 있는 항목은 건너뜁니다(삭제·초기화하지 마세요):"
      : "[judge-setup] 중단 — 아무것도 바꾸지 않았습니다:",
  );
  for (const m of msgs) console.error(` - ${m}`);
  process.exit(1);
};
const SCHOOL_YEAR = Number(new Intl.DateTimeFormat("en", { timeZone: "Asia/Seoul", year: "numeric" }).format(new Date()));

async function main() {
  const apply = flag("apply");
  const resetActive = flag("reset-active");
  if (apply && resetActive) fail(["--apply 와 --reset-active 는 따로 실행하세요."]);
  const plan = buildJudgePlan();
  const planErrors = validateJudgePlan(plan);
  if (planErrors.length) fail(planErrors);

  const target = resolveDeployTarget(process.env);
  if (!target.ok) return fail(target.errors);
  log(`대상: ${target.summary}`);
  const targetErrors = judgeTargetErrors(target);
  if (targetErrors.length) fail(targetErrors);

  const db = new PrismaClient({ datasourceUrl: target.url, log: ["error"] });
  try {
    // ── 읽기 전용 점검 ──
    const who = await db.$queryRaw<{ u: string }[]>`SELECT current_user AS u`;
    const priv = await db.$queryRaw<{ schema: string; usage: boolean }[]>`
      SELECT nspname AS schema, has_schema_privilege(current_user, oid, 'USAGE') AS usage FROM pg_namespace WHERE nspname LIKE 'safeschool%'`;
    const dbErrors = judgeDbIsolationErrors(priv, who[0]?.u ?? "?");
    if (dbErrors.length) fail(dbErrors);
    const mig = await db.$queryRaw<{ ok: boolean }[]>`SELECT to_regclass(format('%I._prisma_migrations', ${target.schema}::text)) IS NOT NULL AS ok`;
    if (!mig[0]?.ok) fail([`${target.schema} 에 마이그레이션 기록이 없습니다. 먼저 'npm run deploy:migrate'로 스키마를 만드세요.`]);
    const dataErrors = judgeDataIsolationErrors(await db.school.count({ where: { isDemo: false } }));
    if (dataErrors.length) fail(dataErrors);

    const slugs = plan.schools.map((s) => s.slug);
    const existingSchools = await db.school.findMany({ where: { slug: { in: slugs } }, select: { id: true, slug: true, isDemo: true } });
    const allEmails = [...plan.accounts.map((a) => a.email), ...plan.virtualStaff.map((v) => v.email)];
    const existingEmails = new Set((await db.user.findMany({ where: { email: { in: allEmails } }, select: { email: true } })).map((u) => u.email));

    if (resetActive) {
      const confirmErrors = judgeApplyErrors(target, process.env.JUDGE_SETUP_CONFIRM);
      if (confirmErrors.length) fail(confirmErrors);
      writing = true;
      for (const s of existingSchools) {
        if (!s.isDemo || !s.slug.startsWith(JUDGE_SLUG_PREFIX)) continue; // 심사 시연 학교만
        const active = await db.disasterEvent.findMany({ where: { schoolId: s.id, status: "active" }, select: { id: true, mode: true } });
        const closer = plan.accounts.find((a) => plan.schools.find((x) => x.slug === s.slug)?.key === a.schoolKey && a.duties.includes("safety_officer"));
        const closerUser = closer ? await db.user.findUnique({ where: { email: closer.email }, select: { id: true } }) : null;
        for (const ev of active) {
          if (!closerUser) fail([`${s.slug}: 종료할 안전업무 담당 계정이 없습니다.`]);
          await closeEvent(db, { schoolId: s.id, eventId: ev.id, actorUserId: closerUser!.id, confirmClose: ev.mode === "real" });
          log(`  ${s.slug}: 진행 중인 상황 1건 종료(기록은 보존)`);
        }
        if (!active.length) log(`  ${s.slug}: 진행 중인 상황 없음`);
      }
      log("초기화 완료(진행 중 상황 종료만 — 보고·훈련일지·감사 기록은 그대로).");
      return;
    }

    log(`구성: 가상 학교 ${plan.schools.length}곳 · 심사위원 계정 ${plan.accounts.length}개 · 가상 담임(로그인 불가) ${plan.virtualStaff.length}명`);
    for (const s of plan.schools)
      log(`  학교 ${s.slug} ${existingSchools.some((x) => x.slug === s.slug) ? "(이미 있음 — 건너뜀)" : "(새로 만듦)"} ${s.name} · 학급 ${s.classes.length}개 · 예시 훈련 ${s.drill.type === "fire" ? "화재" : "지진"}`);
    for (const a of plan.accounts) log(`  계정 ${a.email} ${existingEmails.has(a.email) ? "(이미 있음 — 비밀번호 유지)" : "(새로 만듦)"} · ${a.roleLabel}`);

    if (!apply) {
      log("계획만 표시했습니다(DB 변경 없음). 실제 구성은 승인 후 --apply 로 실행하세요.");
      return;
    }

    const applyErrors = judgeApplyErrors(target, process.env.JUDGE_SETUP_CONFIRM);
    const newAccounts = plan.accounts.filter((a) => !existingEmails.has(a.email));
    const out = opt("out");
    if (newAccounts.length) applyErrors.push(...passwordFileErrors(out, process.cwd(), !!out && fs.existsSync(out)));
    if (applyErrors.length) fail(applyErrors);

    // 비밀번호 파일을 먼저 열어(새 파일만, 600) 쓰기 가능한지 확인 — 계정 생성 후 파일 실패로 비밀번호를 잃지 않게
    const passwords = new Map(newAccounts.map((a) => [a.email, generatePassword()]));
    writing = true;
    const fd = newAccounts.length ? fs.openSync(out!, "wx", 0o600) : null;

    const schoolId = new Map<string, string>();
    const classId = new Map<string, string>();
    for (const s of plan.schools) {
      const sch = await db.school.upsert({
        where: { slug: s.slug },
        update: {},
        create: { slug: s.slug, name: s.name, isDemo: true, schoolKindCode: s.kindCode, status: "active", activatedAt: new Date(), eduOfficeName: s.eduOfficeName, address: s.address },
      });
      if (!sch.isDemo) fail([`${s.slug}: 시연 학교가 아닙니다.`]);
      schoolId.set(s.key, sch.id);
      for (const c of s.classes) {
        const row = await db.schoolClass.upsert({
          where: { schoolId_schoolYear_grade_classNo: { schoolId: sch.id, schoolYear: SCHOOL_YEAR, grade: c.grade, classNo: c.classNo } },
          update: {},
          create: { schoolId: sch.id, schoolYear: SCHOOL_YEAR, grade: c.grade, classNo: c.classNo, label: `${c.grade}학년 ${c.classNo}반`, enrolledCount: c.enrolled, enrolledConfirmedAt: new Date() },
        });
        classId.set(`${s.key}:${c.grade}-${c.classNo}`, row.id);
      }
    }

    type Member = { membershipId: string; userId: string; role: string };
    const memberByEmail = new Map<string, Member>();
    const join = async (p: { schoolKey: string; email: string; displayName: string; role: "admin" | "homeroom" | "staff"; login: boolean; assignments: { grade: number; classNo: number; duty: "homeroom" | "assist" }[] }) => {
      const sid = schoolId.get(p.schoolKey)!;
      const isNew = !existingEmails.has(p.email);
      const user = isNew
        ? await db.user.create({
            data: p.login
              ? { email: p.email, displayName: p.displayName, passwordHash: await hashPassword(passwords.get(p.email)!), emailVerifiedAt: new Date() }
              : { email: p.email, displayName: p.displayName, passwordHash: null, status: "disabled" }, // 가상 담임: 로그인 불가
          })
        : await db.user.findUniqueOrThrow({ where: { email: p.email } });
      if (p.login)
        await db.userIdentity.upsert({ where: { provider_providerSubject: { provider: "password", providerSubject: user.id } }, update: {}, create: { userId: user.id, provider: "password", providerSubject: user.id } });
      const m = await db.schoolMembership.upsert({
        where: { schoolId_userId: { schoolId: sid, userId: user.id } },
        update: {},
        create: { schoolId: sid, userId: user.id, role: p.role, status: "approved", approvalMethod: "roster", approvedAt: new Date() },
      });
      for (const x of p.assignments)
        await db.classAssignment.upsert({
          where: { membershipId_classId_duty: { membershipId: m.id, classId: classId.get(`${p.schoolKey}:${x.grade}-${x.classNo}`)!, duty: x.duty } },
          update: {},
          create: { membershipId: m.id, classId: classId.get(`${p.schoolKey}:${x.grade}-${x.classNo}`)!, duty: x.duty },
        });
      memberByEmail.set(p.email, { membershipId: m.id, userId: user.id, role: p.role });
      return m.id;
    };

    const rows: { email: string; password: string; roleLabel: string; schoolName: string }[] = [];
    for (const a of plan.accounts) {
      const mid = await join({ ...a, login: true, role: a.role });
      const active = await db.memberDuty.findMany({ where: { membershipId: mid, endedAt: null }, select: { duty: true } });
      for (const duty of a.duties)
        if (!active.some((d) => d.duty === duty))
          await grantDutyByPlatformOperator(db, { membershipId: mid, duty, operator: "심사 시연 준비(운영자)", verificationMethod: JUDGE_VERIFICATION_NOTE, note: "STEP 6 심사위원 시연" });
      if (passwords.has(a.email)) rows.push({ email: a.email, password: passwords.get(a.email)!, roleLabel: a.roleLabel, schoolName: plan.schools.find((s) => s.key === a.schoolKey)!.name });
    }
    if (fd !== null) {
      fs.writeSync(fd, passwordFileText(rows, new Date().toISOString()));
      fs.closeSync(fd);
      log(`새 계정 ${rows.length}개의 비밀번호를 ${out} 에 저장했습니다(권한 600, 화면에는 출력하지 않음).`);
    }
    for (const v of plan.virtualStaff) await join({ ...v, role: "homeroom", login: false, assignments: [{ grade: v.grade, classNo: v.classNo, duty: "homeroom" }] });
    log(`가상 담임 ${plan.virtualStaff.length}명(로그인 불가) 배정 완료`);

    if (flag("sample-drill")) {
      for (const s of plan.schools) {
        const sid = schoolId.get(s.key)!;
        if (await db.disasterEvent.count({ where: { schoolId: sid, mode: "drill" } })) {
          log(`  ${s.slug}: 훈련 기록이 이미 있어 예시 훈련을 만들지 않습니다.`);
          continue;
        }
        const officer = plan.accounts.find((a) => a.schoolKey === s.key && a.duties.includes("safety_officer"))!;
        const om = memberByEmail.get(officer.email)!;
        const ev = await issueEvent(db, { schoolId: sid, actorUserId: om.userId, primaryType: s.drill.type, mode: "drill", location: s.drill.location, evacPlace: s.drill.evacPlace, message: s.drill.message });
        let n = 0;
        for (const c of s.classes) {
          if (s.drill.unreported.some((u) => u.grade === c.grade && u.classNo === c.classNo)) continue;
          const reporterEmail =
            plan.accounts.find((a) => a.schoolKey === s.key && a.assignments.some((x) => x.grade === c.grade && x.classNo === c.classNo))?.email ??
            plan.virtualStaff.find((v) => v.schoolKey === s.key && v.grade === c.grade && v.classNo === c.classNo)!.email;
          const rm = memberByEmail.get(reporterEmail)!;
          const absent = s.drill.absent(c.grade, c.classNo);
          await submitReport(db, {
            schoolId: sid,
            eventId: ev.id,
            classId: classId.get(`${s.key}:${c.grade}-${c.classNo}`)!,
            actorUserId: rm.userId,
            membershipId: rm.membershipId,
            role: rm.role,
            idempotencyKey: `judge-sample-${s.key}-${c.grade}-${c.classNo}`,
            input: { evacuated: c.enrolled - absent, absentKnown: absent, injured: s.drill.injured(c.grade, c.classNo), enrolledCount: c.enrolled, enrolledChangeReason: null, note: null, expectedVersion: null },
          });
          n++;
        }
        await closeEvent(db, { schoolId: sid, eventId: ev.id, actorUserId: om.userId });
        await createDrillLog(db, { schoolId: sid, eventId: ev.id, actorUserId: om.userId });
        log(`  ${s.slug}: 예시 ${s.drill.type === "fire" ? "화재" : "지진"} 모의훈련 1건(보고 ${n}개 학급, 미보고 ${s.drill.unreported.length}개) + 훈련일지 초안`);
      }
    }
    log("완료. 비밀번호 파일은 심사위원에게 안전하게 전달한 뒤 서버에서 삭제하세요(shred -u).");
  } catch (e) {
    fail([safeErrorSummary(e)]);
  } finally {
    await db.$disconnect().catch(() => {});
  }
}

main().catch((e) => fail([safeErrorSummary(e)]));
