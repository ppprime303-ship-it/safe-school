// Beta PILOT 2 Phase 3-C: 현장 사진 비공개 첨부(HTTP, 테스트 스키마, 임시 폴더, 가상 이미지만)
// - 첨부: 승인 교직원, JPEG·PNG만, 5MB·제보당 3장, EXIF·GPS 제거 저장, 진행 중 사건만
// - 열람: incident.photo(대응 담당자)만, 다른 학교 404, 공개 경로 없음, 캐시 금지 헤더
// - 삭제: incident.manage 만(삭제 표시 + 파일 제거), 감사 기록에 사진 내용·키 없음
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { Server } from "node:http";
import { randomUUID } from "node:crypto";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import type { PrismaClient } from "@prisma/client";
import { createTestClient, getTestDatabaseUrl, resetTestData } from "./test-db";
import { fakeJpeg, fakePng, latin } from "./fixtures/images";

const PASSWORD = "photo-test-password-1234";
let prisma: PrismaClient;
let server: Server;
let base = "";
let uploadDir = "";
const school: Record<"a" | "b", string> = { a: "", b: "" };
const M: Record<string, string> = {};
const cookie: Record<string, string> = {};
const ip: Record<string, string> = {};
let eventA = "";
let incidentA = "";
const P: Record<string, string> = {};

async function call(who: string, method: string, p: string, body?: unknown, headers: Record<string, string> = {}) {
  const res = await fetch(`${base}${p.startsWith("/api") || !p.startsWith("/schools") ? p : `/api${p}`}`, {
    method,
    headers: {
      cookie: cookie[who] ?? "",
      "x-forwarded-for": ip[who] ?? "198.51.100.141",
      ...(body === undefined ? { "x-requested-with": "safe-school" } : { "content-type": "application/json" }),
      ...headers,
    },
    body: body === undefined ? undefined : typeof body === "string" ? body : JSON.stringify(body),
  });
  const buf = Buffer.from(await res.arrayBuffer());
  const type = res.headers.get("content-type") ?? "";
  return { status: res.status, headers: res.headers, buf, body: type.includes("json") && buf.length ? (JSON.parse(buf.toString("utf8")) as Record<string, any>) : {} };
}
const A = (p: string) => `/schools/${school.a}${p}`;
const upload = (who: string, data: Buffer | string, incidentId = incidentA) => call(who, "POST", A(`/incidents/${incidentId}/photos`), { data: typeof data === "string" ? data : data.toString("base64") });
const filesOnDisk = async () => (await fs.readdir(uploadDir).catch(() => [] as string[])).filter((f) => !f.endsWith(".part"));

