// 학교 검색: 학교알리미 학교기본정보(apiType 0)를 DB 목록(school_directory_entries)에 저장해 두고 검색합니다.
// - 공식 API에는 '학교명 검색' 인자가 없어서, 학교급·시도 단위로 받아 저장한 뒤 이름으로 거릅니다.
// - API 장애나 인증키 미설정 시에는 마지막으로 저장된 목록으로 검색합니다(stale 표시).
// - STEP A: 시군구(sggCode, 5자리)를 주면 그 시군구 단위로 받고 최신 여부도 그 단위로 판단합니다.
//   SCHOOLINFO_SGG_REQUIRED=true(시군구가 필수인 인증키)면 시군구 없는 요청은 API를 부르지 않고 저장된 목록으로만 검색합니다.
import type { Prisma, PrismaClient } from "@prisma/client";
import {
  API_TYPE_BASIC_INFO,
  inspectFields,
  parseBasicInfo,
  REQUIRED_BASIC_FIELDS,
  SchoolinfoError,
  type SchoolinfoClient,
  type SchoolinfoRow,
} from "../integrations/schoolinfo.js";
import { isSggCode } from "../../../shared/schoolinfoRegions.js";

export const DIRECTORY_MAX_AGE_MS = 7 * 24 * 60 * 60 * 1000; // 7일

// 2026-07-01 전남광주통합특별시(12) 출범 전 코드로 저장된 목록 행. 지우거나 고치지 않고, 12로 검색할 때 함께 보여 줍니다(읽기만).
// API 요청 코드는 공식 코드표(shared/schoolinfoRegions.ts)를 따르고, 예전 코드 요청을 막지도 않습니다(제공기관 응답으로 판단).
export const LEGACY_SIDO_FOR: Record<string, string[]> = { "12": ["29", "46"] };

// 2026-07-01 인천 행정구역 개편(중구·동구 → 제물포구·영종구, 서구 → 서해구·검단구) 전 시군구 코드.
// 2026-11-04 실제 응답: 학교알리미는 일부 학교를 아직 예전 코드로만 제공합니다
// (예: 인천신검단초등학교 — 주소는 검단구인데 sggCode=28260(서구)로만 조회됨, 28290·28275 목록에는 없음).
// 새 시군구 목록을 받을 때 예전 코드 목록도 함께 받아 저장하고, 새 코드로 검색할 때 함께 보여 줍니다.
// 예전 코드는 공식 코드표에 없으므로 사용자가 직접 요청할 수는 없고, 여기서만 보조로 부릅니다.
export const LEGACY_SGG_FOR: Record<string, string[]> = {
  "28125": ["28110", "28140"], // 제물포구 ← 중구·동구
  "28155": ["28110"], // 영종구 ← 중구
  "28275": ["28260"], // 서해구 ← 서구
  "28290": ["28260"], // 검단구 ← 서구
};

/** 시군구 코드가 필수인 인증키(공식 페이지는 '선택' — 발급받은 키 조건에 따라 운영자가 켬) */
export const isSggRequired = () => process.env.SCHOOLINFO_SGG_REQUIRED === "true";

