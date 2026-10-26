// STEP 6 심사위원 시연 환경 계획(순수 함수 — DB에 접속하지 않음)
// 확정 구성(2026-10-26): 가상 학교 2곳(초등·중학교) × 역할별 계정 4개 = 심사위원 계정 8개
//   A학교 SAFE 시연초등학교: ① 앱 운영담당 + 1학년 1반 담임(겸임) ② 안전업무 담당 ③ 교장 ④ 교감
//   B학교 SAFE 시연중학교:   ① 앱 운영담당 ② 안전업무 담당 + 1학년 1반 담임(겸임) ③ 교장 ④ 교감
// - 실제 학교·교직원·학생 정보를 쓰지 않습니다. 이름에 '(가상)', 이메일은 예약 도메인(.invalid).
// - 나머지 학급 담임은 로그인할 수 없는 '가상 교직원'(비밀번호 없음·사용 중지)으로 두고, 예시 훈련 보고에만 씁니다.
// - 비밀번호는 무작위로 만들고 화면·로그·저장소에 남기지 않습니다(운영자만 읽는 0600 파일로 전달).
// - 인증 우회 경로(백도어)를 만들지 않습니다. 계정은 서버 셸에 접근할 수 있는 운영자가 사전 구성하는 일반 계정입니다.
// - 심사 환경 스키마(safeschool_prod_judge)에서만 실행합니다(실제 학교 시범운영 스키마 차단 — environment.ts).
import { randomBytes } from "node:crypto";
import path from "node:path";
import { capabilitiesFor, type Capability, type MemberRole, type StaffDuty } from "../../../shared/permissions.js";
import type { DeployTargetOk } from "./dbTarget.js";
import { JUDGE_SCHEMA } from "./environment.js";

export const JUDGE_EMAIL_DOMAIN = "judge.safeschool.invalid";
export const JUDGE_SLUG_PREFIX = "judge-demo-";
/** 운영자 확인 방법(교장·교감 직책 기록에 필수): 실제 기관 확인이 아님을 명시 */
export const JUDGE_VERIFICATION_NOTE = "가상 시연학교 — 실제 학교·교직원 아님(운영자 사전 구성)";

export interface JudgeClassPlan {
  grade: number;
  classNo: number;
  enrolled: number;
}

export interface JudgeDrillPlan {
  type: "fire" | "earthquake";
  location: string;
  evacPlace: string;
  message: string;
  /** 보고하지 않은 채 종료할 학급(상황판 '미보고' 확인용) */
  unreported: { grade: number; classNo: number }[];
  /** 학급별 보고 값 규칙: 결석(사유 확인) 인원, 부상 인원 */
  absent: (grade: number, classNo: number) => number;
  injured: (grade: number, classNo: number) => number;
}

export interface JudgeSchoolPlan {
  key: "a" | "b";
  slug: string;
  name: string;
  /** 학교급 코드(학교알리미 기준: 02 초, 03 중) */
  kindCode: "02" | "03";
  /** STEP 5 관할 교육청 표시용(가상 학교라 실제 소재지 아님) */
  eduOfficeName: string;
  /** 모의 경보 지역 매칭용 가상 주소(시도·시군구만 의미, 도로명은 가상) */
  address: string;
  classes: JudgeClassPlan[];
  drill: JudgeDrillPlan;
}

export interface JudgeAccountPlan {
  key: string;
  schoolKey: "a" | "b";
  email: string;
  displayName: string;
  role: MemberRole;
  duties: StaffDuty[];
  assignments: { grade: number; classNo: number; duty: "homeroom" | "assist" }[];
  /** 안내서에 쓰는 역할 설명 */
  roleLabel: string;
  /** 이 계정이 반드시 가져야 할 권한 / 가지면 안 되는 권한(검증용) */
  must: Capability[];
  mustNot: Capability[];
}

/** 로그인하지 않는 가상 담임(예시 훈련 보고용). 비밀번호 없음·사용 중지 상태로 만듦 */
export interface VirtualStaffPlan {
  schoolKey: "a" | "b";
  email: string;
  displayName: string;
  grade: number;
  classNo: number;
}

export interface JudgePlan {
  schools: JudgeSchoolPlan[];
  accounts: JudgeAccountPlan[];
  virtualStaff: VirtualStaffPlan[];
}

const grid = (grades: number, perGrade: number, enrolled: (g: number, c: number) => number): JudgeClassPlan[] =>
  Array.from({ length: grades }, (_, gi) => Array.from({ length: perGrade }, (_, ci) => ({ grade: gi + 1, classNo: ci + 1, enrolled: enrolled(gi + 1, ci + 1) }))).flat();

