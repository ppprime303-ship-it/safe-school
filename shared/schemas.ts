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
