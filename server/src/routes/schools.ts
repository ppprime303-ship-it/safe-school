// 학교 검색·등록 신청·가입 신청·관리자 승인·학급 배정·공시자료
// 모든 학교 업무 API는 서버에서 소속·승인·역할·학교 활성 상태를 검사합니다(resolveSchoolAccess).
import { Router } from "express";
import { prisma } from "../db.js";
import { notFound } from "../errors.js";
import { parse } from "../validate.js";
import { requireRecentReauth, requireVerified } from "../auth/session.js";
import { getSchoolinfoClient } from "../integrations/client.js";
import { rateLimit } from "../middleware/security.js";
import { searchDirectory } from "../services/schoolDirectory.js";
import { applyForSchoolRegistration, reapplyForPendingSchool } from "../services/schoolRegistration.js";
import {
  decideMemberships,
  requestToJoinSchool,
  resolveSchoolAccess,
  revokeMembership,
  setAssignments,
} from "../services/membership.js";
import {
  applyClassStructure,
  confirmEnrollment,
  getClassStructureProposal,
  refreshGradeClassData,
} from "../services/publicData.js";
import {
  applyStructureSchema,
  assignmentsSchema,
  confirmEnrollmentSchema,
  directorySearchSchema,
  joinRequestSchema,
  membershipDecisionSchema,
  registrationApplySchema,
} from "../../../shared/schemas.js";

export const schoolsRouter = Router();
const searchLimiter = rateLimit({ windowMs: 60 * 1000, max: 30 });

const param = (value: string | string[] | undefined) => (Array.isArray(value) ? value[0] : value) ?? "";
const currentSchoolYear = () => Number(new Intl.DateTimeFormat("en", { timeZone: "Asia/Seoul", year: "numeric" }).format(new Date()));

// ───────────── 학교 검색(학교알리미 목록) ─────────────
schoolsRouter.get("/school-directory", requireVerified, searchLimiter, async (req, res) => {
  const input = parse(directorySearchSchema, req.query);
  const result = await searchDirectory(prisma, getSchoolinfoClient(), { q: input.q, kindCode: input.kind, sidoCode: input.sido });
  res.json(result);
});

// ───────────── 최초 학교 등록 신청 ─────────────
schoolsRouter.post("/school-registrations", requireVerified, async (req, res) => {
  const input = parse(registrationApplySchema, req.body);
  const result = await applyForSchoolRegistration(prisma, {
    userId: req.auth!.userId,
    externalCode: input.externalCode,
    applicantPosition: input.applicantPosition,
    ip: req.ip,
  });
  // 공시자료(학년별 학급수·학생수)는 실패해도 등록에 영향 없음(참고자료)
  void refreshGradeClassData(prisma, getSchoolinfoClient(), { schoolId: result.school.id }).catch((e) =>
    console.warn("[registration] 공시자료 조회 실패", e),
  );
  res.status(201).json({
    schoolId: result.school.id,
    registrationId: result.registration.id,
    status: result.registration.status,
    message: "학교 등록 신청이 접수되었습니다. 관리자 자격 확인 후 학교 공간이 활성화됩니다.",
  });
});

// 승인 대기 학교(이전 신청이 거절됨)에 다른 교직원이 다시 등록 신청
schoolsRouter.post("/schools/:schoolId/registrations", requireVerified, async (req, res) => {
  const input = parse(registrationApplySchema.pick({ applicantPosition: true }), req.body);
  const registration = await reapplyForPendingSchool(prisma, {
    userId: req.auth!.userId,
    schoolId: param(req.params.schoolId),
    applicantPosition: input.applicantPosition,
  });
  res.status(201).json({ registrationId: registration.id, status: registration.status });
});

// ───────────── 후속 교직원 가입 신청 ─────────────
schoolsRouter.post("/schools/:schoolId/join-requests", requireVerified, async (req, res) => {
  const input = parse(joinRequestSchema, req.body);
  const { membership, created } = await requestToJoinSchool(prisma, {
    userId: req.auth!.userId,
    schoolId: param(req.params.schoolId),
    requestedRole: input.role,
    ip: req.ip,
  });
  res.status(created ? 201 : 200).json({ membershipId: membership.id, status: membership.status });
});

// ───────────── 관리자: 교직원 목록·승인·배정·회수 ─────────────
schoolsRouter.get("/schools/:schoolId/members", requireVerified, async (req, res) => {
  const schoolId = param(req.params.schoolId);
  await resolveSchoolAccess(prisma, { userId: req.auth!.userId, schoolId, roles: ["admin"] });
  const status = typeof req.query.status === "string" ? req.query.status : undefined;
  const members = await prisma.schoolMembership.findMany({
    where: { schoolId, ...(status ? { status: status as "pending" | "approved" | "rejected" | "revoked" } : {}) },
    include: {
      user: { select: { displayName: true, email: true } },
      assignments: { include: { schoolClass: { select: { id: true, label: true, schoolYear: true } } } },
    },
    orderBy: [{ status: "asc" }, { createdAt: "asc" }],
  });
  res.json({
    members: members.map((m) => ({
      id: m.id,
      role: m.role,
      status: m.status,
      requestedAt: m.createdAt,
      user: m.user,
      assignments: m.assignments.map((a) => ({ duty: a.duty, class: a.schoolClass })),
    })),
  });
});

