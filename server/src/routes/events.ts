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
import { addEventType, closeEvent, getActiveEvent, getBoard, issueEvent, myClasses, restrictBoard, submitReport, summarize, updateEvent } from "../services/events.js";
import { assignDelegate, delegationSuggestions, endDelegation } from "../services/delegations.js";
import { z } from "zod";
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

// A3 상황판: 승인된 교직원 누구나(board.view). 상세(메모·보고자·부상·대리 담당)는 board.detail 이 있을 때만 응답에 포함
// 열람 권한은 보고 권한과 별개입니다(보고는 아래 reports 경로에서 학급 배정·대리 지정으로 따로 검사)
eventsRouter.get("/schools/:schoolId/events/:eventId/board", requireVerified, async (req, res) => {
  const access = await resolveAccess(prisma, { userId: req.auth!.userId, schoolId: param(req.params.schoolId), need: "board.view" });
  const board = await getBoard(prisma, ids(req));
  if (!access.can("board.detail")) {
    res.json(restrictBoard(board));
    return;
  }
  res.json({ scope: "full", ...board, summary: summarize(board.classes) });
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

// ───────────── v0.1 대리 보고(발령 권한자만 지정·종료, 사건 범위) ─────────────
const delegationSchema = z.object({
  delegateMembershipId: z.string().uuid("교직원을 고르세요."),
  reason: z.enum(["unreachable", "unable", "admin_decision"], { message: "사유를 고르세요(연락 미확인·보고 불가·관리자 판단)." }),
  basis: z.string().trim().max(200, "지정 근거는 200자 이내로 적으세요.").optional(),
  replacesDelegationId: z.string().uuid().optional(), // 재지정 시 지금 유효한 지정 ID
});
const endDelegationSchema = z.object({ reason: z.enum(["returned", "revoked"]) });
const classIdOf = (req: Request) => parse(z.object({ classId: z.string().uuid() }), { classId: param(req.params.classId) }).classId;

eventsRouter.get("/schools/:schoolId/events/:eventId/classes/:classId/delegation-suggestions", requireVerified, async (req, res) => {
  await issuer(req);
  res.json(await delegationSuggestions(prisma, { ...ids(req), classId: classIdOf(req) }));
});

eventsRouter.post("/schools/:schoolId/events/:eventId/classes/:classId/delegation", requireVerified, issueLimiter, async (req, res) => {
  await issuer(req);
  const input = parse(delegationSchema, req.body);
  const row = await assignDelegate(prisma, { ...ids(req), classId: classIdOf(req), actorUserId: req.auth!.userId, ...input, ip: req.ip });
  res.status(201).json({ delegationId: row.id });
});

eventsRouter.post("/schools/:schoolId/events/:eventId/delegations/:delegationId/end", requireVerified, issueLimiter, async (req, res) => {
  await issuer(req);
  const input = parse(endDelegationSchema, req.body);
  const delegationId = parse(z.object({ id: z.string().uuid() }), { id: param(req.params.delegationId) }).id;
  res.json(await endDelegation(prisma, { ...ids(req), delegationId, actorUserId: req.auth!.userId, reason: input.reason, ip: req.ip }));
});
