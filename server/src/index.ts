import http from "node:http";
import { deployRole, env } from "./env.js";
import { prisma } from "./db.js";
import { createApp } from "./app.js";
import { safeErrorSummary } from "./security/safeLog.js";
import { startCollector } from "./alerts/collector.js";
import { assertMockAllowed, mockFileSource, type AlertSource } from "./alerts/providers.js";
import { MoisCbsSource } from "./alerts/moisCbs.js";
import { setConfiguredAlertSources } from "./alerts/feedStatus.js";

async function main() {
  const httpServer = http.createServer();
  const app = await createApp({ mode: env.NODE_ENV, httpServer, trustProxyHops: env.TRUST_PROXY_HOPS });
  httpServer.on("request", app);

  httpServer.listen(env.PORT, env.LISTEN_HOST, () => {
    console.log(`[SAFE SCHOOL] ${env.NODE_ENV} 모드로 실행 중: ${env.LISTEN_HOST}:${env.PORT}`);
  });

  // 공식 경보 주기 수집: 실제 공급자 어댑터는 아직 없음(응답 필드 확인 전). 개발·시연에서는 모의 경보 파일만 사용.
  const sources: AlertSource[] = [];
  if (env.ALERT_MOCK_FEED) {
    assertMockAllowed(env.NODE_ENV, deployRole);
    sources.push(mockFileSource(env.ALERT_MOCK_FEED));
    console.log(`[alerts] 모의 경보 파일 수집 사용(${env.ALERT_COLLECT_INTERVAL_SEC}초 간격) — 실제 공식 경보 아님`);
  }
  const stopCollector = startCollector(prisma, sources, env.ALERT_COLLECT_INTERVAL_SEC * 1000);
  // STEP 7: 공식 긴급재난문자(설정한 경우만, 심사 환경 제외 — env.ts 에서 검사). 일일 호출 한도 때문에 별도 간격
  const official: AlertSource[] = (env.ALERT_PROVIDERS ?? "").split(",").map((s) => s.trim()).includes("mois_cbs") && env.MOIS_CBS_SERVICE_KEY ? [new MoisCbsSource(env.MOIS_CBS_SERVICE_KEY)] : [];
  if (official.length) console.log(`[alerts] 공식 긴급재난문자 수집 사용(${env.MOIS_CBS_INTERVAL_SEC}초 간격, 응답 형식 확인 전이면 실패가 기록될 수 있음)`);
  const stopOfficial = startCollector(prisma, official, env.MOIS_CBS_INTERVAL_SEC * 1000);
  // STEP A: 경보함 수집 상태 표시용 — 실제로 켠 공급자만 등록(꺼져 있으면 경보함에 '공식 수집 미연결')
  setConfiguredAlertSources([
    ...sources.map((s) => ({ provider: s.provider, isMock: s.isMock, intervalMs: env.ALERT_COLLECT_INTERVAL_SEC * 1000 })),
    ...official.map((s) => ({ provider: s.provider, isMock: s.isMock, intervalMs: env.MOIS_CBS_INTERVAL_SEC * 1000 })),
  ]);

  // Replit이 서버를 멈출 때 DB 연결을 깔끔하게 닫습니다.
  const shutdown = async (signal: string) => {
    console.log(`[SAFE SCHOOL] ${signal} 수신, 종료합니다.`);
    stopCollector();
    stopOfficial();
    httpServer.close();
    await prisma.$disconnect();
    process.exit(0);
  };
  process.on("SIGTERM", () => void shutdown("SIGTERM"));
  process.on("SIGINT", () => void shutdown("SIGINT"));
}

main().catch(async (error) => {
  console.error("[SAFE SCHOOL] 시작 실패", safeErrorSummary(error));
  await prisma.$disconnect();
  process.exit(1);
});
