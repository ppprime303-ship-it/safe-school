// STEP 3-C 재난안전 안내문 API (/api/schools/:schoolId/notice-examples, /notices…)
// - 권한은 모두 서버에서 resolveSchoolAccess 로 검사: 소속 아님 404, 승인 대기 403
// - 작성·재사용·처리 이력: 승인된 교직원 / 수정·취소: 작성자 또는 학교 관리자(서비스에서 검사)
// - 결재·실제 발송·모의 발송 API는 없습니다.
import { Router, type Request } from "express";
import { prisma } from "../db.js";
import { parse } from "../validate.js";
import { requireVerified } from "../auth/session.js";
import { userRateLimit } from "../middleware/security.js";
import { resolveSchoolAccess } from "../services/membership.js";
import {
  addHandlingRecord,
  cancelNotice,
  createNotice,
  getNotice,
  listNoticeExamples,
  listNotices,
  reuseNotice,
  updateNotice,
  voidHandlingRecord,
} from "../services/notices.js";
import {
  handlingRecordSchema,
  noticeCancelSchema,
  noticeCreateSchema,
  noticeReuseSchema,
  noticeUpdateSchema,
  voidRecordSchema,
} from "../../../shared/schemas.js";

export const noticesRouter = Router();
const writeLimiter = userRateLimit({ windowMs: 60 * 1000, max: 120 });
const param = (value: string | string[] | undefined) => (Array.isArray(value) ? value[0] : value) ?? "";
const schoolOf = (req: Request) => param(req.params.schoolId);
const member = (req: Request) => resolveSchoolAccess(prisma, { userId: req.auth!.userId, schoolId: schoolOf(req) });
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
/** 형식이 틀린 ID도 '없음'(404)으로: 다른 학교 ID와 구분되지 않게 */
const idParam = (req: Request, name: string) => {
  const v = param(req.params[name]);
  return UUID.test(v) ? v : "00000000-0000-0000-0000-000000000000";
};

noticesRouter.get("/schools/:schoolId/notice-examples", requireVerified, async (req, res) => {
  await member(req);
  res.json(listNoticeExamples());
});

noticesRouter.get("/schools/:schoolId/notices", requireVerified, async (req, res) => {
  await member(req);
  const alertId = typeof req.query.alertId === "string" && UUID.test(req.query.alertId) ? req.query.alertId : undefined;
  res.json(await listNotices(prisma, { schoolId: schoolOf(req), alertId }));
});

noticesRouter.post("/schools/:schoolId/notices", requireVerified, writeLimiter, async (req, res) => {
  await member(req);
  const input = parse(noticeCreateSchema, req.body);
  res.status(201).json(await createNotice(prisma, { schoolId: schoolOf(req), actorUserId: req.auth!.userId, ...input, ip: req.ip }));
});

noticesRouter.get("/schools/:schoolId/notices/:noticeId", requireVerified, async (req, res) => {
  const m = await member(req);
  res.json(await getNotice(prisma, { schoolId: schoolOf(req), noticeId: idParam(req, "noticeId"), userId: req.auth!.userId, role: m.role }));
});

noticesRouter.patch("/schools/:schoolId/notices/:noticeId", requireVerified, writeLimiter, async (req, res) => {
  const m = await member(req);
  const input = parse(noticeUpdateSchema, req.body);
  res.json(await updateNotice(prisma, { schoolId: schoolOf(req), noticeId: idParam(req, "noticeId"), actorUserId: req.auth!.userId, role: m.role, ...input, ip: req.ip }));
});

noticesRouter.post("/schools/:schoolId/notices/:noticeId/cancel", requireVerified, writeLimiter, async (req, res) => {
  const m = await member(req);
  const input = parse(noticeCancelSchema, req.body);
  res.json(await cancelNotice(prisma, { schoolId: schoolOf(req), noticeId: idParam(req, "noticeId"), actorUserId: req.auth!.userId, role: m.role, ...input, ip: req.ip }));
});

// 취소된 안내문으로 새 초안 만들기(원본은 그대로)
noticesRouter.post("/schools/:schoolId/notices/:noticeId/reuse", requireVerified, writeLimiter, async (req, res) => {
  await member(req);
  const input = parse(noticeReuseSchema, req.body ?? {});
  const result = await reuseNotice(prisma, { schoolId: schoolOf(req), sourceNoticeId: idParam(req, "noticeId"), actorUserId: req.auth!.userId, alertId: input.alertId, ip: req.ip });
  res.status(result.created ? 201 : 200).json(result);
});

noticesRouter.post("/schools/:schoolId/notices/:noticeId/records", requireVerified, writeLimiter, async (req, res) => {
  await member(req);
  const input = parse(handlingRecordSchema, req.body);
  res.status(201).json(await addHandlingRecord(prisma, { schoolId: schoolOf(req), noticeId: idParam(req, "noticeId"), actorUserId: req.auth!.userId, ...input, ip: req.ip }));
});

noticesRouter.post("/schools/:schoolId/notices/:noticeId/records/:recordId/void", requireVerified, writeLimiter, async (req, res) => {
  const m = await member(req);
  const input = parse(voidRecordSchema, req.body);
  res.json(
    await voidHandlingRecord(prisma, {
      schoolId: schoolOf(req), noticeId: idParam(req, "noticeId"), recordId: idParam(req, "recordId"),
      actorUserId: req.auth!.userId, role: m.role, reason: input.reason, ip: req.ip,
    }),
  );
});
