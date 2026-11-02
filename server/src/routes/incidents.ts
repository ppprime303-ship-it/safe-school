// Beta PILOT 2 Phase 3 현장 상황 공유 API
// 경로: /api/schools/:schoolId/...  — 승인된 학교 소속을 서버에서 검사(다른 학교 404, 대기·회수 403)
// - 목록·상세·유사 제안·제보·후속 정보: board.view(승인 교직원 누구나)
// - 처리 상태 변경: incident.manage / 사진(Phase 3-C): incident.photo
import express, { Router, type Request } from "express";
import { prisma } from "../db.js";
import { AppError } from "../errors.js";
import { parse } from "../validate.js";
import { requireVerified } from "../auth/session.js";
import { concurrencyLimit, userRateLimit } from "../middleware/security.js";
import { resolveAccess } from "../services/access.js";
import { addIncidentUpdate, changeIncidentStatus, createIncident, getIncident, listIncidents, recordIncidentFollowup, similarIncidents, type Viewer } from "../services/incidents.js";
import { addIncidentPhoto, deleteIncidentPhoto, photoUploadEnabled, readIncidentPhoto } from "../services/incidentPhotos.js";
import { z } from "zod";
import { idempotencyKeySchema } from "../../../shared/schemas.js";
import { incidentCreateSchema, incidentFollowupSchema, incidentStatusSchema, incidentUpdateSchema, similarQuerySchema } from "../../../shared/incident.js";

export const incidentsRouter = Router();
const writeLimiter = userRateLimit({ windowMs: 60 * 1000, max: 60 });

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

// 후속 조치(실제 재난, 종료 후 포함): 재난대피일지 작성 권한자만. 교장·교감은 종료 후 기록을 바꾸지 않음
incidentsRouter.post("/schools/:schoolId/incidents/:incidentId/followup", requireVerified, writeLimiter, async (req, res) => {
  const a = await resolveAccess(prisma, { userId: req.auth!.userId, schoolId: schoolOf(req), need: "realreport.edit" });
  const idempotencyKey = keyOf(req);
  const input = parse(incidentFollowupSchema, req.body);
  res.json(await recordIncidentFollowup(prisma, { schoolId: schoolOf(req), incidentId: param(req.params.incidentId), membershipId: a.membership.id, actorUserId: req.auth!.userId, idempotencyKey, input, ip: req.ip }));
});

incidentsRouter.post("/schools/:schoolId/incidents/:incidentId/status", requireVerified, writeLimiter, async (req, res) => {
  const viewer = await viewerOf(req, "incident.manage");
  const input = parse(incidentStatusSchema, req.body);
  res.json(await changeIncidentStatus(prisma, { schoolId: schoolOf(req), incidentId: param(req.params.incidentId), membershipId: viewer.membershipId, actorUserId: req.auth!.userId, ...input, ip: req.ip }));
});

// ───────────── Phase 3-C 현장 사진(비공개) ─────────────
// 본문은 JSON { data: base64 }(상태 변경 API는 JSON만 받는 CSRF 방어 유지), 이 경로만 본문 한도 7MiB.
// 세션·요청 제한·동시 처리 수·학교 소속을 확인한 뒤에야 본문을 읽어, 로그인하지 않은 큰 요청이 메모리를 쓰지 못하게 합니다.
// Caddy 예시(deploy/caddy/beta.caddy.example)의 경로·한도와 같아야 합니다(테스트로 고정).
export const PHOTO_UPLOAD_PATH = /^\/api\/schools\/[^/]+\/incidents\/[^/]+\/photos$/;
export const PHOTO_BODY_LIMIT_BYTES = 7 * 1024 * 1024;
const photoLimiter = userRateLimit({ windowMs: 60 * 1000, max: 20 });
const photoSlots = concurrencyLimit({ max: 8 }); // 건당 최대 약 20MB(본문·문자열·디코딩) × 8 ≈ 160MB — Beta MemoryMax 400M 안(실측 전 추정)
const photoJson = express.json({ limit: PHOTO_BODY_LIMIT_BYTES, inflate: false });
const photoBody = (body: unknown) => parse(z.object({ data: z.string().min(1).max(7_100_000) }).strict(), body);

incidentsRouter.post(
  "/schools/:schoolId/incidents/:incidentId/photos",
  requireVerified,
  photoLimiter,
  photoSlots,
  async (req, res, next) => {
    res.locals.viewer = await viewerOf(req);
    if (!photoUploadEnabled()) throw new AppError(503, "photo_upload_disabled", "사진 첨부가 꺼져 있습니다. 제보 내용은 사진 없이 보내 주세요.");
    next();
  },
  photoJson,
  async (req, res) => {
    const viewer = res.locals.viewer as Viewer;
    const { data } = photoBody(req.body);
    const r = await addIncidentPhoto(prisma, { schoolId: schoolOf(req), incidentId: param(req.params.incidentId), membershipId: viewer.membershipId, actorUserId: req.auth!.userId, dataBase64: data, ip: req.ip });
    res.status(201).json(r);
  },
);

incidentsRouter.get("/schools/:schoolId/incidents/:incidentId/photos/:photoId", requireVerified, async (req, res) => {
  await resolveAccess(prisma, { userId: req.auth!.userId, schoolId: schoolOf(req), need: "incident.photo" });
  const photo = await readIncidentPhoto(prisma, { schoolId: schoolOf(req), incidentId: param(req.params.incidentId), photoId: param(req.params.photoId) });
  res.setHeader("Content-Type", photo.mimeType);
  res.setHeader("Cache-Control", "private, no-store");
  res.setHeader("X-Content-Type-Options", "nosniff");
  res.setHeader("Content-Security-Policy", "default-src 'none'; img-src 'self'; sandbox");
  res.setHeader("Content-Disposition", `inline; filename="incident-photo.${photo.mimeType === "image/png" ? "png" : "jpg"}"`);
  res.end(photo.data);
});

incidentsRouter.delete("/schools/:schoolId/incidents/:incidentId/photos/:photoId", requireVerified, async (req, res) => {
  const viewer = await viewerOf(req, "incident.manage");
  res.json(await deleteIncidentPhoto(prisma, { schoolId: schoolOf(req), incidentId: param(req.params.incidentId), photoId: param(req.params.photoId), membershipId: viewer.membershipId, actorUserId: req.auth!.userId, ip: req.ip }));
});
