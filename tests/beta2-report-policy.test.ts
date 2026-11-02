// Beta PILOT 2 Phase 4 확정 정책(HTTP, 테스트 스키마, 가상 학교·가상 교직원만)
// - 명칭: 모의훈련 '비상대피훈련일지'(그대로), 실제 재난 '재난대피일지'(서식 키 disaster_real 그대로)
// - 교장·교감: 열람·내려받기만(생성·수정·완료 403), 가입 때 적은 직위·희망 업무만으로는 아무 권한 없음
// - 시스템 작성·수정자 이름: 권한 있는 상세 조회에만(목록·PDF·HWPX·인쇄본에는 없음)
// - 모의훈련 역할 담당자 성명은 서식대로 보존(개인정보 검사로 막지 않음), 전화번호는 계속 차단
// - 실제 재난 교직원 소재는 익명 숫자만, 모의훈련에는 소재 붙임 없음, 기존 저장본(제보 붙임 이전) 호환
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
import { buildDrillDoc, defaultManual, markDraft, type DrillManual, type DrillSnapshot } from "../shared/drillLog";
import { DrillDocPreview } from "../client/src/pages/drill/DrillDocPreview";

const PASSWORD = "report-policy-password-1234";
const PLACE = "별관 3층 방송실 옆"; // 교직원 소재 응답의 교내 위치(출력물에 나오면 안 됨)
let prisma: PrismaClient;
let server: Server;
let base = "";
let uploadDir = "";
const school: Record<"a" | "b", string> = { a: "", b: "" };
let classId = "";
const M: Record<string, string> = {};
const U: Record<string, string> = {};
const EMAIL: Record<string, string> = {};
const NAME: Record<string, string> = {};
const cookie: Record<string, string> = {};
const ip: Record<string, string> = {};
let drill = "";
let real = "";
let drillLog = "";
let realLog = "";

/** HWPX(ZIP) 안의 모든 텍스트 파일(본문·메타·미리보기 글) 이어 붙이기 */
function hwpxText(buf: Buffer) {
  let i = 0;
  let text = "";
  while (buf.readUInt32LE(i) === 0x04034b50) {
    const method = buf.readUInt16LE(i + 8), size = buf.readUInt32LE(i + 18), nlen = buf.readUInt16LE(i + 26), xlen = buf.readUInt16LE(i + 28);
    const name = buf.subarray(i + 30, i + 30 + nlen).toString("utf8");
    const body = buf.subarray(i + 30 + nlen + xlen, i + 30 + nlen + xlen + size);
    if (!name.endsWith(".png")) text += (method === 8 ? inflateRawSync(body) : Buffer.from(body)).toString("utf8");
    i += 30 + nlen + xlen + size;
  }
  return text;
}

