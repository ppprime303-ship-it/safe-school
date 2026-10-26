// STEP 6 심사위원 시연 환경 계획(순수 함수 — DB에 접속하지 않음)
// - 실제 학교·교직원·학생 정보를 쓰지 않습니다. 학교·계정 이름에 '가상'·'심사 시연'을 넣고, 이메일은 예약 도메인(.invalid)을 씁니다.
// - 비밀번호는 무작위로 만들고, 화면·로그·저장소에 남기지 않습니다(운영자만 읽는 0600 파일로만 전달).
// - 인증 우회 경로(백도어)를 만들지 않습니다. 계정은 서버 셸에 접근할 수 있는 운영자가 사전에 만드는 일반 계정입니다.
import { randomBytes } from "node:crypto";
import path from "node:path";
import { capabilitiesFor, type MemberRole, type StaffDuty } from "../../../shared/permissions.js";
import type { DeployTargetOk } from "./dbTarget.js";

export type JudgeLayout = "independent" | "shared";
export const JUDGE_EMAIL_DOMAIN = "judge.safeschool.invalid";
export const JUDGE_SLUG_PREFIX = "judge-demo-";
/** 운영자 확인 방법(교장·교감 직책 기록에 필수): 실제 기관 확인이 아님을 명시 */
export const JUDGE_VERIFICATION_NOTE = "가상 시연학교 — 실제 학교·교직원 아님(운영자 사전 생성)";

export interface JudgeSchoolPlan {
  key: string;
  slug: string;
  name: string;
  /** STEP 5 관할 교육청 표시용(가상 학교이므로 실제 소재지가 아님) */
  eduOfficeName: string;
  grades: number[];
  classesPerGrade: number;
  enrolledPerClass: number;
}

export interface JudgeAccountPlan {
  key: string;
  schoolKey: string;
  email: string;
  displayName: string;
  role: MemberRole;
  duties: StaffDuty[];
  assignments: { grade: number; classNo: number; duty: "homeroom" | "assist" }[];
  /** 심사 안내서에 쓰는 역할 설명 */
  roleLabel: string;
}

export interface JudgePlan {
  layout: JudgeLayout;
  schools: JudgeSchoolPlan[];
  accounts: JudgeAccountPlan[];
}

const LETTERS = ["a", "b", "c", "d", "e"] as const;
const OFFICES = ["인천광역시교육청", "경기도교육청", "서울특별시교육청", "부산광역시교육청", "대구광역시교육청"] as const;

const school = (key: string, name: string, eduOfficeName: string): JudgeSchoolPlan => ({
  key,
  slug: `${JUDGE_SLUG_PREFIX}${key}`,
  name,
  eduOfficeName,
  grades: [1, 2, 3],
  classesPerGrade: 3,
  enrolledPerClass: 25,
});

/**
 * independent(권장): 심사위원별 독립 가상 학교 5곳. 각 계정 = 학교 관리자(앱 운영) + 안전업무 담당 → 혼자서 발령·보고·종료·훈련일지까지 체험,
 *   다른 심사위원의 발령과 섞이지 않음(학교별 데이터 분리 그대로 사용).
 * shared: 가상 학교 1곳에 역할별 5계정(앱 운영담당·교장·안전업무 담당·담임·교감) → 역할 차이를 보기 좋으나 같은 학교라 발령이 서로 겹침.
 */
export function buildJudgePlan(layout: JudgeLayout): JudgePlan {
  if (layout === "independent") {
    const schools = LETTERS.map((l, i) => school(l, `SAFE SCHOOL 심사 시연 ${l.toUpperCase()}초등학교(가상)`, OFFICES[i]!));
    const accounts: JudgeAccountPlan[] = LETTERS.map((l, i) => ({
      key: `judge${i + 1}`,
      schoolKey: l,
      email: `judge${i + 1}@${JUDGE_EMAIL_DOMAIN}`,
      displayName: `심사위원 ${i + 1}(가상 ${l.toUpperCase()}학교 관리자)`,
      role: "admin",
      duties: ["safety_officer"],
      assignments: [],
      roleLabel: "학교 관리자(앱 운영) + 안전업무 담당",
    }));
    return { layout, schools, accounts };
  }
  const s = school("shared", "SAFE SCHOOL 심사 시연초등학교(가상)", OFFICES[0]);
  const acc = (n: number, displayName: string, role: MemberRole, duties: StaffDuty[], roleLabel: string, assignments: JudgeAccountPlan["assignments"] = []): JudgeAccountPlan => ({
    key: `judge${n}`,
    schoolKey: s.key,
    email: `judge${n}@${JUDGE_EMAIL_DOMAIN}`,
    displayName,
    role,
    duties,
    assignments,
    roleLabel,
  });
  return {
    layout,
    schools: [s],
    accounts: [
      acc(1, "심사위원 1(가상 앱 운영담당)", "staff", ["app_operator"], "앱 운영담당"),
      acc(2, "심사위원 2(가상 교장)", "staff", ["principal"], "교장"),
      acc(3, "심사위원 3(가상 안전업무 담당)", "staff", ["safety_officer"], "안전업무 담당"),
      acc(4, "심사위원 4(가상 1학년 1반 담임)", "homeroom", [], "담임교사", [{ grade: 1, classNo: 1, duty: "homeroom" }]),
      acc(5, "심사위원 5(가상 교감)", "staff", ["vice_principal"], "교감"),
    ],
  };
}

