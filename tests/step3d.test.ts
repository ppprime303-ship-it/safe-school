// STEP 3-D 직책·업무 권한(겸임)과 비상대피훈련일지 (서비스 계층, 테스트 전용 DB 스키마)
// HTTP 경로(로그인·비밀번호 재확인·내려받기 헤더)는 scripts/e2e-step3d.ts 에서 확인합니다.
import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { createTestClient, resetTestData } from "./test-db.js";
import { closeEvent, currentSchoolYear, issueEvent, submitReport, type ReportInput } from "../server/src/services/events.js";
import { resolveAccess } from "../server/src/services/access.js";
import { endDuty, grantDutyByPlatformOperator, grantDutyInApp } from "../server/src/services/duties.js";
import { revokeMembership } from "../server/src/services/membership.js";
import { createDrillLog, exportDrillLogHwpx, getDrillLog, updateDrillLog } from "../server/src/services/drillLogs.js";
import { capabilitiesFor } from "../shared/permissions.js";
import { defaultManual, type DrillManual } from "../shared/drillLog.js";
import { inflateRawSync } from "node:zlib";

/** HWPX(ZIP) 안의 파일 꺼내기(지역 헤더 순서대로) */
function unzip(buf: Buffer) {
  const out = new Map<string, Buffer>();
  let i = 0;
  while (buf.readUInt32LE(i) === 0x04034b50) {
    const method = buf.readUInt16LE(i + 8), size = buf.readUInt32LE(i + 18), nlen = buf.readUInt16LE(i + 26), xlen = buf.readUInt16LE(i + 28);
    const name = buf.subarray(i + 30, i + 30 + nlen).toString("utf8");
    const body = buf.subarray(i + 30 + nlen + xlen, i + 30 + nlen + xlen + size);
    out.set(name, method === 8 ? inflateRawSync(body) : Buffer.from(body));
    i += 30 + nlen + xlen + size;
  }
  return out;
}

const prisma = createTestClient();
const YEAR = currentSchoolYear();
let A = "";
let B = "";
const U: Record<string, string> = {}; // 사용자 id
const M: Record<string, string> = {}; // 소속 id
let c11 = "";
let c12 = "";
let c21 = "";

async function person(key: string, schoolId: string, role: "admin" | "homeroom" | "staff", status: "approved" | "pending" = "approved") {
  const now = new Date();
  U[key] = (await prisma.user.create({ data: { email: `${key}@d.kr`, displayName: key, emailVerifiedAt: now } })).id;
  M[key] = (
    await prisma.schoolMembership.create({
      data: { schoolId, userId: U[key], role, status, ...(status === "approved" ? { approvalMethod: "roster" as const, approvedAt: now } : {}) },
    })
  ).id;
}
const op = (key: string, duty: "principal" | "vice_principal" | "safety_officer" | "app_operator", method: string | null = "공문 확인") =>
  grantDutyByPlatformOperator(prisma, { membershipId: M[key]!, duty, operator: "플랫폼 운영자", verificationMethod: method });
const access = (key: string, need?: Parameters<typeof resolveAccess>[1]["need"], schoolId = A) => resolveAccess(prisma, { userId: U[key]!, schoolId, need });
const caps = async (key: string) => (await access(key)).caps;
const input = (over: Partial<ReportInput> = {}): ReportInput => ({
  evacuated: 24, absentKnown: 1, injured: 0, enrolledCount: 25, enrolledChangeReason: null, note: null, expectedVersion: null, ...over,
});

beforeEach(async () => {
  await resetTestData(prisma);
  const now = new Date();
  A = (await prisma.school.create({ data: { name: "가상<초>&학교", slug: "test-3d-a", status: "active", activatedAt: now } })).id;
  B = (await prisma.school.create({ data: { name: "B학교", slug: "test-3d-b", status: "active", activatedAt: now } })).id;
  await person("admin", A, "admin");
  await person("principal", A, "staff");
  await person("vice1", A, "staff");
  await person("vice2", A, "staff");
  await person("vice3", A, "staff");
  await person("safety1", A, "staff");
  await person("safety2", A, "homeroom");
  await person("operator", A, "staff");
  await person("teacher", A, "homeroom");
  await person("staff", A, "staff");
  await person("pending", A, "staff", "pending");
  await person("adminB", B, "admin");
  const mk = async (grade: number, classNo: number, enrolledCount: number | null) =>
    (await prisma.schoolClass.create({ data: { schoolId: A, schoolYear: YEAR, grade, classNo, label: `${grade}학년 ${classNo}반`, enrolledCount } })).id;
  c11 = await mk(1, 1, 25);
  c12 = await mk(1, 2, 27);
  c21 = await mk(2, 1, 24);
});

