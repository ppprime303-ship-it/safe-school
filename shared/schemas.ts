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

// ───────────── STEP 3-B 경보·학교 소재지 ─────────────
export const regionSchema = z.object({
  sido: z.string().trim().min(2).max(20),
  sigungu: z.string().trim().max(30).nullable(),
});

// ───────────── STEP 3-C 재난안전 안내문 ─────────────
const noticeTitle = z.string().trim().min(1, "제목을 입력하세요.").max(200, "제목은 200자 이하입니다.");
const noticeBody = z
  .string()
  .max(5000, "본문은 5000자 이하입니다.")
  .refine((v) => v.trim().length > 0, "본문을 입력하세요.");
const exampleKey = z.string().regex(/^[a-z_]+\.(parent|staff)\.(issued|cancelled)$/, "예시문 키 형식이 올바르지 않습니다.");
const expectedVersion = z.number().int().min(1);

export const noticeCreateSchema = z.object({
  alertId: z.string().uuid(),
  title: noticeTitle,
  body: noticeBody,
  exampleKey: exampleKey.nullable().optional(),
});

export const noticeUpdateSchema = z.object({
  title: noticeTitle,
  body: noticeBody,
  status: z.enum(["draft", "completed"]),
  exampleKey: exampleKey.nullable().optional(), // undefined = 그대로, null = 직접 작성으로 표시
  expectedVersion,
});

export const noticeCancelSchema = z.object({
  reason: z.string().trim().min(1, "취소 사유를 입력하세요.").max(200),
  expectedVersion,
});

export const noticeReuseSchema = z.object({
  alertId: z.string().uuid().optional(), // 없으면 원본과 같은 경보(대상·대표 경보 검사는 다시 함)
});

// 처리 이력에는 개인 연락처를 적지 않습니다(전화번호 형태 거부).
const PHONE_LIKE = /(01[016789]|0\d{1,2})[-.\s]?\d{3,4}[-.\s]?\d{4}/;
const noPhone = (max: number) =>
  z
    .string()
    .trim()
    .max(max)
    .refine((v) => !PHONE_LIKE.test(v), "개인 연락처(전화번호)는 적지 마세요.")
    .nullable()
    .optional();

export const handlingRecordSchema = z
  .object({
    channel: z.enum(["sms", "school_app", "kakao", "other"]).nullable().optional(),
    channelNote: noPhone(50),
    audienceCategory: noPhone(100),
    sentByTeacher: z.boolean().default(false),
    sentAt: z.string().datetime({ offset: true }).nullable().optional(),
    memo: noPhone(500),
  })
  .refine((v) => !v.sentAt || v.sentByTeacher, { message: "발송 일시는 '발송 완료'를 선택했을 때만 적습니다.", path: ["sentAt"] });

export const voidRecordSchema = z.object({ reason: z.string().trim().min(1, "무효 처리 사유를 입력하세요.").max(200) });

// ───────────── STEP 3-D 업무 담당자 지정 ─────────────
export const dutyGrantSchema = z.object({
  membershipId: z.string().uuid(),
  duty: z.enum(["safety_officer", "app_operator"]), // 교장·교감은 앱에서 지정 불가
  note: z.string().trim().max(200).nullable().optional(),
});
export const dutyEndSchema = z.object({ reason: z.string().trim().min(1, "해제 사유를 입력하세요.").max(200) });

// ───────────── STEP 3-D 비상대피훈련일지(담당자 입력값) ─────────────
const shortText = (max: number) => z.string().max(max);
export const drillManualSchema = z.object({
  staffCount: z.string().trim().regex(/^\d{0,4}$/, "교직원 참가 인원은 숫자로 적으세요."),
  // 실제 참가 학생 수(선택). 이전 화면·저장본은 이 항목이 없으므로 빈칸으로 받습니다(기존 요청 그대로 통과).
  studentCount: z.string().trim().regex(/^\d{0,5}$/, "학생 참가 인원은 숫자로 적으세요.").default(""),
  totalCount: z.string().trim().regex(/^\d{0,5}$/, "총 참가 인원은 숫자로 적으세요."),
  roles: z.array(z.object({ part: shortText(60), who: shortText(60) })).min(1).max(10),
  trainingNote: shortText(300),
  evacPlaceText: shortText(200),
  durationText: shortText(40),
  evals: z.array(z.object({ item: shortText(60), result: z.enum(["", "O", "X"]), note: shortText(80) })).min(1).max(8),
  improvements: shortText(1000),
});
export const drillLogUpdateSchema = z.object({
  manual: drillManualSchema,
  status: z.enum(["draft", "completed"]),
  expectedVersion: z.number().int().min(1),
  refreshAuto: z.boolean().optional(), // 원본 기록이 바뀐 경우 자동 항목 다시 불러오기(교직원 확인 후)
});
