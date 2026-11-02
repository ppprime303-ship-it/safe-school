// 개인정보 삭제 미리보기(읽기 전용, 삭제 기능 없음).
//   npx tsx scripts/privacy-preview.ts --confirm-db <DB이름> --user <사용자ID>   개인 계정 참조 관계·건수
//   npx tsx scripts/privacy-preview.ts --confirm-db <DB이름> --environment       시험 환경 전체 건수·폐기 차단 사유
// 이메일·이름 등 값은 출력하지 않고 건수만 보여 줍니다. 대상 DB 이름이 일치하지 않으면 멈춥니다.
import { PrismaClient } from "@prisma/client";
import { previewEnvironmentDisposal, previewUserDeletion } from "../server/src/services/privacyPreview.js";

const flag = (name: string) => {
  const i = process.argv.indexOf(`--${name}`);
  return i >= 0 ? process.argv[i + 1] : undefined;
};

async function main() {
  const url = new URL(process.env.DATABASE_URL ?? "http://invalid");
  const db = decodeURIComponent(url.pathname.slice(1));
  if (!db || flag("confirm-db") !== db) throw new Error("--confirm-db 값이 연결된 DB 이름과 일치해야 합니다. 조회하지 않았습니다.");
  if (process.argv.includes("--execute")) throw new Error("삭제 실행 기능은 없습니다. 조회하지 않았습니다.");
  const prisma = new PrismaClient();
  try {
    const user = flag("user");
    if (user) {
      const p = await previewUserDeletion(prisma, user);
      console.log(`[계정 미리보기] DB ${db} · 사용자 ${p.userFound ? "있음" : "없음"} · 삭제가 막히는 참조 ${p.blockedRows}행 · 실행 불가(미구현)`);
      for (const r of p.references.filter((x) => x.rows > 0)) console.log(`  ${r.table}.${r.column}: ${r.rows}행 · ${r.action}${r.deleteGuarded ? " · 삭제 금지 트리거" : ""}`);
      for (const n of p.notes) console.log(`  참고: ${n}`);
    } else if (process.argv.includes("--environment")) {
      const p = await previewEnvironmentDisposal(prisma);
      console.log(`[환경 폐기 미리보기] DB ${p.database} · 총 ${p.totalRows}행 · 가상 학교 ${p.schools.demo}, 그 밖의 학교 ${p.schools.nonDemo} · 사진 파일 ${p.uploadFiles ?? "확인 안 됨"} · 실행 불가(미구현)`);
      for (const t of p.tables.filter((x) => x.rows > 0)) console.log(`  ${t.table}: ${t.rows}`);
      for (const b of p.blockers) console.log(`  차단: ${b}`);
    } else {
      throw new Error("--user <ID> 또는 --environment 를 지정하세요.");
    }
  } finally {
    await prisma.$disconnect();
  }
}

main().catch((e: Error) => {
  console.error(`[중단] ${e.message}`);
  process.exitCode = 1;
});