afterAll(async () => {
  await prisma.$disconnect();
});

// ───────────────────────── 권한 ─────────────────────────
describe("직책·업무 권한(합산·겸임)", () => {
  it("기존 관리자: 지금까지의 기능 그대로 + 훈련일지 열람만(작성·수정은 자동 부여 안 함)", async () => {
    const c = await caps("admin");
    for (const k of ["event.issue", "event.close", "board.view", "members.manage", "classes.manage", "region.manage", "drilllog.view"]) expect(c).toContain(k);
    expect(c).not.toContain("drilllog.edit");
  });

  it("교장·교감(플랫폼 운영자 확인)은 발령·종료·상황판·훈련일지 열람, 가입 승인·훈련일지 수정은 없음", async () => {
    await op("principal", "principal");
    await op("vice1", "vice_principal");
    for (const k of ["principal", "vice1"]) {
      const c = await caps(k);
      expect(c).toEqual(expect.arrayContaining(["event.issue", "event.close", "board.view", "drilllog.view"]));
      expect(c).not.toContain("members.manage");
      expect(c).not.toContain("drilllog.edit");
    }
  });

  it("교장 1명·교감 최대 2명, 확인 방법 없는 교장·교감 등록 거부, 종료 후 새로 등록 가능", async () => {
    await op("principal", "principal");
    await expect(op("vice1", "principal")).rejects.toMatchObject({ status: 409 });
    await op("vice1", "vice_principal");
    await op("vice2", "vice_principal");
    await expect(op("vice3", "vice_principal")).rejects.toMatchObject({ status: 409 });
    await expect(op("vice3", "vice_principal", null)).rejects.toMatchObject({ status: 400 });
    const v1 = await prisma.memberDuty.findFirstOrThrow({ where: { membershipId: M.vice1, endedAt: null } });
    await endDuty(prisma, { schoolId: A, dutyId: v1.id, reason: "전보", actorLabel: "플랫폼 운영자", via: "platform_operator" });
    await op("vice3", "vice_principal");
    expect(await prisma.memberDuty.count({ where: { schoolId: A, duty: "vice_principal" } })).toBe(3); // 종료 기록 보존
  });

  it("앱에서는 교장·교감을 지정·종료할 수 없음(교장 직책만으로 운영 권한 없음)", async () => {
    await expect(grantDutyInApp(prisma, { schoolId: A, actorUserId: U.admin!, membershipId: M.staff!, duty: "principal" })).rejects.toMatchObject({ status: 403 });
    const p = await op("principal", "principal");
    await expect(endDuty(prisma, { schoolId: A, dutyId: p.id, reason: "x", actorUserId: U.admin, via: "school_app" })).rejects.toMatchObject({ status: 403 });
  });

  it("안전업무 담당 여러 명, 담임+안전 겸임, 안전+앱 운영 겸임(권한 합산)", async () => {
    await grantDutyInApp(prisma, { schoolId: A, actorUserId: U.admin!, membershipId: M.safety1!, duty: "safety_officer" });
    await grantDutyInApp(prisma, { schoolId: A, actorUserId: U.admin!, membershipId: M.safety2!, duty: "safety_officer" });
    await grantDutyInApp(prisma, { schoolId: A, actorUserId: U.admin!, membershipId: M.safety1!, duty: "app_operator" });
    const s1 = await caps("safety1");
    expect(s1).toEqual(expect.arrayContaining(["event.issue", "drilllog.edit", "members.manage", "duties.manage"]));
    const s2 = await caps("safety2"); // 담임 + 안전업무
    expect(s2).toEqual(expect.arrayContaining(["event.issue", "event.close", "drilllog.edit"]));
    expect(s2).not.toContain("members.manage");
    await expect(grantDutyInApp(prisma, { schoolId: A, actorUserId: U.admin!, membershipId: M.safety1!, duty: "safety_officer" })).rejects.toMatchObject({ status: 409 });
  });

  it("앱 운영담당만으로는 발령 불가, 일반 교직원·담임은 발령·상황판·훈련일지 불가", async () => {
    await grantDutyInApp(prisma, { schoolId: A, actorUserId: U.admin!, membershipId: M.operator!, duty: "app_operator" });
    expect(await caps("operator")).toEqual(expect.arrayContaining(["members.manage", "classes.manage"]));
    for (const k of ["operator", "staff", "teacher"]) {
      await expect(access(k, "event.issue")).rejects.toMatchObject({ status: 403 });
    }
    await expect(access("teacher", "board.view")).rejects.toMatchObject({ status: 403 });
    await expect(access("staff", "drilllog.view")).rejects.toMatchObject({ status: 403 });
  });

  it("승인 대기 403, 다른 학교 404", async () => {
    await expect(access("pending")).rejects.toMatchObject({ status: 403 });
    await expect(access("adminB", "event.issue", A)).rejects.toMatchObject({ status: 404 });
  });

  it("자기 자신에게 업무 지정 불가(스스로 권한 확대 방지)", async () => {
    await grantDutyInApp(prisma, { schoolId: A, actorUserId: U.admin!, membershipId: M.operator!, duty: "app_operator" });
    await expect(grantDutyInApp(prisma, { schoolId: A, actorUserId: U.operator!, membershipId: M.operator!, duty: "safety_officer" })).rejects.toMatchObject({ status: 403 });
    await expect(grantDutyInApp(prisma, { schoolId: A, actorUserId: U.admin!, membershipId: M.admin!, duty: "safety_officer" })).rejects.toMatchObject({ status: 403 });
  });

  it("업무 해제 직후 권한 사라짐(계정 유지, 기록 보존·감사)", async () => {
    const g = await grantDutyInApp(prisma, { schoolId: A, actorUserId: U.admin!, membershipId: M.safety1!, duty: "safety_officer" });
    await access("safety1", "event.issue");
    await endDuty(prisma, { schoolId: A, dutyId: g.id, reason: "업무분장 변경", actorUserId: U.admin, via: "school_app" });
    await expect(access("safety1", "event.issue")).rejects.toMatchObject({ status: 403 });
    await access("safety1"); // 계정·소속은 그대로
    expect(await prisma.auditLog.count({ where: { schoolId: A, action: { in: ["duty.granted", "duty.ended"] } } })).toBe(2);
    await expect(prisma.memberDuty.delete({ where: { id: g.id } })).rejects.toBeTruthy();
  });

  it("마지막 운영 권한자 보호: 관리자 없는 학교의 마지막 앱 운영담당 해제 거부", async () => {
    const C = (await prisma.school.create({ data: { name: "C학교", slug: "test-3d-c", status: "active", activatedAt: new Date() } })).id;
    await person("opC", C, "staff");
    const g = await op("opC", "app_operator", null);
    await expect(endDuty(prisma, { schoolId: C, dutyId: g.id, reason: "x", actorLabel: "운영자", via: "platform_operator" })).rejects.toMatchObject({ status: 409, code: "last_operator" });
    // 관리자가 있으면 해제 가능
    const g2 = await grantDutyInApp(prisma, { schoolId: A, actorUserId: U.admin!, membershipId: M.operator!, duty: "app_operator" });
    await endDuty(prisma, { schoolId: A, dutyId: g2.id, reason: "x", actorUserId: U.admin, via: "school_app" });
  });

  it("앱 운영담당은 학교 관리자·교장·교감 계정을 회수할 수 없음, 회수하면 업무도 종료", async () => {
    await grantDutyInApp(prisma, { schoolId: A, actorUserId: U.admin!, membershipId: M.operator!, duty: "app_operator" });
    await person("admin2", A, "admin");
    await expect(revokeMembership(prisma, { schoolId: A, actorUserId: U.operator!, membershipId: M.admin2!, actorRole: "staff" })).rejects.toMatchObject({ status: 403 });
    await op("principal", "principal");
    await expect(revokeMembership(prisma, { schoolId: A, actorUserId: U.admin!, membershipId: M.principal!, actorRole: "admin" })).rejects.toMatchObject({ status: 403 });
    await grantDutyInApp(prisma, { schoolId: A, actorUserId: U.admin!, membershipId: M.safety1!, duty: "safety_officer" });
    await revokeMembership(prisma, { schoolId: A, actorUserId: U.operator!, membershipId: M.safety1!, actorRole: "staff" });
    expect(await prisma.memberDuty.count({ where: { membershipId: M.safety1, endedAt: null } })).toBe(0);
    expect(await prisma.memberDuty.count({ where: { membershipId: M.safety1 } })).toBe(1);
  });

  it("동시 요청으로 제한 우회 불가: 교감 3명 동시 등록 → 2명만, 같은 업무 동시 지정 → 1건, 운영자 2명이 동시에 서로 해제 → 1명은 남음", async () => {
    const vices = await Promise.allSettled([op("vice1", "vice_principal"), op("vice2", "vice_principal"), op("vice3", "vice_principal")]);
    expect(vices.filter((r) => r.status === "fulfilled")).toHaveLength(2);
    const same = await Promise.allSettled([
      grantDutyInApp(prisma, { schoolId: A, actorUserId: U.admin!, membershipId: M.safety1!, duty: "safety_officer" }),
      grantDutyInApp(prisma, { schoolId: A, actorUserId: U.admin!, membershipId: M.safety1!, duty: "safety_officer" }),
    ]);
    expect(same.filter((r) => r.status === "fulfilled")).toHaveLength(1);
    const C = (await prisma.school.create({ data: { name: "C학교", slug: "test-3d-c2", status: "active", activatedAt: new Date() } })).id;
    await person("opX", C, "staff");
    await person("opY", C, "staff");
    const x = await op("opX", "app_operator", null);
    const y = await op("opY", "app_operator", null);
    const ends = await Promise.allSettled([
      endDuty(prisma, { schoolId: C, dutyId: x.id, reason: "전보", actorUserId: U.opY, via: "school_app" }),
      endDuty(prisma, { schoolId: C, dutyId: y.id, reason: "전보", actorUserId: U.opX, via: "school_app" }),
    ]);
    expect(ends.filter((r) => r.status === "fulfilled")).toHaveLength(1);
    expect(await prisma.memberDuty.count({ where: { schoolId: C, duty: "app_operator", endedAt: null } })).toBe(1);
  });

  it("권한 계산은 순수 함수와 서버가 같음", async () => {
    await grantDutyInApp(prisma, { schoolId: A, actorUserId: U.admin!, membershipId: M.safety2!, duty: "safety_officer" });
    expect(await caps("safety2")).toEqual(capabilitiesFor("homeroom", ["safety_officer"]));
  });
});