export async function syncDirectory(
  prisma: PrismaClient,
  client: SchoolinfoClient,
  scope: { kindCode: string; sidoCode?: string; sggCode?: string },
): Promise<{ upserted: number; skipped: number }> {
  if (scope.sggCode !== undefined && !isSggCode(scope.sggCode)) {
    throw new SchoolinfoError(`학교알리미 시군구 코드가 공식 코드표에 없습니다(${scope.sggCode.slice(0, 10)}).`, "params");
  }
  if (!scope.sggCode && isSggRequired()) {
    throw new SchoolinfoError("이 학교알리미 인증키는 시군구를 지정해야 목록을 받을 수 있습니다.", "params");
  }
  const sidoCode = scope.sggCode ? scope.sggCode.slice(0, 2) : scope.sidoCode;
  const { rows } = await client.fetch({
    apiType: API_TYPE_BASIC_INFO,
    schulKndCode: scope.kindCode,
    sidoCode,
    sggCode: scope.sggCode,
  });

  // 기대한 필드가 없는 응답(명세 변경 등)은 저장하지 않고 형식 오류로 멈춥니다(기존 목록 보존).
  if (rows.length > 0) {
    const { missing } = inspectFields(rows, REQUIRED_BASIC_FIELDS);
    if (missing.length > 0) {
      throw new SchoolinfoError(`학교알리미 응답 형식이 예상과 다릅니다(없는 필드: ${missing.join(", ")}).`, "format");
    }
  }

  let upserted = 0;
  let skipped = 0;
  const now = new Date();
  const seen = new Set<string>();
  for (const row of rows) {
    const info = parseBasicInfo(row);
    if (!info) {
      skipped++;
      continue;
    }
    seen.add(info.externalCode);
    await upsertEntry(prisma, info, row, { kindCode: scope.kindCode, sidoCode: sidoCode ?? null, sggCode: scope.sggCode ?? null, now });
    upserted++;
  }

  // 개편 전 시군구 코드 목록(보조). 실패해도 새 코드 목록은 이미 저장됐으므로 무시합니다(예: '데이터가 존재하지 않습니다').
  for (const legacySgg of scope.sggCode ? (LEGACY_SGG_FOR[scope.sggCode] ?? []) : []) {
    let legacyRows: SchoolinfoRow[];
    try {
      ({ rows: legacyRows } = await client.fetch({ apiType: API_TYPE_BASIC_INFO, schulKndCode: scope.kindCode, sidoCode, sggCode: legacySgg }));
    } catch {
      continue;
    }
    if (legacyRows.length > 0 && inspectFields(legacyRows, REQUIRED_BASIC_FIELDS).missing.length > 0) continue;
    for (const row of legacyRows) {
      const info = parseBasicInfo(row);
      if (!info) {
        skipped++;
        continue;
      }
      if (seen.has(info.externalCode)) continue; // 새 코드 목록에도 있으면 새 코드가 우선
      // 이미 공식(새) 시군구 코드로 저장된 학교는 예전 코드로 덮어쓰지 않습니다(중구처럼 둘로 나뉜 지역의 번갈아 바뀜 방지).
      const existing = await prisma.schoolDirectoryEntry.findUnique({
        where: { source_externalCode: { source: "schoolinfo", externalCode: info.externalCode } },
        select: { sggCode: true },
      });
      if (existing?.sggCode && isSggCode(existing.sggCode)) continue;
      seen.add(info.externalCode);
      await upsertEntry(prisma, info, row, { kindCode: scope.kindCode, sidoCode: sidoCode ?? null, sggCode: legacySgg, now });
      upserted++;
    }
  }
  return { upserted, skipped };
}

