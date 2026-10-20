import type { ZodType, ZodTypeDef } from "zod";
import { AppError } from "./errors.js";

// 요청 값 검증: 실패하면 400과 항목별 메시지를 돌려줍니다.
export function parse<T>(schema: ZodType<T, ZodTypeDef, unknown>, value: unknown): T {
  const result = schema.safeParse(value);
  if (!result.success) {
    const fields = Object.fromEntries(result.error.issues.map((i) => [i.path.join(".") || "_", i.message]));
    throw new AppError(400, "validation_failed", "입력값을 확인하세요.", { fields });
  }
  return result.data;
}
