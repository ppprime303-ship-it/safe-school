import express, { type ErrorRequestHandler, type Express } from "express";
import path from "node:path";
import fs from "node:fs";
import type { Server } from "node:http";
import { prisma } from "./db.js";
import { AppError } from "./errors.js";
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
  console.error("[server] 처리하지 못한 오류", err);
  res.status(500).json({ code: "internal_error", message: "서버 오류가 발생했습니다. 잠시 후 다시 시도하세요." });
};

export async function createApp(options: { mode: "development" | "production" | "test"; httpServer?: Server }) {
  const app: Express = express();
  app.disable("x-powered-by");
  app.set("trust proxy", 1); // Replit 앞단 프록시 뒤에서 실제 접속 IP를 쓰기 위함
  app.use(express.json({ limit: "100kb" }));

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