beforeAll(async () => {
  uploadDir = await fs.mkdtemp(path.join(os.tmpdir(), "safeschool-photo-test-"));
  process.env.INCIDENT_UPLOAD_DIR = uploadDir;
  process.env.DATABASE_URL = getTestDatabaseUrl();
  prisma = createTestClient();
  await resetTestData(prisma);
  const { hashPassword } = await import("../server/src/security/password");
  const { grantDutyByPlatformOperator } = await import("../server/src/services/duties");
  const passwordHash = await hashPassword(PASSWORD);
  const now = new Date();
  for (const k of ["a", "b"] as const) {
    school[k] = (await prisma.school.create({ data: { slug: `photo-${k}`, name: `가상 사진학교 ${k.toUpperCase()}`, isDemo: true, status: "active", activatedAt: now } })).id;
  }
  const people: { key: string; k: "a" | "b"; role: "admin" | "homeroom" | "staff" }[] = [
    { key: "adminA", k: "a", role: "admin" },
    { key: "safetyA", k: "a", role: "staff" },
    { key: "staffA", k: "a", role: "staff" },
    { key: "staffA2", k: "a", role: "homeroom" },
    { key: "adminB", k: "b", role: "admin" },
  ];
  for (const [i, p] of people.entries()) {
    const user = await prisma.user.create({ data: { email: `${p.key.toLowerCase()}@photo.safeschool.invalid`, displayName: `가상 ${p.key}`, passwordHash, emailVerifiedAt: now } });
    M[p.key] = (await prisma.schoolMembership.create({ data: { schoolId: school[p.k], userId: user.id, role: p.role, status: "approved", approvalMethod: "roster", approvedAt: now } })).id;
    ip[p.key] = `203.0.113.${90 + i}`;
  }
  await grantDutyByPlatformOperator(prisma, { membershipId: M.safetyA!, duty: "safety_officer", operator: "사진 테스트", verificationMethod: "테스트" });
  const { createApp } = await import("../server/src/app");
  const http = await import("node:http");
  server = http.createServer(await createApp({ mode: "test", trustProxyHops: 1 }));
  await new Promise<void>((r) => server.listen(0, "127.0.0.1", () => r()));
  const addr = server.address();
  base = `http://127.0.0.1:${typeof addr === "object" && addr ? addr.port : 0}`;
  for (const p of people) {
    const res = await fetch(`${base}/api/auth/login`, {
      method: "POST",
      headers: { "content-type": "application/json", "x-forwarded-for": ip[p.key]! },
      body: JSON.stringify({ email: `${p.key.toLowerCase()}@photo.safeschool.invalid`, password: PASSWORD, deviceKind: "personal" }),
    });
    expect(res.status).toBe(200);
    cookie[p.key] = res.headers.get("set-cookie")!.split(";")[0]!;
  }
  eventA = (await call("adminA", "POST", A("/events"), { primaryType: "fire", mode: "drill" })).body.event.id;
  incidentA = (await call("staffA", "POST", A(`/events/${eventA}/incidents`), { type: "facility_damage", placeCategory: "hallway", description: "복도 창문이 깨졌습니다" }, { "idempotency-key": randomUUID() })).body.id;
});

afterAll(async () => {
  await new Promise<void>((r) => server.close(() => r()));
  await prisma.$disconnect();
  await fs.rm(uploadDir, { recursive: true, force: true });
});

describe("첨부와 메타데이터 제거", () => {
  it("일반 교직원 JPEG 첨부 201(훈련 상황 포함), 디스크·DB 에 EXIF·GPS·주석·덧붙인 데이터 없음, 원래 파일명 없음", async () => {
    const r = await upload("staffA2", fakeJpeg());
    expect(r.status).toBe(201);
    expect(r.body).toMatchObject({ mimeType: "image/jpeg" });
    P.jpg = r.body.id;
    const row = await prisma.incidentAttachment.findUniqueOrThrow({ where: { id: P.jpg } });
    expect(row.storageKey).toMatch(/^[0-9a-f]{32}\.jpg$/);
    const saved = await fs.readFile(path.join(uploadDir, row.storageKey));
    expect(saved.length).toBe(row.sizeBytes);
    for (const t of ["Exif", "GPS", "DEVICE-SERIAL", "xmpmeta", "TRAILING"]) expect(saved.includes(latin(t))).toBe(false);
    expect(saved.includes(Buffer.from("홍길동", "utf8"))).toBe(false);
  });

  it("PNG 첨부 201(텍스트·EXIF 청크 제거)", async () => {
    const r = await upload("staffA", fakePng());
    expect(r.status).toBe(201);
    P.png = r.body.id;
    const row = await prisma.incidentAttachment.findUniqueOrThrow({ where: { id: P.png } });
    const saved = await fs.readFile(path.join(uploadDir, row.storageKey));
    for (const t of ["tEXt", "eXIf", "GPS-DATA", "TRAILING"]) expect(saved.includes(latin(t))).toBe(false);
  });

  it("형식·크기·본문 검사: GIF 415, SVG 415, 깨진 base64 400, 모르는 필드 400, 5MB 초과 413, 본문 7MB 초과 413, 다른 API 는 여전히 100KB 한도", async () => {
    expect((await upload("staffA", latin("GIF89a\x01\x00\x01\x00"))).status).toBe(415);
    expect((await upload("staffA", latin("<svg><script>alert(1)</script></svg>"))).status).toBe(415);
    expect((await upload("staffA", "@@@not-base64@@@")).status).toBe(400);
    expect((await call("staffA", "POST", A(`/incidents/${incidentA}/photos`), { data: fakeJpeg().toString("base64"), filename: "IMG_0001.jpg" })).status).toBe(400);
    const big = Buffer.concat([Buffer.from([0xff, 0xd8, 0xff]), Buffer.alloc(5 * 1024 * 1024)]);
    expect((await upload("staffA", big)).status).toBe(413);
    expect((await call("staffA", "POST", A(`/incidents/${incidentA}/photos`), JSON.stringify({ data: "A".repeat(7_400_000) }))).status).toBe(413);
    expect((await call("staffA", "POST", A(`/events/${eventA}/incidents`), { type: "other", placeCategory: "other", placeDetail: "x", description: "가".repeat(60_000) }, { "idempotency-key": randomUUID() })).status).toBe(413);
    expect(await prisma.incidentAttachment.count()).toBe(2);
    expect(await filesOnDisk()).toHaveLength(2);
  });

  it("제보당 3장: 세 번째 201, 네 번째 409(파일도 남지 않음)", async () => {
    const third = await upload("staffA", fakeJpeg());
    expect(third.status).toBe(201);
    P.third = third.body.id;
    const fourth = await upload("staffA", fakeJpeg());
    expect(fourth.status).toBe(409);
    expect(fourth.body.code).toBe("photo_limit");
    expect(await filesOnDisk()).toHaveLength(3);
  });
});

