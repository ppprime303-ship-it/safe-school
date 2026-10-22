// STEP 3-A 재난 발령·학급 대피 보고·상황판·종료 API
// 경로: /api/schools/:schoolId/events…  — 권한은 모두 서버에서 resolveSchoolAccess 로 검사(다른 학교는 404)
import { Router, type Request } from "express";
import { prisma } from "../db.js";
import { AppError } from "../errors.js";
import { parse } from "../validate.js";
import { requireVerified } from "../auth/session.js";
import { rateLimit } from "../middleware/security.js";
import { resolveSchoolAccess } from "../services/membership.js";
import { resolveAccess } from "../services/access.js";
import type { Capability } from "../../../shared/permissions.js";
import { addEventType, closeEvent, getActiveEvent, getBoard, issueEvent, myClasses, submitReport, summarize, updateEvent } from "../services/events.js";
import {
  addEventTypeSchema,
  closeEventSchema,
  idempotencyKeySchema,
  issueEventSchema,
  reportInputSchema,
  updateEventSchema,
} from "../../../shared/schemas.js";

export const eventsRouter = Router();
// 보고는 재시도가 잦으므로 넉넉하게, 발령·종료는 남용 방지용
const reportLimiter = rateLimit({ windowMs: 60 * 1000, max: 120 });
const issueLimiter = rateLimit({ windowMs: 60 * 1000, max: 20 });

const param = (value: string | string[] | undefined) => (Array.isArray(value) ? value[0] : value) ?? "";
const ids = (req: Request) => ({ schoolId: param(req.params.schoolId), eventId: param(req.params.eventId) });
// STEP 3-D: 발령·종료·상황판은 기능 권한으로 검사(기존 관리자 + 교장·교감 + 안전업무 담당). 결과는 기존과 같은 소속 정보
const can = (cap: Capability) => async (req: Request) =>
  (await resolveAccess(prisma, { userId: req.auth!.userId, schoolId: param(req.params.schoolId), need: cap })).membership;
const issuer = can("event.issue");
const closer = can("event.close");
const boardViewer = can("board.view");
const member = (req: Request) => resolveSchoolAccess(prisma, { userId: req.auth!.userId, schoolId: param(req.params.schoolId) });

// 진행 중 상황(승인된 교직원 누구나)
eventsRouter.get("/schools/:schoolId/events/active", requireVerified, async (req, res) => {
  await member(req);
  res.json({ event: await getActiveEvent(prisma, param(req.params.schoolId)) });
});

// A1 발령(관리자). 실제 상황은 confirmReal: true 필요
eventsRouter.post("/schools/:schoolId/events", requireVerified, issueLimiter, async (req, res) => {
  await issuer(req);
  const input = parse(issueEventSchema, req.body);
  const event = await issueEvent(prisma, { schoolId: param(req.params.schoolId), actorUserId: req.auth!.userId, ...input, ip: req.ip });
  res.status(201).json({ event });
});

eventsRouter.post("/schools/:schoolId/events/:eventId/types", requireVerified, async (req, res) => {
  await issuer(req);
  const input = parse(addEventTypeSchema, req.body);
  res.json({ event: await addEventType(prisma, { ...ids(req), actorUserId: req.auth!.userId, type: input.type, note: input.note, ip: req.ip }) });
});

eventsRouter.patch("/schools/:schoolId/events/:eventId", requireVerified, async (req, res) => {
  await issuer(req);
  const input = parse(updateEventSchema, req.body);
  res.json({ event: await updateEvent(prisma, { ...ids(req), actorUserId: req.auth!.userId, ...input, ip: req.ip }) });
});

// A3 상황판(관리자)
eventsRouter.get("/schools/:schoolId/events/:eventId/board", requireVerified, async (req, res) => {
  await boardViewer(req);
  const board = await getBoard(prisma, ids(req));
  res.json({ ...board, summary: summarize(board.classes) });
});

// 내가 보고할 학급(관리자는 전체)
eventsRouter.get("/schools/:schoolId/events/:eventId/my-classes", requireVerified, async (req, res) => {
  const m = await member(req);
  res.json({ classes: await myClasses(prisma, { ...ids(req), membershipId: m.id, role: m.role }) });
});

// A2 학급 보고(배정 교직원 또는 관리자 대리). Idempotency-Key 필수
eventsRouter.put("/schools/:schoolId/events/:eventId/reports/:classId", requireVerified, reportLimiter, async (req, res) => {
  const m = await member(req);
  const rawKey = req.get("Idempotency-Key");
  if (!rawKey) throw new AppError(400, "idempotency_key_required", "요청 번호(Idempotency-Key)가 필요합니다.");
  const idempotencyKey = parse(idempotencyKeySchema, rawKey);
  const input = parse(reportInputSchema, req.body);
  const { report, replayed } = await submitReport(prisma, {
    ...ids(req),
    classId: param(req.params.classId),
    actorUserId: req.auth!.userId,
    membershipId: m.id,
    role: m.role,
    idempotencyKey,
    input,
    ip: req.ip,
  });
  res.json({ report, replayed });
});

// 종료(관리자). 실제 상황은 confirmClose: true 필요
eventsRouter.post("/schools/:schoolId/events/:eventId/close", requireVerified, issueLimiter, async (req, res) => {
  await closer(req);
  const input = parse(closeEventSchema, req.body ?? {});
  res.json(await closeEvent(prisma, { ...ids(req), actorUserId: req.auth!.userId, confirmClose: input.confirmClose, ip: req.ip }));
});