const SCHOOLS: JudgeSchoolPlan[] = [
  {
    key: "a",
    slug: `${JUDGE_SLUG_PREFIX}elem`,
    name: "SAFE 시연초등학교(가상)",
    kindCode: "02",
    eduOfficeName: "인천광역시교육청",
    address: "인천광역시 남동구 시연로 1(가상 주소)",
    // 1~6학년 × 2반, 학년이 오를수록 인원이 조금씩 다름(21~27명)
    classes: grid(6, 2, (g, c) => 20 + g + (c === 2 ? 0 : -1) + 1),
    drill: {
      type: "fire",
      location: "본관 1층 급식실 인근(가상)",
      evacPlace: "운동장",
      message: "[모의훈련] 화재 대피 훈련입니다. 계단으로 이동하세요.",
      unreported: [{ grade: 6, classNo: 2 }],
      absent: (g, c) => ((g + c) % 3 === 0 ? 1 : 0),
      injured: (g, c) => (g === 3 && c === 1 ? 1 : 0),
    },
  },
  {
    key: "b",
    slug: `${JUDGE_SLUG_PREFIX}middle`,
    name: "SAFE 시연중학교(가상)",
    kindCode: "03",
    eduOfficeName: "경기도교육청",
    address: "경기도 수원시 시연로 2(가상 주소)",
    // 1~3학년 × 4반, 28~31명
    classes: grid(3, 4, (g, c) => 27 + ((g + c) % 4) + 1),
    drill: {
      type: "earthquake",
      location: "학교 전체(가상)",
      evacPlace: "운동장 중앙",
      message: "[모의훈련] 지진 대피 훈련입니다. 흔들림이 멈춘 뒤 대피하세요.",
      unreported: [
        { grade: 2, classNo: 4 },
        { grade: 3, classNo: 3 },
      ],
      absent: (g, c) => ((g * c) % 5 === 0 ? 2 : (g + c) % 2),
      injured: () => 0,
    },
  },
];

const acc = (
  key: string,
  schoolKey: "a" | "b",
  displayName: string,
  role: MemberRole,
  duties: StaffDuty[],
  roleLabel: string,
  must: Capability[],
  mustNot: Capability[],
  assignments: JudgeAccountPlan["assignments"] = [],
): JudgeAccountPlan => ({ key, schoolKey, email: `judge-${key}@${JUDGE_EMAIL_DOMAIN}`, displayName, role, duties, assignments, roleLabel, must, mustNot });

const ISSUE: Capability[] = ["event.issue", "event.close", "board.view"];
const OPERATE: Capability[] = ["members.manage", "classes.manage", "duties.manage"];

const ACCOUNTS: JudgeAccountPlan[] = [
  acc("a1", "a", "심사위원 A1(가상 앱 운영담당·1학년 1반 담임)", "homeroom", ["app_operator"], "앱 운영담당 + 1학년 1반 담임(겸임)", OPERATE, [...ISSUE, "drilllog.edit"], [{ grade: 1, classNo: 1, duty: "homeroom" }]),
  acc("a2", "a", "심사위원 A2(가상 안전업무 담당)", "staff", ["safety_officer"], "안전업무 담당", [...ISSUE, "drilllog.view", "drilllog.edit"], OPERATE),
  acc("a3", "a", "심사위원 A3(가상 교장)", "staff", ["principal"], "교장", [...ISSUE, "drilllog.view"], [...OPERATE, "drilllog.edit"]),
  acc("a4", "a", "심사위원 A4(가상 교감)", "staff", ["vice_principal"], "교감", [...ISSUE, "drilllog.view"], [...OPERATE, "drilllog.edit"]),
  acc("b1", "b", "심사위원 B1(가상 앱 운영담당)", "staff", ["app_operator"], "앱 운영담당", OPERATE, [...ISSUE, "drilllog.edit"]),
  acc("b2", "b", "심사위원 B2(가상 안전업무 담당·1학년 1반 담임)", "homeroom", ["safety_officer"], "안전업무 담당 + 1학년 1반 담임(겸임)", [...ISSUE, "drilllog.view", "drilllog.edit"], OPERATE, [{ grade: 1, classNo: 1, duty: "homeroom" }]),
  acc("b3", "b", "심사위원 B3(가상 교장)", "staff", ["principal"], "교장", [...ISSUE, "drilllog.view"], [...OPERATE, "drilllog.edit"]),
  acc("b4", "b", "심사위원 B4(가상 교감)", "staff", ["vice_principal"], "교감", [...ISSUE, "drilllog.view"], [...OPERATE, "drilllog.edit"]),
];

