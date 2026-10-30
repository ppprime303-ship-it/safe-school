// Beta PILOT 2 Phase 4-B: 모의훈련 일지·실제 재난 상황보고서 API(HTTP, 테스트 스키마, 가상 학교·가상 교직원만)
// - 서식은 사건의 서버 측 mode 로 결정, 진행 중에도 작성 중 생성(완료·최종본은 종료 후 + 종료 뒤 다시 불러오기)
// - 모의훈련: 기존 권한(작성은 안전업무 담당만), 교직원 소재는 조회·저장·출력하지 않음
// - 실제 재난: 작성은 학교 관리자·안전업무 담당, 교직원 소재는 익명 집계만(API 응답에 이름·위치·소속 id 없음)
// - 현장 제보·조치는 제보자 이름 없이, 자유 기재는 교직원 이름을 가린 요약
// - 개인정보 검사 통과 전 완료·내려받기 거부, 버전 충돌, 사건당 1건, 학교 격리
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { Server } from "node:http";
import { randomUUID } from "node:crypto";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import type { PrismaClient } from "@prisma/client";
import { createTestClient, getTestDatabaseUrl, resetTestData } from "./test-db";
import { buildDrillDoc, defaultManual, type DrillSnapshot } from "../shared/drillLog";

const PASSWORD = "report-test-password-1234";
let prisma: PrismaClient;
let server: Server;
let base = "";
let uploadDir = "";
const school: Record<"a" | "b", string> = { a: "", b: "" };
const M: Record<string, string> = {};
const NAME: Record<string, string> = {};
const cookie: Record<string, string> = {};
const ip: Record<string, string> = {};
let classId = "";
let drill = "";
let real = "";
let drillLog = "";
let realLog = "";

