// 재난 종료 후 후속 조치: 실제 재난 제보만, 권한자만, 사건·학급·소재 기록 불변, 보고서는 명시적으로 새 판(HTTP, 테스트 스키마, 가상 자료만)
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { randomUUID } from "node:crypto";
import { inflateRawSync } from "node:zlib";
import type { Server } from "node:http";
import type { PrismaClient } from "@prisma/client";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { createTestClient, getTestDatabaseUrl, resetTestData } from "./test-db";
import { DrillDocPreview } from "../client/src/pages/drill/DrillDocPreview";
import { buildDrillDoc, type DrillManual, type DrillSnapshot } from "../shared/drillLog";

let prisma: PrismaClient;
let server: Server;
let base = "";
const school = { a: "", b: "" };
const cookie: Record<string, string> = {};
const M: Record<string, string> = {};
const names: Record<string, string> = {};
let classId = "";
let real = "";
let drill = "";
let inc = "";
let inc2 = "";
let drillInc = "";
let log = "";

async function call(who: string, method: string, p: string, body?: unknown, idem?: string | true) {
  const res = await fetch(`${base}/api/schools/${p.startsWith("!") ? p.slice(1) : `${school.a}${p}`}`, {
    method,
    headers: { cookie: cookie[who] ?? "", ...(body === undefined ? { "x-requested-with": "safe-school" } : { "content-type": "application/json" }), ...(idem ? { "idempotency-key": idem === true ? randomUUID() : idem } : {}) },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const buf = Buffer.from(await res.arrayBuffer());
  return { status: res.status, buf, headers: res.headers, body: (res.headers.get("content-type") ?? "").includes("json") ? (JSON.parse(buf.toString("utf8")) as Record<string, any>) : {} };
}
const follow = (who: string, id: string, body: Record<string, unknown>, idem: string | true = true) => call(who, "POST", `/incidents/${id}/followup`, body, idem);
const done = (extra: Record<string, unknown> = {}) => ({ status: "resolved", expectedStatus: "received", note: "시설팀이 복구 완료", ...extra });
function hwpxText(buf: Buffer) {
  let i = 0;
  let xml = "";
  while (buf.readUInt32LE(i) === 0x04034b50) {
    const method = buf.readUInt16LE(i + 8), size = buf.readUInt32LE(i + 18), nlen = buf.readUInt16LE(i + 26), xlen = buf.readUInt16LE(i + 28);
    const name = buf.subarray(i + 30, i + 30 + nlen).toString("utf8");
    const body = buf.subarray(i + 30 + nlen + xlen, i + 30 + nlen + xlen + size);
    if (/^Contents\/section\d+\.xml$/.test(name)) xml += (method === 8 ? inflateRawSync(body) : Buffer.from(body)).toString("utf8");
    i += 30 + nlen + xlen + size;
  }
  return [...xml.matchAll(/<hp:t[^>]*>([^<]*)<\/hp:t>/g)].map((m) => m[1]).join("\n");
}
const statusCell = (snap: DrillSnapshot, manual: DrillManual, word: string) => {
  const cells = buildDrillDoc(snap, manual).pages[2]!.table.cells;
  const r = cells.find((c) => c.text.includes(word))!.r;
  return cells.filter((c) => c.r === r).at(-1)!.text;
};
const frozen = async () => ({
  event: await prisma.disasterEvent.findUniqueOrThrow({ where: { id: real } }),
  reports: await prisma.evacuationReport.findMany({ where: { eventId: real } }),
  reportRevisions: await prisma.evacuationReportRevision.count(),
  presence: await prisma.staffPresence.findMany({ where: { eventId: real } }),
  presenceHistory: await prisma.staffPresenceHistory.count(),
  alerts: await prisma.staffAlert.count(),
});

beforeAll(async () => {
  process.env.DATABASE_URL = getTestDatabaseUrl();
  prisma = createTestClient();
  await resetTestData(prisma);
  const { createSession, SESSION_COOKIE } = await import("../server/src/auth/session");
  const { grantDutyByPlatformOperator } = await import("../server/src/services/duties");
  const now = new Date();
  for (const k of ["a", "b"] as const) school[k] = (await prisma.school.create({ data: { slug: `followup-${k}`, name: `가상 후속학교 ${k}`, isDemo: true, status: "active", activatedAt: now } })).id;
  classId = (await prisma.schoolClass.create({ data: { schoolId: school.a, schoolYear: now.getFullYear(), grade: 1, classNo: 1, label: "1학년 1반", enrolledCount: 20, enrolledConfirmedAt: now } })).id;
  for (const [key, role, s, duty] of [["admin", "admin", school.a, null], ["safety", "staff", school.a, "safety_officer"], ["principal", "staff", school.a, "principal"], ["vice", "staff", school.a, "vice_principal"], ["staff", "staff", school.a, null], ["teacher", "homeroom", school.a, null], ["adminB", "admin", school.b, null]] as const) {
    names[key] = `가상담당 ${key}`;
    const user = await prisma.user.create({ data: { email: `${key.toLowerCase()}@followup.safeschool.invalid`, displayName: names[key]!, passwordHash: "x", emailVerifiedAt: now } });
    const m = await prisma.schoolMembership.create({ data: { schoolId: s, userId: user.id, role, status: "approved", approvalMethod: "roster", approvedAt: now } });
    M[key] = m.id;
    if (key === "teacher") await prisma.classAssignment.create({ data: { membershipId: m.id, classId, duty: "homeroom" } });
    if (duty) await grantDutyByPlatformOperator(prisma, { membershipId: m.id, duty, operator: "테스트", verificationMethod: "테스트" });
    cookie[key] = `${SESSION_COOKIE}=${(await createSession(prisma, { userId: user.id, deviceKind: "personal" })).token}`;
  }
  const { createApp } = await import("../server/src/app");
  const http = await import("node:http");
  server = http.createServer(await createApp({ mode: "test", trustProxyHops: 1 }));
  await new Promise<void>((r) => server.listen(0, "127.0.0.1", () => r()));
  const addr = server.address();
  base = `http://127.0.0.1:${typeof addr === "object" && addr ? addr.port : 0}`;
  const incident = async (ev: string, description: string) => (await call("staff", "POST", `/events/${ev}/incidents`, { type: "facility_damage", placeCategory: "hallway", placeDetail: "가상 복도", description }, true)).body.id as string;
  drill = (await call("admin", "POST", "/events", { primaryType: "fire", mode: "drill" })).body.event.id;
  drillInc = await incident(drill, "훈련 제보");
  expect((await call("admin", "POST", `/events/${drill}/close`, {})).status).toBe(200);
  real = (await call("admin", "POST", "/events", { primaryType: "fire", mode: "real", confirmReal: true })).body.event.id;
  inc = await incident(real, "복도천장제보");
  inc2 = await incident(real, "계단난간제보");
  expect((await call("teacher", "PUT", `/events/${real}/reports/${classId}`, { evacuated: 19, absentKnown: 0, injured: 0, enrolledCount: 20, enrolledChangeReason: null, note: null, expectedVersion: null }, true)).status).toBe(200);
  expect((await call("staff", "PUT", `/events/${real}/presence/me`, { location: "off_campus", availability: "available", expectedVersion: null }, true)).status).toBe(200);
  log = (await call("admin", "POST", `/events/${real}/drill-log`, {})).body.id;
  expect((await call("admin", "POST", `/events/${real}/close`, { confirmClose: true })).status).toBe(200);
}, 60000);

afterAll(async () => {
  await new Promise<void>((r) => server.close(() => r()));
  await prisma.$disconnect();
});

describe("권한·범위", () => {
  it("일반 교직원·담임·교장·교감 403, 다른 학교 404, 로그인 없음 401, 상태 그대로", async () => {
    for (const who of ["staff", "teacher", "principal", "vice"]) expect((await follow(who, inc, done())).status).toBe(403);
    expect((await follow("adminB", inc, done())).status).toBe(404);
    expect((await call("adminB", "POST", `!${school.b}/incidents/${inc}/followup`, done(), true)).status).toBe(404);
    const anon = await fetch(`${base}/api/schools/${school.a}/incidents/${inc}/followup`, { method: "POST", headers: { "content-type": "application/json", "idempotency-key": randomUUID() }, body: JSON.stringify(done()) });
    expect(anon.status).toBe(401);
    expect((await prisma.incidentReport.findUniqueOrThrow({ where: { id: inc } })).status).toBe("received");
  });
  it("종료된 모의훈련은 API·DB 모두 거부", async () => {
    const r = await follow("admin", drillInc, done());
    expect(r.status).toBe(409);
    expect(r.body.code).toBe("followup_real_only");
    await expect(prisma.incidentReport.update({ where: { id: drillInc }, data: { status: "resolved" } })).rejects.toThrow();
    await expect(prisma.incidentStatusHistory.create({ data: { incidentId: drillInc, fromStatus: "received", toStatus: "resolved", changedByMembershipId: M.admin! } })).rejects.toThrow();
  });
  it("입력 검증: 내용 필수, 같은 상태 거부, 세부 상태로 변경 불가, 미래·제보 이전 완료 시각 거부", async () => {
    expect((await follow("admin", inc, done({ note: " " }))).status).toBe(400);
    expect((await follow("admin", inc, { status: "received", expectedStatus: "checking", note: "정정 사유 입력" })).status).toBe(400);
    expect((await follow("admin", inc, { ...done(), status: "checking" })).status).toBe(400);
    expect((await follow("admin", inc, done({ completedAt: new Date(Date.now() + 3600_000).toISOString() }))).status).toBe(400);
    expect((await follow("admin", inc, done({ completedAt: "2000-01-01T00:00:00.000Z" }))).status).toBe(400);
    expect((await prisma.incidentStatusHistory.count({ where: { incidentId: inc } }))).toBe(0);
  });
  it("종료 후 일반 경로는 그대로 막힘: 상태 변경·후속 정보·사진·새 제보 409", async () => {
    expect((await call("admin", "POST", `/incidents/${inc}/status`, { status: "resolved", expectedStatus: "received" })).status).toBe(409);
    expect((await call("staff", "POST", `/incidents/${inc}/updates`, { kind: "action", note: "추가 조치 내용" }, true)).status).toBe(409);
    expect((await call("staff", "POST", `/events/${real}/incidents`, { type: "hazard", placeCategory: "hallway", description: "종료 후 새 제보" }, true)).status).toBe(409);
  });
  it("DB: 종료된 실제 재난도 본문 변경·삭제·다른 후속 종류·이력 수정은 거부", async () => {
    await expect(prisma.incidentReport.update({ where: { id: inc }, data: { description: "변조" } })).rejects.toThrow();
    await expect(prisma.incidentReport.delete({ where: { id: inc } })).rejects.toThrow();
    await expect(prisma.incidentUpdate.create({ data: { incidentId: inc, authorMembershipId: M.admin!, kind: "info", note: "x", idempotencyKey: randomUUID() } })).rejects.toThrow();
    await expect(prisma.incidentAttachment.create({ data: { incidentId: inc, schoolId: school.a, uploaderMembershipId: M.admin!, storageKey: `${"b".repeat(32)}.jpg`, mimeType: "image/jpeg", sizeBytes: 10, sha256: "x" } })).rejects.toThrow();
    await expect(prisma.auditLog.deleteMany({})).rejects.toThrow();
  });
});

describe("후속 조치 기록과 보고서", () => {
  it("완성본이 있는 상태에서 조치 완료: 원본·이력·조치 기록·감사 기록, 사건·학급·소재는 불변", async () => {
    const g0 = (await call("admin", "GET", `/drill-logs/${log}`)).body;
    expect((await call("admin", "PATCH", `/drill-logs/${log}`, { manual: g0.manual, status: "completed", expectedVersion: g0.log.version, refreshAuto: true })).status).toBe(200);
    const before = await frozen();
    const logBefore = await prisma.drillLog.findUniqueOrThrow({ where: { id: log } });
    const at = new Date().toISOString();
    const r = await follow("safety", inc, done({ completedAt: at }));
    expect(r.status).toBe(200);
    expect(r.body).toMatchObject({ status: "resolved", replayed: false });
    expect((await prisma.incidentReport.findUniqueOrThrow({ where: { id: inc } })).status).toBe("resolved");
    expect(await prisma.incidentStatusHistory.findMany({ where: { incidentId: inc }, select: { fromStatus: true, toStatus: true, changedByMembershipId: true } })).toEqual([{ fromStatus: "received", toStatus: "resolved", changedByMembershipId: M.safety }]);
    const u = await prisma.incidentUpdate.findFirstOrThrow({ where: { incidentId: inc } });
    expect(u.kind).toBe("action");
    expect(u.note).toContain("시설팀이 복구 완료");
    expect(u.note).toContain("완료 시각");
    const audit = await prisma.auditLog.findFirstOrThrow({ where: { action: "incident.followup_recorded", targetId: inc } });
    expect(audit.before).toEqual({ status: "received" });
    expect(audit.after).toEqual({ status: "resolved", eventStatus: "closed", completedAt: at });
    expect(JSON.stringify(audit.after)).not.toContain("시설팀");
    expect(await frozen()).toEqual(before);
    // 완성본은 몰래 바뀌지 않음
    expect(await prisma.drillLog.findUniqueOrThrow({ where: { id: log } })).toEqual(logBefore);
  });
  it("중복 클릭(같은 요청 번호)은 한 번만, 동시 요청은 하나만 성공", async () => {
    const key = randomUUID();
    const a = await follow("admin", inc2, done({ note: "1차 조치" }), key);
    const b = await follow("admin", inc2, done({ note: "1차 조치" }), key);
    expect([a.status, b.status]).toEqual([200, 200]);
    expect(b.body.replayed).toBe(true);
    expect(await prisma.incidentStatusHistory.count({ where: { incidentId: inc2 } })).toBe(1);
    expect((await follow("admin", inc2, { status: "received", expectedStatus: "resolved", note: "오기입 정정" })).status).toBe(200);
    const [x, y] = await Promise.all([follow("admin", inc2, done({ note: "재처리 A" })), follow("safety", inc2, done({ note: "재처리 B" }))]);
    expect([x.status, y.status].sort()).toEqual([200, 409]);
    expect(await prisma.incidentStatusHistory.count({ where: { incidentId: inc2 } })).toBe(3);
  });
  it("완료 취소는 정정 이력으로 남음(지우지 않음)", async () => {
    const r = await follow("admin", inc2, { status: "received", expectedStatus: "resolved", note: "복구 재확인 필요" });
    expect(r.status).toBe(200);
    const notes = (await prisma.incidentUpdate.findMany({ where: { incidentId: inc2 }, orderBy: { createdAt: "asc" } })).map((u) => u.note);
    expect(notes).toContain("[정정] 복구 재확인 필요");
    expect(notes).toContain("1차 조치");
    expect(await prisma.incidentStatusHistory.count({ where: { incidentId: inc2 } })).toBe(4);
    expect((await follow("admin", inc2, { status: "received", expectedStatus: "resolved", note: "정정 사유 입력", completedAt: new Date().toISOString() })).status).toBe(400);
  });
  it("보고서: 변경 알림 표시, 완성본은 이전 상태 유지, 일반 저장은 원본·스냅숏을 바꾸지 않음", async () => {
    const g = (await call("admin", "GET", `/drill-logs/${log}`)).body;
    expect(g.sourceChanges.join()).toContain("현장 제보·조치 기록이 바뀜");
    expect(statusCell(g.snapshot, g.manual, "복도천장제보")).toBe("조치 대기");
    const status = (await prisma.incidentReport.findUniqueOrThrow({ where: { id: inc2 } })).status;
    const save = await call("admin", "PATCH", `/drill-logs/${log}`, { manual: { ...g.manual, improvements: "일반 저장 내용" }, status: "completed", expectedVersion: g.log.version });
    expect(save.status).toBe(200);
    expect((await prisma.incidentReport.findUniqueOrThrow({ where: { id: inc2 } })).status).toBe(status);
    const after = (await call("admin", "GET", `/drill-logs/${log}`)).body;
    expect(statusCell(after.snapshot, after.manual, "복도천장제보")).toBe("조치 대기");
  });
  it("새 판: 원본과 일치, HWPX·인쇄 내용 일치, 이전 판 보존·내려받기, 충돌 검사, 교장 권한", async () => {
    const g = (await call("admin", "GET", `/drill-logs/${log}`)).body;
    const oldVersion = g.log.version as number;
    expect((await call("principal", "PATCH", `/drill-logs/${log}`, { manual: g.manual, status: "completed", expectedVersion: oldVersion, refreshAuto: true })).status).toBe(403);
    expect((await call("admin", "PATCH", `/drill-logs/${log}`, { manual: g.manual, status: "completed", expectedVersion: oldVersion - 1, refreshAuto: true })).status).toBe(409);
    expect((await call("admin", "PATCH", `/drill-logs/${log}`, { manual: g.manual, status: "completed", expectedVersion: oldVersion, refreshAuto: true })).status).toBe(200);
    const n = (await call("principal", "GET", `/drill-logs/${log}`)).body;
    expect(n.log).toMatchObject({ version: oldVersion + 1, status: "completed", final: true });
    expect(n.sourceChanges).toEqual([]);
    expect(statusCell(n.snapshot, n.manual, "복도천장제보")).toBe("조치 완료");
    expect(statusCell(n.snapshot, n.manual, "계단난간제보")).toBe("조치 대기");
    const doc = buildDrillDoc(n.snapshot, n.manual);
    expect(doc.pages[2]!.title).toBe("붙임 2. 현장 제보·조치 현황");
    const html = renderToStaticMarkup(createElement(DrillDocPreview, { doc }));
    const cur = await call("principal", "GET", `/drill-logs/${log}/export.hwpx`);
    expect(cur.status).toBe(200);
    const text = hwpxText(cur.buf);
    for (const t of ["조치 완료", "복도천장제보", "조치: 시설팀이 복구 완료"]) {
      expect(text).toContain(t);
      expect(html).toContain(t);
    }
    for (const out of [text, html]) for (const name of Object.values(names)) expect(out).not.toContain(name);
    const old = await call("principal", "GET", `/drill-logs/${log}/export.hwpx?version=${oldVersion}`);
    expect(old.status).toBe(200);
    expect(decodeURIComponent(old.headers.get("content-disposition") ?? "")).toContain(`_판${oldVersion}`);
    const oldText = hwpxText(old.buf);
    expect(oldText).toContain("복도천장제보");
    expect(oldText).not.toContain("조치: 시설팀이 복구 완료");
    expect((await call("principal", "GET", `/drill-logs/${log}/export.hwpx?version=999`)).status).toBe(404);
    expect((await call("principal", "GET", `/drill-logs/${log}/export.hwpx?version=abc`)).status).toBe(404);
    expect((await call("staff", "GET", `/drill-logs/${log}/export.hwpx?version=${oldVersion}`)).status).toBe(403);
    const rows = await prisma.drillLogRevision.findMany({ where: { drillLogId: log }, orderBy: { version: "asc" } });
    expect(rows.map((r) => r.version)).toEqual(Array.from({ length: oldVersion + 1 }, (_, i) => i + 1));
  });
  it("원본 제보 본문·이력 보존", async () => {
    expect((await prisma.incidentReport.findUniqueOrThrow({ where: { id: inc } })).status).toBe("resolved");
    expect(await prisma.incidentStatusHistory.count({ where: { incidentId: inc } })).toBe(1);
    expect((await prisma.incidentReport.findUniqueOrThrow({ where: { id: inc } })).description).toBe("복도천장제보");
  });
  it("작성 중 보고서: 후속 조치 후 다시 불러오면 최신 상태가 새 판으로 반영", async () => {
    const ev = (await call("admin", "POST", "/events", { primaryType: "earthquake", mode: "real", confirmReal: true })).body.event.id as string;
    const id = (await call("staff", "POST", `/events/${ev}/incidents`, { type: "hazard", placeCategory: "hallway", description: "초안연동제보" }, true)).body.id as string;
    const draft = (await call("safety", "POST", `/events/${ev}/drill-log`, {})).body.id as string;
    expect((await call("admin", "POST", `/events/${ev}/close`, { confirmClose: true })).status).toBe(200);
    const g0 = (await call("safety", "GET", `/drill-logs/${draft}`)).body;
    const refreshed = await call("safety", "PATCH", `/drill-logs/${draft}`, { manual: g0.manual, status: "draft", expectedVersion: g0.log.version, refreshAuto: true });
    expect(refreshed.status).toBe(200);
    expect((await follow("safety", id, done({ note: "초안 중 조치 완료" }))).status).toBe(200);
    const g1 = (await call("safety", "GET", `/drill-logs/${draft}`)).body;
    expect(g1.sourceChanges.length).toBeGreaterThan(0);
    expect(statusCell(g1.snapshot, g1.manual, "초안연동제보")).toBe("조치 대기");
    expect((await call("safety", "PATCH", `/drill-logs/${draft}`, { manual: g1.manual, status: "draft", expectedVersion: g1.log.version, refreshAuto: true })).status).toBe(200);
    const g2 = (await call("safety", "GET", `/drill-logs/${draft}`)).body;
    expect(g2.log.status).toBe("draft");
    expect(g2.sourceChanges).toEqual([]);
    expect(statusCell(g2.snapshot, g2.manual, "초안연동제보")).toBe("조치 완료");
  });
});
