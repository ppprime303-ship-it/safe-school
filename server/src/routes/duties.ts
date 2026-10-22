// STEP 3-D 업무 담당자(안전업무 담당·앱 운영담당) 지정·해제 API — 교장·교감 직책은 플랫폼 운영자 도구로만
// 권한: duties.manage(앱 운영담당·기존 관리자), 비밀번호 재확인 필요(권한 변경)
import { Router, type Request } from "express";
import { prisma } from "../db.js";
import { parse } from "../validate.js";
import { requireRecentReauth, requireVerified } from "../auth/session.js";
import { resolveAccess } from "../services/access.js";
import { endDuty, grantDutyInApp, listDuties } from "../services/duties.js";
import { dutyEndSchema, dutyGrantSchema } from "../../../shared/schemas.js";

export const dutiesRouter = Router();
const param = (v: string | string[] | undefined) => (Array.isArray(v) ? v[0] : v) ?? "";
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const idOf = (req: Request, name: string) => (UUID.test(param(req.params[name])) ? param(req.params[name]) : "00000000-0000-0000-0000-000000000000");

dutiesRouter.get("/schools/:schoolId/duties", requireVerified, async (req, res) => {
  await resolveAccess(prisma, { userId: req.auth!.userId, schoolId: param(req.params.schoolId), need: "duties.manage" });
  res.json(await listDuties(prisma, param(req.params.schoolId)));
});

dutiesRouter.post("/schools/:schoolId/duties", requireVerified, requireRecentReauth, async (req, res) => {
  await resolveAccess(prisma, { userId: req.auth!.userId, schoolId: param(req.params.schoolId), need: "duties.manage" });
  const input = parse(dutyGrantSchema, req.body);
  res.status(201).json(await grantDutyInApp(prisma, { schoolId: param(req.params.schoolId), actorUserId: req.auth!.userId, ...input, ip: req.ip }));
});

dutiesRouter.post("/schools/:schoolId/duties/:dutyId/end", requireVerified, requireRecentReauth, async (req, res) => {
  await resolveAccess(prisma, { userId: req.auth!.userId, schoolId: param(req.params.schoolId), need: "duties.manage" });
  const input = parse(dutyEndSchema, req.body);
  res.json(await endDuty(prisma, { schoolId: param(req.params.schoolId), dutyId: idOf(req, "dutyId"), reason: input.reason, actorUserId: req.auth!.userId, via: "school_app", ip: req.ip }));
});
