// 학교 검색 목록 미리 받기(선택): npm run directory:sync -- --kind 02 [--sido 41]
// 검색 때 자동으로도 받지만, 미리 받아 두면 첫 검색이 빠르고 API 장애 때도 검색할 수 있습니다.
import { PrismaClient } from "@prisma/client";
import { createSchoolinfoClient, SCHOOL_KIND_CODES } from "../server/src/integrations/schoolinfo.js";
import { syncDirectory } from "../server/src/services/schoolDirectory.js";

const prisma = new PrismaClient();

function flag(name: string): string | undefined {
  const i = process.argv.indexOf(`--${name}`);
  return i >= 0 ? process.argv[i + 1] : undefined;
}

async function main() {
  const kind = flag("kind") ?? "02";
  const sido = flag("sido");
  if (!(kind in SCHOOL_KIND_CODES)) throw new Error("--kind 는 02(초) 03(중) 04(고) 05(특수) 06 07 중 하나");
  if (!process.env.SCHOOLINFO_API_KEY) throw new Error("SCHOOLINFO_API_KEY 를 Replit Secrets에 넣어 주세요.");
  const client = createSchoolinfoClient({ apiKey: process.env.SCHOOLINFO_API_KEY, timeoutMs: 60000 });
  const result = await syncDirectory(prisma, client, { kindCode: kind, sidoCode: sido });
  const total = await prisma.schoolDirectoryEntry.count({ where: { kindCode: kind } });
  console.log(`[directory] 저장 ${result.upserted}건, 건너뜀 ${result.skipped}건 / 현재 학교급 ${kind} 목록 ${total}건`);
}

main()
  .catch((error) => {
    console.error("[directory] 실패:", error instanceof Error ? error.message : error);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
