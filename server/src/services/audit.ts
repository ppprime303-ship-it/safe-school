import type { Prisma, PrismaClient } from "@prisma/client";

type Db = PrismaClient | Prisma.TransactionClient;

// 감사 로그: 업무 처리와 같은 트랜잭션에서 기록합니다(추가만 가능).
export async function writeAudit(
  db: Db,
  entry: {
    schoolId?: string | null;
    actorUserId?: string | null;
    action: string;
    targetType?: string;
    targetId?: string;
    before?: Prisma.InputJsonValue;
    after?: Prisma.InputJsonValue;
    ip?: string | null;
  },
) {
  await db.auditLog.create({
    data: {
      schoolId: entry.schoolId ?? null,
      actorUserId: entry.actorUserId ?? null,
      action: entry.action,
      targetType: entry.targetType,
      targetId: entry.targetId,
      before: entry.before,
      after: entry.after,
      ip: entry.ip ?? null,
    },
  });
}
