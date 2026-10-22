// STEP 3-B 교직원 경보함·학교 소재지 API (/api/schools/:schoolId/alerts…, /region)
import { Router, type Request } from "express";
import { prisma } from "../db.js";
import { parse } from "../validate.js";
import { requireVerified } from "../auth/session.js";
import { resolveAccess } from "../services/access.js";
import { confirmSchoolRegion, getSchoolRegion, listSchoolAlerts, markAlertRead } from "../services/alerts.js";
import { regionSchema } from "../../../shared/schemas.js";

export const alertsRouter = Router();
const param = (value: string | string[] | undefined) => (Array.isArray(value) ? value[0] : value) ?? "";
const schoolOf = (req: Request) => param(req.params.schoolId);

alertsRouter.get("/schools/:schoolId/alerts", requireVerified, async (req, res) => {
  const a = await resolveAccess(prisma, { userId: req.auth!.userId, schoolId: schoolOf(req) });
  // 미판정 경보는 소재지를 확인할 수 있는 사람(기존 관리자·앱 운영담당)에게만
  res.json(await listSchoolAlerts(prisma, { schoolId: schoolOf(req), userId: req.auth!.userId, role: a.can("region.manage") ? "admin" : a.membership.role }));
});

alertsRouter.post("/schools/:schoolId/alerts/:matchId/read", requireVerified, async (req, res) => {
  const a = await resolveAccess(prisma, { userId: req.auth!.userId, schoolId: schoolOf(req) });
  res.json(await markAlertRead(prisma, { schoolId: schoolOf(req), userId: req.auth!.userId, role: a.can("region.manage") ? "admin" : a.membership.role, matchId: param(req.params.matchId) }));
});

alertsRouter.get("/schools/:schoolId/region", requireVerified, async (req, res) => {
  await resolveAccess(prisma, { userId: req.auth!.userId, schoolId: schoolOf(req), need: "region.manage" });
  res.json(await getSchoolRegion(prisma, schoolOf(req)));
});

alertsRouter.put("/schools/:schoolId/region", requireVerified, async (req, res) => {
  await resolveAccess(prisma, { userId: req.auth!.userId, schoolId: schoolOf(req), need: "region.manage" });
  const input = parse(regionSchema, req.body);
  res.json(await confirmSchoolRegion(prisma, { schoolId: schoolOf(req), actorUserId: req.auth!.userId, sido: input.sido, sigungu: input.sigungu, ip: req.ip }));
});
