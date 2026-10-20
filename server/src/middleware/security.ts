import type { NextFunction, Request, Response } from "express";
import { AppError } from "../errors.js";

// CSRF 대응: 상태를 바꾸는 API 요청은 JSON만 받습니다.
// (다른 사이트의 HTML 폼은 application/json 을 보낼 수 없고, 보내려면 CORS 사전요청이 필요해 차단됩니다.)
// 세션 쿠키는 SameSite=Lax 입니다.
export function requireJsonForMutations(req: Request, _res: Response, next: NextFunction) {
  if (["GET", "HEAD", "OPTIONS"].includes(req.method)) return next();
  const type = req.headers["content-type"] ?? "";
  const hasBody = Number(req.headers["content-length"] ?? 0) > 0 || req.headers["transfer-encoding"] !== undefined;
  if (hasBody && !type.startsWith("application/json")) {
    return next(new AppError(415, "unsupported_media_type", "JSON 형식으로 요청해야 합니다."));
  }
  if (!hasBody && req.headers["x-requested-with"] !== "safe-school") {
    return next(new AppError(400, "missing_header", "요청 헤더가 올바르지 않습니다."));
  }
  next();
}

// 간단한 요청 횟수 제한(서버 메모리 기준, 인스턴스별). 로그인·인증코드·학교 검색에 사용.
export function rateLimit(options: { windowMs: number; max: number; key?: (req: Request) => string }) {
  const hits = new Map<string, { count: number; resetAt: number }>();
  return (req: Request, _res: Response, next: NextFunction) => {
    const now = Date.now();
    const key = options.key ? options.key(req) : req.ip ?? "unknown";
    const entry = hits.get(key);
    if (!entry || entry.resetAt <= now) {
      hits.set(key, { count: 1, resetAt: now + options.windowMs });
      if (hits.size > 10_000) for (const [k, v] of hits) if (v.resetAt <= now) hits.delete(k);
      return next();
    }
    entry.count++;
    if (entry.count > options.max) {
      return next(new AppError(429, "too_many_requests", "요청이 너무 많습니다. 잠시 후 다시 시도하세요."));
    }
    next();
  };
}
