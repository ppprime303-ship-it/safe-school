// STEP 3-D 비상대피훈련일지: 자동작성(스냅숏)·편집(판 번호)·HWPX 내려받기
// - 종료된 '모의훈련'에만, 이벤트당 1건(DB 제약과 함께 이중 검사)
// - 원본 대피 보고(evacuation_reports)는 읽기만 합니다. 훈련일지에서 원본을 바꾸지 않습니다.
// - 자동작성 당시 기록을 스냅숏으로 저장하고, 이후 원본이 바뀌면 화면에 알리고 담당자가 '다시 불러오기'를 고를 때만 반영(판 +1, 이력 보존)
// - HWPX는 저장된 판(스냅숏+입력값)으로 만듭니다.
import type { Prisma, PrismaClient } from "@prisma/client";
import { AppError, conflict, isUniqueViolation, notFound } from "../errors.js";
import { writeAudit } from "./audit.js";
import { DISASTER_TYPES, MEMBER_ROLES } from "../../../shared/constants.js";
import { DUTY_LABEL, type StaffDuty } from "../../../shared/permissions.js";
import {
  DRILL_FORM_KEY,
  REAL_FORM_KEY,
  formKeyFor,
  markDraft,
  maskPersonal,
  scanDocPrivacy,
  type DrillIncidentSnap,
  DRILL_FORM_VERSION,
  buildDrillDoc,
  checkDoc,
  defaultManual,
  diffSnapshots,
  docTitle,
  summarizeClasses,
  type DrillManual,
  type DrillSnapshot,
} from "../../../shared/drillLog.js";
import { buildDrillLogHwpx } from "../drilllog/hwpx.js";
import { anonymousPresenceSummary } from "./presence.js";
import { INCIDENT_STATUS_LABEL, INCIDENT_TYPE_LABEL, incidentPlaceLabel } from "../../../shared/incident.js";

type Db = PrismaClient | Prisma.TransactionClient;
const label = (t: string) => (DISASTER_TYPES as Record<string, string>)[t] ?? "기타";
const kstYear = (d: Date) => new Date(d.getTime() + 9 * 3600 * 1000).getUTCFullYear();