describe("열람 권한과 공개 경로", () => {
  it("일반 교직원(올린 사람 포함) 열람 403, 상세 응답에 사진 목록 없음(장수만)", async () => {
    for (const who of ["staffA", "staffA2"]) {
      expect((await call(who, "GET", A(`/incidents/${incidentA}/photos/${P.jpg}`))).status).toBe(403);
      const d = await call(who, "GET", A(`/incidents/${incidentA}`));
      expect(d.body.incident.photoCount).toBe(3);
      expect(d.body.incident).not.toHaveProperty("photos");
    }
  });

  it("대응 담당자(관리자·안전업무 담당) 열람 200: 이미지 형식, 캐시 금지·nosniff, 정리된 바이트", async () => {
    for (const who of ["adminA", "safetyA"]) {
      const r = await call(who, "GET", A(`/incidents/${incidentA}/photos/${P.jpg}`));
      expect(r.status).toBe(200);
      expect(r.headers.get("content-type")).toBe("image/jpeg");
      expect(r.headers.get("cache-control")).toBe("private, no-store");
      expect(r.headers.get("x-content-type-options")).toBe("nosniff");
      expect(r.buf.includes(latin("GPS"))).toBe(false);
    }
    const d = await call("adminA", "GET", A(`/incidents/${incidentA}`));
    expect(d.body.incident.photos).toHaveLength(3);
  });

  it("다른 학교: B 관리자는 B 경로·A 경로 모두 404, 다른 제보 id 로 사진 접근 404", async () => {
    expect((await call("adminB", "GET", `/schools/${school.b}/incidents/${incidentA}/photos/${P.jpg}`)).status).toBe(404);
    expect((await call("adminB", "GET", A(`/incidents/${incidentA}/photos/${P.jpg}`))).status).toBe(404);
    expect((await call("adminB", "POST", `/schools/${school.b}/incidents/${incidentA}/photos`, { data: fakeJpeg().toString("base64") })).status).toBe(404);
    const other = (await call("staffA2", "POST", A(`/events/${eventA}/incidents`), { type: "hazard", placeCategory: "gym", description: "체육관 바닥이 젖었습니다" }, { "idempotency-key": randomUUID() })).body.id;
    expect((await call("adminA", "GET", A(`/incidents/${other}/photos/${P.jpg}`))).status).toBe(404);
  });

  it("저장 파일에 대한 공개 경로 없음(정적 제공 안 함)", async () => {
    const row = await prisma.incidentAttachment.findUniqueOrThrow({ where: { id: P.jpg } });
    for (const p of [`/${row.storageKey}`, `/data/incident-uploads/${row.storageKey}`, `/incident-uploads/${row.storageKey}`, `/api/${row.storageKey}`]) {
      const r = await fetch(`${base}${p}`);
      const type = r.headers.get("content-type") ?? "";
      expect(r.status !== 200 || !type.startsWith("image/")).toBe(true);
    }
  });
});

