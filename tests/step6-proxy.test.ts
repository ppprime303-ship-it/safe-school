// STEP 6 HTTP 수준 점검: 리버스 프록시 뒤 실제 IP, 로그인 시도 제한, 미인증 차단, CSRF
// 실제 Express 앱(createApp, test 모드)을 임의 포트로 띄워 요청합니다. 요청은 DB에 닿기 전 단계에서 끝나도록 구성했지만,
// 혹시 모를 접속도 테스트 스키마로만 가도록 앱을 불러오기 전에 DATABASE_URL을 테스트 스키마로 바꿉니다.
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { Server } from "node:http";
import { getTestDatabaseUrl } from "./test-db";

let server: Server;
let base = "";

beforeAll(async () => {
  process.env.DATABASE_URL = getTestDatabaseUrl();
  const { createApp } = await import("../server/src/app");
  const http = await import("node:http");
  const app = await createApp({ mode: "test", trustProxyHops: 1 });
  server = http.createServer(app);
  await new Promise<void>((r) => server.listen(0, "127.0.0.1", () => r()));
  const addr = server.address();
  base = `http://127.0.0.1:${typeof addr === "object" && addr ? addr.port : 0}`;
});
afterAll(async () => {
  await new Promise<void>((r) => server.close(() => r()));
});

const login = (xff: string) =>
  fetch(`${base}/api/auth/login`, { method: "POST", headers: { "content-type": "application/json", "x-forwarded-for": xff }, body: "{}" });

describe("프록시 뒤 실제 IP와 로그인 시도 제한", () => {
  it("같은 실제 IP는 15분에 30회 넘으면 429, 다른 IP는 별도", async () => {
    for (let i = 0; i < 30; i++) expect((await login("203.0.113.10")).status).toBe(400); // 빈 본문 → 입력 오류(DB 조회 전)
    expect((await login("203.0.113.10")).status).toBe(429);
    expect((await login("203.0.113.20")).status).toBe(400);
  });
  it("클라이언트가 X-Forwarded-For 앞쪽에 가짜 IP를 넣어도 프록시가 붙인 실제 IP로 제한", async () => {
    expect((await login("198.51.100.99, 203.0.113.10")).status).toBe(429);
  });
});

describe("미인증·CSRF", () => {
  it("로그인 없이 내 정보·학교 화면 API → 401", async () => {
    expect((await fetch(`${base}/api/auth/me`)).status).toBe(401);
    expect((await fetch(`${base}/api/schools/00000000-0000-0000-0000-000000000000/events/active`)).status).toBe(401);
  });
  it("다른 사이트 폼 형식(urlencoded) 요청 → 415, 본문 없는 변경 요청에 전용 헤더 없음 → 400", async () => {
    const form = await fetch(`${base}/api/auth/login`, { method: "POST", headers: { "content-type": "application/x-www-form-urlencoded" }, body: "email=a&password=b" });
    expect(form.status).toBe(415);
    const bare = await fetch(`${base}/api/auth/logout`, { method: "POST" });
    expect(bare.status).toBe(400);
  });
  it("응답에 x-powered-by 없음", async () => {
    expect((await fetch(`${base}/api/auth/me`)).headers.get("x-powered-by")).toBe(null);
  });
});