async function call(who: string, method: string, p: string, body?: unknown, headers: Record<string, string> = {}) {
  const res = await fetch(`${base}/api${p}`, {
    method,
    headers: { cookie: cookie[who] ?? "", "x-forwarded-for": ip[who] ?? "198.51.100.181", ...(body === undefined ? { "x-requested-with": "safe-school" } : { "content-type": "application/json" }), ...headers },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const type = res.headers.get("content-type") ?? "";
  const raw = type.includes("json") ? await res.text() : "";
  return { status: res.status, raw, body: (raw ? JSON.parse(raw) : {}) as Record<string, any> };
}
const A = (p: string) => `/schools/${school.a}${p}`;
const key = () => ({ "idempotency-key": randomUUID() });
const save = (who: string, logId: string, version: number, over: { manual?: object; status?: "draft" | "completed"; refreshAuto?: boolean } = {}) =>
  call(who, "PATCH", A(`/drill-logs/${logId}`), { manual: over.manual ?? defaultManual(), status: over.status ?? "draft", expectedVersion: version, ...(over.refreshAuto ? { refreshAuto: true } : {}) });
const exportHwpx = async (who: string, logId: string, schoolId = school.a) => {
  const res = await fetch(`${base}/api/schools/${schoolId}/drill-logs/${logId}/export.hwpx`, { headers: { cookie: cookie[who]!, "x-forwarded-for": ip[who]! } });
  return { status: res.status, name: decodeURIComponent(res.headers.get("content-disposition") ?? ""), text: res.status === 200 ? hwpxText(Buffer.from(await res.arrayBuffer())) : "" };
};
/** 화면의 '인쇄 / PDF로 저장(A4)'과 같은 A4 HTML(같은 컴포넌트) */
const printHtml = async (who: string, logId: string) => {
  const g = await call(who, "GET", A(`/drill-logs/${logId}`));
  const doc = buildDrillDoc(g.body.snapshot as DrillSnapshot, g.body.manual as DrillManual);
  return renderToStaticMarkup(createElement(DrillDocPreview, { doc: g.body.log.final ? doc : markDraft(doc) }));
};
/** 시스템 작성·수정자 정보(이름·사용자 id·이메일·소속 id) */
const authorInfo = (...who: string[]) => new RegExp(who.flatMap((w) => [NAME[w]!, U[w]!, EMAIL[w]!, M[w]!]).map((s) => s.replace(/[.+]/g, "\\$&")).join("|"));
const ROLE_PEOPLE = ["teacher", "nurse"] as const; // 모의훈련 역할 담당자(서식상 성명 기재)
const drillManual = () => ({
  ...defaultManual(),
  staffCount: "8",
  trainingNote: "화재 경보 후 운동장 대피",
  roles: [
    { part: "안전교육 및 학생 대피", who: `${NAME.teacher} 외 담임교사` },
    { part: "부상 학생 응급처치", who: NAME.nurse! },
  ],
});

beforeAll(async () => {
  uploadDir = await fs.mkdtemp(path.join(os.tmpdir(), "safeschool-report-policy-"));
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
    school[k] = (await prisma.school.create({ data: { slug: `report-policy-${k}`, name: `가상 정책학교 ${k.toUpperCase()}`, isDemo: true, status: "active", activatedAt: now } })).id;
  }
  classId = (await prisma.schoolClass.create({ data: { schoolId: school.a, schoolYear: currentSchoolYear(), grade: 3, classNo: 1, label: "3학년 1반", enrolledCount: 22, enrolledConfirmedAt: now } })).id;
  // claimer: 가입 때 직위 '교장'·희망 업무 '안전업무 담당'만 적은 일반 교직원(직책 미등록)
  const people: { key: string; k: "a" | "b"; role: "admin" | "homeroom" | "staff"; name: string; position?: string; duties?: string[]; note?: string }[] = [
    { key: "admin", k: "a", role: "admin", name: "서문관리" },
    { key: "safety", k: "a", role: "staff", name: "사공안전" },
    { key: "principal", k: "a", role: "staff", name: "어금교장" },
    { key: "vice", k: "a", role: "staff", name: "망절교감" },
    { key: "teacher", k: "a", role: "homeroom", name: "탁담임" },
    { key: "nurse", k: "a", role: "staff", name: "옹보건" },
    { key: "claimer", k: "a", role: "staff", name: "편사칭", position: "principal", duties: ["safety_officer"], note: "교장입니다. 안전업무 담당입니다." },
    { key: "adminB", k: "b", role: "admin", name: "봉타교" },
  ];
  for (const [i, p] of people.entries()) {
    EMAIL[p.key] = `${p.key.toLowerCase()}@policy.safeschool.invalid`;
    const user = await prisma.user.create({ data: { email: EMAIL[p.key]!, displayName: p.name, passwordHash, emailVerifiedAt: now } });
    U[p.key] = user.id;
    NAME[p.key] = p.name;
    M[p.key] = (
      await prisma.schoolMembership.create({
        data: { schoolId: school[p.k], userId: user.id, role: p.role, status: "approved", approvalMethod: "roster", approvedAt: now, requestedPosition: p.position ?? null, requestedDuties: p.duties ?? [], requestNote: p.note ?? null },
      })
    ).id;
    ip[p.key] = `203.0.113.${100 + i}`;
  }
  await prisma.classAssignment.create({ data: { membershipId: M.teacher!, classId, duty: "homeroom" } });
  await grantDutyByPlatformOperator(prisma, { membershipId: M.safety!, duty: "safety_officer", operator: "정책 테스트", verificationMethod: "테스트" });
  await grantDutyByPlatformOperator(prisma, { membershipId: M.principal!, duty: "principal", operator: "정책 테스트", verificationMethod: "테스트" });
  await grantDutyByPlatformOperator(prisma, { membershipId: M.vice!, duty: "vice_principal", operator: "정책 테스트", verificationMethod: "테스트" });
  const { createApp } = await import("../server/src/app");
  const http = await import("node:http");
  server = http.createServer(await createApp({ mode: "test", trustProxyHops: 1 }));
  await new Promise<void>((r) => server.listen(0, "127.0.0.1", () => r()));
  const addr = server.address();
  base = `http://127.0.0.1:${typeof addr === "object" && addr ? addr.port : 0}`;
  for (const p of people) {
    const res = await fetch(`${base}/api/auth/login`, { method: "POST", headers: { "content-type": "application/json", "x-forwarded-for": ip[p.key]! }, body: JSON.stringify({ email: EMAIL[p.key], password: PASSWORD, deviceKind: "personal" }) });
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
  call("teacher", "PUT", A(`/events/${eventId}/reports/${classId}`), { evacuated: 21, absentKnown: 1, injured: 0, enrolledCount: 22, enrolledChangeReason: null, note: null, expectedVersion: null }, key());

describe("모의훈련: 비상대피훈련일지", () => {
  it("작성 권한은 안전업무 담당만: 교장·교감·학교 관리자·직위만 적은 교직원 생성 403, 안전업무 담당 201", async () => {
    drill = (await call("admin", "POST", A("/events"), { primaryType: "fire", mode: "drill" })).body.event.id;
    expect((await reportClass(drill)).status).toBe(200);
    for (const who of ["principal", "vice", "admin", "claimer", "teacher"]) expect((await call(who, "POST", A(`/events/${drill}/drill-log`), {})).status).toBe(403);
    const r = await call("safety", "POST", A(`/events/${drill}/drill-log`), {});
    expect(r.status).toBe(201);
    drillLog = r.body.id;
    expect((await save("safety", drillLog, 1, { manual: drillManual() })).status).toBe(200);
  });

  it("교장·교감은 수정·완료 403(내용·판 그대로), 안전업무 담당은 종료 후 완료", async () => {
    expect((await call("admin", "POST", A(`/events/${drill}/close`), {})).status).toBe(200);
    for (const who of ["principal", "vice"]) {
      expect((await save(who, drillLog, 2, { manual: { ...drillManual(), improvements: "교장 수정" } })).status).toBe(403);
      expect((await save(who, drillLog, 2, { manual: drillManual(), status: "completed", refreshAuto: true })).status).toBe(403);
    }
    const row = await prisma.drillLog.findUniqueOrThrow({ where: { id: drillLog } });
    expect([row.version, row.status]).toEqual([2, "draft"]);
    expect((await save("safety", drillLog, 2, { manual: drillManual(), status: "completed", refreshAuto: true })).status).toBe(200);
  });

  it("제목 '비상대피훈련일지', 승인 서식 칸·순서 그대로, 소재 붙임 없음", async () => {
    const g = await call("principal", "GET", A(`/drill-logs/${drillLog}`));
    expect(g.status).toBe(200);
    expect(g.body.log).toMatchObject({ formKey: "evacuation_drill", final: true });
    const doc = buildDrillDoc(g.body.snapshot as DrillSnapshot, g.body.manual as DrillManual);
    expect(doc.pages.map((p) => p.title)).toEqual(["비상대피훈련일지(화재)", "붙임. 학급별 대피 현황"]);
    const labels = doc.pages[0]!.table.cells.filter((c) => c.kind !== "value").map((c) => c.text);
    expect(labels).toEqual(expect.arrayContaining(["참가인원", "훈련 개요"]));
    expect(labels.join("|")).not.toMatch(/학생 재실|상황 개요|대응 평가/);
  });

  it("역할 담당자 성명은 인쇄본·HWPX 에 그대로(검사로 막지 않음), 시스템 작성·수정자 정보는 없음", async () => {
    const html = await printHtml("principal", drillLog);
    const hw = await exportHwpx("principal", drillLog);
    expect(hw.status).toBe(200);
    expect(hw.name).toContain("비상대피훈련일지(화재)");
    for (const out of [html, hw.text]) {
      for (const who of ROLE_PEOPLE) expect(out).toContain(NAME[who]);
      expect(out).not.toMatch(authorInfo("safety", "admin")); // 일지 작성·수정자(안전업무 담당), 사건 발령·종료자(학교 관리자)
      expect(out).not.toMatch(/교직원 소재|미응답/);
    }
  });

  it("전화번호 같은 불필요한 개인정보는 모의훈련 일지에서도 완료 차단(422)", async () => {
    const r = await save("safety", drillLog, 3, { manual: { ...drillManual(), improvements: "보건실 연락 010-1234-5678" }, status: "completed" });
    expect(r.status).toBe(422);
    expect(r.body.code).toBe("privacy_check_failed");
  });
});

describe("실제 재난: 재난대피일지", () => {
  it("작성은 학교 관리자·안전업무 담당만(교장·교감·직위만 적은 교직원 403)", async () => {
    real = (await call("safety", "POST", A("/events"), { primaryType: "storm_flood", mode: "real", confirmReal: true })).body.event.id;
    expect((await reportClass(real)).status).toBe(200);
    expect((await call("nurse", "PUT", A(`/events/${real}/presence/me`), { location: "on_campus", placeCategory: "other", placeDetail: PLACE, availability: "available", expectedVersion: null }, key())).status).toBe(200);
    for (const who of ["principal", "vice", "claimer", "teacher"]) expect((await call(who, "POST", A(`/events/${real}/drill-log`), {})).status).toBe(403);
    const r = await call("admin", "POST", A(`/events/${real}/drill-log`), {});
    expect(r.status).toBe(201);
    realLog = r.body.id;
    expect((await save("safety", realLog, 1, { manual: { ...defaultManual(), trainingNote: "집중호우로 운동장 침수, 본관 3층 대피" } })).status).toBe(200); // 안전업무 담당도 수정 가능
  });

  it("교장·교감 수정·완료 403, 종료 후 안전업무 담당 완료 → 제목·파일명 '재난대피일지', 서식 키 disaster_real", async () => {
    expect((await call("safety", "POST", A(`/events/${real}/close`), { confirmClose: true })).status).toBe(200);
    for (const who of ["principal", "vice"]) expect((await save(who, realLog, 2, { status: "completed", refreshAuto: true })).status).toBe(403);
    expect((await save("safety", realLog, 2, { manual: { ...defaultManual(), trainingNote: "집중호우로 운동장 침수, 본관 3층 대피" }, status: "completed", refreshAuto: true })).status).toBe(200);
    const row = await prisma.drillLog.findUniqueOrThrow({ where: { id: realLog } });
    expect(row.formKey).toBe("disaster_real");
    const g = await call("vice", "GET", A(`/drill-logs/${realLog}`));
    expect(g.status).toBe(200);
    expect(g.body).toMatchObject({ canEdit: false, log: { final: true } });
    const doc = buildDrillDoc(g.body.snapshot as DrillSnapshot, g.body.manual as DrillManual);
    expect(doc.pages.map((p) => p.title)).toEqual(["재난대피일지(태풍·호우)", "붙임 1. 학급별 대피 현황", "붙임 2. 현장 제보·조치 현황", "붙임 3. 교직원 소재 응답 통계(익명 집계)"]);
    const hw = await exportHwpx("vice", realLog);
    expect(hw.status).toBe(200);
    expect(hw.name).toMatch(/^.*재난대피일지\(태풍·호우\)_\d{8}\.hwpx/);
    expect(hw.name).not.toContain("상황보고서");
  });

  it("인쇄본·HWPX: 익명 소재 숫자만, 교직원 이름·교내 위치·작성·수정자 정보 없음, 고정 문구에 '훈련' 없음", async () => {
    const html = await printHtml("principal", realLog);
    const hw = await exportHwpx("principal", realLog);
    for (const out of [html, hw.text]) {
      expect(out).toContain("재난대피일지(태풍·호우)");
      expect(out).toContain("미응답(추정 안 함)");
      expect(out).not.toMatch(new RegExp([...Object.values(NAME), PLACE].join("|")));
      expect(out).not.toMatch(authorInfo("admin", "safety"));
      expect(out).not.toMatch(/훈련|상황보고서/);
    }
  });
});

describe("시스템 작성·수정자 정보 표시 범위", () => {
  it("권한 있는 상세 조회(교장·교감·작성자)에만 최초 작성자·최종 수정자·시각·판·상태, 이메일·사용자 id 는 없음", async () => {
    for (const who of ["principal", "vice", "admin", "safety"]) {
      const g = await call(who, "GET", A(`/drill-logs/${realLog}`));
      expect(g.status).toBe(200);
      expect(g.body.log).toMatchObject({ createdByName: NAME.admin, updatedByName: NAME.safety, version: 3, status: "completed" });
      expect(typeof g.body.log.createdAt).toBe("string");
      expect(typeof g.body.log.updatedAt).toBe("string");
      expect(g.body.revisions.map((r: { changedByName: string }) => r.changedByName)).toEqual([NAME.safety, NAME.safety, NAME.admin]);
      for (const w of ["admin", "safety"]) {
        expect(g.raw).not.toContain(EMAIL[w]);
        expect(g.raw).not.toContain(U[w]);
      }
    }
  });

  it("목록에는 작성·수정자 이름 없음(판·시각·상태만)", async () => {
    const l = await call("principal", "GET", A("/drill-logs"));
    expect(l.status).toBe(200);
    expect(l.raw).not.toMatch(authorInfo("admin", "safety"));
    const byId = Object.fromEntries((l.body.events as { eventId: string; log: object | null }[]).map((e) => [e.eventId, e.log]));
    expect(Object.keys(byId[real]!).sort()).toEqual(["id", "status", "updatedAt", "version"]);
  });

  it("열람 권한 없는 교직원·직위만 적은 교직원·다른 학교 관리자: 목록·상세·내려받기 모두 차단", async () => {
    for (const who of ["claimer", "teacher", "nurse"]) {
      expect((await call(who, "GET", A("/drill-logs"))).status).toBe(403);
      expect((await call(who, "GET", A(`/drill-logs/${realLog}`))).status).toBe(403);
      expect((await exportHwpx(who, realLog)).status).toBe(403);
    }
    expect((await call("adminB", "GET", A(`/drill-logs/${realLog}`))).status).toBe(404);
    expect((await call("adminB", "GET", `/schools/${school.b}/drill-logs/${drillLog}`)).status).toBe(404);
    expect((await exportHwpx("adminB", realLog, school.b)).status).toBe(404);
  });

  it("직위 문자열은 권한이 아님: 가입 신청 정보가 그대로여도 교장 직책·안전업무 담당이 생기지 않음", async () => {
    const m = await prisma.schoolMembership.findUniqueOrThrow({ where: { id: M.claimer! }, include: { duties: true } });
    expect(m.requestedPosition).toBe("principal");
    expect(m.requestedDuties).toEqual(["safety_officer"]);
    expect(m.duties).toHaveLength(0);
  });
});

describe("기존 저장본 호환", () => {
  it("제보 붙임 이전 형식(incidents 없음)으로 저장된 일지도 열람·내려받기 가능, 기존 배치 그대로", async () => {
    const row = await prisma.drillLog.findUniqueOrThrow({ where: { id: drillLog } });
    const { incidents: _i, maskedCount: _m, ...legacy } = row.autoSnapshot as Record<string, unknown>;
    await prisma.drillLog.update({ where: { id: drillLog }, data: { autoSnapshot: legacy as object, version: row.version + 1 } });
    const g = await call("principal", "GET", A(`/drill-logs/${drillLog}`));
    expect(g.status).toBe(200);
    const doc = buildDrillDoc(g.body.snapshot as DrillSnapshot, g.body.manual as DrillManual);
    expect(doc.pages[0]!.title).toBe("비상대피훈련일지(화재)");
    expect(doc.pages.map((p) => p.title).join("|")).not.toMatch(/현장 제보|교직원 소재/);
    const hw = await exportHwpx("principal", drillLog);
    expect(hw.status).toBe(200);
    expect(hw.text).toContain("비상대피훈련일지(화재)");
  });
});
