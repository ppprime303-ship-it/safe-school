// Beta PILOT 2 T4: 사진 업로드 경계(HTTP, 테스트 스키마, 임시 폴더, 가상 이미지만) + 배포 설정 정합성
// - 큰 본문은 사진 첨부 경로에서만, 로그인·소속 확인 뒤에만 읽음 / 동시 처리 수 제한 / Caddy·앱 한도 일치 / 백업 스크립트 대상
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import fs from "node:fs";
import fsp from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import type { Server } from "node:http";
import { randomUUID } from "node:crypto";
import type { PrismaClient } from "@prisma/client";
import { createTestClient, getTestDatabaseUrl, resetTestData } from "./test-db";
import { fakeJpeg } from "./fixtures/images";
import { concurrencyLimit } from "../server/src/middleware/security";

const PASSWORD = "photo-guard-password-1234";
const FIVE_MIB = 5 * 1024 * 1024;
let prisma: PrismaClient;
let server: Server;
let base = "";
let uploadDir = "";
let schoolA = "";
let schoolB = "";
let incidentA = "";
const cookie: Record<string, string> = {};

async function call(who: string | null, method: string, p: string, body?: unknown, headers: Record<string, string> = {}) {
  const res = await fetch(`${base}/api${p}`, {
    method,
    headers: { cookie: who ? (cookie[who] ?? "") : "", ...(body === undefined ? { "x-requested-with": "safe-school" } : { "content-type": "application/json" }), ...headers },
    body: body === undefined ? undefined : typeof body === "string" ? body : JSON.stringify(body),
  });
  const text = await res.text();
  return { status: res.status, body: text.startsWith("{") ? (JSON.parse(text) as Record<string, any>) : {} };
}
const photoPath = (schoolId = schoolA, incidentId = incidentA) => `/schools/${schoolId}/incidents/${incidentId}/photos`;

beforeAll(async () => {
  uploadDir = await fsp.mkdtemp(path.join(os.tmpdir(), "safeschool-photo-guard-"));
  process.env.INCIDENT_UPLOAD_DIR = uploadDir;
  process.env.DATABASE_URL = getTestDatabaseUrl();
  prisma = createTestClient();
  await resetTestData(prisma);
  const { hashPassword } = await import("../server/src/security/password");
  const passwordHash = await hashPassword(PASSWORD);
  const now = new Date();
  schoolA = (await prisma.school.create({ data: { slug: "guard-a", name: "가상 경계학교 A", isDemo: true, status: "active", activatedAt: now } })).id;
  schoolB = (await prisma.school.create({ data: { slug: "guard-b", name: "가상 경계학교 B", isDemo: true, status: "active", activatedAt: now } })).id;
  const people = [
    { key: "adminA", school: schoolA, role: "admin" as const },
    { key: "staffA", school: schoolA, role: "staff" as const },
    { key: "adminB", school: schoolB, role: "admin" as const },
  ];
  for (const p of people) {
    const user = await prisma.user.create({ data: { email: `${p.key.toLowerCase()}@guard.safeschool.invalid`, displayName: `가상 ${p.key}`, passwordHash, emailVerifiedAt: now } });
    await prisma.schoolMembership.create({ data: { schoolId: p.school, userId: user.id, role: p.role, status: "approved", approvalMethod: "roster", approvedAt: now } });
  }
  const { createApp } = await import("../server/src/app");
  const http = await import("node:http");
  server = http.createServer(await createApp({ mode: "test", trustProxyHops: 1 }));
  await new Promise<void>((r) => server.listen(0, "127.0.0.1", () => r()));
  const addr = server.address();
  base = `http://127.0.0.1:${typeof addr === "object" && addr ? addr.port : 0}`;
  for (const p of people) {
    const res = await fetch(`${base}/api/auth/login`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ email: `${p.key.toLowerCase()}@guard.safeschool.invalid`, password: PASSWORD, deviceKind: "personal" }) });
    expect(res.status).toBe(200);
    cookie[p.key] = res.headers.get("set-cookie")!.split(";")[0]!;
  }
  const eventId = (await call("adminA", "POST", `/schools/${schoolA}/events`, { primaryType: "fire", mode: "drill" })).body.event.id;
  incidentA = (await call("staffA", "POST", `/schools/${schoolA}/events/${eventId}/incidents`, { type: "facility_damage", placeCategory: "hallway", description: "복도 창문이 깨졌습니다" }, { "idempotency-key": randomUUID() })).body.id;
}, 30000);