async function call(who: string, method: string, p: string, body?: unknown, headers: Record<string, string> = {}) {
  const res = await fetch(`${base}/api${p}`, {
    method,
    headers: { cookie: cookie[who] ?? "", "x-forwarded-for": ip[who] ?? "198.51.100.151", ...(body === undefined ? { "x-requested-with": "safe-school" } : { "content-type": "application/json" }), ...headers },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const type = res.headers.get("content-type") ?? "";
  const raw = type.includes("json") ? await res.text() : "";
  return { status: res.status, headers: res.headers, raw, body: (raw ? JSON.parse(raw) : {}) as Record<string, any> };
}
const A = (p: string) => `/schools/${school.a}${p}`;
const key = () => ({ "idempotency-key": randomUUID() });
const save = (who: string, logId: string, version: number, over: { manual?: object; status?: "draft" | "completed"; refreshAuto?: boolean } = {}) =>
  call(who, "PATCH", A(`/drill-logs/${logId}`), { manual: over.manual ?? defaultManual(), status: over.status ?? "draft", expectedVersion: version, ...(over.refreshAuto ? { refreshAuto: true } : {}) });

beforeAll(async () => {
  uploadDir = await fs.mkdtemp(path.join(os.tmpdir(), "safeschool-report-"));
  process.env.INCIDENT_UPLOAD_DIR = uploadDir;
  process.env.DATABASE_URL = getTestDatabaseUrl();
  prisma = createTestClient();
  await resetTestData(prisma);
  const { hashPassword } = await import("../server/src/security/password");
  const { grantDutyByPlatformOperator } = await import("../server/src/services/duties");
  const { currentSchoolYear } = await import("../server/src/services/events");
  const passwordHash = await hashPassword(PASSWORD);
  const now = new Date();
  for (const k of ["a", "b"] as const) {
    school[k] = (await prisma.school.create({ data: { slug: `report-${k}`, name: `가상 보고학교 ${k.toUpperCase()}`, isDemo: true, status: "active", activatedAt: now } })).id;
  }
  classId = (await prisma.schoolClass.create({ data: { schoolId: school.a, schoolYear: currentSchoolYear(), grade: 1, classNo: 1, label: "1학년 1반", enrolledCount: 20, enrolledConfirmedAt: now } })).id;
  const people: { key: string; k: "a" | "b"; role: "admin" | "homeroom" | "staff"; name: string }[] = [
    { key: "adminA", k: "a", role: "admin", name: "강관리" },
    { key: "safetyA", k: "a", role: "staff", name: "안전희" },
    { key: "principalA", k: "a", role: "staff", name: "장교장" },
    { key: "teacherA", k: "a", role: "homeroom", name: "담임선" },
    { key: "staffA", k: "a", role: "staff", name: "보건윤" },
    { key: "adminB", k: "b", role: "admin", name: "비관리" },
  ];
  for (const [i, p] of people.entries()) {
    const user = await prisma.user.create({ data: { email: `${p.key.toLowerCase()}@report.safeschool.invalid`, displayName: p.name, passwordHash, emailVerifiedAt: now } });
    NAME[p.key] = p.name;
    M[p.key] = (await prisma.schoolMembership.create({ data: { schoolId: school[p.k], userId: user.id, role: p.role, status: "approved", approvalMethod: "roster", approvedAt: now } })).id;
    ip[p.key] = `203.0.113.${160 + i}`;
  }
  await prisma.classAssignment.create({ data: { membershipId: M.teacherA!, classId, duty: "homeroom" } });
  await grantDutyByPlatformOperator(prisma, { membershipId: M.safetyA!, duty: "safety_officer", operator: "보고서 테스트", verificationMethod: "테스트" });
  await grantDutyByPlatformOperator(prisma, { membershipId: M.principalA!, duty: "principal", operator: "보고서 테스트", verificationMethod: "테스트" });
  const { createApp } = await import("../server/src/app");
  const http = await import("node:http");
  server = http.createServer(await createApp({ mode: "test", trustProxyHops: 1 }));
  await new Promise<void>((r) => server.listen(0, "127.0.0.1", () => r()));
  const addr = server.address();
  base = `http://127.0.0.1:${typeof addr === "object" && addr ? addr.port : 0}`;
  for (const p of people) {
    const res = await fetch(`${base}/api/auth/login`, { method: "POST", headers: { "content-type": "application/json", "x-forwarded-for": ip[p.key]! }, body: JSON.stringify({ email: `${p.key.toLowerCase()}@report.safeschool.invalid`, password: PASSWORD, deviceKind: "personal" }) });
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
  call("teacherA", "PUT", A(`/events/${eventId}/reports/${classId}`), { evacuated: 18, absentKnown: 1, injured: 0, enrolledCount: 20, enrolledChangeReason: null, note: null, expectedVersion: null }, key());
const incident = async (eventId: string) => {
  const r = await call("staffA", "POST", A(`/events/${eventId}/incidents`), { type: "hazard", placeCategory: "hallway", placeDetail: "본관 1층", description: `${NAME.teacherA} 선생님 반 앞 복도에 연기가 보입니다` }, key());
  expect(r.status).toBe(201);
  expect((await call("staffA", "POST", A(`/incidents/${r.body.id}/updates`), { kind: "action", note: `${NAME.safetyA} 담당이 출입을 통제함` }, key())).status).toBe(201);
  return r.body.id as string;
};
const allNames = () => Object.values(NAME);

describe("모의훈련 일지", () => {
  it("진행 중 생성: 학교 관리자는 403(기존 권한 유지), 안전업무 담당 201 작성 중, 서식은 모의훈련", async () => {
    drill = (await call("adminA", "POST", A("/events"), { primaryType: "fire", mode: "drill" })).body.event.id;
    expect((await reportClass(drill)).status).toBe(200);
    await incident(drill);
    expect((await call("adminA", "POST", A(`/events/${drill}/drill-log`), {})).status).toBe(403);
    const r = await call("safetyA", "POST", A(`/events/${drill}/drill-log`), {});
    expect(r.status).toBe(201);
    drillLog = r.body.id;
    const g = await call("safetyA", "GET", A(`/drill-logs/${drillLog}`));
    expect(g.body.log).toMatchObject({ formKey: "evacuation_drill", mode: "drill", eventStatus: "active", status: "draft", final: false });
  });

  it("교직원 소재는 조회·저장·출력하지 않음: 스냅숏·응답에 소재 항목 없음, 소재 행 0건, 문서에 붙임 3 없음", async () => {
    const g = await call("principalA", "GET", A(`/drill-logs/${drillLog}`));
    const snap = g.body.snapshot as DrillSnapshot;
    expect(snap).not.toHaveProperty("presence");
    expect(g.raw).not.toMatch(/targetCount|respondedCount|onCampus|offCampus|presence/);
    expect(await prisma.staffPresence.count({ where: { eventId: drill } })).toBe(0);
    expect(buildDrillDoc(snap, defaultManual()).pages.map((p) => p.title)).toEqual(["비상대피훈련일지(화재)", "붙임 1. 학급별 대피 현황", "붙임 2. 현장 제보·조치 현황"]);
  });

  it("현장 제보·조치: 제보자 이름 없음, 자유 기재 속 교직원 이름은 ○○○, 조치 건수·최근 조치 반영", async () => {
    const snap = (await call("safetyA", "GET", A(`/drill-logs/${drillLog}`))).body.snapshot as DrillSnapshot;
    expect(snap.incidents).toHaveLength(1);
    expect(snap.incidents![0]).toMatchObject({ typeLabel: "위험 발견", placeLabel: "복도 / 본관 1층", statusLabel: "접수", updateCount: 1, actionCount: 1 });
    expect(snap.incidents![0]!.summary).toContain("○○○ 선생님");
    expect(snap.incidents![0]!.lastAction).toContain("○○○ 담당이 출입을 통제함");
    expect(JSON.stringify(snap.incidents)).not.toMatch(new RegExp(allNames().join("|")));
    expect(snap.maskedCount).toBe(2);
  });

  it("완료: 진행 중 409 → 종료 후 다시 불러오지 않으면 409 → 다시 불러오며 완료 200(최종본)", async () => {
    expect((await save("safetyA", drillLog, 1, { status: "completed" })).body.code).toBe("event_not_closed");
    expect((await call("adminA", "POST", A(`/events/${drill}/close`), {})).status).toBe(200);
    expect((await call("safetyA", "GET", A(`/drill-logs/${drillLog}`))).body.log).toMatchObject({ eventStatus: "closed", refreshNeeded: true, final: false });
    expect((await save("safetyA", drillLog, 1, { status: "completed" })).body.code).toBe("refresh_required");
    const done = await save("safetyA", drillLog, 1, { status: "completed", refreshAuto: true });
    expect(done.status).toBe(200);
    expect((await call("safetyA", "GET", A(`/drill-logs/${drillLog}`))).body.log).toMatchObject({ status: "completed", final: true, refreshNeeded: false });
  });

  it("최종본 HWPX 이름에 '초안' 없음, 모의훈련 일지는 승인 서식대로 역할 담당자 이름 허용(이름 검사 안 함)", async () => {
    const manual = { ...defaultManual(), roles: [{ part: "신고", who: NAME.adminA! }] };
    expect((await save("safetyA", drillLog, 2, { manual, status: "completed" })).status).toBe(200);
    const res = await fetch(`${base}/api${A(`/drill-logs/${drillLog}/export.hwpx`)}`, { headers: { cookie: cookie.principalA!, "x-forwarded-for": ip.principalA! } });
    expect(res.status).toBe(200);
    expect(decodeURIComponent(res.headers.get("content-disposition") ?? "")).not.toContain("초안");
  });
});

describe("실제 재난 상황보고서", () => {
  it("진행 중 생성: 학교 관리자 201(실제 재난 작성 권한), 교장 403(열람만), 일반 교직원 403", async () => {
    real = (await call("safetyA", "POST", A("/events"), { primaryType: "earthquake", mode: "real", confirmReal: true })).body.event.id;
    expect((await reportClass(real)).status).toBe(200);
    await incident(real);
    expect((await call("staffA", "PUT", A(`/events/${real}/presence/me`), { location: "on_campus", placeCategory: "classroom", placeDetail: "3학년 2반", availability: "available", expectedVersion: null }, key())).status).toBe(200);
    expect((await call("principalA", "POST", A(`/events/${real}/drill-log`), {})).status).toBe(403);
    expect((await call("staffA", "POST", A(`/events/${real}/drill-log`), {})).status).toBe(403);
    const r = await call("adminA", "POST", A(`/events/${real}/drill-log`), {});
    expect(r.status).toBe(201);
    realLog = r.body.id;
    expect((await call("adminA", "POST", A(`/events/${real}/drill-log`), {})).body).toMatchObject({ id: realLog, created: false }); // 사건당 1건
  });

  it("열람: 교장 200(작성 불가 표시), 일반 교직원 403 / 서식·제목은 재난대피 상황보고서", async () => {
    const g = await call("principalA", "GET", A(`/drill-logs/${realLog}`));
    expect(g.status).toBe(200);
    expect(g.body).toMatchObject({ canEdit: false, log: { formKey: "disaster_real", mode: "real", final: false } });
    expect((await call("staffA", "GET", A(`/drill-logs/${realLog}`))).status).toBe(403);
    expect(buildDrillDoc(g.body.snapshot, defaultManual()).pages[0]!.title).toBe("재난대피 상황보고서(지진)");
  });

  it("교직원 소재는 익명 집계만: 응답 전체에 교직원 이름·교내 위치·소속 id 없음, 미응답 따로", async () => {
    const g = await call("adminA", "GET", A(`/drill-logs/${realLog}`));
    const snap = g.body.snapshot as DrillSnapshot;
    expect(snap.presence).toMatchObject({ targetCount: 5, respondedCount: 1, notRespondedCount: 4, onCampus: 1, offCampus: 0, available: 1 });
    const snapshotJson = JSON.stringify(snap);
    expect(snapshotJson).not.toMatch(new RegExp(allNames().join("|")));
    expect(snapshotJson).not.toContain("3학년 2반");
    for (const id of Object.values(M)) expect(snapshotJson).not.toContain(id);
    expect(snap.event.issuedByName).toBeNull();
    expect(snap.event.closedByName).toBeNull();
    const doc = buildDrillDoc(snap, defaultManual());
    expect(doc.pages.map((p) => p.title)).toEqual(["재난대피 상황보고서(지진)", "붙임 1. 학급별 대피 현황", "붙임 2. 현장 제보·조치 현황", "붙임 3. 교직원 소재 응답 통계(익명 집계)"]);
    expect(JSON.stringify(doc)).not.toMatch(new RegExp([...allNames(), "3학년 2반"].join("|")));
  });

  it("학급 미보고와 교직원 미응답은 별도(0으로 채우지 않음)", async () => {
    const snap = (await call("adminA", "GET", A(`/drill-logs/${realLog}`))).body.snapshot as DrillSnapshot;
    expect(snap.classes.filter((c) => !c.report)).toHaveLength(0);
    expect(snap.presence!.notRespondedCount).toBe(snap.presence!.targetCount - snap.presence!.respondedCount);
  });

  it("개인정보 검사: 실제 재난 보고서에 교직원 이름이 들어가면 완료·내려받기 422, 고치면 완료", async () => {
    expect((await call("adminA", "POST", A(`/events/${real}/close`), { confirmClose: true })).status).toBe(200);
    const withName = { ...defaultManual(), trainingNote: `${NAME.safetyA} 담당이 방송함` };
    const draft = await save("adminA", realLog, 1, { manual: withName, refreshAuto: true }); // 작성 중 저장은 가능
    expect(draft.status).toBe(200);
    const fail = await save("adminA", realLog, 2, { manual: withName, status: "completed" });
    expect(fail.status).toBe(422);
    expect(fail.body.code).toBe("privacy_check_failed");
    expect(fail.body.details.issues).toContain("쪽 1: 교직원 이름");
    const ex = await fetch(`${base}/api${A(`/drill-logs/${realLog}/export.hwpx`)}`, { headers: { cookie: cookie.adminA!, "x-forwarded-for": ip.adminA! } });
    expect(ex.status).toBe(422);
    const fixed = { ...defaultManual(), trainingNote: "안전업무 담당이 방송함", improvements: "비상 방송 점검" };
    expect((await save("adminA", realLog, 2, { manual: fixed, status: "completed" })).status).toBe(200);
    expect((await call("adminA", "GET", A(`/drill-logs/${realLog}`))).body.log).toMatchObject({ status: "completed", final: true, privacyIssues: [] });
  });

  it("버전 충돌: 오래된 판으로 저장하면 409(덮어쓰지 않음)", async () => {
    const r = await save("safetyA", realLog, 1, { manual: { ...defaultManual(), improvements: "오래된 판" } });
    expect(r.status).toBe(409);
    expect(r.body.code).toBe("version_conflict");
    expect(((await prisma.drillLog.findUniqueOrThrow({ where: { id: realLog } })).manual as { improvements: string }).improvements).toBe("비상 방송 점검");
  });

  it("원본(학급 보고·제보)은 보고서 작업으로 바뀌지 않음", async () => {
    expect(await prisma.evacuationReport.count({ where: { eventId: real } })).toBe(1);
    expect((await prisma.evacuationReport.findFirstOrThrow({ where: { eventId: real } })).version).toBe(1);
    expect((await prisma.incidentReport.findFirstOrThrow({ where: { eventId: real } })).status).toBe("received");
  });
});

describe("학교 격리", () => {
  it("다른 학교 관리자: B 경로·A 경로 모두 404(열람·작성·수정·내려받기)", async () => {
    expect((await call("adminB", "GET", `/schools/${school.b}/drill-logs/${realLog}`)).status).toBe(404);
    expect((await call("adminB", "GET", A(`/drill-logs/${realLog}`))).status).toBe(404);
    expect((await call("adminB", "POST", `/schools/${school.b}/events/${real}/drill-log`, {})).status).toBe(404);
    expect((await call("adminB", "PATCH", `/schools/${school.b}/drill-logs/${realLog}`, { manual: defaultManual(), status: "draft", expectedVersion: 3 })).status).toBe(404);
    const ex = await fetch(`${base}/api/schools/${school.b}/drill-logs/${realLog}/export.hwpx`, { headers: { cookie: cookie.adminB!, "x-forwarded-for": ip.adminB! } });
    expect(ex.status).toBe(404);
  });

  it("목록: 두 서식 모두, 사건 mode·상태·작성 권한(서식별)", async () => {
    const l = await call("adminA", "GET", A("/drill-logs"));
    expect(l.body).toMatchObject({ canEdit: false, canEditReal: true });
    const byId = Object.fromEntries((l.body.events as { eventId: string }[]).map((e) => [e.eventId, e]));
    expect(byId[drill]).toMatchObject({ mode: "drill", formKey: "evacuation_drill", status: "closed", log: { id: drillLog } });
    expect(byId[real]).toMatchObject({ mode: "real", formKey: "disaster_real", status: "closed", log: { id: realLog } });
  });
});