describe("발령·종료 주체(교장·교감 1·2·안전담당)", () => {
  it("교감1·교감2·교장·안전담당 각각 발령·종료, 발령자와 종료자가 달라도 됨, 중복 발령 409", async () => {
    await op("principal", "principal");
    await op("vice1", "vice_principal");
    await op("vice2", "vice_principal");
    await grantDutyInApp(prisma, { schoolId: A, actorUserId: U.admin!, membershipId: M.safety1!, duty: "safety_officer" });
    await grantDutyInApp(prisma, { schoolId: A, actorUserId: U.admin!, membershipId: M.safety2!, duty: "safety_officer" });
    const pairs: [string, string][] = [["vice1", "vice2"], ["vice2", "principal"], ["safety1", "vice1"], ["safety2", "safety1"], ["principal", "safety2"]];
    for (const [issuer, closer] of pairs) {
      await access(issuer, "event.issue");
      const ev = await issueEvent(prisma, { schoolId: A, actorUserId: U[issuer]!, primaryType: "earthquake", mode: "drill" });
      await expect(issueEvent(prisma, { schoolId: A, actorUserId: U[closer]!, primaryType: "fire", mode: "drill" })).rejects.toMatchObject({ status: 409 });
      await access(closer, "event.close");
      await closeEvent(prisma, { schoolId: A, eventId: ev.id, actorUserId: U[closer]! });
      const row = await prisma.disasterEvent.findUniqueOrThrow({ where: { id: ev.id } });
      expect([row.createdById, row.closedById]).toEqual([U[issuer], U[closer]]);
    }
  });

  it("실제 상황은 확인 없이 발령·종료 안 됨(기존 규칙 유지)", async () => {
    await op("vice1", "vice_principal");
    await expect(issueEvent(prisma, { schoolId: A, actorUserId: U.vice1!, primaryType: "fire", mode: "real" })).rejects.toMatchObject({ status: 400 });
    const ev = await issueEvent(prisma, { schoolId: A, actorUserId: U.vice1!, primaryType: "fire", mode: "real", confirmReal: true });
    await expect(closeEvent(prisma, { schoolId: A, eventId: ev.id, actorUserId: U.vice1! })).rejects.toMatchObject({ status: 400 });
    await closeEvent(prisma, { schoolId: A, eventId: ev.id, actorUserId: U.vice1!, confirmClose: true });
  });
});

