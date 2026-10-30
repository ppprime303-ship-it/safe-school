// Beta PILOT 2 Phase 3-D: Phase 1~3 통합 회귀(HTTP, 테스트 스키마, 가상 학교·계정·가상 이미지)
// 한 학교에서 모의훈련 → 실제 재난을 차례로 진행하며 기능 간 경계를 확인합니다.
// - 훈련: 안내 알림, 담임 학급 보고(관리자·일반 교직원 불가), 상황판 요약, 현장 제보(훈련 표시), 소재 미수집, 처리 상태, 종료 후 잠김, 훈련일지
// - 실제: 소재 보고·상세 권한, 현장 제보·사진 권한, 종료 후 잠김, 사건 간 데이터 분리
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { Server } from "node:http";
import { randomUUID } from "node:crypto";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import type { PrismaClient } from "@prisma/client";
import { createTestClient, getTestDatabaseUrl, resetTestData } from "./test-db";
import { fakeJpeg } from "./fixtures/images";
import { previewTargetProblem } from "../scripts/preview-local";

const PASSWORD = "regression3-password-1234";
let prisma: PrismaClient;
let server: Server;
let base = "";
let uploadDir = "";
let schoolId = "";
let classId = "";
const M: Record<string, string> = {};
const cookie: Record<string, string> = {};
const ip: Record<string, string> = {};
let drill = "";
let real = "";

