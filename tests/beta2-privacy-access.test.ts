// 권한 회수 후 기존 세션 차단, 삭제 미리보기(읽기 전용), 개인정보 최소수집 구조. 다른 테스트 자료를 초기화하지 않습니다.
import { readFileSync } from "node:fs";
import { createServer, type Server } from "node:http";
import type { AddressInfo } from "node:net";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import type { PrismaClient } from "@prisma/client";
import { createTestClient, getTestDatabaseUrl } from "./test-db";
import { createSession, SESSION_COOKIE } from "../server/src/auth/session";
import { previewEnvironmentDisposal, previewUserDeletion } from "../server/src/services/privacyPreview";
import { betaEnvironmentErrors } from "../server/src/deploy/environment";
import { FREE_TEXT_PRIVACY_NOTICE } from "../shared/privacy";

let prisma: PrismaClient;
let server: Server;
let base: string;
let seq = 0;
const unique = () => `${Date.now()}-${++seq}`;

const mkSchool = async (isDemo = true) => (await prisma.school.create({ data: { slug: `priv-${unique()}`, name: "가상 개인정보학교", isDemo, status: "active", activatedAt: new Date() } })).id;
const mkMember = async (schoolId: string, role: "admin" | "staff" = "staff") => {
  const user = await prisma.user.create({ data: { email: `priv-${unique()}@check.safeschool.invalid`, displayName: "가상 교직원", passwordHash: "x", emailVerifiedAt: new Date() } });
  const m = await prisma.schoolMembership.create({ data: { schoolId, userId: user.id, role, status: "approved", approvalMethod: "roster", approvedAt: new Date() } });
  return { userId: user.id, membershipId: m.id, cookie: `${SESSION_COOKIE}=${(await createSession(prisma, { userId: user.id, deviceKind: "personal" })).token}` };
};

beforeAll(async () => {
  process.env.DATABASE_URL = getTestDatabaseUrl();
  prisma = createTestClient();
  const { createApp } = await import("../server/src/app");
  server = createServer(await createApp({ mode: "test" }));
  await new Promise<void>((r) => server.listen(0, "127.0.0.1", () => r()));
  base = `http://127.0.0.1:${(server.address() as AddressInfo).port}/api`;
});
afterAll(async () => {
  await new Promise((r) => server.close(r));
  await prisma.$disconnect();
});