export function buildJudgePlan(): JudgePlan {
  const virtualStaff: VirtualStaffPlan[] = [];
  for (const s of SCHOOLS)
    for (const c of s.classes) {
      const covered = ACCOUNTS.some((a) => a.schoolKey === s.key && a.assignments.some((x) => x.grade === c.grade && x.classNo === c.classNo));
      if (!covered)
        virtualStaff.push({
          schoolKey: s.key,
          email: `vt-${s.key}-${c.grade}-${c.classNo}@${JUDGE_EMAIL_DOMAIN}`,
          displayName: `가상 담임 ${c.grade}학년 ${c.classNo}반(로그인 불가)`,
          grade: c.grade,
          classNo: c.classNo,
        });
    }
  return { schools: SCHOOLS, accounts: ACCOUNTS, virtualStaff };
}

/** 계획 점검: 이름·이메일·권한 구성·학급 규칙(문제 목록) */
export function validateJudgePlan(plan: JudgePlan): string[] {
  const errors: string[] = [];
  const emails = new Set<string>();
  if (plan.schools.length !== 2) errors.push(`가상 학교는 2곳이어야 합니다(현재 ${plan.schools.length})`);
  if (plan.accounts.length !== 8) errors.push(`심사위원 계정은 8개여야 합니다(현재 ${plan.accounts.length})`);
  for (const s of plan.schools) {
    if (!s.slug.startsWith(JUDGE_SLUG_PREFIX)) errors.push(`${s.key}: slug 접두사`);
    if (!s.name.includes("(가상)")) errors.push(`${s.key}: 학교 이름에 '(가상)' 표시 필요`);
    if (!s.address.includes("(가상 주소)")) errors.push(`${s.key}: 주소에 '(가상 주소)' 표시 필요`);
    for (const c of s.classes) if (c.enrolled < 1 || c.enrolled > 60) errors.push(`${s.key}: ${c.grade}-${c.classNo} 재적 범위`);
    const keys = new Set(s.classes.map((c) => `${c.grade}-${c.classNo}`));
    if (keys.size !== s.classes.length) errors.push(`${s.key}: 학급 중복`);
    for (const u of s.drill.unreported) if (!keys.has(`${u.grade}-${u.classNo}`)) errors.push(`${s.key}: 미보고 학급이 없음`);
    for (const c of s.classes) if (s.drill.absent(c.grade, c.classNo) + s.drill.injured(c.grade, c.classNo) > c.enrolled) errors.push(`${s.key}: 보고 값 범위`);
    if (plan.accounts.filter((a) => a.schoolKey === s.key).length !== 4) errors.push(`${s.key}: 학교별 계정 4개`);
    if (plan.accounts.filter((a) => a.schoolKey === s.key && a.duties.includes("principal")).length !== 1) errors.push(`${s.key}: 교장 1명`);
  }
  for (const a of [...plan.accounts, ...plan.virtualStaff]) {
    if (a.email !== a.email.toLowerCase()) errors.push(`${a.email}: 이메일 소문자`);
    if (!a.email.endsWith(`@${JUDGE_EMAIL_DOMAIN}`)) errors.push(`${a.email}: 예약 도메인 이메일만`);
    if (emails.has(a.email)) errors.push(`${a.email}: 이메일 중복`);
    emails.add(a.email);
    if (!a.displayName.includes("가상")) errors.push(`${a.email}: 표시 이름에 '가상' 필요`);
  }
  for (const a of plan.accounts) {
    const caps = capabilitiesFor(a.role, a.duties);
    for (const c of a.must) if (!caps.includes(c)) errors.push(`${a.key}: '${c}' 권한이 있어야 함`);
    for (const c of a.mustNot) if (caps.includes(c)) errors.push(`${a.key}: '${c}' 권한이 없어야 함`);
    const school = plan.schools.find((s) => s.key === a.schoolKey);
    for (const x of a.assignments) if (!school?.classes.some((c) => c.grade === x.grade && c.classNo === x.classNo)) errors.push(`${a.key}: 배정 학급 없음`);
  }
  return errors;
}