describe("삭제와 종료 후", () => {
  it("삭제: 일반 교직원 403, 대응 담당자 200 → 파일 제거·삭제 표시·열람 404, 다시 3장까지 첨부 가능", async () => {
    expect((await call("staffA2", "DELETE", A(`/incidents/${incidentA}/photos/${P.jpg}`))).status).toBe(403);
    const row = await prisma.incidentAttachment.findUniqueOrThrow({ where: { id: P.jpg } });
    expect((await call("safetyA", "DELETE", A(`/incidents/${incidentA}/photos/${P.jpg}`))).status).toBe(200);
    await expect(fs.access(path.join(uploadDir, row.storageKey))).rejects.toThrow();
    expect((await prisma.incidentAttachment.findUniqueOrThrow({ where: { id: P.jpg } })).deletedByMembershipId).toBe(M.safetyA);
    expect((await call("adminA", "GET", A(`/incidents/${incidentA}/photos/${P.jpg}`))).status).toBe(404);
    expect((await call("safetyA", "DELETE", A(`/incidents/${incidentA}/photos/${P.jpg}`))).status).toBe(409);
    expect((await upload("staffA", fakePng())).status).toBe(201);
    await expect(prisma.incidentAttachment.delete({ where: { id: P.jpg } })).rejects.toThrow(); // 행 삭제는 DB 가 거부
  });

  it("감사 기록에 사진 내용·저장 키·해시 없음", async () => {
    const logs = await prisma.auditLog.findMany({ where: { action: { in: ["incident.photo_added", "incident.photo_deleted"] } } });
    expect(logs.length).toBe(5);
    const keys = (await prisma.incidentAttachment.findMany()).flatMap((a) => [a.storageKey, a.sha256]);
    for (const l of logs) {
      const s = JSON.stringify([l.before, l.after]);
      for (const k of keys) expect(s).not.toContain(k);
      expect(s).not.toMatch(/base64|\/9j\//);
    }
  });

  it("종료 후 첨부 409(파일 남지 않음), 대응 담당자의 삭제·열람은 가능, DB 도 종료 후 첨부 행 거부", async () => {
    expect((await call("adminA", "POST", A(`/events/${eventA}/close`), {})).status).toBe(200);
    const before = (await filesOnDisk()).length;
    const late = await upload("staffA", fakeJpeg());
    expect(late.status).toBe(409);
    expect(late.body.code).toBe("event_closed");
    expect(await filesOnDisk()).toHaveLength(before);
    expect((await call("adminA", "GET", A(`/incidents/${incidentA}/photos/${P.png}`))).status).toBe(200);
    expect((await call("adminA", "DELETE", A(`/incidents/${incidentA}/photos/${P.png}`))).status).toBe(200);
    await expect(
      prisma.incidentAttachment.create({ data: { incidentId: incidentA, schoolId: school.a, uploaderMembershipId: M.staffA!, storageKey: `${"a".repeat(32)}.jpg`, mimeType: "image/jpeg", sizeBytes: 10, sha256: "x" } }),
    ).rejects.toThrow();
  });
});
