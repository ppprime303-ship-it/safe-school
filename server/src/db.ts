import { PrismaClient } from "@prisma/client";

// 서버 전체에서 DB 연결 하나를 같이 씁니다.
export const prisma = new PrismaClient({
  log: process.env.NODE_ENV === "production" ? ["error"] : ["warn", "error"],
});