describe("권한 회수 후 기존 세션", () => {
  let school: string;
  let staff: Awaited<ReturnType<typeof mkMember>>;
  const paths = (id: string) => ["board", "alerts", "alerts/pending", "weather-warnings", "incidents", "drill-logs", "staff-alerts", "events/active"].map((p) => `${base}/schools/${id}/${p}`);
  const statuses = async (cookie: string) => Promise.all(paths(school).map(async (u) => [u.split("/").slice(-1)[0], (await fetch(u, { headers: { cookie } })).status] as const));

  beforeEach(async () => {
    school = await mkSchool();
    staff = await mkMember(school);
  });
  const expectDenied = async () => {
    for (const [p, s] of await statuses(staff.cookie)) expect([p, s >= 401 && s < 500]).toEqual([p, true]);
  };

  it("회수 전에는 접근 가능(대조)", async () => {
    expect((await fetch(`${base}/schools/${school}/alerts/pending`, { headers: { cookie: staff.cookie } })).status).toBe(200);
  });
  it("소속 회수(전근·퇴직): 같은 세션으로 학교 자료 접근 불가, 계정·감사 기록은 삭제 안 됨", async () => {
    await prisma.schoolMembership.update({ where: { id: staff.membershipId }, data: { status: "revoked" } });
    await expectDenied();
    expect(await prisma.user.count({ where: { id: staff.userId } })).toBe(1);
  });
  it("승인 취소(rejected)도 차단", async () => {
    await prisma.schoolMembership.update({ where: { id: staff.membershipId }, data: { status: "rejected" } });
    await expectDenied();
  });
  it("학교 이용 중지: 차단", async () => {
    await prisma.school.update({ where: { id: school }, data: { status: "suspended" } });
    await expectDenied();
  });
  it("계정 비활성화: 세션 자체가 무효", async () => {
    await prisma.user.update({ where: { id: staff.userId }, data: { status: "disabled" } });
    await expectDenied();
    expect((await fetch(`${base}/auth/me`, { headers: { cookie: staff.cookie } })).status).toBe(401);
  });
  it("업무 회수: 해당 권한만 다음 요청부터 사라짐", async () => {
    const { grantDutyByPlatformOperator } = await import("../server/src/services/duties");
    await grantDutyByPlatformOperator(prisma, { membershipId: staff.membershipId, duty: "safety_officer", operator: "점검", verificationMethod: "점검" });
    const url = `${base}/schools/${school}/events`;
    const issue = () => fetch(url, { method: "POST", headers: { cookie: staff.cookie, "content-type": "application/json" }, body: JSON.stringify({ primaryType: "fire", mode: "drill" }) });
    const first = await issue();
    expect(first.status).toBeLessThan(300);
    const eventId = ((await first.json()) as { event: { id: string } }).event.id;
    await prisma.disasterEvent.update({ where: { id: eventId }, data: { status: "closed", closedAt: new Date() } }).catch(() => undefined);
    await prisma.memberDuty.updateMany({ where: { membershipId: staff.membershipId }, data: { endedAt: new Date(), endReason: "권한 회수 시험", endedByLabel: "점검" } });
    expect((await issue()).status).toBe(403);
    expect((await fetch(`${base}/schools/${school}/alerts/pending`, { headers: { cookie: staff.cookie } })).status).toBe(200);
  });
  it("다른 학교 사용자는 사진·보고서 경로도 거부", async () => {
    const other = await mkMember(await mkSchool());
    for (const p of ["incidents/00000000-0000-0000-0000-000000000000/attachments/00000000-0000-0000-0000-000000000000", "drill-logs/00000000-0000-0000-0000-000000000000/export.hwpx"]) {
      const s = (await fetch(`${base}/schools/${school}/${p}`, { headers: { cookie: other.cookie } })).status;
      expect(s).toBeGreaterThanOrEqual(403);
      expect(s).toBeLessThan(500);
    }
  });
});

