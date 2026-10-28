// STEP D 플랫폼 운영관리자 API(/api/platform/…)
// 보안: 로그인·이메일 인증(requireVerified) → 운영관리자 권한을 요청마다 DB에서 확인 → 변경 요청은 최근 재인증(10분) 필수.
// CSRF: api 공통 requireJsonForMutations(JSON 본문 또는 전용 헤더만 허용, 세션 쿠키 SameSite=Lax).
// 학교 내부 데이터는 다루지 않습니다(신청 정보·학교 기본정보·감사 이력만).
import { Router, type NextFunction, type Request, type Response } from "express";
import { z } from "zod";
import { prisma } from "../db.js";
import { AppError } from "../errors.js";
import { parse } from "../validate.js";
import { requireRecentReauth, requireVerified } from "../auth/session.js";
import { rateLimit } from "../middleware/security.js";
import { getRegistrationDetail, isPlatformOperator, listPlatformAudit, listRegistrations } from "../services/platform.js";
import { reviewSchoolRegistration } from "../services/schoolRegistration.js";

export const platformRouter = Router();

const platformLimiter = rateLimit({ windowMs: 60 * 1000, max: 120, key: (req) => `platform:${req.auth?.userId ?? req.ip}` });

async function requirePlatformOperator(req: Request, _res: Response, next: NextFunction) {
  try {
    if (!(await isPlatformOperator(prisma, req.auth!.userId))) {
      return next(new AppError(403, "not_platform_operator", "플랫폼 운영관리자만 사용할 수 있는 화면입니다."));
    }
    next();
  } catch (error) {
    next(error);
  }
}

const guard = [requireVerified, platformLimiter, requirePlatformOperator];
const idOf = (req: Request) => parse(z.object({ id: z.string().uuid("잘못된 신청 번호입니다.") }), { id: req.params.id }).id;

const approveSchema = z.object({
  verificationMethod: z.string().trim().min(2, "자격 확인 방법을 적어 주세요(예: 학교 대표전화로 재직 확인).").max(100),
  note: z.string().trim().max(500).optional(),
});
const rejectSchema = z.object({ note: z.string().trim().min(2, "반려 사유를 적어 주세요.").max(500) });

// 화면 메뉴 표시용: 운영관리자인지 여부만(권한이 없어도 403 대신 false)
platformRouter.get("/platform/me", requireVerified, async (req, res) => {
  res.json({ operator: await isPlatformOperator(prisma, req.auth!.userId) });
});

platformRouter.get("/platform/approvals", ...guard, async (req, res) => {
  const status = req.query.status === "processed" ? "processed" : "pending";
  res.json(await listRegistrations(prisma, { status }));
});

platformRouter.get("/platform/approvals/:id", ...guard, async (req, res) => {
  res.json(await getRegistrationDetail(prisma, idOf(req)));
});

async function reviewerName(userId: string) {
  const u = await prisma.user.findUniqueOrThrow({ where: { id: userId }, select: { displayName: true } });
  return u.displayName.slice(0, 50);
}

platformRouter.post("/platform/approvals/:id/approve", ...guard, requireRecentReauth, async (req, res) => {
  const registrationId = idOf(req);
  const input = parse(approveSchema, req.body);
  const updated = await reviewSchoolRegistration(prisma, {
    registrationId,
    decision: "approve",
    reviewer: await reviewerName(req.auth!.userId),
    reviewerUserId: req.auth!.userId,
    via: "web",
    verificationMethod: input.verificationMethod,
    note: input.note,
    ip: req.ip,
  });
  res.json({ id: updated.id, status: updated.status });
});

platformRouter.post("/platform/approvals/:id/reject", ...guard, requireRecentReauth, async (req, res) => {
  const registrationId = idOf(req);
  const input = parse(rejectSchema, req.body);
  const updated = await reviewSchoolRegistration(prisma, {
    registrationId,
    decision: "reject",
    reviewer: await reviewerName(req.auth!.userId),
    reviewerUserId: req.auth!.userId,
    via: "web",
    note: input.note,
    ip: req.ip,
  });
  res.json({ id: updated.id, status: updated.status });
});

platformRouter.get("/platform/audit", ...guard, async (req, res) => {
  const before = typeof req.query.before === "string" && !Number.isNaN(Date.parse(req.query.before)) ? new Date(req.query.before) : undefined;
  res.json({ entries: await listPlatformAudit(prisma, { before }) });
});
