// 학교 검색 목록 미리 받기(선택): npm run directory:sync -- --kind 02 [--sido 41] [--sgg 41110]
// 검색 때 자동으로도 받지만, 미리 받아 두면 첫 검색이 빠르고 API 장애 때도 검색할 수 있습니다.
// STEP A: --sgg 는 시군구 단위(5자리, shared/schoolinfoRegions.ts). SCHOOLINFO_SGG_REQUIRED=true(시군구 필수 인증키)에서
//         --sido 만 주면 그 시도의 시군구를 하나씩 차례로 받습니다(호출 사이 1초 쉼).
import { PrismaClient } from "@prisma/client";
import { createSchoolinfoClient, SCHOOL_KIND_CODES } from "../server/src/integrations/schoolinfo.js";
import { isSggRequired, syncDirectory } from "../server/src/services/schoolDirectory.js";
import { sggOf } from "../shared/schoolinfoRegions.js";

const prisma = new PrismaClient();

function flag(name: string): string | undefined {
  const i = process.argv.indexOf(`--${name}`);
  return i >= 0 ? process.argv[i + 1] : undefined;
}

async function main() {
  const kind = flag("kind") ?? "02";
  const sido = flag("sido");
  const sgg = flag("sgg");
  if (!(kind in SCHOOL_KIND_CODES)) throw new Error("--kind 는 02(초) 03(중) 04(고) 05(특수) 06 07 중 하나");
  if (!process.env.SCHOOLINFO_API_KEY) throw new Error("SCHOOLINFO_API_KEY 를 환경변수에 넣어 주세요.");
  const client = createSchoolinfoClient({ apiKey: process.env.SCHOOLINFO_API_KEY, timeoutMs: 60000 });

  const scopes: { sidoCode?: string; sggCode?: string }[] = sgg
    ? [{ sggCode: sgg }]
    : sido && isSggRequired()
      ? sggOf(sido).map(([code]) => ({ sggCode: code }))
      : [{ sidoCode: sido }];
  if (scopes.length === 0) throw new Error(`시도 코드 ${sido} 의 시군구가 공식 코드표에 없습니다.`);

  let upserted = 0;
  let skipped = 0;
  for (const [i, scope] of scopes.entries()) {
    if (i > 0) await new Promise((r) => setTimeout(r, 1000)); // 연속 호출 간격
    const result = await syncDirectory(prisma, client, { kindCode: kind, ...scope });
    upserted += result.upserted;
    skipped += result.skipped;
  }
  const total = await prisma.schoolDirectoryEntry.count({ where: { kindCode: kind } });
  console.log(`[directory] 범위 ${scopes.length}개, 저장 ${upserted}건, 건너뜀 ${skipped}건 / 현재 학교급 ${kind} 목록 ${total}건`);
}

main()
  .catch((error) => {
    console.error("[directory] 실패:", error instanceof Error ? error.message : error);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
