// 전교 대피 현황 차트: 집계(순수 함수)·표시(정적 렌더링)·상황판 API의 사건·학교·권한 경계(HTTP, 테스트 스키마, 가상 자료만)
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { randomUUID } from "node:crypto";
import fs from "node:fs";
import type { Server } from "node:http";
import type { PrismaClient } from "@prisma/client";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { createTestClient, getTestDatabaseUrl, resetTestData } from "./test-db";
import { evacuationRateText, evacuationRows, summarizeBoard, type ClassReportView } from "../client/src/lib/disaster";
import { EvacuationChart } from "../client/src/pages/board/EvacuationChart";
import { BoardView } from "../client/src/pages/board/BoardView";

const cls = (grade: number, no: number, enrolled: number | null, r?: { evacuated: number; absentKnown?: number; enrolled?: number }, id = `${grade}-${no}`): ClassReportView => {
  const e = r?.enrolled ?? enrolled ?? 0;
  const absentKnown = r?.absentKnown ?? 0;
  return { classId: id, grade, classNo: no, label: `${grade}학년 ${no}반`, enrolledCount: enrolled, report: r ? { enrolledCount: e, absentKnown, evacuated: r.evacuated, unconfirmed: e - absentKnown - r.evacuated, injured: null, note: null, version: 1, reportedAt: "2026-11-02T01:00:00.000Z", reporterName: null } : null };
};
const row = (classes: ClassReportView[], key: string) => evacuationRows(classes).find((r) => r.key === key)!;
const sumOf = (classes: ClassReportView[], f: "evacuated" | "notEvacuated" | "unknown" | "absentKnown" | "enrolled" | "target" | "reportedClasses" | "totalClasses" | "enrolledUnknownClasses") => evacuationRows(classes).slice(1).reduce((n, r) => n + r[f], 0);

describe("집계", () => {
  const mixed = [cls(1, 1, 28, { evacuated: 25, absentKnown: 2 }), cls(1, 2, 28, { evacuated: 28 }), cls(1, 3, 28), cls(2, 1, 20, { evacuated: 18, enrolled: 21 }), cls(3, 1, null), cls(3, 2, 30, { evacuated: 30 })];

  it("전교 전체는 맨 앞, 학년은 실제 있는 학년만 오름차순(지어내지 않음)", () => {
    expect(evacuationRows([cls(5, 1, 20), cls(1, 1, 20)]).map((r) => r.label)).toEqual(["전교 전체", "1학년", "5학년"]);
    expect(evacuationRows([])).toHaveLength(1);
    expect(evacuationRows([]).at(0)).toMatchObject({ target: 0, rate: null });
  });
  it("전교 값은 학년 값의 합이고 상황판 수치와 일치", () => {
    const all = row(mixed, "all");
    for (const f of ["evacuated", "notEvacuated", "unknown", "absentKnown", "enrolled", "target", "reportedClasses", "totalClasses", "enrolledUnknownClasses"] as const) expect(sumOf(mixed, f)).toBe(all[f]);
    const b = summarizeBoard(mixed);
    expect([all.evacuated, all.notEvacuated, all.unknown, all.absentKnown, all.enrolled, all.reportedClasses, all.totalClasses, all.enrolledUnknownClasses]).toEqual([b.evacuated, b.unconfirmed, b.pendingStudents, b.absentKnown, b.enrolledTotal, b.reportedClasses, b.totalClasses, b.enrolledUnknownClasses]);
    expect(all.target).toBe(all.enrolled - all.absentKnown);
  });
  it("학년별 완료·미완료·확인되지 않음, 사전 부재는 대상에서 제외, 보고 재적 사용", () => {
    expect(row(mixed, "grade-1")).toMatchObject({ evacuated: 53, notEvacuated: 1, unknown: 28, absentKnown: 2, target: 82, rate: 64, reportedClasses: 2, totalClasses: 3 });
    expect(row(mixed, "grade-2")).toMatchObject({ evacuated: 18, notEvacuated: 3, target: 21, rate: 85 });
  });
  it("미보고 학급은 완료·미완료로 세지 않고 재적만 확인되지 않음으로", () => {
    const r = row([cls(1, 1, 28)], "grade-1");
    expect(r).toMatchObject({ evacuated: 0, notEvacuated: 0, unknown: 28, target: 28, rate: null, reportedClasses: 0 });
    expect(evacuationRateText(r)).toBe("확인 중"); // 0%로 대피 실패처럼 보이지 않게
    expect(evacuationRateText(row([cls(1, 1, null)], "grade-1"))).toBe("집계 불가");
  });
  it("재적을 모르는 미보고 학급이 있으면 완료율 집계 불가(잘못된 100% 방지)", () => {
    const r = row([cls(3, 1, null), cls(3, 2, 30, { evacuated: 30 })], "grade-3");
    expect(r).toMatchObject({ evacuated: 30, target: 30, enrolledUnknownClasses: 1, rate: null });
    expect(row(mixed, "all").rate).toBeNull();
    expect(row([cls(1, 1, 0, { evacuated: 0 })], "all").rate).toBeNull();
  });
  it("학생 대피율은 학급 보고율과 다르고, 내림이라 미완료가 있으면 100%가 아님", () => {
    const many = [cls(1, 1, 60, { evacuated: 60 }), cls(1, 2, 60, { evacuated: 59 }), ...Array.from({ length: 6 }, (_, i) => cls(1, 3 + i, 60, { evacuated: 60 }))];
    expect(row(many, "all").rate).toBe(99);
    expect(row(many, "all").reportedClasses).toBe(8);
    const half = [cls(1, 1, 10, { evacuated: 10 }), cls(1, 2, 30)];
    expect(row(half, "all").rate).toBe(25); // 학급 보고율 50%와 섞이지 않음
    expect(row([cls(1, 1, 30, { evacuated: 30 })], "all").rate).toBe(100);
  });
  it("같은 학급이 두 번 와도 한 번만 집계, 수정된 보고는 최신 값", () => {
    const r = row([cls(1, 1, 28, { evacuated: 20 }), cls(1, 1, 28, { evacuated: 27 })], "all");
    expect(r).toMatchObject({ evacuated: 27, notEvacuated: 1, target: 28, totalClasses: 1 });
  });
  it("학년을 알 수 없는 학급은 빠뜨리지 않고 별도 행, 전교 합 유지", () => {
    const list = [cls(1, 1, 20, { evacuated: 20 }), cls(0, 1, 15, { evacuated: 10 }), cls(NaN, 2, 5)];
    expect(evacuationRows(list).map((r) => r.label)).toEqual(["전교 전체", "1학년", "기타 / 학년 미확인"]);
    expect(row(list, "no-grade")).toMatchObject({ evacuated: 10, notEvacuated: 5, unknown: 5 });
    expect(row(list, "all").target).toBe(40);
  });
});

