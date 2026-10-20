// 학교 검색: 학교알리미 학교기본정보(apiType 0)를 DB 목록(school_directory_entries)에 저장해 두고 검색합니다.
// - 공식 API에는 '학교명 검색' 인자가 없어서, 학교급·시도 단위로 받아 저장한 뒤 이름으로 거릅니다.
// - API 장애나 인증키 미설정 시에는 마지막으로 저장된 목록으로 검색합니다(stale 표시).
import type { Prisma, PrismaClient } from "@prisma/client";
import {
  API_TYPE_BASIC_INFO,
  parseBasicInfo,
  SchoolinfoError,
  type SchoolinfoClient,
} from "../integrations/schoolinfo.js";

export const DIRECTORY_MAX_AGE_MS = 7 * 24 * 60 * 60 * 1000; // 7일

export async function syncDirectory(
  prisma: PrismaClient,
  client: SchoolinfoClient,
  scope: { kindCode: string; sidoCode?: string },
): Promise<{ upserted: number; skipped: number }> {
  const { rows } = await client.fetch({
    apiType: API_TYPE_BASIC_INFO,
    schulKndCode: scope.kindCode,
    sidoCode: scope.sidoCode,
  });

  let upserted = 0;
  let skipped = 0;
  const now = new Date();
  for (const row of rows) {
    const info = parseBasicInfo(row);
    if (!info) {
      skipped++;
      continue;
    }
    const data = {
      name: info.name,
      kindCode: info.kindCode ?? scope.kindCode,
      sidoCode: scope.sidoCode ?? null,
      eduOfficeName: info.eduOfficeName,
      address: info.address,
      closed: info.closed,
      raw: row as Prisma.InputJsonValue,
      syncedAt: now,
    };
    await prisma.schoolDirectoryEntry.upsert({
      where: { source_externalCode: { source: "schoolinfo", externalCode: info.externalCode } },
      update: data,
      create: { source: "schoolinfo", externalCode: info.externalCode, ...data },
    });
    upserted++;
  }
  return { upserted, skipped };
}

export interface DirectorySearchResult {
  externalCode: string;
  name: string;
  kindCode: string | null;
  eduOfficeName: string | null;
  address: string | null;
  registeredSchool: { id: string; status: string } | null;
}

export async function searchDirectory(
  prisma: PrismaClient,
  client: SchoolinfoClient | null,
  params: { q: string; kindCode: string; sidoCode?: string },
): Promise<{ results: DirectorySearchResult[]; stale: boolean; syncedAt: Date | null; warning?: string }> {
  const scopeWhere = { source: "schoolinfo" as const, kindCode: params.kindCode, ...(params.sidoCode ? { sidoCode: params.sidoCode } : {}) };

  // 1) 저장된 목록이 없거나 오래됐으면 새로 받기를 시도
  const newest = await prisma.schoolDirectoryEntry.findFirst({ where: scopeWhere, orderBy: { syncedAt: "desc" }, select: { syncedAt: true } });
  let stale = !newest || Date.now() - newest.syncedAt.getTime() > DIRECTORY_MAX_AGE_MS;
  let warning: string | undefined;
  let syncedAt = newest?.syncedAt ?? null;
  if (stale && client) {
    try {
      await syncDirectory(prisma, client, { kindCode: params.kindCode, sidoCode: params.sidoCode });
      stale = false;
      syncedAt = new Date();
    } catch (error) {
      // 2) 실패하면 기존 목록으로 계속(장애 대응)
      warning =
        error instanceof SchoolinfoError
          ? `${error.message} 저장된 목록으로 검색합니다.`
          : "학교 목록을 새로 받지 못해 저장된 목록으로 검색합니다.";
    }
  } else if (stale && !client) {
    warning = "학교알리미 연동이 설정되지 않아 저장된 목록으로 검색합니다.";
  }

  const q = params.q.replace(/\s+/g, "");
  if (q.length < 2) return { results: [], stale, syncedAt, warning };

  const entries = await prisma.schoolDirectoryEntry.findMany({
    where: { ...scopeWhere, closed: false, name: { contains: q } },
    orderBy: { name: "asc" },
    take: 30,
  });

  const links = await prisma.schoolExternalId.findMany({
    where: { source: "schoolinfo", externalCode: { in: entries.map((e) => e.externalCode) } },
    include: { school: { select: { id: true, status: true } } },
  });
  const byCode = new Map(links.map((l) => [l.externalCode, l.school]));

  return {
    results: entries.map((e) => ({
      externalCode: e.externalCode,
      name: e.name,
      kindCode: e.kindCode,
      eduOfficeName: e.eduOfficeName,
      address: e.address,
      registeredSchool: byCode.get(e.externalCode) ?? null,
    })),
    stale,
    syncedAt,
    warning,
  };
}
