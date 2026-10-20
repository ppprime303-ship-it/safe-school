// 서버 API 호출 공통 함수: 오류는 { status, code, message } 형태의 ApiError로 통일합니다.
export class ApiError extends Error {
  constructor(
    public readonly status: number,
    public readonly code: string,
    message: string,
    public readonly details?: Record<string, unknown>,
  ) {
    super(message);
  }
  /** 서버에 닿지 못한 경우(통신 장애) */
  get isNetwork() {
    return this.status === 0;
  }
}

type Method = "GET" | "POST" | "PUT" | "PATCH" | "DELETE";

export async function api<T>(
  method: Method,
  path: string,
  body?: unknown,
  options: { idempotencyKey?: string; signal?: AbortSignal } = {},
): Promise<T> {
  const headers: Record<string, string> = { Accept: "application/json", "X-Requested-With": "safe-school" };
  if (body !== undefined) headers["Content-Type"] = "application/json";
  if (options.idempotencyKey) headers["Idempotency-Key"] = options.idempotencyKey;

  let response: Response;
  try {
    response = await fetch(`/api${path}`, {
      method,
      headers,
      body: body === undefined ? undefined : JSON.stringify(body),
      credentials: "same-origin",
      signal: options.signal,
    });
  } catch (error) {
    if ((error as Error).name === "AbortError") throw error;
    throw new ApiError(0, "network_error", "서버에 연결할 수 없습니다. 통신 상태를 확인하세요.");
  }

  const text = await response.text();
  const data = text ? safeJson(text) : null;
  if (!response.ok) {
    const err = (data ?? {}) as { code?: string; message?: string; details?: Record<string, unknown> };
    throw new ApiError(response.status, err.code ?? "http_error", err.message ?? `요청을 처리하지 못했습니다(${response.status}).`, err.details);
  }
  return data as T;
}

function safeJson(text: string): unknown {
  try {
    return JSON.parse(text);
  } catch {
    return null;
  }
}

export const newIdempotencyKey = () =>
  typeof crypto !== "undefined" && "randomUUID" in crypto
    ? crypto.randomUUID()
    : `${Date.now()}-${Math.random().toString(36).slice(2)}`;

// 브라우저 저장소는 사생활 보호 모드 등에서 실패할 수 있으므로 항상 감쌉니다.
export const storage = {
  get(key: string): string | null {
    try {
      return window.localStorage.getItem(key);
    } catch {
      return null;
    }
  },
  set(key: string, value: string) {
    try {
      window.localStorage.setItem(key, value);
    } catch {
      /* 저장 실패는 무시(기능 저하만) */
    }
  },
  remove(key: string) {
    try {
      window.localStorage.removeItem(key);
    } catch {
      /* 무시 */
    }
  },
};
