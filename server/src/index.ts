import http from "node:http";
import { env } from "./env.js";
import { prisma } from "./db.js";
import { createApp } from "./app.js";

async function main() {
  const httpServer = http.createServer();
  const app = await createApp({ mode: env.NODE_ENV, httpServer });
  httpServer.on("request", app);

  httpServer.listen(env.PORT, "0.0.0.0", () => {
    console.log(`[SAFE SCHOOL] ${env.NODE_ENV} 모드로 실행 중: http://localhost:${env.PORT}`);
  });

  // Replit이 서버를 멈출 때 DB 연결을 깔끔하게 닫습니다.
  const shutdown = async (signal: string) => {
    console.log(`[SAFE SCHOOL] ${signal} 수신, 종료합니다.`);
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
