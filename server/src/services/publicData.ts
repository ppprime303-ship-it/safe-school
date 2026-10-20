// 학교알리미 공시자료: 스냅숏으로만 저장하고, 실제 학급·재적 데이터는 관리자가 확인한 뒤에만 바뀝니다.
import type { Prisma, PrismaClient } from "@prisma/client";
import { badRequest, notFound } from "../errors.js";
import {
  API_TYPE_BASIC_INFO,
  API_TYPE_GRADE_CLASS_STUDENTS,
  hashPayload,
  parseBasicInfo,
  parseGradeClassStudents,
  SchoolinfoError,
  type GradeClassStudents,
  type SchoolinfoClient,
  type SchoolinfoRow,
} from "../integrations/schoolinfo.js";
import { writeAudit } from "./audit.js";

export const DATASET_BASIC = "basic_info";
export const DATASET_GRADE_CLASS = "grade_class_students";

async function saveSnapshot(
  prisma: PrismaClient | Prisma.TransactionClient,
  input: {
    schoolId: string;
    dataset: string;
    apiType: string;
    disclosureYear: number | null;
    baseDate: string | null;
    sourceUrl: string;
    payload: SchoolinfoRow;
    parsed: Prisma.InputJsonValue;
  },
) {
  const payloadHash = hashPayload(input.payload);
  const existing = await prisma.schoolPublicDataSnapshot.findUnique({
    where: {
      schoolId_source_dataset_payloadHash: {
        schoolId: input.schoolId,
        source: "schoolinfo",
        dataset: input.dataset,
        payloadHash,
      },
    },
  });
  if (existing) return { snapshot: existing, changed: false };
  const snapshot = await prisma.schoolPublicDataSnapshot.create({
    data: {
      schoolId: input.schoolId,
      source: "schoolinfo",
      dataset: input.dataset,
      apiType: input.apiType,
      disclosureYear: input.disclosureYear,
      baseDate: input.baseDate ? new Date(`${input.baseDate}T00:00:00Z`) : null,
      sourceUrl: input.sourceUrl,
      payload: input.payload as Prisma.InputJsonValue,
      parsed: input.parsed,
      payloadHash,
    },
  });
  return { snapshot, changed: true };
}

// 학교 등록 시: 검색 목록에 있던 기본정보 원본을 스냅숏으로 남깁니다(추가 API 호출 없음).
export async function saveBasicInfoSnapshot(
  db: PrismaClient | Prisma.TransactionClient,
  input: { schoolId: string; kindCode: string; sidoCode: string | null; row: SchoolinfoRow },
) {
  const parsed = parseBasicInfo(input.row);
  return saveSnapshot(db, {
    schoolId: input.schoolId,
    dataset: DATASET_BASIC,
    apiType: API_TYPE_BASIC_INFO,
    disclosureYear: null,
    baseDate: null,
    sourceUrl: `https://www.schoolinfo.go.kr/openApi.do?apiType=${API_TYPE_BASIC_INFO}&schulKndCode=${input.kindCode}${input.sidoCode ? `&sidoCode=${input.sidoCode}` : ""}`,
    payload: input.row,
    parsed: (parsed ?? {}) as unknown as Prisma.InputJsonValue,
  });
}

// 학년별 학급수·학생수를 새로 받아 저장. 실패하면 마지막 스냅숏을 돌려줍니다(stale).
export async function refreshGradeClassData(
  prisma: PrismaClient,
  client: SchoolinfoClient | null,
  params: { schoolId: string; disclosureYear?: number },
) {
  const school = await prisma.school.findUnique({
    where: { id: params.schoolId },
    include: { externalIds: { where: { source: "schoolinfo" } } },
  });
  if (!school) throw notFound("학교를 찾을 수 없습니다.");
  const code = school.externalIds[0]?.externalCode;
  const kindCode = school.schoolKindCode;

  const fallback = async (warning: string) => ({
    snapshot: await latestSnapshot(prisma, school.id, DATASET_GRADE_CLASS),
    changed: false,
    stale: true,
    warning,
  });

  if (!code || !kindCode) return fallback("학교알리미 학교코드가 연결되지 않은 학교입니다.");
  if (!client) return fallback("학교알리미 연동이 설정되지 않았습니다. 저장된 자료를 표시합니다.");

  const entry = await prisma.schoolDirectoryEntry.findUnique({
    where: { source_externalCode: { source: "schoolinfo", externalCode: code } },
    select: { sidoCode: true },
  });

  try {
    const { rows, sourceUrl } = await client.fetch({
      apiType: API_TYPE_GRADE_CLASS_STUDENTS,
      schulKndCode: kindCode,
      sidoCode: entry?.sidoCode ?? undefined,
      pbanYr: params.disclosureYear,
    });
    const row = rows.find((r) => String(r.SCHUL_CODE ?? "").trim() === code);
    if (!row) return fallback("학교알리미 응답에 이 학교의 학년별 자료가 없습니다.");
    const parsed = parseGradeClassStudents(row, kindCode);
    const result = await saveSnapshot(prisma, {
      schoolId: school.id,
      dataset: DATASET_GRADE_CLASS,
      apiType: API_TYPE_GRADE_CLASS_STUDENTS,
      disclosureYear: params.disclosureYear ?? null,
      baseDate: parsed.baseDate,
      sourceUrl,
      payload: row,
      parsed: parsed as unknown as Prisma.InputJsonValue,
    });
    await prisma.school.update({ where: { id: school.id }, data: { infoSyncedAt: new Date() } });
    return { ...result, stale: false, warning: undefined as string | undefined };
  } catch (error) {
    if (error instanceof SchoolinfoError) return fallback(`${error.message} 저장된 자료를 표시합니다.`);
    throw error;
  }
}