async function upsertEntry(
  prisma: PrismaClient,
  info: NonNullable<ReturnType<typeof parseBasicInfo>>,
  row: SchoolinfoRow,
  at: { kindCode: string; sidoCode: string | null; sggCode: string | null; now: Date },
) {
  const data = {
    name: info.name,
    kindCode: info.kindCode ?? at.kindCode,
    sidoCode: at.sidoCode,
    sggCode: at.sggCode,
    eduOfficeName: info.eduOfficeName,
    address: info.address,
    closed: info.closed,
    raw: row as Prisma.InputJsonValue,
    syncedAt: at.now,
  };
  await prisma.schoolDirectoryEntry.upsert({
    where: { source_externalCode: { source: "schoolinfo", externalCode: info.externalCode } },
    update: data,
    create: { source: "schoolinfo", externalCode: info.externalCode, ...data },
  });
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
  params: { q: string; kindCode: string; sidoCode?: string; sggCode?: string },
): Promise<{
  results: DirectorySearchResult[];
  stale: boolean;
  syncedAt: Date | null;
  warning?: string;
  /** STEP B: 화면 표시용 — 출처, 시군구 필수 키 여부, 이번 검색에서 새로 받기를 시도했다 실패했는지 */
  source: "schoolinfo";
  sggRequired: boolean;
  refreshFailed: boolean;
}> {
  // 시군구를 주면 그 시군구에서 받은 목록만으로 최신 여부를 판단하고 검색합니다.
  const scopeWhere = {
    source: "schoolinfo" as const,
    kindCode: params.kindCode,
    ...(params.sggCode ? { sggCode: params.sggCode } : params.sidoCode ? { sidoCode: params.sidoCode } : {}),
  };

  // 검색 범위: 통합 시도(12)면 예전 코드(29·46) 행도 포함(최신 여부 판단에는 넣지 않음)
  const legacy = !params.sggCode && params.sidoCode ? LEGACY_SIDO_FOR[params.sidoCode] : undefined;
  // 개편된 시군구(예: 검단구 28290)면 예전 시군구 코드(서구 28260)로 받은 행도 포함(최신 여부 판단에는 넣지 않음)
  const legacySgg = params.sggCode ? LEGACY_SGG_FOR[params.sggCode] : undefined;
  const searchWhere = legacy
    ? { ...scopeWhere, sidoCode: { in: [params.sidoCode!, ...legacy] } }
    : legacySgg
      ? { ...scopeWhere, sggCode: { in: [params.sggCode!, ...legacySgg] } }
      : scopeWhere;

  // 1) 저장된 목록이 없거나 오래됐으면 새로 받기를 시도
  const newest = await prisma.schoolDirectoryEntry.findFirst({ where: scopeWhere, orderBy: { syncedAt: "desc" }, select: { syncedAt: true } });
  let stale = !newest || Date.now() - newest.syncedAt.getTime() > DIRECTORY_MAX_AGE_MS;
  let warning: string | undefined;
  let refreshFailed = false;
  let syncedAt = newest?.syncedAt ?? null;
  if (stale && client && !params.sggCode && isSggRequired()) {
    warning = "학교 목록을 새로 받으려면 시군구를 선택하세요. 지금은 저장된 목록으로 검색합니다.";
  } else if (stale && client) {
    try {
      await syncDirectory(prisma, client, { kindCode: params.kindCode, sidoCode: params.sidoCode, sggCode: params.sggCode });
      stale = false;
      syncedAt = new Date();
    } catch (error) {
      // 2) 실패하면 기존 목록으로 계속(장애 대응)
      refreshFailed = true;
      warning =
        error instanceof SchoolinfoError && error.kind === "params" && !params.sggCode
          ? "이 학교알리미 인증키는 시군구를 지정해야 목록을 받을 수 있습니다. 시군구를 선택하세요. 지금은 저장된 목록으로 검색합니다."
          : error instanceof SchoolinfoError
          ? `${error.message} 저장된 목록으로 검색합니다.`
          : "학교 목록을 새로 받지 못해 저장된 목록으로 검색합니다.";
    }
  } else if (stale && !client) {
    warning = "학교알리미 연동이 설정되지 않아 저장된 목록으로 검색합니다.";
  } else if (client && !params.sggCode && isSggRequired()) {
    // 시군구 필수 인증키: 시군구 없이 검색하면 지금까지 받아 둔 시군구 목록에서만 찾으므로, 최신이어도 안내합니다.
    warning = "시군구를 선택하지 않으면 지금까지 받아 둔 목록에서만 찾습니다. 학교가 보이지 않으면 시군구를 선택해 다시 검색하세요.";
  }

  const q = params.q.replace(/\s+/g, "");
  const meta = { source: "schoolinfo" as const, sggRequired: isSggRequired(), refreshFailed };
  if (q.length < 2) return { results: [], stale, syncedAt, warning, ...meta };

  const entries = await prisma.schoolDirectoryEntry.findMany({
    where: { ...searchWhere, closed: false, name: { contains: q } },
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
    ...meta,
  };
}