// ───────────────────────── 훈련일지 ─────────────────────────
async function closedDrill(opts: { report12?: boolean } = {}) {
  const ev = await issueEvent(prisma, { schoolId: A, actorUserId: U.admin!, primaryType: "earthquake", mode: "drill", evacPlace: "운동장" });
  const rep = (classId: string, key: string, over: Partial<ReportInput>) =>
    submitReport(prisma, { schoolId: A, eventId: ev.id, classId, actorUserId: U.admin!, membershipId: M.admin!, role: "admin", idempotencyKey: key, input: input(over) });
  await rep(c11, "k-11a", { evacuated: 23, absentKnown: 1, enrolledCount: 25 });
  await rep(c11, "k-11b", { evacuated: 24, absentKnown: 1, enrolledCount: 25, expectedVersion: 1 }); // 수정 보고(판 2) — 중복 집계 안 됨
  if (opts.report12 !== false) await rep(c12, "k-12", { evacuated: 27, absentKnown: 0, enrolledCount: 27, injured: 1 });
  await closeEvent(prisma, { schoolId: A, eventId: ev.id, actorUserId: U.admin! });
  return ev.id;
}
const editor = async () => {
  await grantDutyInApp(prisma, { schoolId: A, actorUserId: U.admin!, membershipId: M.safety1!, duty: "safety_officer" });
  await grantDutyInApp(prisma, { schoolId: A, actorUserId: U.admin!, membershipId: M.safety2!, duty: "safety_officer" });
};
const save = (logId: string, expectedVersion: number, manual: DrillManual, by = "safety1", status: "draft" | "completed" = "draft", refreshAuto = false) =>
  updateDrillLog(prisma, { schoolId: A, logId, actorUserId: U[by]!, manual, status, expectedVersion, refreshAuto });