export function latestSnapshot(prisma: PrismaClient, schoolId: string, dataset: string) {
  return prisma.schoolPublicDataSnapshot.findFirst({
    where: { schoolId, dataset },
    orderBy: { fetchedAt: "desc" },
  });
}

// 관리자 화면용: 공시자료(참고)와 현재 학급 구성(실제)을 나란히 보여 줍니다.
export async function getClassStructureProposal(prisma: PrismaClient, schoolId: string, schoolYear: number) {
  const snapshot = await latestSnapshot(prisma, schoolId, DATASET_GRADE_CLASS);
  const parsed = (snapshot?.parsed ?? null) as unknown as GradeClassStudents | null;
  const classes = await prisma.schoolClass.findMany({
    where: { schoolId, schoolYear },
    orderBy: [{ grade: "asc" }, { classNo: "asc" }],
  });
  const grades = (parsed?.grades ?? []).map((g) => {
    const existing = classes.filter((c) => c.grade === g.grade);
    return {
      grade: g.grade,
      publicClassCount: g.classCount,
      publicStudentCount: g.studentCount, // 학년 합계(참고용, 학급별로 나누지 않음)
      existingClassCount: existing.length,
      confirmedEnrolledSum: existing.reduce((sum, c) => sum + (c.enrolledConfirmedAt ? c.enrolledCount ?? 0 : 0), 0),
      unconfirmedClassCount: existing.filter((c) => !c.enrolledConfirmedAt).length,
    };
  });
  return {
    snapshot: snapshot
      ? {
          id: snapshot.id,
          source: snapshot.source,
          sourceUrl: snapshot.sourceUrl,
          disclosureYear: snapshot.disclosureYear,
          baseDate: snapshot.baseDate,
          fetchedAt: snapshot.fetchedAt,
        }
      : null,
    grades,
    classes,
  };
}

// 학급 '구조'만 만듭니다. 이미 있는 학급은 바꾸거나 지우지 않고, 재적은 비워 둡니다(관리자 확인 필요).
export async function applyClassStructure(
  prisma: PrismaClient,
  params: { schoolId: string; actorUserId: string; schoolYear: number; grades: { grade: number; classCount: number }[] },
) {
  for (const g of params.grades) {
    if (!Number.isInteger(g.grade) || g.grade < 1 || g.grade > 6) throw badRequest("학년은 1~6이어야 합니다.");
    if (!Number.isInteger(g.classCount) || g.classCount < 0 || g.classCount > 30) throw badRequest("학급 수는 0~30이어야 합니다.");
  }
  return prisma.$transaction(async (tx) => {
    const created: { grade: number; classNo: number }[] = [];
    for (const g of params.grades) {
      for (let classNo = 1; classNo <= g.classCount; classNo++) {
        const exists = await tx.schoolClass.findUnique({
          where: { schoolId_schoolYear_grade_classNo: { schoolId: params.schoolId, schoolYear: params.schoolYear, grade: g.grade, classNo } },
          select: { id: true },
        });
        if (exists) continue;
        await tx.schoolClass.create({
          data: {
            schoolId: params.schoolId,
            schoolYear: params.schoolYear,
            grade: g.grade,
            classNo,
            label: `${g.grade}학년 ${classNo}반`,
            origin: "schoolinfo",
            enrolledCount: null,
          },
        });
        created.push({ grade: g.grade, classNo });
      }
    }
    await writeAudit(tx, {
      schoolId: params.schoolId,
      actorUserId: params.actorUserId,
      action: "classes.apply_structure",
      targetType: "school",
      targetId: params.schoolId,
      after: { schoolYear: params.schoolYear, created },
    });
    return { created: created.length };
  });
}

// 관리자 일괄 재적 확인·수정(한 화면에서 여러 학급)
export async function confirmEnrollment(
  prisma: PrismaClient,
  params: { schoolId: string; actorUserId: string; items: { classId: string; enrolledCount: number }[] },
) {
  for (const item of params.items) {
    if (!Number.isInteger(item.enrolledCount) || item.enrolledCount < 0 || item.enrolledCount > 60) {
      throw badRequest("재적은 0~60 사이 정수여야 합니다.");
    }
  }
  return prisma.$transaction(async (tx) => {
    const ids = params.items.map((i) => i.classId);
    const classes = await tx.schoolClass.findMany({ where: { id: { in: ids }, schoolId: params.schoolId } });
    if (classes.length !== new Set(ids).size) throw notFound("이 학교의 학급이 아닌 항목이 있습니다.");
    const before = classes.map((c) => ({ id: c.id, enrolledCount: c.enrolledCount, confirmed: !!c.enrolledConfirmedAt }));
    const now = new Date();
    for (const item of params.items) {
      await tx.schoolClass.update({
        where: { id: item.classId },
        data: {
          enrolledCount: item.enrolledCount,
          enrolledSource: "manual",
          enrolledConfirmedAt: now,
          enrolledConfirmedById: params.actorUserId,
        },
      });
    }
    await writeAudit(tx, {
      schoolId: params.schoolId,
      actorUserId: params.actorUserId,
      action: "classes.confirm_enrollment",
      targetType: "school",
      targetId: params.schoolId,
      before,
      after: params.items,
    });
    return { updated: params.items.length };
  });
}
