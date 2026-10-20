import express, { type ErrorRequestHandler, type Express } from "express";
import path from "node:path";
import fs from "node:fs";
import type { Server } from "node:http";
import { healthRouter } from "./routes/health.js";

// 오류 응답 형식은 { code, message } 로 통일합니다(설계서 E절).
export class AppError extends Error {
  constructor(
    public readonly status: number,
    public readonly code: string,
    message: string,
  ) {
    super(message);
  }
}

export function createApiRouter() {
  const api = express.Router();
  api.use(healthRouter);
  // STEP 2 이후 라우터(인증, 학교, 재난 등)를 여기에 추가합니다.
  api.use((_req, _res, next) => next(new AppError(404, "not_found", "요청한 API가 없습니다.")));
  return api;
}

const errorHandler: ErrorRequestHandler = (err, _req, res, _next) => {
  if (err instanceof AppError) {
    res.status(err.status).json({ code: err.code, message: err.message });
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
