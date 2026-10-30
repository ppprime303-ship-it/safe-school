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
      issuedByName: ev.createdBy?.displayName ?? null,
      closedByName: ev.closedBy?.displayName ?? null,
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
  };
}

/** 훈련일지 대상(종료된 모의훈련)과 작성 상태 */
export async function listDrillTargets(db: Db, schoolId: string) {
  const events = await db.disasterEvent.findMany({
    where: { schoolId, mode: "drill", status: "closed" },
    orderBy: { startedAt: "desc" },
    take: 50,
    include: { drillLog: { select: { id: true, status: true, version: true, updatedAt: true, updatedBy: { select: { displayName: true } } } } },
  });
  return {
    events: events.map((e: any) => ({
      eventId: e.id,
      type: e.primaryType,
      typeLabel: label(e.primaryType),
      startedAt: e.startedAt.toISOString(),
      closedAt: e.closedAt?.toISOString() ?? null,
      log: e.drillLog
        ? { id: e.drillLog.id, status: e.drillLog.status, version: e.drillLog.version, updatedAt: e.drillLog.updatedAt.toISOString(), updatedByName: e.drillLog.updatedBy?.displayName ?? null }
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

export async function createDrillLog(prisma: PrismaClient, params: { schoolId: string; eventId: string; actorUserId: string; ip?: string | null }) {
  const run = () =>
    prisma.$transaction(async (tx) => {
      const ev = await tx.disasterEvent.findFirst({ where: { id: params.eventId, schoolId: params.schoolId }, select: { id: true, mode: true, status: true } });
      if (!ev) throw notFound("재난 대응 기록을 찾을 수 없습니다.");
      if (ev.mode !== "drill") throw conflict("not_drill", "실제 재난 대응 기록에는 훈련일지를 만들 수 없습니다.");
      if (ev.status !== "closed") throw conflict("event_not_closed", "훈련을 종료한 뒤에 훈련일지를 만들 수 있습니다.");
      const existing = await tx.drillLog.findUnique({ where: { eventId: ev.id }, select: { id: true } });
      if (existing) return { id: existing.id, created: false };
      const snapshot = await buildSnapshot(tx, params.schoolId, ev.id);
      let created;
      try {
        created = await tx.drillLog.create({
          data: {
            schoolId: params.schoolId,
            eventId: ev.id,
            formKey: DRILL_FORM_KEY,
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
        after: { eventId: ev.id, classes: s.total, reported: s.reportedCount, unreported: s.unreported.length },
        ip: params.ip,
      });
      return { id: created.id, created: true };
    });
  try {
    return await run();
  } catch (e) {
    if (!(e instanceof CreateRace)) throw e;
    const again = await prisma.drillLog.findUnique({ where: { eventId: params.eventId }, select: { id: true, schoolId: true } });
    if (!again || again.schoolId !== params.schoolId) throw conflict("create_conflict", "훈련일지를 만들지 못했습니다. 다시 시도하세요.");
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
  if (!log) throw notFound("훈련일지를 찾을 수 없습니다.");
  const saved = log.autoSnapshot as unknown as DrillSnapshot;
  const current = await buildSnapshot(db, params.schoolId, log.eventId);
  return {
    log: {
      id: log.id,
      eventId: log.eventId,
      status: log.status,
      version: log.version,
      formKey: log.formKey,
      autoTakenAt: log.autoTakenAt.toISOString(),
      createdByName: log.createdBy?.displayName ?? null,
      updatedByName: log.updatedBy?.displayName ?? null,
      createdAt: log.createdAt.toISOString(),
      updatedAt: log.updatedAt.toISOString(),
    },
    snapshot: saved,
    manual: { ...defaultManual(), ...(log.manual as object) } as DrillManual,
    sourceChanges: diffSnapshots(saved, current),
    canEdit: params.canEdit,
    revisions: log.revisions.map((r: any) => ({ version: r.version, status: r.status, changedAt: r.changedAt.toISOString(), changedByName: r.changedBy?.displayName ?? null })),
  };
}

export async function updateDrillLog(
  prisma: PrismaClient,
  params: { schoolId: string; logId: string; actorUserId: string; manual: DrillManual; status: "draft" | "completed"; expectedVersion: number; refreshAuto?: boolean; ip?: string | null },
) {
  return prisma.$transaction(async (tx) => {
    const log = await tx.drillLog.findFirst({ where: { id: params.logId, schoolId: params.schoolId } });
    if (!log) throw notFound("훈련일지를 찾을 수 없습니다.");
    if (log.version !== params.expectedVersion) {
      throw conflict("version_conflict", "다른 담당자가 먼저 저장했습니다. 최신 내용을 확인하세요.", { currentVersion: log.version });
    }
    const snapshot = params.refreshAuto ? await buildSnapshot(tx, params.schoolId, log.eventId) : (log.autoSnapshot as unknown as DrillSnapshot);
    const changes = params.refreshAuto ? diffSnapshots(log.autoSnapshot as unknown as DrillSnapshot, snapshot) : [];
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
  if (!log) throw notFound("훈련일지를 찾을 수 없습니다.");
  const snap = log.autoSnapshot as unknown as DrillSnapshot;
  const manual = { ...defaultManual(), ...(log.manual as object) } as DrillManual;
  let buf: Buffer;
  try {
    const doc = buildDrillDoc(snap, manual);
    // 칸 구조 오류만 막습니다. 높이 초과(역할·평가를 최대로 늘린 경우)는 한글에서 다음 쪽으로 이어지므로 내려받기를 막지 않음
    const errs = checkDoc(doc, { height: false });
    if (errs.length) throw new Error(errs.join("; "));
    const tall = checkDoc(doc).filter((e) => e.includes("높이"));
    if (tall.length) console.warn("[drilllog] 쪽 높이 초과(다음 쪽으로 이어짐)", tall.join("; "));
    buf = buildDrillLogHwpx(doc);
  } catch (e) {
    console.error("[drilllog] 문서 생성 실패", e instanceof Error ? e.message : e);
    throw new AppError(500, "doc_generation_failed", "훈련일지 파일을 만들지 못했습니다. 입력 내용은 저장되어 있으니 잠시 후 다시 시도하세요.");
  }
  await writeAudit(prisma, { schoolId: params.schoolId, actorUserId: params.actorUserId, action: "drilllog.exported", targetType: "drill_log", targetId: log.id, after: { version: log.version, format: "hwpx", bytes: buf.length }, ip: params.ip });
  const d = new Date(new Date(snap.event.startedAt).getTime() + 9 * 3600 * 1000);
  const ymd = `${d.getUTCFullYear()}${String(d.getUTCMonth() + 1).padStart(2, "0")}${String(d.getUTCDate()).padStart(2, "0")}`;
  return { buffer: buf, filename: `${docTitle(snap)}_${ymd}.hwpx`.replace(/[\\/:*?"<>|]/g, "_") };
}
