// Beta PILOT 2 T5: 학교 공인 IP 하나에서 많은 교직원이 동시에 보고해도 서로 막지 않고, 한 계정의 과도한 요청만 막음(HTTP, 테스트 스키마, 가상 계정)
// 이전 제한(IP당 소재·제보 분당 60회, 학급 보고 120회, 발령 20회)으로는 이 시나리오의 61번째 요청부터 거부되었습니다.
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { Server } from "node:http";
import { randomUUID } from "node:crypto";
import fsp from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import type { PrismaClient } from "@prisma/client";
import { createTestClient, getTestDatabaseUrl, resetTestData } from "./test-db";
import { ApiError, describeError } from "../client/src/lib/api";
import { userRateLimit } from "../server/src/middleware/security";

const SCHOOL_IP = "203.0.113.50";
const STAFF = 70;
let prisma: PrismaClient;
let server: Server;
let base = "";
let school = "";
let uploadDir = "";
let classId = "";
const cookie: Record<string, string> = {};
const staff = Array.from({ length: STAFF }, (_, i) => `staff${i}`);

async function call(who: string, method: string, p: string, body?: unknown, headers: Record<string, string> = {}) {
  const res = await fetch(`${base}/api/schools/${school}${p}`, {
    method,
    headers: { cookie: cookie[who] ?? "", "x-forwarded-for": SCHOOL_IP, ...(body === undefined ? { "x-requested-with": "safe-school" } : { "content-type": "application/json" }), ...headers },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const text = await res.text();
  return { status: res.status, headers: res.headers, body: text.startsWith("{") ? (JSON.parse(text) as Record<string, any>) : {} };
}
const idem = () => ({ "idempotency-key": randomUUID() });
const onCampus = { location: "on_campus", placeCategory: "classroom", placeDetail: "가상 교실", availability: "available", expectedVersion: null };
const incident = { type: "facility_damage", placeCategory: "hallway", description: "가상 복도 창문 파손" };
const report = { evacuated: 20, absentKnown: 0, injured: 0, enrolledCount: 20, enrolledChangeReason: null, note: null, expectedVersion: null };

/** 한 번에 10개씩 보내 실제 동시 요청을 흉내 냄 */
async function inBatches<T>(items: string[], fn: (who: string) => Promise<T>): Promise<T[]> {
  const out: T[] = [];
  for (let i = 0; i < items.length; i += 10) out.push(...(await Promise.all(items.slice(i, i + 10).map(fn))));
  return out;
}

beforeAll(async () => {
  uploadDir = await fsp.mkdtemp(path.join(os.tmpdir(), "safeschool-limit-test-"));
  process.env.INCIDENT_UPLOAD_DIR = uploadDir;
  process.env.DATABASE_URL = getTestDatabaseUrl();
  prisma = createTestClient();
  await resetTestData(prisma);
  const { createSession, SESSION_COOKIE } = await import("../server/src/auth/session");
  const now = new Date();
  school = (await prisma.school.create({ data: { slug: "shared-ip", name: "가상 공용IP학교", isDemo: true, status: "active", activatedAt: now } })).id;
  classId = (await prisma.schoolClass.create({ data: { schoolId: school, schoolYear: now.getFullYear(), grade: 1, classNo: 1, label: "1학년 1반", enrolledCount: 20, enrolledConfirmedAt: now } })).id;
  const people = [
    { key: "admin", role: "admin" as const },
    { key: "admin2", role: "admin" as const },
    { key: "teacher", role: "homeroom" as const },
    ...staff.map((key) => ({ key, role: "staff" as const })),
  ];
  for (const p of people) {
    const user = await prisma.user.create({ data: { email: `${p.key}@limit.safeschool.invalid`, displayName: `가상 ${p.key}`, passwordHash: "x", emailVerifiedAt: now } });
    const m = await prisma.schoolMembership.create({ data: { schoolId: school, userId: user.id, role: p.role, status: "approved", approvalMethod: "roster", approvedAt: now } });
    if (p.key === "teacher") await prisma.classAssignment.create({ data: { membershipId: m.id, classId, duty: "homeroom" } });
    cookie[p.key] = `${SESSION_COOKIE}=${(await createSession(prisma, { userId: user.id, deviceKind: "personal" })).token}`;
  }
  const { createApp } = await import("../server/src/app");
  const http = await import("node:http");
  server = http.createServer(await createApp({ mode: "test", trustProxyHops: 1 }));
  await new Promise<void>((r) => server.listen(0, "127.0.0.1", () => r()));
  const addr = server.address();
  base = `http://127.0.0.1:${typeof addr === "object" && addr ? addr.port : 0}`;
}, 60000);

afterAll(async () => {
  await new Promise<void>((r) => server.close(() => r()));
  await prisma.$disconnect();
  await fsp.rm(uploadDir, { recursive: true, force: true });
});

describe("공용 IP 하나, 서로 다른 교직원", () => {
  let drillId = "";
  let realId = "";

  it("모의훈련: 70명 현장 제보 201·담임 학급 보고 200, 소재는 여전히 403(429 아님)", async () => {
    drillId = (await call("admin", "POST", "/events", { primaryType: "fire", mode: "drill" })).body.event.id;
    const incidents = await inBatches(staff, (w) => call(w, "POST", `/events/${drillId}/incidents`, incident, idem()));
    expect(incidents.map((r) => r.status)).toEqual(staff.map(() => 201));
    const presence = await inBatches(staff, (w) => call(w, "PUT", `/events/${drillId}/presence/me`, onCampus, idem()));
    expect(new Set(presence.map((r) => r.status))).toEqual(new Set([403]));
    expect((await call("teacher", "PUT", `/events/${drillId}/reports/${classId}`, report, idem())).status).toBe(200);
    expect(await prisma.staffPresence.count({ where: { eventId: drillId } })).toBe(0);
    expect((await call("admin", "POST", `/events/${drillId}/close`, {})).status).toBe(200);
  }, 60000);

  it("실제 재난: 70명 교직원 소재 200 + 현장 제보 201, 담임 학급 보고 200, 모두 저장됨", async () => {
    realId = (await call("admin", "POST", "/events", { primaryType: "fire", mode: "real", confirmReal: true })).body.event.id;
    const presence = await inBatches(staff, (w) => call(w, "PUT", `/events/${realId}/presence/me`, onCampus, idem()));
    expect(presence.map((r) => r.status)).toEqual(staff.map(() => 200));
    expect(await prisma.staffPresence.count({ where: { eventId: realId } })).toBe(STAFF);
    const incidents = await inBatches(staff, (w) => call(w, "POST", `/events/${realId}/incidents`, incident, idem()));
    expect(incidents.map((r) => r.status)).toEqual(staff.map(() => 201));
    expect((await call("teacher", "PUT", `/events/${realId}/reports/${classId}`, report, idem())).status).toBe(200);
  }, 60000);

  it("학급 보고 경로: 같은 IP에서 분당 120회를 넘어도 계정이 다르면 제한되지 않음", async () => {
    const twice = [...staff, ...staff];
    const r = await inBatches(twice, (w) => call(w, "PUT", `/events/${realId}/reports/${classId}`, report, idem()));
    expect(r.length).toBeGreaterThan(120);
    expect(r.filter((x) => x.status === 429)).toHaveLength(0);
    expect(new Set(r.map((x) => x.status))).toEqual(new Set([403])); // 담임이 아니므로 권한 거부는 그대로
  }, 60000);

  it("사진 경로: 같은 IP에서 분당 20회를 넘어도 계정이 다르면 제한되지 않음(잘못된 데이터 400은 그대로)", async () => {
    const incidentId = (await prisma.incidentReport.findFirstOrThrow({ where: { eventId: realId } })).id;
    const statuses: number[] = [];
    for (const w of staff.slice(0, 30)) statuses.push((await call(w, "POST", `/incidents/${incidentId}/photos`, { data: "@@@" })).status); // 동시 처리 수 제한과 분리해 차례로
    expect(new Set(statuses)).toEqual(new Set([400]));
  }, 60000);

  it("발령 경로: 관리자 두 명이 합쳐 20회를 넘어도 제한되지 않음", async () => {
    const r = await inBatches([...Array(13).fill("admin"), ...Array(13).fill("admin2")], (w) => call(w, "POST", `/events/${realId}/classes/${classId}/delegation`, { reason: "unknown" }));
    expect(r.filter((x) => x.status === 429)).toHaveLength(0);
  }, 60000);
});

describe("한 계정의 과도한 요청", () => {
  it("소재 경로 60회 초과 429 + Retry-After·재시도 시간, 같은 IP의 다른 교직원은 영향 없음", async () => {
    const ev = (await prisma.disasterEvent.findFirstOrThrow({ where: { schoolId: school, status: "active" } })).id;
    let last = { status: 0, headers: new Headers(), body: {} as Record<string, any> };
    for (let i = 0; i < 60; i++) last = await call("staff60", "PUT", `/events/${ev}/presence/me`, { invalid: true }, idem());
    expect(last.status).toBe(429);
    expect(last.body.code).toBe("too_many_requests");
    const sec = last.body.details.retryAfterSec as number;
    expect(sec).toBeGreaterThan(0);
    expect(sec).toBeLessThanOrEqual(60);
    expect(last.headers.get("retry-after")).toBe(String(sec));
    expect(last.body.message).toContain(`${sec}초`);
    expect((await call("staff61", "PUT", `/events/${ev}/presence/me`, { ...onCampus, expectedVersion: 1 }, idem())).status).toBe(200);
  }, 60000);

  it("제보 경로·사진 경로도 계정별로 차단", async () => {
    const ev = (await prisma.disasterEvent.findFirstOrThrow({ where: { schoolId: school, status: "active" } })).id;
    const statuses: number[] = [];
    for (let i = 0; i < 61; i++) statuses.push((await call("staff62", "POST", `/events/${ev}/incidents`, { invalid: true }, idem())).status);
    expect(statuses.at(-1)).toBe(429);
    const incidentId = (await prisma.incidentReport.findFirstOrThrow({ where: { eventId: ev } })).id;
    const photos: number[] = [];
    for (let i = 0; i < 21; i++) photos.push((await call("staff63", "POST", `/incidents/${incidentId}/photos`, { data: "@@@" })).status);
    expect(photos.at(-1)).toBe(429);
  }, 60000);

  it("세션이 없을 때는 IP 기준으로 동작(같은 IP 합산)", () => {
    const mw = userRateLimit({ windowMs: 60_000, max: 1 });
    const hit = (req: Record<string, unknown>) => {
      let err: any;
      mw(req as never, {} as never, ((e?: unknown) => (err = e)) as never);
      return err?.status;
    };
    expect([hit({ ip: "1.1.1.1" }), hit({ ip: "1.1.1.1" })]).toEqual([undefined, 429]);
    expect([hit({ ip: "1.1.1.1", auth: { userId: "u1" } }), hit({ ip: "1.1.1.1", auth: { userId: "u2" } }), hit({ ip: "1.1.1.1", auth: { userId: "u1" } })]).toEqual([undefined, undefined, 429]);
  });
});

describe("429 화면 안내", () => {
  it("대기 시간과 비상연락망 병행을 안내하고 다시 시도 가능으로 표시", () => {
    const d = describeError(new ApiError(429, "too_many_requests", "요청이 너무 많습니다. 30초 뒤 다시 시도하세요.", { retryAfterSec: 30 }));
    expect(d.retryable).toBe(true);
    expect(d.message).toContain("30초");
    expect(d.message).toContain("비상연락망");
  });
});