/** 시스템 기록으로 확인된 값만 모읍니다(학교명·이벤트·학급별 최신 보고). */
export async function buildSnapshot(db: Db, schoolId: string, eventId: string): Promise<DrillSnapshot> {
  const ev = await db.disasterEvent.findFirst({
    where: { id: eventId, schoolId },
    include: {
      school: { select: { name: true } },
      types: { orderBy: { addedAt: "asc" }, select: { type: true } },
      createdBy: { select: { displayName: true } },
      closedBy: { select: { displayName: true } },
    },
  });
  if (!ev) throw notFound("재난 대응 기록을 찾을 수 없습니다.");
  const reports = await db.evacuationReport.findMany({
    where: { eventId, schoolId },
    include: { revisions: { select: { changedAt: true }, orderBy: { changedAt: "desc" }, take: 1 } },
  });
  const reportedIds = reports.map((r: { classId: string }) => r.classId);
  const classes = await db.schoolClass.findMany({
    where: { schoolId, OR: [{ active: true, schoolYear: kstYear(ev.startedAt) }, { id: { in: reportedIds } }] },
    orderBy: [{ grade: "asc" }, { classNo: "asc" }],
  });
  const byClass = new Map(reports.map((r: any) => [r.classId, r]));
  const real = ev.mode === "real";

  // Phase 4: 현장 제보·조치(두 서식). 제보자·작성자 이름은 고르지 않고, 자유 기재는 개인정보를 가린 요약만
  const staffNames = (await db.schoolMembership.findMany({ where: { schoolId }, select: { user: { select: { displayName: true } } } })).map((m) => m.user.displayName);
  const incRows = await db.incidentReport.findMany({
    where: { schoolId, eventId },
    orderBy: { createdAt: "asc" },
    select: { type: true, placeCategory: true, placeDetail: true, description: true, status: true, createdAt: true, updates: { orderBy: { createdAt: "desc" }, select: { kind: true, note: true } } },
  });
  let maskedCount = 0;
  const cut = (s: string, n: number) => ([...s].length > n ? `${[...s].slice(0, n - 1).join("")}…` : s);
  const incidents: DrillIncidentSnap[] = incRows.map((r, i) => {
    const d = maskPersonal(r.description, staffNames);
    const place = maskPersonal(incidentPlaceLabel(r.placeCategory, r.placeDetail), staffNames);
    const action = r.updates.find((u) => u.kind === "action");
    const a = action ? maskPersonal(action.note, staffNames) : null;
    maskedCount += d.masked + place.masked + (a?.masked ?? 0);
    return {
      no: i + 1,
      typeLabel: INCIDENT_TYPE_LABEL[r.type],
      placeLabel: place.text,
      createdAt: r.createdAt.toISOString(),
      statusLabel: INCIDENT_STATUS_LABEL[r.status],
      updateCount: r.updates.length,
      actionCount: r.updates.filter((u) => u.kind === "action").length,
      summary: cut(d.text, 60),
      lastAction: a ? cut(a.text, 40) : null,
    };
  });
  // Phase 4: 교직원 소재는 실제 재난에서만 익명 집계로(모의훈련은 조회하지 않음)
  const presence = real ? await anonymousPresenceSummary(db, { schoolId, eventId }) : undefined;

  return {
    takenAt: new Date().toISOString(),
    schoolName: ev.school.name,
    event: {
      id: ev.id,
      type: ev.primaryType,
      typeLabel: label(ev.primaryType),
      extraTypeLabels: ev.types.map((t: { type: string }) => t.type).filter((t: string) => t !== ev.primaryType).map(label),
      mode: ev.mode as "drill" | "real",
      startedAt: ev.startedAt.toISOString(),
      closedAt: ev.closedAt?.toISOString() ?? null,
      evacPlace: ev.evacPlace?.trim() || null,
      location: ev.location?.trim() || null,
      // 실제 재난의 재난대피일지에는 교직원 이름을 담지 않음(발령·종료자 포함)
      issuedByName: real ? null : (ev.createdBy?.displayName ?? null),
      closedByName: real ? null : (ev.closedBy?.displayName ?? null),
    },
    classes: classes.map((c: any) => {
      const r: any = byClass.get(c.id);
      return {
        classId: c.id,
        label: c.label,
        grade: c.grade,
        classNo: c.classNo,
        enrolled: r ? r.enrolledCount : (c.enrolledCount ?? null),
        enrolledSource: r ? "report" : c.enrolledCount === null ? "none" : "class",
        report: r
          ? {
              evacuated: r.evacuated,
              absentKnown: r.absentKnown,
              unconfirmed: r.unconfirmed,
              injured: r.injured,
              note: r.note,
              version: r.version,
              reportedAt: r.reportedAt.toISOString(),
              lastChangedAt: (r.revisions[0]?.changedAt ?? r.reportedAt).toISOString(),
            }
          : null,
      };
    }),
    incidents,
    ...(real ? { presence } : {}),
    maskedCount,
  };
}

/**
 * 보고서 대상과 작성 상태: 모의훈련(비상대피훈련일지)·실제 재난(재난대피일지) 모두, 진행 중 사건도 포함(작성 중만 가능 — 완료는 종료 후).
 * 서식은 사건의 서버 측 mode 로만 정함
 */
export async function listDrillTargets(db: Db, schoolId: string) {
  const events = await db.disasterEvent.findMany({
    where: { schoolId },
    orderBy: { startedAt: "desc" },
    take: 50,
    include: { drillLog: { select: { id: true, status: true, version: true, updatedAt: true } } }, // 작성·수정자 이름은 상세 화면(권한 확인 후)에서만
  });
  return {
    events: events.map((e: any) => ({
      eventId: e.id,
      mode: e.mode as "drill" | "real",
      status: e.status as "active" | "closed",
      formKey: formKeyFor(e.mode),
      type: e.primaryType,
      typeLabel: label(e.primaryType),
      startedAt: e.startedAt.toISOString(),
      closedAt: e.closedAt?.toISOString() ?? null,
      log: e.drillLog
        ? { id: e.drillLog.id, status: e.drillLog.status, version: e.drillLog.version, updatedAt: e.drillLog.updatedAt.toISOString() }
        : null,
    })),
  };
}

