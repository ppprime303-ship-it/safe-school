// Beta PILOT 2 Phase 3-C 현장 사진: 비공개 저장·권한 확인 후 서버가 직접 전달
//
// 원칙
// - 저장 위치: INCIDENT_UPLOAD_DIR(기본 ./data/incident-uploads, 웹 공개 폴더(dist/client) 밖, 저장소에서 제외). 정적 공개 경로 없음.
// - 파일 이름: 서버가 만든 임의 키(32자리 16진수 + 확장자). 원래 파일명·EXIF(위치·기기)는 저장하지 않음(sanitizeImage).
// - 제한: JPEG·PNG, 원본 5MB 이하, 제보당 3장(삭제 표시된 것 제외). 진행 중 사건에서만 첨부(종료와 경합 시 사건 잠금).
// - 첨부: 같은 학교 승인 교직원 / 열람: incident.photo / 삭제(삭제 표시 + 파일 제거): incident.manage
// - 감사 기록: 크기·형식만(사진 내용·해시·파일 키는 남기지 않음)
import { createHash, randomBytes } from "node:crypto";
import fs from "node:fs/promises";
import path from "node:path";
import type { PrismaClient } from "@prisma/client";
import { AppError, badRequest, conflict, notFound } from "../errors.js";
import { sanitizeImage } from "../images/sanitize.js";
import { writeAudit } from "./audit.js";
import { lockActiveEvent } from "./incidents.js";

export const PHOTO_MAX_BYTES = 5 * 1024 * 1024;
export const PHOTOS_PER_INCIDENT = 3;
const KEY_RE = /^[0-9a-f]{32}\.(jpg|png)$/;
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export function uploadDir(): string {
  return path.resolve(process.env.INCIDENT_UPLOAD_DIR ?? path.join(process.cwd(), "data", "incident-uploads"));
}
function filePath(key: string): string {
  if (!KEY_RE.test(key)) throw new Error("잘못된 저장 키");
  const dir = uploadDir();
  const p = path.resolve(dir, key);
  if (path.dirname(p) !== dir) throw new Error("저장 경로 이탈");
  return p;
}

/** base64 본문 → 원본 바이트(형식·크기 검사) */
export function decodePhoto(dataBase64: string): Buffer {
  if (typeof dataBase64 !== "string" || dataBase64.length === 0) throw badRequest("사진 데이터가 없습니다.");
  if (!/^[A-Za-z0-9+/]+={0,2}$/.test(dataBase64)) throw badRequest("사진 데이터 형식이 올바르지 않습니다.");
  if (Math.floor((dataBase64.length * 3) / 4) > PHOTO_MAX_BYTES + 3) throw new AppError(413, "photo_too_large", "사진은 5MB 이하만 올릴 수 있습니다.");
  const buf = Buffer.from(dataBase64, "base64");
  if (buf.length > PHOTO_MAX_BYTES) throw new AppError(413, "photo_too_large", "사진은 5MB 이하만 올릴 수 있습니다.");
  return buf;
}

async function loadIncident(prisma: PrismaClient, schoolId: string, incidentId: string) {
  if (!UUID_RE.test(incidentId)) throw notFound("제보를 찾을 수 없습니다.");
  const inc = await prisma.incidentReport.findFirst({ where: { id: incidentId, schoolId }, select: { id: true, eventId: true } });
  if (!inc) throw notFound("제보를 찾을 수 없습니다.");
  return inc;
}

