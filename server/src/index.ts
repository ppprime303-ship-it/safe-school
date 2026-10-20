import http from "node:http";
import { env } from "./env.js";
import { prisma } from "./db.js";
import { createApp } from "./app.js";
import { startCollector } from "./alerts/collector.js";
import { assertMockAllowed, mockFileSource, type AlertSource } from "./alerts/providers.js";

async function main() {
  const httpServer = http.createServer();
  const app = await createApp({ mode: env.NODE_ENV, httpServer });
  httpServer.on("request", app);

  httpServer.listen(env.PORT, "0.0.0.0", () => {
    console.log(`[SAFE SCHOOL] ${env.NODE_ENV} 모드로 실행 중: http://localhost:${env.PORT}`);
  });

  // 공식 경보 주기 수집: 실제 공급자 어댑터는 아직 없음(응답 필드 확인 전). 개발·시연에서는 모의 경보 파일만 사용.
  const sources: AlertSource[] = [];
  if (env.ALERT_MOCK_FEED) {
    assertMockAllowed(env.NODE_ENV);
    sources.push(mockFileSource(env.ALERT_MOCK_FEED));
    console.log(`[alerts] 모의 경보 파일 수집 사용(${env.ALERT_COLLECT_INTERVAL_SEC}초 간격) — 실제 공식 경보 아님`);
  }
  const stopCollector = startCollector(prisma, sources, env.ALERT_COLLECT_INTERVAL_SEC * 1000);

  // Replit이 서버를 멈출 때 DB 연결을 깔끔하게 닫습니다.
  const shutdown = async (signal: string) => {
    console.log(`[SAFE SCHOOL] ${signal} 수신, 종료합니다.`);
    stopCollector();
    httpServer.close();
    await prisma.$disconnect();
    process.exit(0);
  };
  process.on("SIGTERM", () => void shutdown("SIGTERM"));
  process.on("SIGINT", () => void shutdown("SIGINT"));
}

main().catch(async (error) => {
  console.error("[SAFE SCHOOL] 시작 실패", error);
  await prisma.$disconnect();
  process.exit(1);
});
