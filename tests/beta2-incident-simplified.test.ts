// 2026-11-02 사용자 검증 반영: 모의훈련 일지에 현장 제보 없음, 처리 상태 두 가지(저장값·이력은 보존), 재난대피일지에 상태 반영(HTTP, 테스트 스키마, 가상 자료만)
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { randomUUID } from "node:crypto";
import { inflateRawSync } from "node:zlib";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import type { Server } from "node:http";
import type { PrismaClient } from "@prisma/client";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { createTestClient, getTestDatabaseUrl, resetTestData } from "./test-db";
import { DrillDocPreview } from "../client/src/pages/drill/DrillDocPreview";
import { buildDrillDoc, defaultManual, diffSnapshots, reportStatusLabel, type DrillManual, type DrillSnapshot } from "../shared/drillLog";
import { INCIDENT_STATUS_CHOICES, INCIDENT_STATUS_LABEL, INCIDENT_STATUSES, incidentStatusChangeText } from "../shared/incident";

let prisma: PrismaClient;
let server: Server;
let base = "";
let school = "";
let otherSchool = "";
let tmp = "";
const cookie: Record<string, string> = {};
const names: Record<string, string> = {};

async function call(who: string, method: string, p: string, body?: unknown, idem = false) {
  const res = await fetch(`${base}/api/schools/${p.startsWith("!") ? p.slice(1) : `${school}${p}`}`, {
    method,
    headers: { cookie: cookie[who] ?? "", ...(body === undefined ? { "x-requested-with": "safe-school" } : { "content-type": "application/json" }), ...(idem ? { "idempotency-key": randomUUID() } : {}) },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const buf = Buffer.from(await res.arrayBuffer());
  return { status: res.status, buf, body: (res.headers.get("content-type") ?? "").includes("json") ? (JSON.parse(buf.toString("utf8")) as Record<string, any>) : {} };
}
const incident = async (eventId: string, description: string) => (await call("staff", "POST", `/events/${eventId}/incidents`, { type: "facility_damage", placeCategory: "hallway", placeDetail: "가상 복도", description }, true)).body.id as string;
/** HWPX(ZIP)의 본문 XML에서 글자만 꺼냄 */
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
  return { text: [...xml.matchAll(/<hp:t[^>]*>([^<]*)<\/hp:t>/g)].map((m) => m[1]).join("\n") };
}

beforeAll(async () => {
  tmp = fs.mkdtempSync(path.join(os.tmpdir(), "safeschool-simple-"));
  process.env.INCIDENT_UPLOAD_DIR = tmp;
  process.env.DATABASE_URL = getTestDatabaseUrl();
  prisma = createTestClient();
  await resetTestData(prisma);
  const { createSession, SESSION_COOKIE } = await import("../server/src/auth/session");
  const { grantDutyByPlatformOperator } = await import("../server/src/services/duties");
  const now = new Date();
  school = (await prisma.school.create({ data: { slug: "simple-a", name: "가상 간소화학교", isDemo: true, status: "active", activatedAt: now } })).id;
  otherSchool = (await prisma.school.create({ data: { slug: "simple-b", name: "가상 다른학교", isDemo: true, status: "active", activatedAt: now } })).id;
  for (const [key, role, s] of [["admin", "admin", school], ["safety", "staff", school], ["staff", "staff", school], ["otherAdmin", "admin", otherSchool]] as const) {
    names[key] = `가상담당 ${key}`;
    const user = await prisma.user.create({ data: { email: `${key.toLowerCase()}@simple.safeschool.invalid`, displayName: names[key]!, passwordHash: "x", emailVerifiedAt: now } });
    const m = await prisma.schoolMembership.create({ data: { schoolId: s, userId: user.id, role, status: "approved", approvalMethod: "roster", approvedAt: now } });
    if (key === "safety") await grantDutyByPlatformOperator(prisma, { membershipId: m.id, duty: "safety_officer", operator: "테스트", verificationMethod: "테스트" });
    cookie[key] = `${SESSION_COOKIE}=${(await createSession(prisma, { userId: user.id, deviceKind: "personal" })).token}`;
  }
  const { createApp } = await import("../server/src/app");
  const http = await import("node:http");
  server = http.createServer(await createApp({ mode: "test", trustProxyHops: 1 }));
  await new Promise<void>((r) => server.listen(0, "127.0.0.1", () => r()));
  const addr = server.address();
  base = `http://127.0.0.1:${typeof addr === "object" && addr ? addr.port : 0}`;
}, 30000);
afterAll(async () => {
  await new Promise<void>((r) => server.close(() => r()));
  await prisma.$disconnect();
  fs.rmSync(tmp, { recursive: true, force: true });
});

describe("상태 표시 매핑", () => {
  it("미완료 세 값은 조치 대기, 완료만 조치 완료. 저장값 enum은 그대로", () => {
    expect(INCIDENT_STATUSES).toEqual(["received", "checking", "in_progress", "resolved"]);
    expect(INCIDENT_STATUSES.map((s) => INCIDENT_STATUS_LABEL[s])).toEqual(["조치 대기", "조치 대기", "조치 대기", "조치 완료"]);
    expect(INCIDENT_STATUS_CHOICES.map((s) => INCIDENT_STATUS_LABEL[s])).toEqual(["조치 대기", "조치 완료"]);
    for (const old of ["접수", "확인 중", "조치 중"]) expect(reportStatusLabel(old)).toBe("조치 대기");
    expect(reportStatusLabel("조치 완료")).toBe("조치 완료");
  });
  it("이력 문구: 세부 변경도 사실대로, 두 상태 사이는 간단히", () => {
    expect(incidentStatusChangeText("received", "checking")).toBe("조치 대기(세부 기록: 접수 → 확인 중)");
    expect(incidentStatusChangeText("in_progress", "resolved")).toBe("조치 대기 → 조치 완료");
  });
});

describe("비상대피훈련일지", () => {
  it("모의훈련 제보가 있어도 스냅숏·화면·인쇄·HWPX에 제보 없음, 원본 제보·이력은 보존, 붙임 번호 정리", async () => {
    const ev = (await call("safety", "POST", "/events", { primaryType: "fire", mode: "drill" })).body.event.id as string;
    const id = await incident(ev, "훈련제보고유문구 복도 창문");
    expect((await call("safety", "POST", `/incidents/${id}/status`, { status: "resolved", expectedStatus: "received" })).status).toBe(200);
    const log = (await call("safety", "POST", `/events/${ev}/drill-log`, {})).body.id as string;
    expect((await call("safety", "POST", `/events/${ev}/close`, {})).status).toBe(200);
    const g0 = (await call("safety", "GET", `/drill-logs/${log}`)).body;
    expect((await call("safety", "PATCH", `/drill-logs/${log}`, { manual: g0.manual, status: "completed", expectedVersion: g0.log.version, refreshAuto: true })).status).toBe(200);
    const g = (await call("safety", "GET", `/drill-logs/${log}`)).body;
    const snap = g.snapshot as DrillSnapshot;
    expect(snap.incidents).toEqual([]);
    expect(g.sourceChanges).toEqual([]);
    const doc = buildDrillDoc(snap, g.manual as DrillManual);
    expect(doc.pages.map((p) => p.title)).toEqual(["비상대피훈련일지(화재)", "붙임. 학급별 대피 현황"]);
    expect(doc.pages[0]!.footnote).toContain("붙임  학급별 대피 현황 1부.");
    const html = renderToStaticMarkup(createElement(DrillDocPreview, { doc }));
    expect(html).not.toMatch(/현장 제보|훈련제보고유문구|붙임 1\.|붙임 2/);
    const x = await call("safety", "GET", `/drill-logs/${log}/export.hwpx`);
    expect(x.status).toBe(200);
    expect(hwpxText(x.buf).text).not.toMatch(/현장 제보|훈련제보고유문구|붙임 2/);
    const row = await prisma.incidentReport.findUniqueOrThrow({ where: { id } });
    expect(row.status).toBe("resolved");
    expect(row.description).toContain("훈련제보고유문구");
    expect(await prisma.incidentStatusHistory.count({ where: { incidentId: id } })).toBe(1);
  });
  it("이전에 제보를 담아 저장한 훈련일지도 제보 없이 출력, 원본 변경 알림도 없음", () => {
    const saved = { takenAt: "2026-10-30T01:40:00.000Z", schoolName: "가상", event: { id: "e", type: "fire", typeLabel: "화재", extraTypeLabels: [], mode: "drill", startedAt: "2026-10-30T01:00:00.000Z", closedAt: "2026-10-30T01:30:00.000Z", evacPlace: null, location: null, issuedByName: null, closedByName: null }, classes: [], incidents: [{ no: 1, typeLabel: "위험 발견", placeLabel: "복도", createdAt: "2026-10-30T01:05:00.000Z", statusLabel: "조치 중", updateCount: 0, actionCount: 0, summary: "옛제보문구", lastAction: null }], maskedCount: 0 } as DrillSnapshot;
    expect(JSON.stringify(buildDrillDoc(saved, defaultManual()))).not.toContain("옛제보문구");
    expect(diffSnapshots(saved, { ...saved, incidents: [] })).toEqual([]);
  });
});

describe("재난대피일지와 처리 상태", () => {
  let ev = "";
  let log = "";
  let pending = "";
  let done = "";
  it("새 제보는 조치 대기, 자동 완료 없음. 종료 후에도 저절로 완료되지 않음", async () => {
    ev = (await call("admin", "POST", "/events", { primaryType: "fire", mode: "real", confirmReal: true })).body.event.id;
    pending = await incident(ev, "대기제보 복도 천장");
    done = await incident(ev, "완료제보 계단 난간");
    const named = await incident(ev, `가림제보 ${names.safety} 선생님 반 앞`);
    expect((await call("safety", "POST", `/incidents/${named}/updates`, { kind: "action", note: `${names.admin} 담당이 출입을 통제함` }, true)).status).toBe(201);
    expect((await call("staff", "GET", `/incidents/${pending}`)).body.incident.status).toBe("received");
  });
  it("상태 변경 권한: 일반 교직원 403, 다른 학교 404, 담당자 200, 이력·감사 기록 유지, 원본 상태 보존", async () => {
    const body = { status: "resolved", expectedStatus: "received" };
    expect((await call("staff", "POST", `/incidents/${done}/status`, body)).status).toBe(403);
    expect((await call("otherAdmin", "POST", `!${otherSchool}/incidents/${done}/status`, body)).status).toBe(404);
    expect((await call("otherAdmin", "POST", `/incidents/${done}/status`, body)).status).toBe(404);
    expect((await prisma.incidentReport.findUniqueOrThrow({ where: { id: done } })).status).toBe("received");
    expect((await call("safety", "POST", `/incidents/${done}/status`, body)).status).toBe(200);
    expect(await prisma.incidentStatusHistory.findMany({ where: { incidentId: done }, select: { fromStatus: true, toStatus: true } })).toEqual([{ fromStatus: "received", toStatus: "resolved" }]);
    const audits = await prisma.auditLog.findMany({ where: { action: "incident.status_changed", targetId: done } });
    expect(audits).toHaveLength(1);
    expect(audits[0]!.after).toEqual({ status: "resolved" });
  });
  it("조치 완료에서 조치 대기로 되돌림, 다시 완료(이력 누적)", async () => {
    const tmpInc = await incident(ev, "되돌림제보");
    expect((await call("safety", "POST", `/incidents/${tmpInc}/status`, { status: "resolved", expectedStatus: "received" })).status).toBe(200);
    expect((await call("safety", "POST", `/incidents/${tmpInc}/status`, { status: "received", expectedStatus: "resolved" })).status).toBe(200);
    expect(await prisma.incidentStatusHistory.count({ where: { incidentId: tmpInc } })).toBe(2);
  });
  it("이전 세부 상태(checking)는 API·저장값이 그대로이며 조치 대기로 출력", async () => {
    const legacy = await incident(ev, "세부상태제보");
    expect((await call("safety", "POST", `/incidents/${legacy}/status`, { status: "checking", expectedStatus: "received" })).status).toBe(200);
    expect((await prisma.incidentReport.findUniqueOrThrow({ where: { id: legacy } })).status).toBe("checking");
  });
  it("보고서: 제보·상태 반영, 보고서 저장이 원본 제보를 바꾸지 않음, 개인정보·작성자 없음", async () => {
    log = (await call("admin", "POST", `/events/${ev}/drill-log`, {})).body.id;
    expect((await call("admin", "POST", `/events/${ev}/close`, { confirmClose: true })).status).toBe(200);
    const before = await prisma.incidentReport.findMany({ where: { eventId: ev }, select: { id: true, status: true, lastActivityAt: true }, orderBy: { id: "asc" } });
    const historyBefore = await prisma.incidentStatusHistory.count();
    const g0 = (await call("admin", "GET", `/drill-logs/${log}`)).body;
    expect((await call("admin", "PATCH", `/drill-logs/${log}`, { manual: g0.manual, status: "completed", expectedVersion: g0.log.version, refreshAuto: true })).status).toBe(200);
    expect(await prisma.incidentReport.findMany({ where: { eventId: ev }, select: { id: true, status: true, lastActivityAt: true }, orderBy: { id: "asc" } })).toEqual(before);
    expect(await prisma.incidentStatusHistory.count()).toBe(historyBefore);
    const g = (await call("admin", "GET", `/drill-logs/${log}`)).body;
    const doc = buildDrillDoc(g.snapshot as DrillSnapshot, g.manual as DrillManual);
    expect(doc.pages.map((p) => p.title)).toEqual(["재난대피일지(화재)", "붙임 1. 학급별 대피 현황", "붙임 2. 현장 제보·조치 현황", "붙임 3. 교직원 소재 응답 통계(익명 집계)"]);
    const cells = doc.pages[2]!.table.cells;
    expect(cells.filter((c) => c.r === 0).map((c) => c.text)).toEqual(["시각", "장소", "현장 제보 내용", "처리 상태"]);
    const statusOf = (word: string) => { const r = cells.find((c) => c.text.includes(word))!.r; return cells.filter((c) => c.r === r).at(-1)!.text; };
    expect(statusOf("대기제보")).toBe("조치 대기");
    expect(statusOf("완료제보")).toBe("조치 완료");
    expect(statusOf("세부상태제보")).toBe("조치 대기");
    const maskedRow = cells.find((c) => c.text.includes("가림제보"))!.text;
    expect(maskedRow).toContain("○○○ 선생님");
    expect(maskedRow).toContain("○○○ 담당이 출입을 통제함");
    expect(JSON.stringify(g.snapshot)).not.toContain(names.safety);
    expect(JSON.stringify(g.snapshot.incidents)).not.toContain(names.staff); // 제보자 이름 없음
    const x = await call("admin", "GET", `/drill-logs/${log}/export.hwpx`);
    expect(x.status).toBe(200);
    const { text } = hwpxText(x.buf);
    for (const t of ["재난대피일지(화재)", "붙임 2. 현장 제보·조치 현황", "조치 대기", "조치 완료", "대기제보", "교직원 소재 응답 통계"]) expect(text).toContain(t);
    expect(text).not.toMatch(/훈련|확인 중|조치 중/);
    for (const n of Object.values(names)) expect(text).not.toContain(n);
    const html = renderToStaticMarkup(createElement(DrillDocPreview, { doc }));
    expect(html).toContain("조치 대기");
    for (const n of Object.values(names)) expect(html).not.toContain(n);
    expect((await prisma.incidentReport.findUniqueOrThrow({ where: { id: pending } })).status).toBe("received");
  });
  it("종료 후 상태 변경은 거부(원본 보호)", async () => {
    const r = await call("safety", "POST", `/incidents/${pending}/status`, { status: "resolved", expectedStatus: "received" });
    expect(r.status).toBe(409);
    expect((await prisma.incidentReport.findUniqueOrThrow({ where: { id: pending } })).status).toBe("received");
  });
});
