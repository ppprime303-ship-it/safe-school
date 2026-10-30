import express, { type ErrorRequestHandler, type Express } from "express";
import path from "node:path";
import fs from "node:fs";
import type { Server } from "node:http";
import { prisma } from "./db.js";
import { AppError } from "./errors.js";
import { safeErrorSummary } from "./security/safeLog.js";
import { loadSession } from "./auth/session.js";
import { requireJsonForMutations } from "./middleware/security.js";
import { healthRouter } from "./routes/health.js";
import { authRouter } from "./routes/auth.js";
import { schoolsRouter } from "./routes/schools.js";
import { eventsRouter } from "./routes/events.js";
import { alertsRouter } from "./routes/alerts.js";
import { noticesRouter } from "./routes/notices.js";
import { dutiesRouter } from "./routes/duties.js";
import { drillLogsRouter } from "./routes/drillLogs.js";
import { platformRouter } from "./routes/platform.js";
import { presenceRouter } from "./routes/presence.js";

export { AppError } from "./errors.js";

export function createApiRouter() {
  const api = express.Router();
  api.use(healthRouter);
  api.use(requireJsonForMutations);
  api.use(loadSession(prisma));
  api.use(authRouter);
  api.use(schoolsRouter);
  api.use(eventsRouter); // STEP 3-A 재난 발령·보고·상황판
  api.use(alertsRouter); // STEP 3-B 경보함·학교 소재지
  api.use(noticesRouter); // STEP 3-C 재난안전 안내문 작성 지원
  api.use(dutiesRouter); // STEP 3-D 업무 담당자 지정
  api.use(drillLogsRouter); // STEP 3-D 비상대피훈련일지
  api.use(platformRouter); // STEP D 플랫폼 운영관리자(신규 학교 등록 승인)
  api.use(presenceRouter); // Beta PILOT 2 Phase 2 교직원 알림·소재 보고
  api.use((_req, _res, next) => next(new AppError(404, "not_found", "요청한 API가 없습니다.")));
  return api;
}

const errorHandler: ErrorRequestHandler = (err, _req, res, _next) => {
  if (err instanceof AppError) {
    res.status(err.status).json({ code: err.code, message: err.message, ...(err.details ? { details: err.details } : {}) });
    return;
  }
  if (err?.type === "entity.parse.failed") {
    res.status(400).json({ code: "invalid_json", message: "요청 형식(JSON)이 올바르지 않습니다." });
    return;
  }
  // STEP 8: 본문 처리 단계의 요청 오류(너무 큼 413, 압축 본문 415 등)는 500이 아니라 해당 4xx로
  if (typeof err?.type === "string" && err.expose === true && Number.isInteger(err.status) && err.status >= 400 && err.status < 500) {
    res.status(err.status).json({ code: "invalid_request_body", message: "요청 본문을 처리할 수 없습니다." });
    return;
  }
  // STEP 3-E: 오류 객체를 통째로 남기지 않음(요청 값·개인정보 노출 방지) — security/safeLog.ts
  console.error("[server] 처리하지 못한 오류", safeErrorSummary(err));
  res.status(500).json({ code: "internal_error", message: "서버 오류가 발생했습니다. 잠시 후 다시 시도하세요." });
};

export async function createApp(options: { mode: "development" | "production" | "test"; httpServer?: Server; trustProxyHops?: number }) {
  const app: Express = express();
  app.disable("x-powered-by");
  // 앞단 프록시(Replit·Caddy·Nginx) 뒤에서 실제 접속 IP를 쓰기 위함. 지정한 단계 수만큼만 X-Forwarded-For를 믿음(맨 왼쪽 위조값 무시)
  app.set("trust proxy", options.trustProxyHops ?? 1);
  // inflate: false — 압축(gzip·deflate·br) 요청 본문은 받지 않음(화면은 압축 본문을 보내지 않음).
  // body-parser 2.0~2.3 압축 본문 서비스 거부 취약점(GHSA-27r3-jxmh-p828) 경로를 버전 변경 없이 차단(STEP 8)
  app.use(express.json({ limit: "100kb", inflate: false }));

  app.use("/api", createApiRouter());
  app.use("/api", errorHandler);

  if (options.mode === "development") {
    // 개발: Vite를 미들웨어로 붙여 화면을 바로 보여 줍니다(포트 하나로 동작).
    const { createServer } = await import("vite");
    const vite = await createServer({
      configFile: path.resolve(process.cwd(), "vite.config.ts"),
      server: { middlewareMode: true, hmr: options.httpServer ? { server: options.httpServer } : undefined },
      appType: "spa",
    });
    app.use(vite.middlewares);
  } else if (options.mode === "production") {
    // 운영: 빌드된 화면(dist/client)을 제공합니다.
    const clientDir = path.resolve(process.cwd(), "dist/client");
    if (!fs.existsSync(clientDir)) {
      console.warn("[server] dist/client 가 없습니다. `npm run build` 를 먼저 실행하세요.");
    }
    app.use(express.static(clientDir, { index: false, maxAge: "1h" }));
    // 화면 주소(/events/... 등)는 모두 index.html로 보내 React가 처리하게 합니다.
    app.use((req, res, next) => {
      if (req.method !== "GET" || req.path.startsWith("/api/")) return next();
      res.sendFile(path.join(clientDir, "index.html"));
    });
  }

  app.use(errorHandler);
  return app;
}
