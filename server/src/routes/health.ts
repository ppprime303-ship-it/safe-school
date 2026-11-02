import { Router } from "express";
import { prisma } from "../db.js";
import { safeErrorSummary } from "../security/safeLog.js";
import { dataModeFor, deploymentRole } from "../deploy/environment.js";
import { RELEASE } from "../../../shared/release.js";

// 상태 확인: 서버가 켜져 있고 DB에 연결되는지 알려 줍니다. 개인정보는 반환하지 않습니다.
// version 은 개발 버전 표기이며 배포 시점을 뜻하지 않습니다. dataMode 는 로그인 전 화면의 안내 문구에 씁니다.
export const healthRouter = Router();

healthRouter.get("/health", async (_req, res) => {
  const startedAt = Date.now();
  const dataMode = dataModeFor(deploymentRole(process.env), process.env);
  try {
    await prisma.$queryRaw`SELECT 1`;
    res.json({
      status: "ok",
      db: "ok",
      dbLatencyMs: Date.now() - startedAt,
      serverTime: new Date().toISOString(),
      version: RELEASE.devVersion,
      dataMode,
    });
  } catch (error) {
    console.error("[health] DB 연결 실패", safeErrorSummary(error));
    res.status(503).json({
      status: "degraded",
      db: "error",
      serverTime: new Date().toISOString(),
      message: "데이터베이스에 연결할 수 없습니다.",
      dataMode,
    });
  }
});