/**
 * 역할 담당자 고르기용 교직원 목록(STEP 3-D UI 개선): 같은 학교의 승인된·활성 계정의 이름과 직책·업무·담임 학급만.
 * 이메일·연락처·계정 정보는 돌려주지 않습니다. 권한 검사(drilllog.edit)는 라우터에서 합니다.
 */
export async function listDrillStaff(db: Db, schoolId: string) {
  const year = kstYear(new Date());
  const rows = await db.schoolMembership.findMany({
    where: { schoolId, status: "approved", user: { status: "active" } },
    select: {
      id: true,
      role: true,
      user: { select: { displayName: true } },
      duties: { where: { endedAt: null }, select: { duty: true, isActing: true } },
      assignments: { where: { duty: "homeroom", schoolClass: { schoolYear: year, active: true } }, select: { schoolClass: { select: { label: true } } } },
    },
  });
  const staff = rows
    .map((m: any) => ({
      id: m.id as string,
      name: ((m.user?.displayName ?? "") as string).trim(),
      roleLabel: (MEMBER_ROLES as Record<string, string>)[m.role] ?? "",
      duties: m.duties.map((d: { duty: StaffDuty; isActing: boolean }) => `${DUTY_LABEL[d.duty] ?? d.duty}${d.isActing ? "(직무대리)" : ""}`),
      classes: m.assignments.map((a: any) => a.schoolClass.label as string),
    }))
    .filter((m) => m.name)
    .sort((a, b) => a.name.localeCompare(b.name, "ko"));
  return { staff };
}

function guardError(error: unknown): never {
  const text = error instanceof Error ? error.message : String(error);
  if (text.includes("판 번호")) throw conflict("version_conflict", "다른 담당자가 먼저 저장했습니다. 최신 내용을 확인하세요.");
  if (text.includes("실제 재난")) throw conflict("not_drill", "실제 재난 대응 기록에는 훈련일지를 만들 수 없습니다.");
  if (text.includes("종료된 훈련")) throw conflict("event_not_closed", "종료된 훈련에만 훈련일지를 만들 수 있습니다.");
  // Phase 4 마이그레이션 20261101000000_disaster_reports 의 DB 검사
  if (text.includes("서식이 사건 구분")) throw conflict("form_mismatch", "보고서 서식이 사건 구분(모의훈련·실제 재난)과 맞지 않습니다.");
  if (text.includes("사건이 종료된 뒤에")) throw conflict("event_not_closed", "사건이 종료된 뒤에 보고서를 완료할 수 있습니다.");
  if (text.includes("종료 뒤에 자동 기록")) throw conflict("refresh_required", "종료 뒤에 자동 기록을 다시 불러온 다음 완료하세요.");
  throw error;
}

/** 사건의 서버 측 mode(보고서 서식·권한 결정용). 다른 학교 사건은 404 */
export async function eventModeOf(db: Db, schoolId: string, eventId: string) {
  const ev = await db.disasterEvent.findFirst({ where: { id: eventId, schoolId }, select: { mode: true, status: true } });
  if (!ev) throw notFound("재난 대응 기록을 찾을 수 없습니다.");
  return ev as { mode: "drill" | "real"; status: "active" | "closed" };
}

/** 보고서의 서식(권한 결정용). 다른 학교 보고서는 404 */
export async function reportFormOf(db: Db, schoolId: string, logId: string) {
  const log = await db.drillLog.findFirst({ where: { id: logId, schoolId }, select: { formKey: true } });
  if (!log) throw notFound("보고서를 찾을 수 없습니다.");
  return { formKey: log.formKey, mode: (log.formKey === REAL_FORM_KEY ? "real" : "drill") as "drill" | "real" };
}

/**
 * 보고서 만들기(Phase 4): 서식은 사건의 서버 측 mode 로 결정(모의훈련 → 비상대피훈련일지, 실제 재난 → 재난대피일지).
 * 진행 중 사건에도 '작성 중'으로 만들 수 있음(최종 완료는 종료 후). 이벤트당 1건(다시 요청·동시 요청은 같은 보고서). 권한은 라우터가 서식별로 검사
 */
