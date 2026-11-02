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

export const SESSION_EXPIRED_EVENT = "safe-school:session-expired";

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
    // 로그인 세션이 만료·회수된 경우: 화면 전체에 알려 로그인 화면으로 보냅니다(로그인·인증 요청 자체는 제외).
    if (response.status === 401 && !path.startsWith("/auth/")) {
      window.dispatchEvent(new CustomEvent(SESSION_EXPIRED_EVENT));
    }
    // 프록시(Caddy)가 앱에 닿기 전에 거절하면 JSON 본문이 없으므로 크기 초과는 여기서 안내합니다.
    const fallback = response.status === 413 ? "보낼 수 있는 크기를 넘었습니다. 사진이라면 더 작은 사진으로 다시 시도하세요." : `요청을 처리하지 못했습니다(${response.status}).`;
    throw new ApiError(response.status, err.code ?? "http_error", err.message ?? fallback, err.details);
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

/** 오류를 화면 안내용 제목·문구로 바꿉니다(권한·승인 대기·통신 장애를 구분). */
export function describeError(e: unknown): { title: string; message: string; retryable: boolean } {
  if (!(e instanceof ApiError)) return { title: "문제가 발생했습니다", message: "잠시 후 다시 시도하세요.", retryable: true };
  if (e.isNetwork) return { title: "서버에 연결할 수 없습니다", message: e.message, retryable: true };
  switch (e.code) {
    case "membership_pending":
      return { title: "가입 승인 대기 중", message: e.message, retryable: false };
    case "school_not_active":
      return { title: "학교 등록 확인 대기 중", message: e.message, retryable: false };
    case "membership_inactive":
    case "forbidden":
      return { title: "접근 권한이 없습니다", message: e.message, retryable: false };
    case "reauth_required":
      return { title: "비밀번호 재확인이 필요합니다", message: e.message, retryable: false };
    case "unauthenticated":
      return { title: "로그인이 필요합니다", message: e.message, retryable: false };
    default:
      return { title: e.status >= 500 ? "서버 오류" : "처리하지 못했습니다", message: e.message, retryable: e.status >= 500 };
  }
}
