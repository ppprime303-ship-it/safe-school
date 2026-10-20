// 화면·서버 공통 입력 검증 규칙(zod)
import { z } from "zod";

export const emailSchema = z
  .string()
  .trim()
  .toLowerCase()
  .email("이메일 형식이 아닙니다.")
  .max(254);

export const passwordSchema = z.string().min(10, "비밀번호는 10자 이상이어야 합니다.").max(200);
export const deviceKindSchema = z.enum(["personal", "shared"]).default("personal");

export const signupSchema = z.object({
  email: emailSchema,
  displayName: z.string().trim().min(1, "이름을 입력하세요.").max(50),
  password: passwordSchema,
});

export const verifyEmailSchema = z.object({
  email: emailSchema,
  code: z.string().trim().regex(/^\d{6}$/, "6자리 숫자를 입력하세요."),
  deviceKind: deviceKindSchema,
});

export const loginSchema = z.object({
  email: emailSchema,
  password: z.string().min(1).max(200),
  deviceKind: deviceKindSchema,
});

export const reauthSchema = z.object({ password: z.string().min(1).max(200) });
export const resendSchema = z.object({ email: emailSchema });

export const directorySearchSchema = z.object({
  q: z.string().trim().min(2, "학교명을 2자 이상 입력하세요.").max(40),
  kind: z.enum(["02", "03", "04", "05", "06", "07"]),
  sido: z.string().regex(/^\d{2}$/).optional(),
});

export const registrationApplySchema = z.object({
  externalCode: z.string().trim().min(1).max(40),
  applicantPosition: z.string().trim().max(50).optional(),
});

export const joinRequestSchema = z.object({
  role: z.enum(["homeroom", "staff"]),
});

export const membershipDecisionSchema = z.object({
  membershipIds: z.array(z.string().uuid()).min(1).max(200),
});

export const assignmentsSchema = z.object({
  role: z.enum(["homeroom", "staff"]).optional(),
  assignments: z
    .array(z.object({ classId: z.string().uuid(), duty: z.enum(["homeroom", "assist", "inspection"]) }))
    .max(100),
});

export const applyStructureSchema = z.object({
  schoolYear: z.number().int().min(2000).max(2100),
  grades: z.array(z.object({ grade: z.number().int().min(1).max(6), classCount: z.number().int().min(0).max(30) })).max(6),
});

export const confirmEnrollmentSchema = z.object({
  items: z.array(z.object({ classId: z.string().uuid(), enrolledCount: z.number().int().min(0).max(60) })).min(1).max(200),
});

// ───────────── STEP 3-A 재난 발령·보고 ─────────────
const disasterTypeEnum = z.enum(["fire", "earthquake", "storm_flood", "heatwave", "fine_dust", "gas_leak", "intruder", "other"]);
const optionalText = (max: number) => z.string().trim().max(max).nullable().optional();

export const issueEventSchema = z.object({
  primaryType: disasterTypeEnum,
  mode: z.enum(["real", "drill"]).default("drill"),
  location: optionalText(100),
  evacPlace: optionalText(100),
  message: optionalText(500),
  confirmReal: z.boolean().optional(),
});

export const addEventTypeSchema = z.object({ type: disasterTypeEnum, note: optionalText(200) });

export const updateEventSchema = z
  .object({ location: optionalText(100), evacPlace: optionalText(100), message: optionalText(500) })
  .refine((v) => v.location !== undefined || v.evacPlace !== undefined || v.message !== undefined, "바꿀 항목이 없습니다.");

const headcount = z.number().int().min(0).max(60); // DB 제약(학급 재적 60명 이하)과 같음
// 학생 이름 등 개인 식별정보는 받지 않습니다(메모 200자 제한, 화면에서 안내).
export const reportInputSchema = z.object({
  evacuated: headcount,
  absentKnown: headcount,
  injured: headcount,
  enrolledCount: headcount,
  enrolledChangeReason: z.enum(["transfer_out", "transfer_in", "other"]).nullable(),
  note: z.string().trim().max(200).nullable(),
  expectedVersion: z.number().int().min(1).nullable(),
});

export const idempotencyKeySchema = z.string().regex(/^[A-Za-z0-9_-]{8,80}$/, "요청 번호(Idempotency-Key) 형식이 올바르지 않습니다.");

export const closeEventSchema = z.object({ confirmClose: z.boolean().optional() });