export async function createDrillLog(prisma: PrismaClient, params: { schoolId: string; eventId: string; actorUserId: string; ip?: string | null }) {
  const run = () =>
    prisma.$transaction(async (tx) => {
      const ev = await tx.disasterEvent.findFirst({ where: { id: params.eventId, schoolId: params.schoolId }, select: { id: true, mode: true, status: true } });
      if (!ev) throw notFound("재난 대응 기록을 찾을 수 없습니다.");
      const existing = await tx.drillLog.findUnique({ where: { eventId: ev.id }, select: { id: true } });
      if (existing) return { id: existing.id, created: false };
      const snapshot = await buildSnapshot(tx, params.schoolId, ev.id);
      let created;
      try {
        created = await tx.drillLog.create({
          data: {
            schoolId: params.schoolId,
            eventId: ev.id,
            formKey: formKeyFor(ev.mode),
            formVersion: DRILL_FORM_VERSION,
            autoSnapshot: snapshot as unknown as Prisma.InputJsonValue,
            manual: defaultManual() as unknown as Prisma.InputJsonValue,
            createdById: params.actorUserId,
            updatedById: params.actorUserId,
          },
          select: { id: true },
        });
      } catch (e) {
        if (isUniqueViolation(e)) throw new CreateRace();
        guardError(e);
      }
      const s = summarizeClasses(snapshot.classes);
      await writeAudit(tx, {
        schoolId: params.schoolId,
        actorUserId: params.actorUserId,
        action: "drilllog.created",
        targetType: "drill_log",
        targetId: created.id,
        after: { eventId: ev.id, formKey: formKeyFor(ev.mode), eventStatus: ev.status, classes: s.total, reported: s.reportedCount, unreported: s.unreported.length },
        ip: params.ip,
      });
      return { id: created.id, created: true };
    });
  try {
    return await run();
  } catch (e) {
    if (!(e instanceof CreateRace)) throw e;
    const again = await prisma.drillLog.findUnique({ where: { eventId: params.eventId }, select: { id: true, schoolId: true } });
    if (!again || again.schoolId !== params.schoolId) throw conflict("create_conflict", "보고서를 만들지 못했습니다. 다시 시도하세요.");
    return { id: again.id, created: false };
  }
}
class CreateRace extends Error {}

/** 키 순서와 무관한 JSON 문자열(내용 비교용) */
export function stableJson(v: unknown): string {
  if (Array.isArray(v)) return `[${v.map(stableJson).join(",")}]`;
  if (v && typeof v === "object") {
    return `{${Object.keys(v as Record<string, unknown>).sort().map((k) => `${JSON.stringify(k)}:${stableJson((v as Record<string, unknown>)[k])}`).join(",")}}`;
  }
  return JSON.stringify(v);
}

export async function getDrillLog(db: Db, params: { schoolId: string; logId: string; canEdit: boolean }) {
  const log = await db.drillLog.findFirst({
    where: { id: params.logId, schoolId: params.schoolId },
    include: {
      createdBy: { select: { displayName: true } },
      updatedBy: { select: { displayName: true } },
      revisions: { orderBy: { version: "desc" }, select: { version: true, status: true, changedAt: true, changedBy: { select: { displayName: true } } } },
    },
  });
  if (!log) throw notFound("보고서를 찾을 수 없습니다.");
  const saved = log.autoSnapshot as unknown as DrillSnapshot;
  const current = await buildSnapshot(db, params.schoolId, log.eventId);
  const manual = { ...defaultManual(), ...(log.manual as object) } as DrillManual;
  const ev = await eventModeOf(db, params.schoolId, log.eventId);
  const closedAt = (await db.disasterEvent.findUniqueOrThrow({ where: { id: log.eventId }, select: { closedAt: true } })).closedAt;
  // 최종본: 완료 + 사건 종료 + 종료 뒤 불러온 자동 기록. 그 밖은 '작성 중 초안'
  const takenAfterClose = !!closedAt && log.autoTakenAt >= closedAt;
  return {
    log: {
      id: log.id,
      eventId: log.eventId,
      status: log.status,
      version: log.version,
      formKey: log.formKey,
      mode: ev.mode,
      eventStatus: ev.status,
      final: log.status === "completed" && ev.status === "closed" && takenAfterClose,
      refreshNeeded: ev.status === "closed" && !takenAfterClose,
      privacyIssues: await privacyIssuesOf(db, params.schoolId, saved, manual, ev.mode),
      autoTakenAt: log.autoTakenAt.toISOString(),
      createdByName: log.createdBy?.displayName ?? null,
      updatedByName: log.updatedBy?.displayName ?? null,
      createdAt: log.createdAt.toISOString(),
      updatedAt: log.updatedAt.toISOString(),
    },
    snapshot: saved,
    manual,
    sourceChanges: diffSnapshots(saved, current),
    canEdit: params.canEdit,
    revisions: log.revisions.map((r: any) => ({ version: r.version, status: r.status, changedAt: r.changedAt.toISOString(), changedByName: r.changedBy?.displayName ?? null })),
  };
}