describe("삭제 미리보기(읽기 전용)", () => {
  it("계정 참조를 카탈로그에서 찾고 건수만 반환, 값·행을 바꾸지 않음", async () => {
    const school = await mkSchool();
    const m = await mkMember(school);
    const before = await prisma.user.findUniqueOrThrow({ where: { id: m.userId } });
    const p = await previewUserDeletion(prisma, m.userId);
    expect(p).toMatchObject({ userFound: true, executable: false });
    expect(p.references.find((r) => r.table.endsWith("sessions"))).toMatchObject({ rows: 1, action: "cascade" });
    expect(p.references.find((r) => r.table.endsWith("school_memberships") && r.column === "user_id")?.rows).toBe(1);
    expect(p.references.length).toBeGreaterThan(10);
    expect(JSON.stringify(p)).not.toContain(before.email);
    expect(await prisma.user.findUniqueOrThrow({ where: { id: m.userId } })).toEqual(before);
    expect(await prisma.session.count({ where: { userId: m.userId } })).toBe(1);
  });
  it("감사 기록처럼 막히는 참조는 blocked 로 표시", async () => {
    const m = await mkMember(await mkSchool());
    await prisma.auditLog.create({ data: { actorUserId: m.userId, action: "privacy.test", targetType: "user", targetId: m.userId } });
    const p = await previewUserDeletion(prisma, m.userId);
    expect(p.references.find((r) => r.table.endsWith("audit_logs") && r.column === "actor_user_id")).toMatchObject({ rows: 1, action: "blocked", deleteGuarded: true });
    expect(p.blockedRows).toBeGreaterThan(0);
  });
  it("잘못된 ID 거부, 없는 사용자는 없음으로 표시", async () => {
    await expect(previewUserDeletion(prisma, "x'; DROP TABLE users; --")).rejects.toThrow("형식");
    expect((await previewUserDeletion(prisma, "00000000-0000-0000-0000-000000000000")).userFound).toBe(false);
  });
  it("환경 폐기: 건수와 차단 사유, 실제 학교가 있거나 가상 모드가 아니면 차단, 행 변화 없음", async () => {
    await mkSchool(false);
    const before = await prisma.school.count();
    const p = await previewEnvironmentDisposal(prisma, { BETA_DATA_MODE: "school_pilot" });
    expect(p.executable).toBe(false);
    expect(p.tables.some((t) => t.table === "users")).toBe(true);
    expect(p.tables.some((t) => t.table === "_prisma_migrations")).toBe(false);
    expect(p.blockers.join()).toContain("가상 학교가 아닌");
    expect(p.blockers.join()).toContain("virtual_test");
    expect(await prisma.school.count()).toBe(before);
  });
  it("도구에 삭제 구문이 없고 실행 옵션을 거부, 보유기간을 코드에 두지 않음", () => {
    for (const f of ["server/src/services/privacyPreview.ts", "scripts/privacy-preview.ts"]) {
      const code = readFileSync(f, "utf8").split("\n").filter((l) => !l.trim().startsWith("//")).join("\n");
      expect(code, f).not.toMatch(/\b(DELETE FROM|TRUNCATE|DROP |UPDATE |INSERT )\b|\.delete(Many)?\(|\.update(Many)?\(/);
      expect(code, f).not.toMatch(/365|31536000/);
    }
    expect(readFileSync("scripts/privacy-preview.ts", "utf8")).toContain('"--execute"');
  });
});

describe("개인정보 최소수집 구조", () => {
  const schema = readFileSync("prisma/schema.prisma", "utf8");
  it("학생 직접 식별 필드와 교직원 휴대전화·생년월일·주소 필드가 없음", () => {
    expect(schema).not.toMatch(/student_?(name|no|number)|studentName|birth|resident|guardian|health/i);
    const user = /model User \{[\s\S]*?\n\}/.exec(schema)![0];
    expect(user).not.toMatch(/phone|mobile|birth|address/i);
  });
  it("제보 화면 외 자유 입력에도 안내 문구(제보는 기존 문구 유지)", () => {
    expect(FREE_TEXT_PRIVACY_NOTICE).toContain("학생 이름");
    for (const f of ["report/ReportFormView.tsx", "drill/DrillLogEditorPage.tsx"]) {
      expect(readFileSync(`client/src/pages/${f}`, "utf8"), f).toContain("FREE_TEXT_PRIVACY_NOTICE");
    }
  });
});

describe("Beta 실제 데이터 유입 차단", () => {
  const virtual = { BETA_DATA_MODE: "virtual_test" };
  it("가상 모드는 가입 경로가 되는 메일 설정을 모두 거부", () => {
    for (const p of ["gmail", "resend", "manual"]) expect(betaEnvironmentErrors("beta" as never, { ...virtual, MAIL_PROVIDER: p }).join()).toContain("가상 데이터 모드");
    expect(betaEnvironmentErrors("beta" as never, virtual).join()).not.toContain("가상 데이터 모드");
  });
  it("실제 학교 모드: 학교 승인 필수, 사진은 끄거나 별도 승인", () => {
    const school = { BETA_DATA_MODE: "school_pilot", BETA_SCHOOL_PILOT_APPROVED: "true" };
    expect(betaEnvironmentErrors("beta" as never, { BETA_DATA_MODE: "school_pilot", INCIDENT_PHOTO_UPLOAD: "disabled" }).join()).toContain("BETA_SCHOOL_PILOT_APPROVED");
    expect(betaEnvironmentErrors("beta" as never, { ...school, INCIDENT_PHOTO_UPLOAD: "enabled" }).join()).toContain("BETA_PHOTO_UPLOAD_APPROVED");
    expect(betaEnvironmentErrors("beta" as never, { ...school, INCIDENT_PHOTO_UPLOAD: "enabled", BETA_PHOTO_UPLOAD_APPROVED: "true" }).join()).not.toContain("BETA_PHOTO_UPLOAD_APPROVED");
    expect(betaEnvironmentErrors("beta" as never, { ...school, INCIDENT_PHOTO_UPLOAD: "disabled" }).join()).not.toContain("BETA_PHOTO_UPLOAD_APPROVED");
  });
  it("Beta 예시 파일은 사진 첨부 꺼짐", () => {
    expect(readFileSync("deploy/env/beta.env.example", "utf8")).toMatch(/^INCIDENT_PHOTO_UPLOAD=disabled$/m);
  });
});