afterAll(async () => {
  await new Promise<void>((r) => server.close(() => r()));
  await prisma.$disconnect();
  await fsp.rm(uploadDir, { recursive: true, force: true });
});

describe("업로드 경계", () => {
  const huge = JSON.stringify({ data: "A".repeat(7_400_000) });

  it("정상 이미지 201, 파일은 지정한 저장 경로에만 생김", async () => {
    const r = await call("staffA", "POST", photoPath(), { data: fakeJpeg().toString("base64") });
    expect(r.status).toBe(201);
    expect((await fsp.readdir(uploadDir)).filter((f) => f.endsWith(".jpg"))).toHaveLength(1);
  });

  it("로그인 없음·위조 쿠키는 큰 본문을 보내도 본문을 읽기 전에 401(413 아님)", async () => {
    expect((await call(null, "POST", photoPath(), huge)).status).toBe(401);
    const { SESSION_COOKIE } = await import("../server/src/auth/session");
    const forged = await fetch(`${base}/api${photoPath()}`, { method: "POST", headers: { cookie: `${SESSION_COOKIE}=forged`, "content-type": "application/json" }, body: huge });
    expect(forged.status).toBe(401);
  });

  it("다른 학교 소속은 큰 본문을 읽기 전에 404(413 아님)", async () => {
    expect((await call("adminB", "POST", photoPath(), huge)).status).toBe(404);
  });

  it("권한이 있어도 본문 한도 초과 413, 원본 5MiB 초과 413, 허용 범위 최대 크기는 본문 한도 안", async () => {
    expect((await call("staffA", "POST", photoPath(), huge)).status).toBe(413);
    const over = Buffer.concat([Buffer.from([0xff, 0xd8, 0xff]), Buffer.alloc(FIVE_MIB)]);
    expect((await call("staffA", "POST", photoPath(), { data: over.toString("base64") })).status).toBe(413);
    const { PHOTO_BODY_LIMIT_BYTES } = await import("../server/src/routes/incidents");
    expect(Math.ceil(FIVE_MIB / 3) * 4 + `{"data":""}`.length).toBeLessThan(PHOTO_BODY_LIMIT_BYTES);
  });

  it("큰 본문 허용은 사진 경로뿐: 다른 쓰기 API·사진 경로의 다른 메서드는 100KB 그대로", async () => {
    const big = JSON.stringify({ description: "가".repeat(60_000) });
    expect((await call("staffA", "POST", `/schools/${schoolA}/incidents/${incidentA}/updates`, big, { "idempotency-key": randomUUID() })).status).toBe(413);
    expect((await call("staffA", "POST", "/auth/reauth", JSON.stringify({ password: "x".repeat(150_000) }))).status).toBe(413);
    expect((await call("staffA", "DELETE", `${photoPath()}/${randomUUID()}`, JSON.stringify({ pad: "x".repeat(150_000) }))).status).toBe(413);
  });

  it("업로드 첨부 후 공개 URL 없음, 인증 없는 열람 401", async () => {
    const row = await prisma.incidentAttachment.findFirstOrThrow({ where: { incidentId: incidentA } });
    expect((await call(null, "GET", `${photoPath()}/${row.id}`)).status).toBe(401);
  });
});

describe("사진 첨부 운영 통제", () => {
  it("끄기 스위치: 첨부만 503, 다시 켜면 동작, 본문을 읽기 전에 거부", async () => {
    process.env.INCIDENT_PHOTO_UPLOAD = "disabled";
    try {
      const r = await call("adminA", "POST", photoPath(), JSON.stringify({ data: "A".repeat(7_400_000) }));
      expect(r.status).toBe(503);
      expect(r.body.code).toBe("photo_upload_disabled");
    } finally {
      delete process.env.INCIDENT_PHOTO_UPLOAD;
    }
  });
  it("저장 상한 초과: 507, 파일·행이 남지 않음, 상한을 올리면 다시 가능", async () => {
    const files = (await fsp.readdir(uploadDir)).length;
    const rows = await prisma.incidentAttachment.count();
    process.env.INCIDENT_UPLOAD_QUOTA_MB = "0.000001";
    try {
      const r = await call("staffA", "POST", photoPath(), { data: fakeJpeg().toString("base64") });
      expect(r.status).toBe(507);
      expect(r.body.code).toBe("photo_storage_full");
    } finally {
      delete process.env.INCIDENT_UPLOAD_QUOTA_MB;
    }
    expect((await fsp.readdir(uploadDir)).length).toBe(files);
    expect(await prisma.incidentAttachment.count()).toBe(rows);
    expect((await call("staffA", "POST", photoPath(), { data: fakeJpeg().toString("base64") })).status).toBe(201);
  });
});