/** 계획 점검: 이름·이메일·권한 구성이 규칙에 맞는지(문제 목록) */
export function validateJudgePlan(plan: JudgePlan): string[] {
  const errors: string[] = [];
  const emails = new Set<string>();
  const slugs = new Set<string>();
  if (plan.accounts.length !== 5) errors.push(`심사위원 계정은 5개여야 합니다(현재 ${plan.accounts.length})`);
  for (const s of plan.schools) {
    if (!s.slug.startsWith(JUDGE_SLUG_PREFIX)) errors.push(`${s.key}: slug 접두사`);
    if (slugs.has(s.slug)) errors.push(`${s.key}: slug 중복`);
    slugs.add(s.slug);
    if (!s.name.includes("(가상)")) errors.push(`${s.key}: 학교 이름에 '(가상)' 표시 필요`);
    if (s.enrolledPerClass > 60) errors.push(`${s.key}: 재적 60명 초과`);
  }
  for (const a of plan.accounts) {
    if (a.email !== a.email.toLowerCase()) errors.push(`${a.key}: 이메일 소문자`);
    if (!a.email.endsWith(`@${JUDGE_EMAIL_DOMAIN}`)) errors.push(`${a.key}: 예약 도메인 이메일만`);
    if (emails.has(a.email)) errors.push(`${a.key}: 이메일 중복`);
    emails.add(a.email);
    if (!a.displayName.includes("가상")) errors.push(`${a.key}: 표시 이름에 '가상' 필요`);
    if (!plan.schools.some((s) => s.key === a.schoolKey)) errors.push(`${a.key}: 학교 없음`);
  }
  // 학교마다 발령할 수 있는 계정과 교직원 승인(앱 운영)을 할 수 있는 계정이 있어야 시연 가능
  for (const s of plan.schools) {
    const caps = plan.accounts.filter((a) => a.schoolKey === s.key).flatMap((a) => capabilitiesFor(a.role, a.duties));
    for (const need of ["event.issue", "event.close", "board.view", "members.manage", "drilllog.edit"] as const) if (!caps.includes(need)) errors.push(`${s.key}: '${need}' 권한을 가진 계정 없음`);
  }
  // 학교당 교장 1명 등 DB 규칙
  for (const s of plan.schools) if (plan.accounts.filter((a) => a.schoolKey === s.key && a.duties.includes("principal")).length > 1) errors.push(`${s.key}: 교장 2명`);
  return errors;
}

/** 무작위 비밀번호(기본 20자, 대소문자·숫자·기호 포함 보장). 화면·로그에 출력하지 않습니다. */
export function generatePassword(length = 20, rand: (n: number) => Buffer = randomBytes): string {
  const sets = ["ABCDEFGHJKLMNPQRSTUVWXYZ", "abcdefghijkmnopqrstuvwxyz", "23456789", "!@#%^*-_=+"];
  const all = sets.join("");
  if (length < 16) throw new Error("비밀번호는 16자 이상");
  const pick = (set: string, byte: number) => set[byte % set.length]!;
  for (;;) {
    const bytes = rand(length * 2);
    // 편향을 줄이기 위해 256을 넘지 않는 배수 범위 안의 바이트만 사용
    const usable = [...bytes].filter((b) => b < 256 - (256 % all.length));
    if (usable.length < length) continue;
    const pw = usable.slice(0, length).map((b) => pick(all, b)).join("");
    if (sets.every((set) => [...pw].some((c) => set.includes(c)))) return pw;
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

/** 적용(--apply) 대상 검사: 운영 프로필 + 운영 스키마 + 확인 문구(스키마 이름을 그대로 입력) */
export function judgeApplyErrors(target: DeployTargetOk, confirm: string | undefined): string[] {
  const errors: string[] = [];
  if (target.profile !== "production") errors.push("심사위원 시연 데이터는 운영(production) 프로필의 전용 스키마에만 만듭니다(Replit 시연 DB 금지).");
  if (confirm !== target.schema) errors.push(`확인 문구가 필요합니다: JUDGE_SETUP_CONFIRM=${target.schema} (대상 스키마 이름을 그대로)`);
  return errors;
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