export async function addIncidentPhoto(
  prisma: PrismaClient,
  params: { schoolId: string; incidentId: string; membershipId: string; actorUserId: string; dataBase64: string; ip?: string | null },
) {
  const inc = await loadIncident(prisma, params.schoolId, params.incidentId);
  const clean = sanitizeImage(decodePhoto(params.dataBase64));
  const key = `${randomBytes(16).toString("hex")}.${clean.ext}`;
  const dir = uploadDir();
  await fs.mkdir(dir, { recursive: true, mode: 0o700 });
  const target = filePath(key);
  const tmp = `${target}.part`;
  await fs.writeFile(tmp, clean.data, { mode: 0o600, flag: "wx" });
  await fs.rename(tmp, target);
  try {
    return await prisma.$transaction(async (tx) => {
      await lockActiveEvent(tx, params.schoolId, inc.eventId);
      // 제보 행 잠금으로 장수 제한을 순서대로 검사(동시 첨부)
      await tx.$queryRaw`SELECT 1 AS locked FROM "incident_reports" WHERE "id" = ${inc.id}::uuid FOR UPDATE`;
      const count = await tx.incidentAttachment.count({ where: { incidentId: inc.id, deletedAt: null } });
      if (count >= PHOTOS_PER_INCIDENT) throw conflict("photo_limit", `사진은 제보당 ${PHOTOS_PER_INCIDENT}장까지 올릴 수 있습니다.`);
      const row = await tx.incidentAttachment.create({
        data: {
          incidentId: inc.id,
          schoolId: params.schoolId,
          uploaderMembershipId: params.membershipId,
          storageKey: key,
          mimeType: clean.mimeType,
          sizeBytes: clean.data.length,
          sha256: createHash("sha256").update(clean.data).digest("hex"),
        },
        select: { id: true, createdAt: true },
      });
      await tx.incidentReport.update({ where: { id: inc.id }, data: { lastActivityAt: row.createdAt } });
      await writeAudit(tx, {
        schoolId: params.schoolId,
        actorUserId: params.actorUserId,
        action: "incident.photo_added",
        targetType: "incident_report",
        targetId: inc.id,
        after: { mimeType: clean.mimeType, sizeBytes: clean.data.length },
        ip: params.ip,
      });
      return { id: row.id, mimeType: clean.mimeType, sizeBytes: clean.data.length };
    });
  } catch (error) {
    await fs.rm(target, { force: true }); // 기록이 없으면 파일도 남기지 않음
    throw error;
  }
}

/** 열람(incident.photo — 라우트에서 검사). 같은 학교·제보의 삭제되지 않은 사진만 */
export async function readIncidentPhoto(prisma: PrismaClient, params: { schoolId: string; incidentId: string; photoId: string }) {
  const inc = await loadIncident(prisma, params.schoolId, params.incidentId);
  if (!UUID_RE.test(params.photoId)) throw notFound("사진을 찾을 수 없습니다.");
  const row = await prisma.incidentAttachment.findFirst({ where: { id: params.photoId, incidentId: inc.id, schoolId: params.schoolId, deletedAt: null } });
  if (!row) throw notFound("사진을 찾을 수 없습니다.");
  const data = await fs.readFile(filePath(row.storageKey)).catch(() => null);
  if (!data) throw notFound("사진 파일을 찾을 수 없습니다.");
  return { mimeType: row.mimeType, data };
}

/** 삭제(incident.manage): 삭제 표시 후 파일 제거. 종료된 사건에서도 가능(개인정보가 찍힌 사진 정리용) */
export async function deleteIncidentPhoto(prisma: PrismaClient, params: { schoolId: string; incidentId: string; photoId: string; membershipId: string; actorUserId: string; ip?: string | null }) {
  const inc = await loadIncident(prisma, params.schoolId, params.incidentId);
  if (!UUID_RE.test(params.photoId)) throw notFound("사진을 찾을 수 없습니다.");
  const row = await prisma.incidentAttachment.findFirst({ where: { id: params.photoId, incidentId: inc.id, schoolId: params.schoolId } });
  if (!row) throw notFound("사진을 찾을 수 없습니다.");
  await prisma.$transaction(async (tx) => {
    const r = await tx.incidentAttachment.updateMany({ where: { id: row.id, deletedAt: null }, data: { deletedAt: new Date(), deletedByMembershipId: params.membershipId } });
    if (r.count !== 1) throw conflict("photo_deleted", "이미 삭제된 사진입니다.");
    await writeAudit(tx, { schoolId: params.schoolId, actorUserId: params.actorUserId, action: "incident.photo_deleted", targetType: "incident_report", targetId: inc.id, ip: params.ip });
  });
  await fs.rm(filePath(row.storageKey), { force: true });
  return { deleted: true };
}