async function call(who: string, method: string, p: string, body?: unknown, headers: Record<string, string> = {}) {
  const res = await fetch(`${base}/api/schools/${schoolId}${p}`, {
    method,
    headers: { cookie: cookie[who] ?? "", "x-forwarded-for": ip[who]!, ...(body === undefined ? { "x-requested-with": "safe-school" } : { "content-type": "application/json" }), ...headers },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const text = (res.headers.get("content-type") ?? "").includes("json") ? await res.text() : "";
  return { status: res.status, body: (text ? JSON.parse(text) : {}) as Record<string, any>, raw: text };
}
const key = () => ({ "idempotency-key": randomUUID() });
const classReport = (who: string, eventId: string) =>
  call(who, "PUT", `/events/${eventId}/reports/${classId}`, { evacuated: 20, absentKnown: 0, injured: 0, enrolledCount: 20, enrolledChangeReason: null, note: "학생 이름이 적힌 메모(가상)", expectedVersion: null }, key());
const presence = (who: string, eventId: string) => call(who, "PUT", `/events/${eventId}/presence/me`, { location: "on_campus", placeCategory: "staff_room", placeDetail: null, availability: "available", expectedVersion: null }, key());
const incident = (who: string, eventId: string) => call(who, "POST", `/events/${eventId}/incidents`, { type: "hazard", placeCategory: "hallway", placeDetail: "본관 1층", description: "복도에 연기가 보입니다" }, key());

beforeAll(async () => {
  uploadDir = await fs.mkdtemp(path.join(os.tmpdir(), "safeschool-reg3-"));
  process.env.INCIDENT_UPLOAD_DIR = uploadDir;
  process.env.DATABASE_URL = getTestDatabaseUrl();
  prisma = createTestClient();
  await resetTestData(prisma);
  const { hashPassword } = await import("../server/src/security/password");
  const { grantDutyByPlatformOperator } = await import("../server/src/services/duties");
  const { currentSchoolYear } = await import("../server/src/services/events");
  const passwordHash = await hashPassword(PASSWORD);
  const now = new Date();
  schoolId = (await prisma.school.create({ data: { slug: "reg3", name: "가상 회귀학교", isDemo: true, status: "active", activatedAt: now } })).id;
  classId = (await prisma.schoolClass.create({ data: { schoolId, schoolYear: currentSchoolYear(), grade: 1, classNo: 1, label: "1학년 1반", enrolledCount: 20, enrolledConfirmedAt: now } })).id;
  const people = [
    ["admin", "admin"],
    ["teacher", "homeroom"],
    ["staff", "staff"],
    ["safety", "staff"],
  ] as const;
  for (const [i, [k, role]] of people.entries()) {
    const user = await prisma.user.create({ data: { email: `${k}@reg3.safeschool.invalid`, displayName: `가상 ${k}`, passwordHash, emailVerifiedAt: now } });
    M[k] = (await prisma.schoolMembership.create({ data: { schoolId, userId: user.id, role, status: "approved", approvalMethod: "roster", approvedAt: now } })).id;
    ip[k] = `203.0.113.${230 + i}`;
  }
  await prisma.classAssignment.create({ data: { membershipId: M.teacher!, classId, duty: "homeroom" } });
  await grantDutyByPlatformOperator(prisma, { membershipId: M.safety!, duty: "safety_officer", operator: "회귀 테스트", verificationMethod: "테스트" });
  const { createApp } = await import("../server/src/app");
  const http = await import("node:http");
  server = http.createServer(await createApp({ mode: "test", trustProxyHops: 1 }));
  await new Promise<void>((r) => server.listen(0, "127.0.0.1", () => r()));
  const addr = server.address();
  base = `http://127.0.0.1:${typeof addr === "object" && addr ? addr.port : 0}`;
  for (const [k] of people) {
    const res = await fetch(`${base}/api/auth/login`, { method: "POST", headers: { "content-type": "application/json", "x-forwarded-for": ip[k]! }, body: JSON.stringify({ email: `${k}@reg3.safeschool.invalid`, password: PASSWORD, deviceKind: "personal" }) });
    expect(res.status).toBe(200);
    cookie[k] = res.headers.get("set-cookie")!.split(";")[0]!;
  }
});

afterAll(async () => {
  await new Promise<void>((r) => server.close(() => r()));
  await prisma.$disconnect();
  await fs.rm(uploadDir, { recursive: true, force: true });
});

describe("모의훈련 흐름", () => {
  it("발령 → 전원 안내 알림(소재 요청 없음), 담임만 학급 보고(관리자·교직원 403)", async () => {
    drill = (await call("admin", "POST", "/events", { primaryType: "fire", mode: "drill" })).body.event.id;
    const alerts = await call("staff", "GET", "/staff-alerts");
    expect(alerts.body.alerts[0]).toMatchObject({ presenceRequested: false, event: { mode: "drill" } });
    expect((await classReport("teacher", drill)).status).toBe(200);
    for (const who of ["admin", "staff", "safety"]) expect((await classReport(who, drill)).status).toBe(403);
  });

  it("상황판: 일반 교직원 요약(메모 없음), 안전업무 담당 상세", async () => {
    const s = await call("staff", "GET", `/events/${drill}/board`);
    expect(s.body.scope).toBe("summary");
    expect(s.raw).not.toContain("학생 이름이 적힌 메모");
    expect((await call("safety", "GET", `/events/${drill}/board`)).body.scope).toBe("full");
  });

  it("현장 제보는 되고(훈련 표시) 소재는 403, 처리 상태는 안전업무 담당만", async () => {
    const r = await incident("staff", drill);
    expect(r.status).toBe(201);
    expect((await call("staff", "GET", `/events/${drill}/incidents`)).body.event.mode).toBe("drill");
    expect((await presence("staff", drill)).status).toBe(403);
    expect((await call("staff", "POST", `/incidents/${r.body.id}/status`, { status: "checking", expectedStatus: "received" })).status).toBe(403);
    expect((await call("safety", "POST", `/incidents/${r.body.id}/status`, { status: "checking", expectedStatus: "received" })).status).toBe(200);
  });

  it("종료 후 학급 보고·제보·후속 정보 잠김, 훈련일지는 작성 가능, 훈련 소재 0건", async () => {
    expect((await call("admin", "POST", `/events/${drill}/close`, {})).status).toBe(200);
    expect((await classReport("teacher", drill)).status).toBe(409);
    expect((await incident("staff", drill)).status).toBe(409);
    expect([200, 201]).toContain((await call("safety", "POST", `/events/${drill}/drill-log`, {})).status);
    expect(await prisma.staffPresence.count({ where: { eventId: drill } })).toBe(0);
  });
});

describe("실제 재난 흐름", () => {
  it("발령 → 소재 요청 알림, 본인 소재 200, 상세는 관리자·안전업무 담당만", async () => {
    real = (await call("safety", "POST", "/events", { primaryType: "earthquake", mode: "real", confirmReal: true })).body.event.id;
    expect((await call("staff", "GET", "/staff-alerts")).body.alerts[0]).toMatchObject({ presenceRequested: true, event: { id: real } });
    expect((await presence("staff", real)).status).toBe(200);
    expect((await call("staff", "GET", `/events/${real}/presence`)).status).toBe(403);
    expect((await call("staff", "GET", `/events/${real}/presence/summary`)).body.summary).toMatchObject({ respondedCount: 1, targetCount: 4 });
    expect((await call("admin", "GET", `/events/${real}/presence`)).body.notResponded).toHaveLength(3);
  });

  it("현장 제보 + 사진: 교직원 첨부 201, 교직원 열람 403, 관리자 열람 200", async () => {
    const r = await incident("staff", real);
    expect(r.status).toBe(201);
    const up = await call("staff", "POST", `/incidents/${r.body.id}/photos`, { data: fakeJpeg().toString("base64") });
    expect(up.status).toBe(201);
    expect((await call("staff", "GET", `/incidents/${r.body.id}/photos/${up.body.id}`)).status).toBe(403);
    expect((await call("admin", "GET", `/incidents/${r.body.id}/photos/${up.body.id}`)).status).toBe(200);
  });

  it("종료 후 소재·제보 잠김, 사건별 데이터 분리(훈련 제보 1·실제 제보 1, 소재는 실제만)", async () => {
    expect((await call("admin", "POST", `/events/${real}/close`, { confirmClose: true })).status).toBe(200);
    expect((await presence("teacher", real)).status).toBe(409);
    expect((await incident("staff", real)).status).toBe(409);
    expect(await prisma.incidentReport.count({ where: { eventId: drill } })).toBe(1);
    expect(await prisma.incidentReport.count({ where: { eventId: real } })).toBe(1);
    expect(await prisma.staffPresence.count({ where: { eventId: real } })).toBe(1);
    expect(await prisma.staffPresence.count({ where: { eventId: drill } })).toBe(0);
  });
});

describe("로컬 미리보기 안전장치(scripts/preview-local.ts)", () => {
  const ok = { PREVIEW_CONFIRM: "local", DATABASE_URL: "postgresql://u:p@localhost:5432/safeschool_dev?schema=public" };
  it("로컬 DB·확인값이 있을 때만 허용", () => {
    expect(previewTargetProblem(ok)).toBeNull();
    expect(previewTargetProblem({ ...ok, DATABASE_URL: "postgresql://u:p@127.0.0.1:5432/dev" })).toBeNull();
  });
  it.each([
    ["운영 모드", { ...ok, NODE_ENV: "production" }],
    ["확인값 없음", { ...ok, PREVIEW_CONFIRM: undefined }],
    ["원격 호스트", { ...ok, DATABASE_URL: "postgresql://u:p@safeschool-pilot.duckdns.org:5432/x" }],
    ["prod 스키마", { ...ok, DATABASE_URL: "postgresql://u:p@localhost:5432/x?schema=safeschool_prod_pilot" }],
    ["prod DB", { ...ok, DATABASE_URL: "postgresql://u:p@localhost:5432/safeschool_prod" }],
    ["URL 없음", { PREVIEW_CONFIRM: "local" }],
  ])("거부: %s", (_n, env) => {
    expect(previewTargetProblem(env as Record<string, string | undefined>)).not.toBeNull();
  });
});