describe("훈련일지 만들기", () => {
  it("종료된 모의훈련만, 진행 중·실제 상황은 409, 이벤트당 1건(다시 요청·동시 요청은 같은 일지)", async () => {
    await editor();
    const active = await issueEvent(prisma, { schoolId: A, actorUserId: U.admin!, primaryType: "fire", mode: "drill" });
    await expect(createDrillLog(prisma, { schoolId: A, eventId: active.id, actorUserId: U.safety1! })).rejects.toMatchObject({ status: 409, code: "event_not_closed" });
    await closeEvent(prisma, { schoolId: A, eventId: active.id, actorUserId: U.admin! });
    const real = await issueEvent(prisma, { schoolId: A, actorUserId: U.admin!, primaryType: "fire", mode: "real", confirmReal: true });
    await closeEvent(prisma, { schoolId: A, eventId: real.id, actorUserId: U.admin!, confirmClose: true });
    await expect(createDrillLog(prisma, { schoolId: A, eventId: real.id, actorUserId: U.safety1! })).rejects.toMatchObject({ status: 409, code: "not_drill" });
    const [a, b] = await Promise.all([
      createDrillLog(prisma, { schoolId: A, eventId: active.id, actorUserId: U.safety1! }),
      createDrillLog(prisma, { schoolId: A, eventId: active.id, actorUserId: U.safety2! }),
    ]);
    expect(a.id).toBe(b.id);
    expect([a.created, b.created].sort()).toEqual([false, true]);
    expect(await prisma.drillLog.count()).toBe(1);
    await expect(createDrillLog(prisma, { schoolId: B, eventId: active.id, actorUserId: U.adminB! })).rejects.toMatchObject({ status: 404 });
  });

  it("자동작성: 학급별 최신 보고 1건만 집계, 미보고 학급은 보고 없음, 재적과 대피 확인 분리, 담당자 입력은 빈칸", async () => {
    await editor();
    const eventId = await closedDrill({ report12: false });
    const { id } = await createDrillLog(prisma, { schoolId: A, eventId, actorUserId: U.safety1! });
    const d = await getDrillLog(prisma, { schoolId: A, logId: id, canEdit: true });
    const byLabel = Object.fromEntries(d.snapshot.classes.map((c) => [c.label, c]));
    expect(byLabel["1학년 1반"]!.report).toMatchObject({ evacuated: 24, absentKnown: 1, version: 2 });
    expect(byLabel["1학년 2반"]!.report).toBeNull();
    expect(byLabel["1학년 2반"]!.enrolled).toBe(27);
    expect(byLabel["2학년 1반"]!.report).toBeNull();
    expect(d.snapshot.event).toMatchObject({ mode: "drill", evacPlace: "운동장", typeLabel: "지진" });
    expect(d.manual).toEqual(defaultManual());
    expect(d.manual.staffCount).toBe("");
    expect(d.manual.durationText).toBe("");
    expect(d.manual.evals.every((e) => e.result === "")).toBe(true);
    expect(d.log).toMatchObject({ status: "draft", version: 1 });
  });
});

