// STEP 3-D 비상대피훈련일지 API (/api/schools/:schoolId/drill-logs…)
// 권한: 열람·내려받기 drilllog.view(교장·교감·안전업무 담당·기존 관리자), 만들기·수정 drilllog.edit(안전업무 담당)
// Phase 4: 실제 재난 '재난대피일지'는 같은 경로·같은 표. 만들기·수정은 realreport.edit(학교 관리자·안전업무 담당).
//          서식·권한은 요청 본문이 아니라 사건의 서버 측 mode 로 결정합니다.
// 역할 담당자 선택용 교직원 이름 목록(drill-log-staff)은 drilllog.edit — 같은 학교 승인 교직원의 이름·직책만(이메일 없음)
// K-에듀파인 자동 업로드·결재 상신 기능은 없습니다(내려받은 파일을 사용자가 직접 첨부).
import { Router, type Request } from "express";
import { prisma } from "../db.js";
import { parse } from "../validate.js";
import { requireVerified } from "../auth/session.js";
import { rateLimit } from "../middleware/security.js";
import { resolveAccess } from "../services/access.js";
import { createDrillLog, eventModeOf, exportDrillLogHwpx, getDrillLog, listDrillStaff, listDrillTargets, reportFormOf, updateDrillLog } from "../services/drillLogs.js";
import type { Capability } from "../../../shared/permissions.js";
import { drillLogUpdateSchema } from "../../../shared/schemas.js";

export const drillLogsRouter = Router();
const writeLimiter = rateLimit({ windowMs: 60 * 1000, max: 120 });
const exportLimiter = rateLimit({ windowMs: 60 * 1000, max: 30 });
const param = (v: string | string[] | undefined) => (Array.isArray(v) ? v[0] : v) ?? "";
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const idOf = (req: Request, name: string) => (UUID.test(param(req.params[name])) ? param(req.params[name]) : "00000000-0000-0000-0000-000000000000");
const schoolOf = (req: Request) => param(req.params.schoolId);
const editCapFor = (mode: "drill" | "real"): Capability => (mode === "real" ? "realreport.edit" : "drilllog.edit");

drillLogsRouter.get("/schools/:schoolId/drill-logs", requireVerified, async (req, res) => {
  const a = await resolveAccess(prisma, { userId: req.auth!.userId, schoolId: schoolOf(req), need: "drilllog.view" });
  res.json({ ...(await listDrillTargets(prisma, schoolOf(req))), canEdit: a.can("drilllog.edit"), canEditReal: a.can("realreport.edit") });
});

drillLogsRouter.post("/schools/:schoolId/events/:eventId/drill-log", requireVerified, writeLimiter, async (req, res) => {
  // 소속 확인(다른 학교 404) → 사건 mode → 서식별 작성 권한(403)
  const a = await resolveAccess(prisma, { userId: req.auth!.userId, schoolId: schoolOf(req) });
  const ev = await eventModeOf(prisma, schoolOf(req), idOf(req, "eventId"));
  if (!a.can(editCapFor(ev.mode))) await resolveAccess(prisma, { userId: req.auth!.userId, schoolId: schoolOf(req), need: editCapFor(ev.mode) });
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
  const form = await reportFormOf(prisma, schoolOf(req), idOf(req, "logId"));
  res.json(await getDrillLog(prisma, { schoolId: schoolOf(req), logId: idOf(req, "logId"), canEdit: a.can(editCapFor(form.mode)) }));
});

drillLogsRouter.patch("/schools/:schoolId/drill-logs/:logId", requireVerified, writeLimiter, async (req, res) => {
  await resolveAccess(prisma, { userId: req.auth!.userId, schoolId: schoolOf(req) });
  const form = await reportFormOf(prisma, schoolOf(req), idOf(req, "logId"));
  await resolveAccess(prisma, { userId: req.auth!.userId, schoolId: schoolOf(req), need: editCapFor(form.mode) });
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
