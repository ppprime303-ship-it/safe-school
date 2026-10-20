// 오류 응답 형식은 { code, message } 로 통일합니다(설계서 E절).
export class AppError extends Error {
  constructor(
    public readonly status: number,
    public readonly code: string,
    message: string,
    public readonly details?: Record<string, unknown>,
  ) {
    super(message);
  }
}

export const notFound = (message = "찾을 수 없습니다.") => new AppError(404, "not_found", message);
export const forbidden = (message = "권한이 없습니다.") => new AppError(403, "forbidden", message);
export const badRequest = (message: string, details?: Record<string, unknown>) =>
  new AppError(400, "bad_request", message, details);
export const conflict = (code: string, message: string, details?: Record<string, unknown>) =>
  new AppError(409, code, message, details);

// Prisma 고유 제약 위반(P2002) 여부
export function isUniqueViolation(error: unknown): boolean {
  return typeof error === "object" && error !== null && (error as { code?: string }).code === "P2002";
}
