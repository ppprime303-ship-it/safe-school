// STEP 3-D 비상대피훈련일지 API (/api/schools/:schoolId/drill-logs…)
// 권한: 열람·내려받기 drilllog.view(교장·교감·안전업무 담당·기존 관리자), 만들기·수정 drilllog.edit(안전업무 담당)
// 역할 담당자 선택용 교직원 이름 목록(drill-log-staff)은 drilllog.edit — 같은 학교 승인 교직원의 이름·직책만(이메일 없음)
// K-에듀파인 자동 업로드·결재 상신 기능은 없습니다(내려받은 파일을 사용자가 직접 첨부).
import { Router, type Request } from "express";
import { prisma } from "../db.js";
import { parse } from "../validate.js";
import { requireVerified } from "../auth/session.js";
import { rateLimit } from "../middleware/security.js";
import { resolveAccess } from "../services/access.js";
import { createDrillLog, exportDrillLogHwpx, getDrillLog, listDrillStaff, listDrillTargets, updateDrillLog } from "../services/drillLogs.js";
import { drillLogUpdateSchema } from "../../../shared/schemas.js";

export const drillLogsRouter = Router();
const writeLimiter = rateLimit({ windowMs: 60 * 1000, max: 120 });
const exportLimiter = rateLimit({ windowMs: 60 * 1000, max: 30 });
const param = (v: string | string[] | undefined) => (Array.isArray(v) ? v[0] : v) ?? "";
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const idOf = (req: Request, name: string) => (UUID.test(param(req.params[name])) ? param(req.params[name]) : "00000000-0000-0000-0000-000000000000");
const schoolOf = (req: Request) => param(req.params.schoolId);

drillLogsRouter.get("/schools/:schoolId/drill-logs", requireVerified, async (req, res) => {
  const a = await resolveAccess(prisma, { userId: req.auth!.userId, schoolId: schoolOf(req), need: "drilllog.view" });
  res.json({ ...(await listDrillTargets(prisma, schoolOf(req))), canEdit: a.can("drilllog.edit") });
});

drillLogsRouter.post("/schools/:schoolId/events/:eventId/drill-log", requireVerified, writeLimiter, async (req, res) => {
  await resolveAccess(prisma, { userId: req.auth!.userId, schoolId: schoolOf(req), need: "drilllog.edit" });
  const r = await createDrillLog(prisma, { schoolId: schoolOf(req), eventId: idOf(req, "eventId"), actorUserId: req.auth!.userId, ip: req.ip });
  res.status(r.created ? 201 : 200).json(r);
});

drillLogsRouter.get("/schools/:schoolId/drill-log-staff", requireVerified, async (req, res) => {
  await resolveAccess(prisma, { userId: req.auth!.userId, schoolId: schoolOf(req), need: "drilllog.edit" });
  res.setHeader("Cache-Control", "no-store");
  res.json(await listDrillStaff(prisma, schoolOf(req)));
});

drillLogsRouter.get("/schools/:schoolId/drill-logs/:logId", requireVerified, async (req, res) => {
  const a = await resolveAccess(prisma, { userId: req.auth!.userId, schoolId: schoolOf(req), need: "drilllog.view" });
  res.json(await getDrillLog(prisma, { schoolId: schoolOf(req), logId: idOf(req, "logId"), canEdit: a.can("drilllog.edit") }));
});

drillLogsRouter.patch("/schools/:schoolId/drill-logs/:logId", requireVerified, writeLimiter, async (req, res) => {
  await resolveAccess(prisma, { userId: req.auth!.userId, schoolId: schoolOf(req), need: "drilllog.edit" });
  const input = parse(drillLogUpdateSchema, req.body);
  res.json(await updateDrillLog(prisma, { schoolId: schoolOf(req), logId: idOf(req, "logId"), actorUserId: req.auth!.userId, ...input, ip: req.ip }));
});

drillLogsRouter.get("/schools/:schoolId/drill-logs/:logId/export.hwpx", requireVerified, exportLimiter, async (req, res) => {
  await resolveAccess(prisma, { userId: req.auth!.userId, schoolId: schoolOf(req), need: "drilllog.view" });
  const { buffer, filename } = await exportDrillLogHwpx(prisma, { schoolId: schoolOf(req), logId: idOf(req, "logId"), actorUserId: req.auth!.userId, ip: req.ip });
  res.setHeader("Content-Type", "application/hwp+zip");
  res.setHeader("Content-Disposition", `attachment; filename="drill-log.hwpx"; filename*=UTF-8''${encodeURIComponent(filename)}`);
  res.setHeader("Cache-Control", "no-store");
  res.send(buffer);
});