/** 출력 문서 개인정보 검사(전화번호·주민등록번호 형태, 실제 재난은 교직원 이름까지) */
async function privacyIssuesOf(db: Db, schoolId: string, snap: DrillSnapshot, manual: DrillManual, mode: "drill" | "real") {
  const names = (await db.schoolMembership.findMany({ where: { schoolId }, select: { user: { select: { displayName: true } } } })).map((m) => m.user.displayName);
  return scanDocPrivacy(buildDrillDoc(snap, manual), names, { checkNames: mode === "real" });
}

export async function updateDrillLog(
  prisma: PrismaClient,
  params: { schoolId: string; logId: string; actorUserId: string; manual: DrillManual; status: "draft" | "completed"; expectedVersion: number; refreshAuto?: boolean; ip?: string | null },
) {
  return prisma.$transaction(async (tx) => {
    const log = await tx.drillLog.findFirst({ where: { id: params.logId, schoolId: params.schoolId } });
    if (!log) throw notFound("보고서를 찾을 수 없습니다.");
    if (log.version !== params.expectedVersion) {
      throw conflict("version_conflict", "다른 담당자가 먼저 저장했습니다. 최신 내용을 확인하세요.", { currentVersion: log.version });
    }
    const snapshot = params.refreshAuto ? await buildSnapshot(tx, params.schoolId, log.eventId) : (log.autoSnapshot as unknown as DrillSnapshot);
    const changes = params.refreshAuto ? diffSnapshots(log.autoSnapshot as unknown as DrillSnapshot, snapshot) : [];
    // Phase 4: 완료(최종본)는 사건 종료 후 + 종료 뒤 불러온 자동 기록 + 개인정보 검사 통과(DB 트리거도 앞의 둘을 검사)
    if (params.status === "completed") {
      const ev = await tx.disasterEvent.findUniqueOrThrow({ where: { id: log.eventId }, select: { status: true, closedAt: true, mode: true } });
      if (log.status !== "completed" || params.refreshAuto) {
        if (ev.status !== "closed") throw conflict("event_not_closed", "사건이 종료된 뒤에 보고서를 완료할 수 있습니다. 지금은 작성 중으로 저장하세요.");
        if (!params.refreshAuto && log.autoTakenAt < ev.closedAt!) throw conflict("refresh_required", "진행 중에 불러온 기록입니다. 종료 뒤 자동 기록을 다시 불러온 다음 완료하세요.");
      }
      // 이미 완료된 일지를 고쳐 다시 완료로 저장할 때도 개인정보 검사(완료본에 전화번호 등이 끼어들지 않게)
      const issues = await privacyIssuesOf(tx, params.schoolId, snapshot, params.manual, ev.mode);
      if (issues.length) throw new AppError(422, "privacy_check_failed", "출력 문서에 개인정보로 보이는 내용이 있어 완료할 수 없습니다. 해당 칸을 고친 뒤 다시 완료하세요.", { issues });
    }
    // jsonb는 객체 키 순서를 바꿔 저장하므로 키를 정렬해 비교(같은 내용이면 판 번호를 올리지 않음)
    const sameManual = stableJson(params.manual) === stableJson({ ...defaultManual(), ...(log.manual as object) });
    if (sameManual && log.status === params.status && (!params.refreshAuto || changes.length === 0)) {
      return { id: log.id, version: log.version, changed: false };
    }
    let count = 0;
    try {
      ({ count } = await tx.drillLog.updateMany({
        where: { id: log.id, schoolId: params.schoolId, version: params.expectedVersion },
        data: {
          manual: params.manual as unknown as Prisma.InputJsonValue,
          status: params.status,
          ...(params.refreshAuto ? { autoSnapshot: snapshot as unknown as Prisma.InputJsonValue, autoTakenAt: new Date() } : {}),
          version: params.expectedVersion + 1,
          updatedById: params.actorUserId,
          updatedAt: new Date(),
        },
      }));
    } catch (e) {
      guardError(e);
    }
    if (count === 0) throw conflict("version_conflict", "다른 담당자가 먼저 저장했습니다. 최신 내용을 확인하세요.");
    await writeAudit(tx, {
      schoolId: params.schoolId,
      actorUserId: params.actorUserId,
      action: params.refreshAuto ? "drilllog.refreshed" : log.status !== params.status && params.status === "completed" ? "drilllog.completed" : "drilllog.updated",
      targetType: "drill_log",
      targetId: log.id,
      before: { version: log.version, status: log.status },
      after: { version: params.expectedVersion + 1, status: params.status, ...(params.refreshAuto ? { sourceChanges: changes } : {}) },
      ip: params.ip,
    });
    return { id: log.id, version: params.expectedVersion + 1, changed: true };
  });
}

