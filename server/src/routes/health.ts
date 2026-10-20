import { Router } from "express";
import { prisma } from "../db.js";

// 상태 확인: 서버가 켜져 있고 DB에 연결되는지 알려 줍니다. 개인정보는 반환하지 않습니다.
export const healthRouter = Router();

healthRouter.get("/health", async (_req, res) => {
  const startedAt = Date.now();
  try {
    await prisma.$queryRaw`SELECT 1`;
    res.json({
      status: "ok",
      db: "ok",
      dbLatencyMs: Date.now() - startedAt,
      serverTime: new Date().toISOString(),
      version: process.env.npm_package_version ?? "0.1.0",
    });
  } catch (error) {
    console.error("[health] DB 연결 실패", error);
    res.status(503).json({
      status: "degraded",
      db: "error",
      serverTime: new Date().toISOString(),
      message: "데이터베이스에 연결할 수 없습니다.",
    });
  }
});