schoolsRouter.post("/schools/:schoolId/members/approve", requireVerified, async (req, res) => {
  const schoolId = param(req.params.schoolId);
  await resolveSchoolAccess(prisma, { userId: req.auth!.userId, schoolId, roles: ["admin"] });
  const input = parse(membershipDecisionSchema, req.body);
  res.json(await decideMemberships(prisma, { schoolId, actorUserId: req.auth!.userId, membershipIds: input.membershipIds, decision: "approve", ip: req.ip }));
});

schoolsRouter.post("/schools/:schoolId/members/reject", requireVerified, async (req, res) => {
  const schoolId = param(req.params.schoolId);
  await resolveSchoolAccess(prisma, { userId: req.auth!.userId, schoolId, roles: ["admin"] });
  const input = parse(membershipDecisionSchema, req.body);
  res.json(await decideMemberships(prisma, { schoolId, actorUserId: req.auth!.userId, membershipIds: input.membershipIds, decision: "reject", ip: req.ip }));
});

schoolsRouter.put("/schools/:schoolId/members/:membershipId/assignments", requireVerified, async (req, res) => {
  const schoolId = param(req.params.schoolId);
  await resolveSchoolAccess(prisma, { userId: req.auth!.userId, schoolId, roles: ["admin"] });
  const input = parse(assignmentsSchema, req.body);
  res.json(
    await setAssignments(prisma, {
      schoolId,
      actorUserId: req.auth!.userId,
      membershipId: param(req.params.membershipId),
      role: input.role,
      assignments: input.assignments,
      ip: req.ip,
    }),
  );
});

schoolsRouter.post("/schools/:schoolId/members/:membershipId/revoke", requireVerified, requireRecentReauth, async (req, res) => {
  const schoolId = param(req.params.schoolId);
  await resolveSchoolAccess(prisma, { userId: req.auth!.userId, schoolId, roles: ["admin"] });
  res.json(await revokeMembership(prisma, { schoolId, actorUserId: req.auth!.userId, membershipId: param(req.params.membershipId), ip: req.ip }));
});

// ───────────── 학급(승인된 교직원 조회, 관리자 수정) ─────────────
schoolsRouter.get("/schools/:schoolId/classes", requireVerified, async (req, res) => {
  const schoolId = param(req.params.schoolId);
  await resolveSchoolAccess(prisma, { userId: req.auth!.userId, schoolId });
  const schoolYear = Number(req.query.year) || currentSchoolYear();
  const classes = await prisma.schoolClass.findMany({
    where: { schoolId, schoolYear, active: true },
    orderBy: [{ grade: "asc" }, { classNo: "asc" }],
    select: { id: true, grade: true, classNo: true, label: true, enrolledCount: true, enrolledConfirmedAt: true, origin: true },
  });
  res.json({ schoolYear, classes });
});

schoolsRouter.put("/schools/:schoolId/classes/enrollment", requireVerified, async (req, res) => {
  const schoolId = param(req.params.schoolId);
  await resolveSchoolAccess(prisma, { userId: req.auth!.userId, schoolId, roles: ["admin"] });
  const input = parse(confirmEnrollmentSchema, req.body);
  res.json(await confirmEnrollment(prisma, { schoolId, actorUserId: req.auth!.userId, items: input.items }));
});

// ───────────── 관리자: 학교알리미 공시자료(참고) ─────────────
schoolsRouter.get("/schools/:schoolId/public-data", requireVerified, async (req, res) => {
  const schoolId = param(req.params.schoolId);
  await resolveSchoolAccess(prisma, { userId: req.auth!.userId, schoolId, roles: ["admin"] });
  const schoolYear = Number(req.query.year) || currentSchoolYear();
  res.json(await getClassStructureProposal(prisma, schoolId, schoolYear));
});

schoolsRouter.post("/schools/:schoolId/public-data/refresh", requireVerified, async (req, res) => {
  const schoolId = param(req.params.schoolId);
  await resolveSchoolAccess(prisma, { userId: req.auth!.userId, schoolId, roles: ["admin"] });
  const result = await refreshGradeClassData(prisma, getSchoolinfoClient(), { schoolId });
  if (!result.snapshot && result.stale) throw notFound(result.warning ?? "공시자료가 없습니다.");
  res.json({ changed: result.changed, stale: result.stale, warning: result.warning, snapshotId: result.snapshot?.id ?? null });
});

schoolsRouter.post("/schools/:schoolId/classes/apply-structure", requireVerified, async (req, res) => {
  const schoolId = param(req.params.schoolId);
  await resolveSchoolAccess(prisma, { userId: req.auth!.userId, schoolId, roles: ["admin"] });
  const input = parse(applyStructureSchema, req.body);
  res.json(await applyClassStructure(prisma, { schoolId, actorUserId: req.auth!.userId, schoolYear: input.schoolYear, grades: input.grades }));
});
