// 테스트 전용 DB 주소: 운영·개발 데이터와 분리하기 위해 같은 DB 안의 별도 스키마(safeschool_test)를 씁니다.
// TEST_DATABASE_URL 을 직접 지정할 수도 있습니다. 스키마 이름에 'test'가 없으면 실행을 거부합니다.
import { PrismaClient } from "@prisma/client";

export function getTestDatabaseUrl(): string {
  const explicit = process.env.TEST_DATABASE_URL;
  const base = explicit ?? process.env.DATABASE_URL;
  if (!base) throw new Error("DATABASE_URL 또는 TEST_DATABASE_URL 이 필요합니다.");

  const url = new URL(base);
  if (!explicit) url.searchParams.set("schema", "safeschool_test");
  const schema = url.searchParams.get("schema") ?? "public";
  if (!schema.includes("test")) {
    throw new Error(`테스트 스키마 이름에 'test'가 없습니다(${schema}). 실제 데이터 보호를 위해 중단합니다.`);
  }
  return url.toString();
}

export function createTestClient() {
  return new PrismaClient({ datasourceUrl: getTestDatabaseUrl() });
}

// 테스트 스키마의 데이터만 비웁니다(마이그레이션 기록은 유지). 운영 스키마는 건드리지 않습니다.
export async function resetTestData(prisma: PrismaClient) {
  const schemaRows = await prisma.$queryRaw<{ schema: string }[]>`SELECT current_schema() AS schema`;
  const schema = schemaRows[0]?.schema ?? "";
  if (!schema.includes("test")) throw new Error(`현재 스키마(${schema})가 테스트용이 아닙니다.`);

  const tables = await prisma.$queryRaw<{ tablename: string }[]>`
    SELECT tablename FROM pg_tables WHERE schemaname = current_schema() AND tablename <> '_prisma_migrations'`;
  if (tables.length === 0) return;
  const list = tables.map((t) => `"${schema}"."${t.tablename}"`).join(", ");
  await prisma.$executeRawUnsafe(`TRUNCATE TABLE ${list} CASCADE`);
}