/** 무작위 비밀번호(기본 20자, 대소문자·숫자·기호 포함 보장). 화면·로그에 출력하지 않습니다. */
export function generatePassword(length = 20, rand: (n: number) => Buffer = randomBytes): string {
  const sets = ["ABCDEFGHJKLMNPQRSTUVWXYZ", "abcdefghijkmnopqrstuvwxyz", "23456789", "!@#%^*-_=+"];
  const all = sets.join("");
  if (length < 16) throw new Error("비밀번호는 16자 이상");
  for (;;) {
    const usable = [...rand(length * 2)].filter((b) => b < 256 - (256 % all.length)); // 편향 줄이기
    if (usable.length < length) continue;
    const pw = usable.slice(0, length).map((b) => all[b % all.length]!).join("");
    if (sets.every((set) => [...pw].some((ch) => set.includes(ch)))) return pw;
  }
}

/** 비밀번호 파일 경로 검사: 절대 경로, 저장소 밖, 아직 없는 파일(덮어쓰기 금지) */
export function passwordFileErrors(outPath: string | undefined, repoRoot: string, exists: boolean): string[] {
  if (!outPath) return ["--out <비밀번호 파일 경로>가 필요합니다(저장소 밖, 예: /root/judge-accounts.txt)."];
  const errors: string[] = [];
  if (!path.isAbsolute(outPath)) errors.push("비밀번호 파일은 절대 경로로 지정하세요.");
  const rel = path.relative(path.resolve(repoRoot), path.resolve(outPath));
  if (!rel.startsWith("..") && !path.isAbsolute(rel)) errors.push("비밀번호 파일을 저장소(앱 폴더) 안에 만들 수 없습니다(커밋·배포 위험).");
  if (exists) errors.push("같은 이름의 파일이 이미 있습니다. 덮어쓰지 않습니다.");
  return errors;
}

/** 심사 도구 실행 대상 검사(코드 차단): 운영 프로필 + 심사 스키마(정확히 일치)만 */
export function judgeTargetErrors(target: DeployTargetOk): string[] {
  const errors: string[] = [];
  if (target.profile !== "production") errors.push("심사 도구는 운영(production) 프로필의 심사 스키마에서만 실행합니다(Replit 시연 DB 금지).");
  if (target.schema !== JUDGE_SCHEMA) errors.push(`심사 도구는 ${JUDGE_SCHEMA} 스키마에서만 실행합니다(현재 ${target.schema}). 실제 학교 시범운영 스키마에서는 실행할 수 없습니다.`);
  return errors;
}

/** 쓰기(--apply, --reset-active) 조건: 대상 검사 + 확인 문구(스키마 이름 그대로) */
export function judgeApplyErrors(target: DeployTargetOk, confirm: string | undefined): string[] {
  const errors = judgeTargetErrors(target);
  if (confirm !== target.schema) errors.push(`확인 문구가 필요합니다: JUDGE_SETUP_CONFIRM=${target.schema} (대상 스키마 이름을 그대로)`);
  return errors;
}

/**
 * DB 권한 검사(DB 차단 확인): 현재 DB 계정이 심사 스키마 밖의 SAFE SCHOOL 스키마(시범운영 등)를 쓸 수 있으면 거부.
 * rows = pg_namespace 에서 'safeschool_%' 스키마별 USAGE 권한 조회 결과
 */
export function judgeDbIsolationErrors(rows: { schema: string; usage: boolean }[], currentUser: string): string[] {
  const leaks = rows.filter((r) => r.schema !== JUDGE_SCHEMA && r.usage).map((r) => r.schema);
  return leaks.length
    ? [`DB 계정(${currentUser.slice(0, 40)})이 심사 외 스키마(${leaks.join(", ")})에 접근할 수 있습니다. 심사 전용 DB 계정(최소 권한)으로 실행하세요(deploy/sql/roles.sql).`]
    : [];
}

/** 심사 스키마에 실제 학교(시연 표시가 없는 학교)가 섞여 있으면 거부 */
export function judgeDataIsolationErrors(nonDemoSchools: number): string[] {
  return nonDemoSchools > 0 ? [`심사 스키마에 시연 학교가 아닌 학교가 ${nonDemoSchools}곳 있습니다. 실제 학교 데이터가 섞였을 수 있어 중단합니다.`] : [];
}

/** 비밀번호 파일 내용(운영자 전달용). 저장소·로그에 남기지 않습니다. */
export function passwordFileText(rows: { email: string; password: string; roleLabel: string; schoolName: string }[], createdAt: string): string {
  return [
    `# SAFE SCHOOL 심사위원 계정 — ${createdAt} 생성. 운영자 전용(권한 600). 전달 후 안전하게 삭제하세요.`,
    "# 이메일\t비밀번호\t역할\t학교",
    ...rows.map((r) => `${r.email}\t${r.password}\t${r.roleLabel}\t${r.schoolName}`),
    "",
  ].join("\n");
}
