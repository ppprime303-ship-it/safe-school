// 개인정보 삭제 미리보기(읽기 전용). 건수와 참조 관계만 보여 주고 어떤 행도 바꾸지 않습니다. 삭제 실행 기능은 없습니다.
// - 참조 관계는 DB 카탈로그에서 읽어 스키마가 바뀌어도 빠지지 않게 합니다. 모든 조회는 읽기 전용 트랜잭션입니다.
// - 보유기간을 코드에 두지 않습니다(법정·기록물 기준 미확정, docs/beta2/release/privacy-policy-draft.md).
import fs from "node:fs";
import path from "node:path";
import type { PrismaClient } from "@prisma/client";

export type ReferenceAction = "cascade" | "set_null" | "blocked";

export interface UserReference {
  table: string;
  column: string;
  rows: number;
  action: ReferenceAction; // 사용자 행 삭제 시 DB 동작. blocked 는 삭제가 막힘
  deleteGuarded: boolean; // 삭제 금지 트리거가 있는 표
}

export interface UserDeletionPreview {
  userFound: boolean;
  references: UserReference[];
  blockedRows: number;
  executable: false;
  notes: string[];
}

export interface EnvironmentDisposalPreview {
  database: string;
  tables: { table: string; rows: number }[];
  totalRows: number;
  schools: { demo: number; nonDemo: number };
  uploadFiles: number | null;
  blockers: string[];
  executable: false;
}

type Tx = Pick<PrismaClient, "$queryRawUnsafe" | "$executeRawUnsafe" | "$queryRaw">;
const readOnly = <T>(prisma: PrismaClient, fn: (tx: Tx) => Promise<T>) =>
  prisma.$transaction(async (tx) => {
    await tx.$executeRawUnsafe("SET TRANSACTION READ ONLY");
    return fn(tx as unknown as Tx);
  });

/** 개인 계정: 이 사용자를 가리키는 모든 외래키와 건수 */
export async function previewUserDeletion(prisma: PrismaClient, userId: string): Promise<UserDeletionPreview> {
  if (!/^[0-9a-f-]{36}$/i.test(userId)) throw new Error("사용자 ID 형식이 아닙니다.");
  return readOnly(prisma, async (tx) => {
    const found = await tx.$queryRawUnsafe<{ n: bigint }[]>(`SELECT count(*) AS n FROM users WHERE id = $1::uuid`, userId);
    const fks = await tx.$queryRawUnsafe<{ tbl: string; col: string; del: string; guarded: boolean }[]>(`
      SELECT c.conrelid::regclass::text AS tbl, quote_ident(a.attname) AS col, c.confdeltype::text AS del,
        EXISTS (SELECT 1 FROM pg_trigger t WHERE t.tgrelid = c.conrelid AND NOT t.tgisinternal AND t.tgtype & 8 = 8) AS guarded
      FROM pg_constraint c JOIN pg_attribute a ON a.attrelid = c.conrelid AND a.attnum = c.conkey[1]
      WHERE c.contype = 'f' AND c.confrelid = 'users'::regclass ORDER BY 1, 2`);
    const references: UserReference[] = [];
    for (const fk of fks) {
      // 표·열 이름은 위 카탈로그 조회의 regclass·quote_ident 결과입니다
      const r = await tx.$queryRawUnsafe<{ n: bigint }[]>(`SELECT count(*) AS n FROM ${fk.tbl} WHERE ${fk.col} = $1::uuid`, userId);
      references.push({ table: fk.tbl, column: fk.col, rows: Number(r[0]!.n), action: fk.del === "c" ? "cascade" : fk.del === "n" ? "set_null" : "blocked", deleteGuarded: fk.guarded });
    }
    return {
      userFound: Number(found[0]!.n) > 0,
      references,
      blockedRows: references.filter((x) => x.action === "blocked").reduce((s, x) => s + x.rows, 0),
      executable: false as const,
      notes: [
        "보고서 스냅숏(JSON)의 이름과 감사 기록 원문은 외래키로 잡히지 않습니다. 처리 방식은 학교·교육청 결정 대기입니다.",
        "참조가 막힌 행이 있으면 행 삭제가 아니라 가명 처리 설계가 필요합니다(privacy-deletion-design.md 4절).",
      ],
    };
  });
}

/** Beta 시험 환경 전체 폐기: 표별 건수, 실제 학교 존재 여부, 사진 파일 수 */
export async function previewEnvironmentDisposal(prisma: PrismaClient, env: Record<string, string | undefined> = process.env): Promise<EnvironmentDisposalPreview> {
  const result = await readOnly(prisma, async (tx) => {
    const db = await tx.$queryRawUnsafe<{ d: string }[]>(`SELECT current_database() AS d`);
    const names = await tx.$queryRawUnsafe<{ t: string }[]>(`SELECT quote_ident(tablename) AS t FROM pg_tables WHERE schemaname = current_schema() AND tablename <> '_prisma_migrations' ORDER BY 1`);
    const tables: { table: string; rows: number }[] = [];
    for (const { t } of names) {
      const r = await tx.$queryRawUnsafe<{ n: bigint }[]>(`SELECT count(*) AS n FROM ${t}`);
      tables.push({ table: t, rows: Number(r[0]!.n) });
    }
    const s = await tx.$queryRawUnsafe<{ demo: bigint; other: bigint }[]>(`SELECT count(*) FILTER (WHERE is_demo) AS demo, count(*) FILTER (WHERE NOT is_demo) AS other FROM schools`);
    return { database: db[0]!.d, tables, demo: Number(s[0]!.demo), nonDemo: Number(s[0]!.other) };
  });
  const dir = env.INCIDENT_UPLOAD_DIR?.trim();
  let uploadFiles: number | null = null;
  if (dir && fs.existsSync(dir)) {
    uploadFiles = (fs.readdirSync(dir, { recursive: true, withFileTypes: true }) as fs.Dirent[]).filter((e) => e.isFile()).length;
  }
  const blockers: string[] = [];
  if (result.nonDemo > 0) blockers.push(`가상 학교가 아닌 학교 ${result.nonDemo}곳: 공식 기록물일 수 있어 폐기 대상이 아닙니다.`);
  if (env.BETA_DATA_MODE?.trim() !== "virtual_test") blockers.push("BETA_DATA_MODE=virtual_test 환경이 아닙니다.");
  if (dir && uploadFiles === null) blockers.push(`사진 폴더를 확인할 수 없습니다: ${path.basename(dir)}`);
  return {
    database: result.database,
    tables: result.tables,
    totalRows: result.tables.reduce((s, x) => s + x.rows, 0),
    schools: { demo: result.demo, nonDemo: result.nonDemo },
    uploadFiles,
    blockers,
    executable: false,
  };
}
