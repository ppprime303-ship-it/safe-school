// Beta PILOT 2 Phase 4-A: 보고서 DB 규칙(마이그레이션 20261101000000_disaster_reports) — 테스트 스키마, 직접 삽입·수정으로 DB 검사 확인
// - 서식 키 ↔ 사건 모드 일치, 진행 중 사건에도 작성 중(draft) 생성, 완료는 종료 후 + 종료 뒤 다시 불러온 기록만
// - 이벤트당 1건, 삭제 금지, 판 번호 규칙은 그대로
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { PrismaClient } from "@prisma/client";
import { createTestClient, resetTestData } from "./test-db";

let prisma: PrismaClient;
let schoolId = "";
let otherSchool = "";
let userId = "";

const json = { takenAt: "x" };
const event = (mode: "drill" | "real", status: "active" | "closed" = "active") =>
  prisma.disasterEvent.create({ data: { schoolId, primaryType: "fire", mode, status, ...(status === "closed" ? { closedAt: new Date() } : {}) } });
const insert = (eventId: string, formKey: string, sid = schoolId) =>
  prisma.drillLog.create({ data: { schoolId: sid, eventId, formKey, autoSnapshot: json, manual: {}, createdById: userId, updatedById: userId } });

beforeAll(async () => {
  prisma = createTestClient();
  await resetTestData(prisma);
  const now = new Date();
  schoolId = (await prisma.school.create({ data: { slug: "report-mig", name: "가상 보고서학교", isDemo: true, status: "active", activatedAt: now } })).id;
  otherSchool = (await prisma.school.create({ data: { slug: "report-mig-b", name: "가상 다른학교", isDemo: true, status: "active", activatedAt: now } })).id;
  userId = (await prisma.user.create({ data: { email: "writer@report.safeschool.invalid", displayName: "가상 작성자", emailVerifiedAt: now } })).id;
});

afterAll(async () => {
  await prisma.$disconnect();
});

describe("서식 키와 사건 모드", () => {
  it("모의훈련은 evacuation_drill 만, 실제 재난은 disaster_real 만, 그 밖의 서식 키 거부", async () => {
    const drill = await event("drill", "closed");
    const real = await event("real", "closed");
    await expect(insert(drill.id, "disaster_real")).rejects.toThrow(/서식이 사건 구분/);
    await expect(insert(real.id, "evacuation_drill")).rejects.toThrow(/서식이 사건 구분/);
    await expect(insert(real.id, "anything_else")).rejects.toThrow();
    expect((await insert(drill.id, "evacuation_drill")).formKey).toBe("evacuation_drill");
    expect((await insert(real.id, "disaster_real")).formKey).toBe("disaster_real");
  });

  it("이벤트당 1건(같은 사건 두 번째 보고서 거부), 다른 학교 사건에 만들 수 없음, 삭제 금지", async () => {
    const real = await event("real", "closed");
    const first = await insert(real.id, "disaster_real");
    await expect(insert(real.id, "disaster_real")).rejects.toThrow();
    await expect(insert(real.id, "disaster_real", otherSchool)).rejects.toThrow();
    await expect(prisma.drillLog.delete({ where: { id: first.id } })).rejects.toThrow();
  });
});

describe("진행 중 작성과 완료 시점", () => {
  it("진행 중 사건에도 작성 중(draft) 보고서 생성 가능, 완료는 거부", async () => {
    const live = await event("real");
    const log = await insert(live.id, "disaster_real");
    expect(log.status).toBe("draft");
    await expect(prisma.drillLog.update({ where: { id: log.id }, data: { status: "completed", version: 2 } })).rejects.toThrow(/사건이 종료된 뒤에/);
    // 작성 중 저장(판 +1)은 가능
    expect((await prisma.drillLog.update({ where: { id: log.id }, data: { manual: { note: "초안" }, version: 2 } })).version).toBe(2);
  });

  it("종료 후라도 진행 중에 불러온 기록으로는 완료 거부 → 종료 뒤 다시 불러오면 완료 가능", async () => {
    // 학교당 진행 중 사건 1건(기존 DB 규칙) — 앞 테스트의 진행 중 사건을 먼저 종료
    await prisma.disasterEvent.updateMany({ where: { schoolId, status: "active" }, data: { status: "closed", closedAt: new Date() } });
    const ev = await event("drill");
    const log = await insert(ev.id, "evacuation_drill");
    await prisma.disasterEvent.update({ where: { id: ev.id }, data: { status: "closed", closedAt: new Date(Date.now() + 1000) } });
    await expect(prisma.drillLog.update({ where: { id: log.id }, data: { status: "completed", version: 2 } })).rejects.toThrow(/다시 불러온 다음/);
    const refreshed = await prisma.drillLog.update({ where: { id: log.id }, data: { autoSnapshot: { takenAt: "after-close" }, autoTakenAt: new Date(Date.now() + 2000), version: 2 } });
    expect((await prisma.drillLog.update({ where: { id: refreshed.id }, data: { status: "completed", version: 3 } })).status).toBe("completed");
    // 완료 후 입력만 고치는 저장은 그대로 가능(기존 동작)
    expect((await prisma.drillLog.update({ where: { id: log.id }, data: { manual: { note: "완료 후 정정" }, version: 4 } })).version).toBe(4);
  });

  it("판 번호 규칙 그대로(내용이 바뀌면 정확히 +1)", async () => {
    const ev = await event("drill", "closed");
    const log = await insert(ev.id, "evacuation_drill");
    await expect(prisma.drillLog.update({ where: { id: log.id }, data: { manual: { a: 1 }, version: 3 } })).rejects.toThrow(/판 번호/);
  });
});
