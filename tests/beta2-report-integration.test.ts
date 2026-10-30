// Beta PILOT 2 Phase 4-D: 보고서 통합 회귀(HTTP, 테스트 스키마, 가상 학교·가상 교직원만)
// 한 학교에서 모의훈련 → 실제 재난을 차례로 진행하고, 최종 출력물(내려받은 HWPX, 인쇄·PDF용 A4 HTML)을 직접 열어 검사합니다.
// - 출력물에 교직원 이름·교내 위치·소속 id 가 없음(실제 재난은 익명 숫자만, 모의훈련은 소재 붙임 자체가 없음)
// - 학급 미보고와 교직원 미응답은 따로 집계, 동시 생성은 1건, 동시 저장은 1건만 반영
// - 한글 제목·표제어, 쪽 나눔(배치 검사·A4 높이), 붙임 표 머리글 반복 표식
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { Server } from "node:http";
import { randomUUID } from "node:crypto";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { inflateRawSync } from "node:zlib";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import type { PrismaClient } from "@prisma/client";
import { createTestClient, getTestDatabaseUrl, resetTestData } from "./test-db";
import { buildDrillDoc, checkDoc, defaultManual, markDraft, type DrillManual, type DrillSnapshot } from "../shared/drillLog";
import { DrillDocPreview } from "../client/src/pages/drill/DrillDocPreview";

const PASSWORD = "report-int-password-1234";
const PLACE = "과학관 2층 준비실"; // 교직원이 응답한 교내 위치(출력물에 나오면 안 됨)
let prisma: PrismaClient;
let server: Server;
let base = "";
let uploadDir = "";
let schoolId = "";
const classIds: string[] = [];
const M: Record<string, string> = {};
const NAME: Record<string, string> = {};
const cookie: Record<string, string> = {};
const ip: Record<string, string> = {};
let drill = "";
let real = "";
let drillLog = "";
let realLog = "";

/** HWPX(ZIP) 안의 본문 XML 모두 이어 붙이기(지역 헤더 순서대로) */
function hwpxText(buf: Buffer) {
  let i = 0;
  let text = "";
  while (buf.readUInt32LE(i) === 0x04034b50) {
    const method = buf.readUInt16LE(i + 8), size = buf.readUInt32LE(i + 18), nlen = buf.readUInt16LE(i + 26), xlen = buf.readUInt16LE(i + 28);
    const name = buf.subarray(i + 30, i + 30 + nlen).toString("utf8");
    const body = buf.subarray(i + 30 + nlen + xlen, i + 30 + nlen + xlen + size);
    if (name.startsWith("Contents/") && name.endsWith(".xml")) text += (method === 8 ? inflateRawSync(body) : Buffer.from(body)).toString("utf8");
    i += 30 + nlen + xlen + size;
  }
  return text;
}