describe("표시", () => {
  const connection = { lastSuccessAt: new Date("2026-11-02T01:00:00Z"), failing: false };
  const render = (classes: ClassReportView[], c = connection) => renderToStaticMarkup(createElement(EvacuationChart, { classes, connection: c }));
  it("제목 하나, 전교 행 + 학년 행, 상태 이름과 숫자 병기", () => {
    const html = render([cls(1, 1, 28, { evacuated: 25, absentKnown: 2 }), cls(2, 1, 20)]);
    expect((html.match(/전교 대피 현황/g) ?? []).length).toBe(1);
    expect(html.indexOf("전교 전체")).toBeLessThan(html.indexOf("1학년"));
    expect(html.indexOf("1학년")).toBeLessThan(html.indexOf("2학년"));
    for (const t of ["대피 완료 25명", "대피 미확인 1명", "확인되지 않음 20명", "대상 46명", "학급 보고 1/2", "대피 완료율 54%", "사전 부재 2명 제외", "재적 48명"]) expect(html).toContain(t);
    expect(html).not.toContain("대피 미완료");
    expect(html).toContain("대피 미확인은 대피 실패를 뜻하지 않으며");
    expect((html.match(/data-testid="evac-row-/g) ?? []).length).toBe(3);
    expect(html).toContain("flex-col-reverse");
  });
  it("색 구간은 값이 있을 때만, 집계 불가·재적 미확인·연결 끊김·빈 자료 안내", () => {
    const html = render([cls(1, 1, null)]);
    expect(html).toContain("대피 완료율 집계 불가");
    expect(html).toContain("재적을 모르는 미보고 학급 1곳");
    expect(html).toContain('data-part="unmeasured"'); // 100%처럼 차 보이지 않게
    expect(html).toContain("일부 집계");
    expect(render([cls(1, 1, 28)])).toContain("대피 완료율 확인 중");
    expect(render([cls(1, 1, 28)])).not.toContain("대피 완료율 0%");
    expect(render([cls(1, 1, 28)])).not.toContain('data-part="unmeasured"');
    expect(html).not.toContain('data-part="evacuated"');
    expect(render([cls(1, 1, 10, { evacuated: 10 })])).not.toContain('data-part="notEvacuated"');
    expect(render([cls(1, 1, 10)], { lastSuccessAt: connection.lastSuccessAt, failing: true })).toContain("연결 끊김");
    expect(render([])).toContain("등록된 학급이 없어 집계할 수 없습니다");
  });
  it("상황판에 차트가 하나, 핵심 수치·위급 목록 아래이고 학급별 상태 위", () => {
    const event = { id: "e", mode: "drill", status: "active", types: ["fire"], location: null, evacPlace: null, message: null, startedAt: "2026-11-02T01:00:00.000Z", closedAt: null };
    const html = renderToStaticMarkup(createElement(BoardView, { data: { event, serverTime: "", classes: [cls(1, 1, 28, { evacuated: 20 })] } as never, connection }));
    expect((html.match(/id="evac-chart"/g) ?? []).length).toBe(1);
    expect(html.indexOf('aria-label="핵심 수치"')).toBeLessThan(html.indexOf('id="evac-chart"'));
    expect(html.indexOf('id="urgent"')).toBeLessThan(html.indexOf('id="evac-chart"'));
    expect(html.indexOf('id="evac-chart"')).toBeLessThan(html.indexOf('id="classes"'));
  });
  it("새 API·폴링·차트 라이브러리 없음", () => {
    const src = fs.readFileSync("client/src/pages/board/EvacuationChart.tsx", "utf8");
    expect(src).not.toMatch(/fetch\(|api\(|setInterval|useEffect/);
    expect(src).not.toMatch(/recharts|chart\.js|d3/);
    expect(Object.keys(JSON.parse(fs.readFileSync("package.json", "utf8")).dependencies)).toEqual(["@prisma/client", "express", "zod"]);
  });
});

describe("상황판 API 경계(차트의 입력)", () => {
  let prisma: PrismaClient;
  let server: Server;
  let base = "";
  const school: Record<"a" | "b", string> = { a: "", b: "" };
  const C: Record<string, string> = {};
  const cookie: Record<string, string> = {};
  const call = async (who: string, method: string, p: string, body?: unknown, idem = false) => {
    const res = await fetch(`${base}/api/schools/${p}`, { method, headers: { cookie: cookie[who] ?? "", ...(body === undefined ? { "x-requested-with": "safe-school" } : { "content-type": "application/json" }), ...(idem ? { "idempotency-key": randomUUID() } : {}) }, body: body === undefined ? undefined : JSON.stringify(body) });
    const text = await res.text();
    return { status: res.status, text, body: text.startsWith("{") ? (JSON.parse(text) as Record<string, any>) : {} };
  };
  const report = (ev: string, evacuated: number, expectedVersion: number | null = null) => call("teacher", "PUT", `${school.a}/events/${ev}/reports/${C.a1}`, { evacuated, absentKnown: 1, injured: 0, enrolledCount: 20, enrolledChangeReason: null, note: null, expectedVersion }, true);

  beforeAll(async () => {
    process.env.DATABASE_URL = getTestDatabaseUrl();
    prisma = createTestClient();
    await resetTestData(prisma);
    const { createSession, SESSION_COOKIE } = await import("../server/src/auth/session");
    const { grantDutyByPlatformOperator } = await import("../server/src/services/duties");
    const now = new Date();
    for (const k of ["a", "b"] as const) school[k] = (await prisma.school.create({ data: { slug: `chart-${k}`, name: `가상 차트학교 ${k}`, isDemo: true, status: "active", activatedAt: now } })).id;
    const mkClass = async (s: string, grade: number, enrolled: number) => (await prisma.schoolClass.create({ data: { schoolId: s, schoolYear: now.getFullYear(), grade, classNo: 1, label: `${grade}학년 1반`, enrolledCount: enrolled, enrolledConfirmedAt: now } })).id;
    C.a1 = await mkClass(school.a, 1, 20);
    C.a2 = await mkClass(school.a, 2, 25);
    C.b1 = await mkClass(school.b, 1, 33);
    for (const [key, role, s] of [["admin", "admin", school.a], ["teacher", "homeroom", school.a], ["staff", "staff", school.a], ["principal", "staff", school.a], ["adminB", "admin", school.b]] as const) {
      const user = await prisma.user.create({ data: { email: `${key.toLowerCase()}@chart.safeschool.invalid`, displayName: `가상 ${key}`, passwordHash: "x", emailVerifiedAt: now } });
      const m = await prisma.schoolMembership.create({ data: { schoolId: s, userId: user.id, role, status: "approved", approvalMethod: "roster", approvedAt: now } });
      if (key === "teacher") await prisma.classAssignment.create({ data: { membershipId: m.id, classId: C.a1!, duty: "homeroom" } });
      if (key === "principal") await grantDutyByPlatformOperator(prisma, { membershipId: m.id, duty: "principal", operator: "테스트", verificationMethod: "테스트" });
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
  });

  it("모의훈련과 실제 재난 수치가 섞이지 않음, 보고 수정은 최신 값 1건, 다른 학교 학급 없음, 권한별 응답도 같은 수치", async () => {
    const drill = (await call("admin", "POST", `${school.a}/events`, { primaryType: "fire", mode: "drill" })).body.event.id as string;
    const first = await report(drill, 15);
    expect(first.status).toBe(200);
    expect((await report(drill, 18, first.body.report.version)).status).toBe(200);
    const drillRows = (who: string) => call(who, "GET", `${school.a}/events/${drill}/board`).then((r) => ({ r, rows: evacuationRows(r.body.classes as ClassReportView[]) }));
    const staffView = await drillRows("staff");
    expect(staffView.r.body.scope).toBe("summary");
    expect(staffView.rows.map((x) => x.label)).toEqual(["전교 전체", "1학년", "2학년"]);
    expect(staffView.rows[0]).toMatchObject({ evacuated: 18, notEvacuated: 1, unknown: 25, absentKnown: 1, enrolled: 45, target: 44, rate: 40 });
    expect(staffView.r.text).not.toMatch(/presence|onCampus|가상 teacher/);
    for (const who of ["admin", "principal"]) expect((await drillRows(who)).rows).toEqual(staffView.rows);
    expect((await call("admin", "POST", `${school.a}/events/${drill}/close`, {})).status).toBe(200);

    const real = (await call("admin", "POST", `${school.a}/events`, { primaryType: "fire", mode: "real", confirmReal: true })).body.event.id as string;
    const realRows = () => call("staff", "GET", `${school.a}/events/${real}/board`).then((r) => evacuationRows(r.body.classes as ClassReportView[]));
    expect((await realRows())[0]).toMatchObject({ evacuated: 0, notEvacuated: 0, unknown: 45, reportedClasses: 0 });
    expect((await report(real, 10)).status).toBe(200);
    expect((await realRows())[0]).toMatchObject({ evacuated: 10, notEvacuated: 9, unknown: 25, reportedClasses: 1 });
    expect((await drillRows("staff")).rows[0]).toMatchObject({ evacuated: 18, notEvacuated: 1 });
  });
  it("다른 학교 사건·경로는 404, 응답에 다른 학교 학급 없음, 비로그인 401", async () => {
    const ev = (await prisma.disasterEvent.findFirstOrThrow({ where: { schoolId: school.a, mode: "real" } })).id;
    expect((await call("adminB", "GET", `${school.a}/events/${ev}/board`)).status).toBe(404);
    expect((await call("adminB", "GET", `${school.b}/events/${ev}/board`)).status).toBe(404);
    const own = await call("staff", "GET", `${school.a}/events/${ev}/board`);
    expect(own.text).not.toContain(C.b1);
    const anon = await fetch(`${base}/api/schools/${school.a}/events/${ev}/board`);
    expect(anon.status).toBe(401);
  });
  it("차트가 권한을 넓히지 않음: 일반 교직원·교장 학급 보고 403, 일반 교직원 발령 403", async () => {
    const ev = (await prisma.disasterEvent.findFirstOrThrow({ where: { schoolId: school.a, mode: "real" } })).id;
    const body = { evacuated: 1, absentKnown: 0, injured: 0, enrolledCount: 20, enrolledChangeReason: null, note: null, expectedVersion: null };
    for (const who of ["staff", "principal"]) expect((await call(who, "PUT", `${school.a}/events/${ev}/reports/${C.a2}`, body, true)).status).toBe(403);
    expect((await call("staff", "POST", `${school.a}/events`, { primaryType: "fire", mode: "drill" })).status).toBe(403);
  });
});
