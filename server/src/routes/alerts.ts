// STEP 3-B 교직원 경보함·학교 소재지 API (/api/schools/:schoolId/alerts…, /region)
import { Router, type Request } from "express";
import { prisma } from "../db.js";
import { parse } from "../validate.js";
import { requireVerified } from "../auth/session.js";
import { resolveSchoolAccess } from "../services/membership.js";
import { confirmSchoolRegion, getSchoolRegion, listSchoolAlerts, markAlertRead } from "../services/alerts.js";
import { regionSchema } from "../../../shared/schemas.js";

export const alertsRouter = Router();
const param = (value: string | string[] | undefined) => (Array.isArray(value) ? value[0] : value) ?? "";
const schoolOf = (req: Request) => param(req.params.schoolId);

alertsRouter.get("/schools/:schoolId/alerts", requireVerified, async (req, res) => {
  const m = await resolveSchoolAccess(prisma, { userId: req.auth!.userId, schoolId: schoolOf(req) });
  res.json(await listSchoolAlerts(prisma, { schoolId: schoolOf(req), userId: req.auth!.userId, role: m.role }));
});

alertsRouter.post("/schools/:schoolId/alerts/:matchId/read", requireVerified, async (req, res) => {
  const m = await resolveSchoolAccess(prisma, { userId: req.auth!.userId, schoolId: schoolOf(req) });
  res.json(await markAlertRead(prisma, { schoolId: schoolOf(req), userId: req.auth!.userId, role: m.role, matchId: param(req.params.matchId) }));
});

alertsRouter.get("/schools/:schoolId/region", requireVerified, async (req, res) => {
  await resolveSchoolAccess(prisma, { userId: req.auth!.userId, schoolId: schoolOf(req), roles: ["admin"] });
  res.json(await getSchoolRegion(prisma, schoolOf(req)));
});

alertsRouter.put("/schools/:schoolId/region", requireVerified, async (req, res) => {
  await resolveSchoolAccess(prisma, { userId: req.auth!.userId, schoolId: schoolOf(req), roles: ["admin"] });
  const input = parse(regionSchema, req.body);
  res.json(await confirmSchoolRegion(prisma, { schoolId: schoolOf(req), actorUserId: req.auth!.userId, sido: input.sido, sigungu: input.sigungu, ip: req.ip }));
});