export async function exportDrillLogHwpx(prisma: PrismaClient, params: { schoolId: string; logId: string; actorUserId: string; ip?: string | null }) {
  const log = await prisma.drillLog.findFirst({ where: { id: params.logId, schoolId: params.schoolId } });
  if (!log) throw notFound("보고서를 찾을 수 없습니다.");
  const snap = log.autoSnapshot as unknown as DrillSnapshot;
  const manual = { ...defaultManual(), ...(log.manual as object) } as DrillManual;
  // Phase 4: 개인정보 검사에 걸리면 내려받지 않음. 최종본이 아니면 '작성 중 초안' 표시를 넣어 내려받음
  const ev = await prisma.disasterEvent.findUniqueOrThrow({ where: { id: log.eventId }, select: { status: true, closedAt: true, mode: true } });
  const issues = await privacyIssuesOf(prisma, params.schoolId, snap, manual, ev.mode);
  if (issues.length) throw new AppError(422, "privacy_check_failed", "출력 문서에 개인정보로 보이는 내용이 있어 내려받을 수 없습니다. 해당 칸을 고친 뒤 다시 시도하세요.", { issues });
  const final = log.status === "completed" && ev.status === "closed" && !!ev.closedAt && log.autoTakenAt >= ev.closedAt;
  let buf: Buffer;
  try {
    const built = buildDrillDoc(snap, manual);
    const doc = final ? built : markDraft(built);
    // 칸 구조 오류만 막습니다. 높이 초과(역할·평가를 최대로 늘린 경우)는 한글에서 다음 쪽으로 이어지므로 내려받기를 막지 않음
    const errs = checkDoc(doc, { height: false });
    if (errs.length) throw new Error(errs.join("; "));
    const tall = checkDoc(doc).filter((e) => e.includes("높이"));
    if (tall.length) console.warn("[drilllog] 쪽 높이 초과(다음 쪽으로 이어짐)", tall.join("; "));
    buf = buildDrillLogHwpx(doc);
  } catch (e) {
    console.error("[drilllog] 문서 생성 실패", e instanceof Error ? e.message : e);
    throw new AppError(500, "doc_generation_failed", "보고서 파일을 만들지 못했습니다. 입력 내용은 저장되어 있으니 잠시 후 다시 시도하세요.");
  }
  await writeAudit(prisma, { schoolId: params.schoolId, actorUserId: params.actorUserId, action: "drilllog.exported", targetType: "drill_log", targetId: log.id, after: { version: log.version, format: "hwpx", bytes: buf.length }, ip: params.ip });
  const d = new Date(new Date(snap.event.startedAt).getTime() + 9 * 3600 * 1000);
  const ymd = `${d.getUTCFullYear()}${String(d.getUTCMonth() + 1).padStart(2, "0")}${String(d.getUTCDate()).padStart(2, "0")}`;
  return { buffer: buf, filename: `${docTitle(snap)}${final ? "" : "_작성중초안"}_${ymd}.hwpx`.replace(/[\\/:*?"<>|]/g, "_") };
}
