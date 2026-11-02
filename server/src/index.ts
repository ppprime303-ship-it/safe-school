import http from "node:http";
import { deployRole, env } from "./env.js";
import { prisma } from "./db.js";
import { createApp } from "./app.js";
import { safeErrorSummary } from "./security/safeLog.js";
import { startCollector } from "./alerts/collector.js";
import { assertMockAllowed, mockFileSource, type AlertSource } from "./alerts/providers.js";
import { MoisCbsSource } from "./alerts/moisCbs.js";
import { KmaWarningSource } from "./alerts/kmaSource.js";
import { getKmaWarningClient } from "./integrations/client.js";
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
  const official: AlertSource[] = (env.ALERT_PROVIDERS ?? "").split(",").map((s) => s.trim()).includes("mois_cbs") && env.MOIS_CBS_SERVICE_KEY ? [new MoisCbsSource(env.MOIS_CBS_SERVICE_KEY, undefined, undefined, undefined, 1)] : [];
  if (official.length) console.log(`[alerts] 공식 긴급재난문자 수집 사용(${env.MOIS_CBS_INTERVAL_SEC}초 간격, 응답 형식 확인 전이면 실패가 기록될 수 있음)`);
  // 공유플랫폼 일일 호출량(이용 화면 100건, 키 전체): 주기당 1쪽, 재시도 없음, 기본 30분 간격. 상한은 같은 DB 서버끼리만 공유(docs/beta2/release/beta-deploy-plan.md)
  const stopOfficial = startCollector(prisma, official, env.MOIS_CBS_INTERVAL_SEC * 1000, console, { retries: 0, dailyCallLimit: env.MOIS_CBS_DAILY_LIMIT, callsPerAttempt: 1 });
  // 기상특보(설정한 경우만). 경보함 카드와 같은 클라이언트를 공유해 호출이 늘지 않습니다
  const kmaClient = (env.ALERT_PROVIDERS ?? "").split(",").map((s) => s.trim()).includes("kma_warning") ? getKmaWarningClient() : null;
  const weather: AlertSource[] = kmaClient ? [new KmaWarningSource(kmaClient)] : [];
  if (weather.length) console.log(`[alerts] 기상특보 수집 사용(${env.KMA_WARNING_INTERVAL_SEC}초 간격)`);
  const stopWeather = startCollector(prisma, weather, env.KMA_WARNING_INTERVAL_SEC * 1000);
  // STEP A: 경보함 수집 상태 표시용 — 실제로 켠 공급자만 등록(꺼져 있으면 경보함에 '공식 수집 미연결')
  setConfiguredAlertSources([
    ...sources.map((s) => ({ provider: s.provider, isMock: s.isMock, intervalMs: env.ALERT_COLLECT_INTERVAL_SEC * 1000 })),
    ...official.map((s) => ({ provider: s.provider, isMock: s.isMock, intervalMs: env.MOIS_CBS_INTERVAL_SEC * 1000 })),
    ...weather.map((s) => ({ provider: s.provider, isMock: s.isMock, intervalMs: env.KMA_WARNING_INTERVAL_SEC * 1000 })),
  ]);

  // Replit이 서버를 멈출 때 DB 연결을 깔끔하게 닫습니다.
  const shutdown = async (signal: string) => {
    console.log(`[SAFE SCHOOL] ${signal} 수신, 종료합니다.`);
    stopCollector();
    stopOfficial();
    stopWeather();
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