describe("훈련일지 저장·이력·동시 수정", () => {
  it("저장마다 판 +1, 변경 없으면 그대로, 오래된 판 409, 동시 저장 1건만, 다른 담당자도 저장 가능", async () => {
    await editor();
    const { id } = await createDrillLog(prisma, { schoolId: A, eventId: await closedDrill(), actorUserId: U.safety1! });
    const m = defaultManual();
    await expect(save(id, 1, m)).resolves.toMatchObject({ version: 1, changed: false });
    const m2 = { ...m, staffCount: "14", durationText: "6분 51초", evals: m.evals.map((e, i) => ({ ...e, result: (i === 4 ? "X" : "O") as "O" | "X" })) };
    await expect(save(id, 1, m2)).resolves.toMatchObject({ version: 2, changed: true });
    await expect(save(id, 1, { ...m2, staffCount: "15" })).rejects.toMatchObject({ status: 409 });
    const r = await Promise.allSettled([save(id, 2, { ...m2, improvements: "가" }, "safety1"), save(id, 2, { ...m2, improvements: "나" }, "safety2")]);
    expect(r.filter((x) => x.status === "fulfilled")).toHaveLength(1);
    await save(id, 3, { ...m2, improvements: "방송 설비 점검 필요" }, "safety2", "completed");
    const d = await getDrillLog(prisma, { schoolId: A, logId: id, canEdit: true });
    expect(d.log).toMatchObject({ version: 4, status: "completed", updatedByName: "safety2" });
    expect(d.revisions.map((x) => x.version)).toEqual([4, 3, 2, 1]);
    expect(d.manual.evals.map((e) => e.result)).toEqual(["O", "O", "O", "O", "X", "O"]);
    expect(await prisma.auditLog.count({ where: { targetId: id, action: { startsWith: "drilllog." } } })).toBeGreaterThanOrEqual(4);
  });

  it("원본 대피 보고는 훈련일지 편집으로 바뀌지 않고, 원본 기록 변화는 알림 후 '다시 불러오기'로만 반영", async () => {
    await editor();
    const { id } = await createDrillLog(prisma, { schoolId: A, eventId: await closedDrill(), actorUserId: U.safety1! });
    const before = await prisma.evacuationReport.findMany({ orderBy: { classId: "asc" } });
    await save(id, 1, { ...defaultManual(), staffCount: "3" });
    expect(await prisma.evacuationReport.findMany({ orderBy: { classId: "asc" } })).toEqual(before);
    await prisma.schoolClass.update({ where: { id: c21 }, data: { enrolledCount: 26 } }); // 미보고 학급 재적 변경
    const d = await getDrillLog(prisma, { schoolId: A, logId: id, canEdit: true });
    expect(d.sourceChanges.some((s) => s.includes("2학년 1반"))).toBe(true);
    expect(d.snapshot.classes.find((c) => c.label === "2학년 1반")!.enrolled).toBe(24); // 자동 반영 안 함
    await save(id, 2, d.manual, "safety1", "draft", true);
    const d2 = await getDrillLog(prisma, { schoolId: A, logId: id, canEdit: true });
    expect(d2.snapshot.classes.find((c) => c.label === "2학년 1반")!.enrolled).toBe(26);
    expect(d2.sourceChanges).toEqual([]);
    expect(await prisma.auditLog.count({ where: { targetId: id, action: "drilllog.refreshed" } })).toBe(1);
  });

  it("훈련일지 행 직접 삭제·이력 위조는 DB가 거부", async () => {
    await editor();
    const { id } = await createDrillLog(prisma, { schoolId: A, eventId: await closedDrill(), actorUserId: U.safety1! });
    await expect(prisma.drillLog.delete({ where: { id } })).rejects.toBeTruthy();
    await expect(prisma.drillLogRevision.deleteMany({})).rejects.toBeTruthy();
  });
});