async function call(who: string, method: string, p: string, body?: unknown, headers: Record<string, string> = {}) {
  const res = await fetch(`${base}/api${p}`, {
    method,
    headers: { cookie: cookie[who] ?? "", "x-forwarded-for": ip[who] ?? "198.51.100.171", ...(body === undefined ? { "x-requested-with": "safe-school" } : { "content-type": "application/json" }), ...headers },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const type = res.headers.get("content-type") ?? "";
  const raw = type.includes("json") ? await res.text() : "";
  return { status: res.status, raw, body: (raw ? JSON.parse(raw) : {}) as Record<string, any> };
}
const S = (p: string) => `/schools/${schoolId}${p}`;
const key = () => ({ "idempotency-key": randomUUID() });
const save = (who: string, logId: string, version: number, over: { manual?: object; status?: "draft" | "completed"; refreshAuto?: boolean } = {}) =>
  call(who, "PATCH", S(`/drill-logs/${logId}`), { manual: over.manual ?? defaultManual(), status: over.status ?? "draft", expectedVersion: version, ...(over.refreshAuto ? { refreshAuto: true } : {}) });
const exportHwpx = async (who: string, logId: string) => {
  const res = await fetch(`${base}/api${S(`/drill-logs/${logId}/export.hwpx`)}`, { headers: { cookie: cookie[who]!, "x-forwarded-for": ip[who]! } });
  return { status: res.status, name: decodeURIComponent(res.headers.get("content-disposition") ?? ""), text: res.status === 200 ? hwpxText(Buffer.from(await res.arrayBuffer())) : "" };
};
/** 화면의 인쇄(PDF로 저장)와 같은 A4 HTML: 같은 컴포넌트, 최종본이 아니면 초안 표시 */
const printHtml = async (who: string, logId: string) => {
  const g = await call(who, "GET", S(`/drill-logs/${logId}`));
  const doc = buildDrillDoc(g.body.snapshot as DrillSnapshot, g.body.manual as DrillManual);
  const shown = g.body.log.final ? doc : markDraft(doc);
  return { doc: shown, html: renderToStaticMarkup(createElement(DrillDocPreview, { doc: shown })), body: g.body };
};
const personal = () => new RegExp([...Object.values(NAME), PLACE, ...Object.values(M)].join("|"));

beforeAll(async () => {
  uploadDir = await fs.mkdtemp(path.join(os.tmpdir(), "safeschool-report-int-"));
  process.env.INCIDENT_UPLOAD_DIR = uploadDir;
  process.env.DATABASE_URL = getTestDatabaseUrl();
  prisma = createTestClient();
  await resetTestData(prisma);
  const { hashPassword } = await import("../server/src/security/password");
  const { grantDutyByPlatformOperator } = await import("../server/src/services/duties");
  const { currentSchoolYear } = await import("../server/src/services/events");
  const passwordHash = await hashPassword(PASSWORD);
  const now = new Date();
  schoolId = (await prisma.school.create({ data: { slug: "report-int", name: "가상 통합학교", isDemo: true, status: "active", activatedAt: now } })).id;
  for (const classNo of [1, 2]) {
    classIds.push((await prisma.schoolClass.create({ data: { schoolId, schoolYear: currentSchoolYear(), grade: 2, classNo, label: `2학년 ${classNo}반`, enrolledCount: 25, enrolledConfirmedAt: now } })).id);
  }
  const people: { key: string; role: "admin" | "homeroom" | "staff"; name: string }[] = [
    { key: "admin", role: "admin", name: "남궁관리" },
    { key: "safety", role: "staff", name: "제갈안전" },
    { key: "teacher", role: "homeroom", name: "선우담임" },
    { key: "nurse", role: "staff", name: "독고보건" },
    { key: "office", role: "staff", name: "황보행정" },
  ];
  for (const [i, p] of people.entries()) {
    const user = await prisma.user.create({ data: { email: `${p.key}@report-int.safeschool.invalid`, displayName: p.name, passwordHash, emailVerifiedAt: now } });
    NAME[p.key] = p.name;
    M[p.key] = (await prisma.schoolMembership.create({ data: { schoolId, userId: user.id, role: p.role, status: "approved", approvalMethod: "roster", approvedAt: now } })).id;
    ip[p.key] = `203.0.113.${200 + i}`;
  }
  await prisma.classAssignment.create({ data: { membershipId: M.teacher!, classId: classIds[0]!, duty: "homeroom" } }); // 2학년 2반은 담임 없음 → 미보고
  await grantDutyByPlatformOperator(prisma, { membershipId: M.safety!, duty: "safety_officer", operator: "통합 테스트", verificationMethod: "테스트" });
  const { createApp } = await import("../server/src/app");
  const http = await import("node:http");
  server = http.createServer(await createApp({ mode: "test", trustProxyHops: 1 }));
  await new Promise<void>((r) => server.listen(0, "127.0.0.1", () => r()));
  const addr = server.address();
  base = `http://127.0.0.1:${typeof addr === "object" && addr ? addr.port : 0}`;
  for (const p of people) {
    const res = await fetch(`${base}/api/auth/login`, { method: "POST", headers: { "content-type": "application/json", "x-forwarded-for": ip[p.key]! }, body: JSON.stringify({ email: `${p.key}@report-int.safeschool.invalid`, password: PASSWORD, deviceKind: "personal" }) });
    expect(res.status).toBe(200);
    cookie[p.key] = res.headers.get("set-cookie")!.split(";")[0]!;
  }
});

afterAll(async () => {
  await new Promise<void>((r) => server.close(() => r()));
  await prisma.$disconnect();
  await fs.rm(uploadDir, { recursive: true, force: true });
});

const reportClass = (eventId: string) =>
  call("teacher", "PUT", S(`/events/${eventId}/reports/${classIds[0]}`), { evacuated: 23, absentKnown: 1, injured: 0, enrolledCount: 25, enrolledChangeReason: null, note: null, expectedVersion: null }, key());
const incident = async (eventId: string) => {
  const r = await call("nurse", "POST", S(`/events/${eventId}/incidents`), { type: "hazard", placeCategory: "hallway", placeDetail: "본관 2층", description: `${NAME.teacher} 선생님 반 앞 복도 천장 마감재가 떨어짐` }, key());
  expect(r.status).toBe(201);
  expect((await call("safety", "POST", S(`/incidents/${r.body.id}/updates`), { kind: "action", note: "출입을 통제하고 우회로를 안내함" }, key())).status).toBe(201);
};

describe("모의훈련 → 훈련일지 최종본(출력물 검사)", () => {
  it("동시 생성 3건 요청 → 보고서 1건(같은 id), 서식은 모의훈련", async () => {
    drill = (await call("admin", "POST", S("/events"), { primaryType: "fire", mode: "drill" })).body.event.id;
    expect((await reportClass(drill)).status).toBe(200);
    await incident(drill);
    const rs = await Promise.all([1, 2, 3].map(() => call("safety", "POST", S(`/events/${drill}/drill-log`), {})));
    expect(new Set(rs.map((r) => r.body.id)).size).toBe(1);
    expect(rs.filter((r) => r.status === 201)).toHaveLength(1);
    drillLog = rs[0]!.body.id;
    expect(await prisma.drillLog.count({ where: { eventId: drill } })).toBe(1);
    expect((await prisma.drillLog.findUniqueOrThrow({ where: { id: drillLog } })).formKey).toBe("evacuation_drill");
  });

  it("모의훈련은 교직원 소재 응답 자체를 받지 않음(저장 0건)", async () => {
    const r = await call("nurse", "PUT", S(`/events/${drill}/presence/me`), { location: "on_campus", placeCategory: "classroom", placeDetail: PLACE, availability: "available", expectedVersion: null }, key());
    expect(r.status).toBeGreaterThanOrEqual(400);
    expect(await prisma.staffPresence.count({ where: { eventId: drill } })).toBe(0);
  });

  it("작성 중 인쇄본: '작성 중 초안' 표시, 소재 붙임·숫자 없음", async () => {
    const { doc, html } = await printHtml("safety", drillLog);
    expect(doc.pages[0]!.subtitle).toContain("작성 중 초안(최종본 아님)");
    expect(html).not.toMatch(/교직원 소재|미응답|targetCount/);
    expect(html).not.toContain(PLACE);
  });

  it("최종본: 종료 → 다시 불러오며 완료, 인쇄본·HWPX 모두 한글 제목·붙임 2쪽, 소재 정보 없음, 초안 표시 없음", async () => {
    expect((await call("admin", "POST", S(`/events/${drill}/close`), {})).status).toBe(200);
    expect((await save("safety", drillLog, 1, { status: "completed", refreshAuto: true })).status).toBe(200);
    const { doc, html } = await printHtml("safety", drillLog);
    expect(doc.pages.map((p) => p.title)).toEqual(["비상대피훈련일지(화재)", "붙임 1. 학급별 대피 현황", "붙임 2. 현장 제보·조치 현황"]);
    expect(checkDoc(doc, { height: true })).toEqual([]);
    expect(html).toContain("비상대피훈련일지(화재)");
    expect(html).not.toContain("작성 중 초안");
    expect(html).not.toMatch(/교직원 소재|미응답/);
    expect(html.match(/<section/g)).toHaveLength(3); // 문서 쪽 수 = 인쇄 쪽 수(쪽마다 A4 한 장)
    const hw = await exportHwpx("safety", drillLog);
    expect(hw.status).toBe(200);
    expect(hw.name).not.toContain("초안");
    expect(hw.text).toContain("비상대피훈련일지(화재)");
    expect(hw.text).not.toMatch(/교직원 소재|미응답/);
    expect(hw.text).not.toContain(PLACE);
  });
});

describe("실제 재난 → 재난대피일지(출력물 검사)", () => {
  it("진행 중 작성 → 소재 응답 2명(교내 위치 포함·교외), 미응답 3명, 학급 1곳 미보고", async () => {
    real = (await call("safety", "POST", S("/events"), { primaryType: "earthquake", mode: "real", confirmReal: true })).body.event.id;
    expect((await reportClass(real)).status).toBe(200);
    await incident(real);
    expect((await call("nurse", "PUT", S(`/events/${real}/presence/me`), { location: "on_campus", placeCategory: "classroom", placeDetail: PLACE, availability: "available", expectedVersion: null }, key())).status).toBe(200);
    expect((await call("office", "PUT", S(`/events/${real}/presence/me`), { location: "off_campus", availability: "unsure", expectedVersion: null }, key())).status).toBe(200);
    const r = await call("admin", "POST", S(`/events/${real}/drill-log`), {});
    expect(r.status).toBe(201);
    realLog = r.body.id;
    const { doc, body } = await printHtml("admin", realLog);
    expect(body.log).toMatchObject({ formKey: "disaster_real", eventStatus: "active", final: false });
    expect(doc.pages[0]!.subtitle).toContain("작성 중 초안(최종본 아님)");
    const snap = body.snapshot as DrillSnapshot;
    expect(snap.presence).toMatchObject({ targetCount: 5, respondedCount: 2, notRespondedCount: 3, onCampus: 1, offCampus: 1, available: 1, unsure: 1 });
    expect(snap.classes.filter((c) => !c.report).map((c) => c.label)).toEqual(["2학년 2반"]); // 학급 미보고 ≠ 교직원 미응답
  });

  it("종료 전 완료 409, 동시 저장은 1건만 반영(나머지 409)", async () => {
    expect((await save("admin", realLog, 1, { status: "completed" })).body.code).toBe("event_not_closed");
    const rs = await Promise.all([save("admin", realLog, 1, { manual: { ...defaultManual(), improvements: "가" } }), save("safety", realLog, 1, { manual: { ...defaultManual(), improvements: "나" } })]);
    expect(rs.map((r) => r.status).sort()).toEqual([200, 409]);
    expect((await prisma.drillLog.findUniqueOrThrow({ where: { id: realLog } })).version).toBe(2);
  });

  it("최종본 인쇄본·HWPX: 제목·표제어·붙임 3(익명 숫자), 이름·교내 위치·소속 id 없음, 미보고·미응답 따로 표시", async () => {
    expect((await call("safety", "POST", S(`/events/${real}/close`), { confirmClose: true })).status).toBe(200);
    const manual = { ...defaultManual(), staffCount: "5", trainingNote: "지진 경보 후 운동장 대피", improvements: "2학년 2반 담임 배정 후 보고 절차 안내" };
    expect((await save("safety", realLog, 2, { manual, status: "completed", refreshAuto: true })).status).toBe(200);
    const { doc, html, body } = await printHtml("admin", realLog);
    expect(body.log).toMatchObject({ status: "completed", final: true, privacyIssues: [] });
    expect(doc.pages.map((p) => p.title)).toEqual(["재난대피일지(지진)", "붙임 1. 학급별 대피 현황", "붙임 2. 현장 제보·조치 현황", "붙임 3. 교직원 소재 응답 통계(익명 집계)"]);
    expect(checkDoc(doc, { height: true })).toEqual([]);
    expect(html.match(/<section/g)).toHaveLength(4);
    expect(html.match(/<thead/g)?.length).toBeGreaterThanOrEqual(2); // 붙임 표 머리글 반복
    for (const out of [html, (await exportHwpx("admin", realLog)).text]) {
      expect(out).toContain("재난대피일지(지진)");
      expect(out).toContain("학생 재실");
      expect(out).toContain("미응답(추정 안 함)");
      expect(out).toContain("미보고");
      expect(out).toContain("○○○ 선생님");
      expect(out).not.toMatch(personal());
      expect(out).not.toContain("작성 중 초안");
      expect(out).not.toContain("비상대피훈련일지");
    }
    const hw = await exportHwpx("admin", realLog);
    expect(hw.status).toBe(200);
    expect(hw.name).not.toContain("초안");
  });

  it("보고서 API 응답에도 교직원 이름·교내 위치·소속 id 없음(숨김이 아니라 반환 안 함) — 보고서 작성·수정자 기록만 예외", async () => {
    // 작성·수정자 이름(createdByName·updatedByName·판 기록)은 보고서를 누가 고쳤는지의 기존 감사 기록이며 소재 정보가 아님(정책 미확정 항목으로 보고)
    for (const who of ["admin", "safety"]) {
      const g = (await call(who, "GET", S(`/drill-logs/${realLog}`))).body;
      expect([g.log.createdByName, g.log.updatedByName]).toEqual([NAME.admin, NAME.safety]);
      const { createdByName: _c, updatedByName: _u, ...logRest } = g.log;
      expect(JSON.stringify({ ...g, log: logRest, revisions: g.revisions.map(({ changedByName: _n, ...r }: Record<string, unknown>) => r) })).not.toMatch(personal());
      const l = (await call(who, "GET", S("/drill-logs"))).body;
      const events = l.events.map((e: Record<string, any>) => (e.log ? { ...e, log: { ...e.log, updatedByName: undefined } } : e));
      expect(JSON.stringify({ ...l, events })).not.toMatch(personal());
    }
  });
});
