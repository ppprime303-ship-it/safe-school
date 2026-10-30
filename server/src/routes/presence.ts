// Beta PILOT 2 Phase 2 교직원 앱 내 알림·소재 보고·집계 API
// 경로: /api/schools/:schoolId/...  — 모두 승인된 학교 소속을 서버에서 검사(다른 학교 404, 대기·회수 403)
// - 알림·소재 보고는 '나(me)'만: 요청에 사용자·소속 id를 받지 않음
// - 소재는 실제 재난만(모의훈련 403), 개인별 상세·이력은 presence.detail 만
import { Router, type Request } from "express";
import { z } from "zod";
import { prisma } from "../db.js";
import { AppError } from "../errors.js";
import { parse } from "../validate.js";
import { requireVerified } from "../auth/session.js";
import { rateLimit } from "../middleware/security.js";
import { resolveAccess } from "../services/access.js";
import { getMyPresence, listMyAlerts, markMyAlertRead, presenceDetail, presenceHistory, presenceSummary, submitMyPresence } from "../services/presence.js";
import { idempotencyKeySchema } from "../../../shared/schemas.js";
import { presenceInputSchema } from "../../../shared/presence.js";

export const presenceRouter = Router();
const reportLimiter = rateLimit({ windowMs: 60 * 1000, max: 60 });

const param = (value: string | string[] | undefined) => (Array.isArray(value) ? value[0] : value) ?? "";
const uuid = (v: string) => parse(z.object({ id: z.string().uuid() }), { id: v }).id;
const schoolOf = (req: Request) => param(req.params.schoolId);
const access = (req: Request, need?: "board.view" | "presence.detail") => resolveAccess(prisma, { userId: req.auth!.userId, schoolId: schoolOf(req), need });

// 내 알림(실제 재난·모의훈련 모두) — 생성 시각과 내가 확인한 시각을 따로
presenceRouter.get("/schools/:schoolId/staff-alerts", requireVerified, async (req, res) => {
  const a = await access(req);
  res.json(await listMyAlerts(prisma, { schoolId: schoolOf(req), membershipId: a.membership.id }));
});

presenceRouter.post("/schools/:schoolId/staff-alerts/:alertId/read", requireVerified, async (req, res) => {
  const a = await access(req);
  res.json(await markMyAlertRead(prisma, { schoolId: schoolOf(req), membershipId: a.membership.id, alertId: uuid(param(req.params.alertId)) }));
});

// 내 소재(실제 재난만)
presenceRouter.get("/schools/:schoolId/events/:eventId/presence/me", requireVerified, async (req, res) => {
  const a = await access(req);
  res.json(await getMyPresence(prisma, { schoolId: schoolOf(req), eventId: uuid(param(req.params.eventId)), membershipId: a.membership.id }));
});

presenceRouter.put("/schools/:schoolId/events/:eventId/presence/me", requireVerified, reportLimiter, async (req, res) => {
  const a = await access(req);
  const rawKey = req.get("Idempotency-Key");
  if (!rawKey) throw new AppError(400, "idempotency_key_required", "요청 번호(Idempotency-Key)가 필요합니다.");
  const idempotencyKey = parse(idempotencyKeySchema, rawKey);
  const input = parse(presenceInputSchema, req.body);
  res.json(
    await submitMyPresence(prisma, {
      schoolId: schoolOf(req),
      eventId: uuid(param(req.params.eventId)),
      membershipId: a.membership.id,
      actorUserId: req.auth!.userId,
      idempotencyKey,
      input,
      ip: req.ip,
    }),
  );
});

// 전체 요약(승인 교직원 누구나, 개인 식별 정보 없음). 상세 권한자에게는 상세를 따로
presenceRouter.get("/schools/:schoolId/events/:eventId/presence/summary", requireVerified, async (req, res) => {
  await access(req, "board.view");
  res.json(await presenceSummary(prisma, { schoolId: schoolOf(req), eventId: uuid(param(req.params.eventId)) }));
});

presenceRouter.get("/schools/:schoolId/events/:eventId/presence", requireVerified, async (req, res) => {
  await access(req, "presence.detail");
  res.json(await presenceDetail(prisma, { schoolId: schoolOf(req), eventId: uuid(param(req.params.eventId)) }));
});

presenceRouter.get("/schools/:schoolId/events/:eventId/presence/members/:membershipId/history", requireVerified, async (req, res) => {
  await access(req, "presence.detail");
  res.json(await presenceHistory(prisma, { schoolId: schoolOf(req), eventId: uuid(param(req.params.eventId)), membershipId: uuid(param(req.params.membershipId)) }));
});
