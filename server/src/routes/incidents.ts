// Beta PILOT 2 Phase 3 현장 상황 공유 API
// 경로: /api/schools/:schoolId/...  — 승인된 학교 소속을 서버에서 검사(다른 학교 404, 대기·회수 403)
// - 목록·상세·유사 제안·제보·후속 정보: board.view(승인 교직원 누구나)
// - 처리 상태 변경: incident.manage / 사진(Phase 3-C): incident.photo
import { Router, type Request } from "express";
import { prisma } from "../db.js";
import { AppError } from "../errors.js";
import { parse } from "../validate.js";
import { requireVerified } from "../auth/session.js";
import { rateLimit } from "../middleware/security.js";
import { resolveAccess } from "../services/access.js";
import { addIncidentUpdate, changeIncidentStatus, createIncident, getIncident, listIncidents, similarIncidents, type Viewer } from "../services/incidents.js";
import { idempotencyKeySchema } from "../../../shared/schemas.js";
import { incidentCreateSchema, incidentStatusSchema, incidentUpdateSchema, similarQuerySchema } from "../../../shared/incident.js";

export const incidentsRouter = Router();
const writeLimiter = rateLimit({ windowMs: 60 * 1000, max: 60 });

const param = (value: string | string[] | undefined) => (Array.isArray(value) ? value[0] : value) ?? "";
const schoolOf = (req: Request) => param(req.params.schoolId);

async function viewerOf(req: Request, need: "board.view" | "incident.manage" = "board.view") {
  const a = await resolveAccess(prisma, { userId: req.auth!.userId, schoolId: schoolOf(req), need });
  const viewer: Viewer = { membershipId: a.membership.id, canManage: a.can("incident.manage"), canPhoto: a.can("incident.photo") };
  return viewer;
}
const keyOf = (req: Request) => {
  const raw = req.get("Idempotency-Key");
  if (!raw) throw new AppError(400, "idempotency_key_required", "요청 번호(Idempotency-Key)가 필요합니다.");
  return parse(idempotencyKeySchema, raw);
};

incidentsRouter.get("/schools/:schoolId/events/:eventId/incidents", requireVerified, async (req, res) => {
  const viewer = await viewerOf(req);
  res.json(await listIncidents(prisma, { schoolId: schoolOf(req), eventId: param(req.params.eventId), viewer }));
});

incidentsRouter.get("/schools/:schoolId/events/:eventId/incidents/similar", requireVerified, async (req, res) => {
  const viewer = await viewerOf(req);
  const q = parse(similarQuerySchema, req.query);
  res.json(await similarIncidents(prisma, { schoolId: schoolOf(req), eventId: param(req.params.eventId), viewer, draft: { type: q.type, placeCategory: q.placeCategory, placeDetail: q.placeDetail?.trim() || null, description: q.description ?? "" } }));
});

incidentsRouter.post("/schools/:schoolId/events/:eventId/incidents", requireVerified, writeLimiter, async (req, res) => {
  const viewer = await viewerOf(req);
  const idempotencyKey = keyOf(req);
  const input = parse(incidentCreateSchema, req.body);
  const r = await createIncident(prisma, { schoolId: schoolOf(req), eventId: param(req.params.eventId), membershipId: viewer.membershipId, actorUserId: req.auth!.userId, idempotencyKey, input, ip: req.ip });
  res.status(r.replayed ? 200 : 201).json(r);
});

incidentsRouter.get("/schools/:schoolId/incidents/:incidentId", requireVerified, async (req, res) => {
  const viewer = await viewerOf(req);
  res.json(await getIncident(prisma, { schoolId: schoolOf(req), incidentId: param(req.params.incidentId), viewer }));
});

incidentsRouter.post("/schools/:schoolId/incidents/:incidentId/updates", requireVerified, writeLimiter, async (req, res) => {
  const viewer = await viewerOf(req);
  const idempotencyKey = keyOf(req);
  const input = parse(incidentUpdateSchema, req.body);
  const r = await addIncidentUpdate(prisma, { schoolId: schoolOf(req), incidentId: param(req.params.incidentId), membershipId: viewer.membershipId, actorUserId: req.auth!.userId, idempotencyKey, input, ip: req.ip });
  res.status(r.replayed ? 200 : 201).json(r);
});

incidentsRouter.post("/schools/:schoolId/incidents/:incidentId/status", requireVerified, writeLimiter, async (req, res) => {
  const viewer = await viewerOf(req, "incident.manage");
  const input = parse(incidentStatusSchema, req.body);
  res.json(await changeIncidentStatus(prisma, { schoolId: schoolOf(req), incidentId: param(req.params.incidentId), membershipId: viewer.membershipId, actorUserId: req.auth!.userId, ...input, ip: req.ip }));
});