describe("HWPX 내려받기", () => {
  it("저장된 판으로 HWPX 생성: ZIP(mimetype 첫 항목), 특수문자 이스케이프, 파일 이름, 감사 기록", async () => {
    await editor();
    const { id } = await createDrillLog(prisma, { schoolId: A, eventId: await closedDrill(), actorUserId: U.safety1! });
    await save(id, 1, { ...defaultManual(), improvements: '방송 <소리> & "사이렌" 점검', staffCount: "14" });
    const r = await exportDrillLogHwpx(prisma, { schoolId: A, logId: id, actorUserId: U.safety1! });
    expect(r.buffer.subarray(0, 2).toString("latin1")).toBe("PK");
    expect(r.buffer.subarray(30, 38).toString("latin1")).toBe("mimetype");
    expect(r.filename).toMatch(/^비상대피훈련일지\(지진\)_\d{8}\.hwpx$/);
    const sec = unzip(r.buffer).get("Contents/section0.xml")!.toString("utf8");
    expect(sec).toContain("방송 &lt;소리&gt; &amp; \"사이렌\" 점검");
    expect(sec).not.toContain("<소리>");
    expect(sec).toContain("가상&lt;초&gt;&amp;학교"); // 학교명 특수문자
    expect(await prisma.auditLog.count({ where: { targetId: id, action: "drilllog.exported" } })).toBe(1);
    await expect(exportDrillLogHwpx(prisma, { schoolId: B, logId: id, actorUserId: U.adminB! })).rejects.toMatchObject({ status: 404 });
  });

  it("학급이 많으면 붙임이 늘어나도 생성됨", async () => {
    await editor();
    for (let g = 3; g <= 6; g++) for (let n = 1; n <= 12; n++) await prisma.schoolClass.create({ data: { schoolId: A, schoolYear: YEAR, grade: g, classNo: n, label: `${g}학년 ${n}반`, enrolledCount: 25 } });
    const { id } = await createDrillLog(prisma, { schoolId: A, eventId: await closedDrill(), actorUserId: U.safety1! });
    const d = await getDrillLog(prisma, { schoolId: A, logId: id, canEdit: true });
    expect(d.snapshot.classes).toHaveLength(51);
    const r = await exportDrillLogHwpx(prisma, { schoolId: A, logId: id, actorUserId: U.safety1! });
    expect(r.buffer.length).toBeGreaterThan(1000);
  });
});