describe("동시 처리 수 제한", () => {
  it("상한을 넘으면 503, 앞선 요청이 끝나면 다시 허용", () => {
    const mw = concurrencyLimit({ max: 1 });
    const handlers: (() => void)[] = [];
    const res = { once: (_: string, h: () => void) => handlers.push(h) };
    const run = () => {
      let err: any;
      mw({} as never, res as never, ((e?: unknown) => (err = e)) as never);
      return err;
    };
    expect(run()).toBe(undefined);
    expect(run()?.status).toBe(503);
    handlers[0]!();
    expect(run()).toBe(undefined);
  });
});

describe("배포 설정 정합성", () => {
  const caddy = fs.readFileSync("deploy/caddy/beta.caddy.example", "utf8");
  const env = fs.readFileSync("deploy/env/beta.env.example", "utf8");

  it("Caddy 사진 경로가 앱 정규식과 같고 POST 전용, 한도는 앱과 같은 7MiB, 그 밖은 1MB 유지", async () => {
    const { PHOTO_UPLOAD_PATH, PHOTO_BODY_LIMIT_BYTES } = await import("../server/src/routes/incidents");
    const m = /@photoUpload \{\s*method POST\s*path_regexp (\S+)\s*\}/.exec(caddy);
    expect(m).not.toBeNull();
    const regex = new RegExp(m![1]!);
    const plain = (r: RegExp) => r.source.replace(/\\\//g, "/");
    expect(plain(regex)).toBe(plain(PHOTO_UPLOAD_PATH));
    expect(regex.test("/api/schools/a/incidents/b/photos")).toBe(true);
    for (const p of ["/api/schools/a/incidents/b/updates", "/api/schools/a/incidents/b/photos/c", "/api/auth/login", "/api/schools/a/incidents/b/photos/../x"]) expect(regex.test(p)).toBe(false);
    expect(PHOTO_BODY_LIMIT_BYTES).toBe(7 * 1024 * 1024);
    expect([...caddy.matchAll(/max_size (\S+)/g)].map((x) => x[1])).toEqual(["7MiB", "1MB"]);
    const handles = caddy.indexOf("handle @photoUpload");
    expect(caddy.indexOf("max_size 7MiB")).toBeGreaterThan(handles);
    expect(caddy.indexOf("max_size 7MiB")).toBeLessThan(caddy.indexOf("\thandle {"));
  });

  it("Caddy는 Beta 포트로만 프록시, 기존 Prototype 예시는 그대로 1MB·5000", () => {
    const port = /^PORT=(\d+)$/m.exec(env)![1];
    expect([...caddy.matchAll(/reverse_proxy\s+(\S+)/g)].map((x) => x[1])).toEqual([`127.0.0.1:${port}`, `127.0.0.1:${port}`]);
    expect(caddy).not.toMatch(/^\s*trusted_proxies/m);
    const proto = fs.readFileSync("deploy/caddy/Caddyfile.example", "utf8");
    expect(proto).toMatch(/max_size 1MB/);
    expect(proto).not.toMatch(/7MiB/);
  });

  it("백업 스크립트: Beta DB·사진만, 덤프를 먼저 하고 읽기 확인, 삭제는 백업 파일 이름으로 한정, 비밀번호 없음", () => {
    const sh = fs.readFileSync("deploy/scripts/beta-backup.sh", "utf8");
    expect(sh).toMatch(/^SCHEMA="safeschool_beta"$/m);
    expect(sh).toMatch(/^DB="safeschool_beta"$/m);
    expect(sh).not.toMatch(/^[^#]*(safeschool_prod|ss_pilot|\/srv\/safe-school\/)/m);
    expect(sh.indexOf("pg_dump --host")).toBeLessThan(sh.indexOf("tar -czf"));
    expect(sh).toContain('pg_restore --list "$DUMP"');
    expect(sh).toContain('tar -tzf "$PHOTOS" > /dev/null');
    expect(sh).toMatch(/--no-password/);
    expect(sh).not.toMatch(/\brm\s+-/);
    expect(/find "\$DIR" -maxdepth 1 .*-delete/.test(sh)).toBe(true);
  });
});
