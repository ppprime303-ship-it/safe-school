// STEP A P0-2 학교알리미 연동 규격 보완(2026-10-27 공식 자료 기준) — 가상 응답만 사용(실제 호출 없음)
// - 시도 코드: 전남광주통합특별시(12) 신설, 광주(29)·전남(46) 삭제 / 시군구 코드(5자리) 공식 코드표
// - 시군구 단위 목록 받기·최신 여부, SCHOOLINFO_SGG_REQUIRED(시군구 필수 인증키) 모드
// - apiType 09 열: 초·중·고 모두 n학년 = COL_Cn·COL_Sn
// - 인증키 없음·연결 실패·시간 초과·HTTP 오류·결과 코드 실패·형식 변경
import { afterAll, afterEach, beforeEach, describe, expect, it } from "vitest";
import { createTestClient, resetTestData } from "./test-db.js";
import { BASIC_ROWS, FakeSchoolinfoClient, gradeClassRow } from "./fixtures/schoolinfo.js";
import { searchDirectory, syncDirectory } from "../server/src/services/schoolDirectory.js";
import { refreshGradeClassData } from "../server/src/services/publicData.js";
import { applyForSchoolRegistration, reviewSchoolRegistration } from "../server/src/services/schoolRegistration.js";
import { createSchoolinfoClient, parseGradeClassStudents, SIDO_CODES } from "../server/src/integrations/schoolinfo.js";
import { isSggCode, SCHOOLINFO_SGG, SCHOOLINFO_SIDO, sggOf } from "../shared/schoolinfoRegions.js";
import { directorySearchSchema } from "../shared/schemas.js";

const prisma = createTestClient();
let client: FakeSchoolinfoClient;

beforeEach(async () => {
  await resetTestData(prisma);
  client = new FakeSchoolinfoClient();
  delete process.env.SCHOOLINFO_SGG_REQUIRED;
});
afterEach(() => {
  delete process.env.SCHOOLINFO_SGG_REQUIRED;
  delete process.env.SCHOOLINFO_GRADE_DATA;
});
afterAll(async () => {
  await prisma.$disconnect();
});

describe("공식 시도·시군구 코드표", () => {
  it("전남광주통합특별시 12 있음, 광주 29·전남 46 없음, 시도 16개", () => {
    expect(SIDO_CODES["12"]).toBe("전남광주통합특별시");
    expect(SIDO_CODES["29"]).toBeUndefined();
    expect(SIDO_CODES["46"]).toBeUndefined();
    expect(SCHOOLINFO_SIDO).toHaveLength(16);
  });
  it("시군구 코드는 5자리·중복 없음·앞 2자리가 실제 시도", () => {
    const sidos = new Set(SCHOOLINFO_SIDO.map(([c]) => c));
    expect(SCHOOLINFO_SGG.every(([c]) => /^\d{5}$/.test(c) && sidos.has(c.slice(0, 2)))).toBe(true);
    expect(new Set(SCHOOLINFO_SGG.map(([c]) => c)).size).toBe(SCHOOLINFO_SGG.length);
    expect(sggOf("12").length).toBeGreaterThan(0);
    expect(isSggCode("51150")).toBe(true); // 강릉시(공식 페이지 예시)
    expect(isSggCode("29110")).toBe(false);
  });
  it("검색 입력: 시군구 5자리, 시도와 맞아야 함", () => {
    expect(directorySearchSchema.safeParse({ q: "안전초", kind: "02", sido: "41", sgg: "41111" }).success).toBe(true);
    expect(directorySearchSchema.safeParse({ q: "안전초", kind: "02", sido: "11", sgg: "41111" }).success).toBe(false);
    expect(directorySearchSchema.safeParse({ q: "안전초", kind: "02", sgg: "4111" }).success).toBe(false);
  });
});

describe("시군구 단위 학교 목록", () => {
  it("시군구로 받으면 요청에 sggCode·sidoCode, 저장에 시군구·시도 코드", async () => {
    await syncDirectory(prisma, client, { kindCode: "02", sggCode: "41111" });
    expect(client.calls[0]).toMatchObject({ apiType: "0", schulKndCode: "02", sidoCode: "41", sggCode: "41111" });
    const e = await prisma.schoolDirectoryEntry.findFirstOrThrow({ where: { externalCode: "S000000001" } });
    expect([e.sidoCode, e.sggCode]).toEqual(["41", "41111"]);
  });
  it("공식 코드표에 없는 시군구는 호출하지 않음", async () => {
    await expect(syncDirectory(prisma, client, { kindCode: "02", sggCode: "29110" })).rejects.toMatchObject({ kind: "params" });
    expect(client.calls).toHaveLength(0);
  });
  it("시군구 검색: 그 시군구 목록이 없으면 받아 오고, 최신이면 다시 부르지 않음", async () => {
    const a = await searchDirectory(prisma, client, { q: "안전초", kindCode: "02", sidoCode: "41", sggCode: "41111" });
    expect([a.stale, a.results.length > 0, client.calls.length]).toEqual([false, true, 1]);
    await searchDirectory(prisma, client, { q: "안전초", kindCode: "02", sidoCode: "41", sggCode: "41111" });
    expect(client.calls).toHaveLength(1);
    // 다른 시군구는 따로 판단
    await searchDirectory(prisma, client, { q: "안전초", kindCode: "02", sidoCode: "41", sggCode: "41131" });
    expect(client.calls).toHaveLength(2);
  });
  it("기존 방식(시군구 없이) 검색은 그대로 동작", async () => {
    const r = await searchDirectory(prisma, client, { q: "안전초", kindCode: "02" });
    expect(r.results.length).toBeGreaterThan(0);
    expect(client.calls[0]?.sggCode).toBeUndefined();
  });
});

describe("시군구 필수 인증키 모드(SCHOOLINFO_SGG_REQUIRED=true)", () => {
  it("시군구 없는 검색은 API를 부르지 않고 저장된 목록 + 안내", async () => {
    process.env.SCHOOLINFO_SGG_REQUIRED = "true";
    await syncDirectory(prisma, client, { kindCode: "02", sggCode: "41111" });
    await prisma.schoolDirectoryEntry.updateMany({ data: { syncedAt: new Date("2020-01-01") } });
    client.calls = [];
    const r = await searchDirectory(prisma, client, { q: "안전초", kindCode: "02", sidoCode: "41" });
    expect(client.calls).toHaveLength(0);
    expect(r.stale).toBe(true);
    expect(r.warning).toContain("시군구");
    expect(r.results.length).toBeGreaterThan(0); // 오래된 목록이라도 표시
  });
  it("시군구 없이 받기 요청은 거부(params)", async () => {
    process.env.SCHOOLINFO_SGG_REQUIRED = "true";
    await expect(syncDirectory(prisma, client, { kindCode: "02", sidoCode: "41" })).rejects.toMatchObject({ kind: "params" });
    expect(client.calls).toHaveLength(0);
  });
  it("학년별 공시자료: 시군구 단위로 받은 학교는 sggCode로 요청, 시군구 모르는 학교는 부르지 않고 저장 자료", async () => {
    process.env.SCHOOLINFO_GRADE_DATA = "enabled";
    process.env.SCHOOLINFO_SGG_REQUIRED = "true";
    const user = await prisma.user.create({ data: { email: "a@sgg.example", displayName: "가상", emailVerifiedAt: new Date() } });
    await syncDirectory(prisma, client, { kindCode: "02", sggCode: "41111" });
    const reg = await applyForSchoolRegistration(prisma, { userId: user.id, externalCode: "S000000001" });
    await reviewSchoolRegistration(prisma, { registrationId: reg.registration.id, decision: "approve", reviewer: "운영자", verificationMethod: "공문 확인" });
    client.calls = [];
    const r = await refreshGradeClassData(prisma, client, { schoolId: reg.school.id });
    expect(r.stale).toBe(false);
    expect(client.calls[0]).toMatchObject({ apiType: "09", sggCode: "41111", sidoCode: "41" });

    await prisma.schoolDirectoryEntry.updateMany({ data: { sggCode: null } });
    client.calls = [];
    const r2 = await refreshGradeClassData(prisma, client, { schoolId: reg.school.id });
    expect(client.calls).toHaveLength(0);
    expect(r2.stale).toBe(true);
    expect(r2.warning).toContain("시군구");
  });
});

describe("학년별 공시자료 열(공식 출력값 정의)", () => {
  const row = gradeClassRow({ COL_C1: "4", COL_S1: "110", COL_C2: "4", COL_S2: "112", COL_C3: "3", COL_S3: "90", COL_C9: "99", COL_S9: "999", COL_C14: "88", COL_S14: "888" });
  it.each(["03", "04"])("학교급 %s: 1~3학년 = COL_C1~3 (예전 잘못된 COL_C9·C14 를 읽지 않음)", (kind) => {
    expect(parseGradeClassStudents(row, kind).grades).toEqual([
      { grade: 1, classCount: 4, studentCount: 110 },
      { grade: 2, classCount: 4, studentCount: 112 },
      { grade: 3, classCount: 3, studentCount: 90 },
    ]);
  });
});

describe("학교알리미 클라이언트 오류 처리(가짜 HTTP)", () => {
  const c = (impl: () => Promise<Response>) => createSchoolinfoClient({ apiKey: "test-key-not-real", timeoutMs: 50, fetchImpl: impl as typeof fetch });
  const q = { apiType: "0", schulKndCode: "02", sggCode: "41111" };
  it("인증키 없음 → not_configured(호출 안 함)", async () => {
    let called = false;
    const none = createSchoolinfoClient({ apiKey: undefined, fetchImpl: (async () => ((called = true), new Response("{}"))) as typeof fetch });
    await expect(none.fetch(q)).rejects.toMatchObject({ kind: "not_configured" });
    expect(called).toBe(false);
  });
  it("정상 응답", async () => {
    const r = await c(async () => new Response(JSON.stringify({ resultCode: "success", resultMsg: "정상", list: BASIC_ROWS }))).fetch(q);
    expect(r.rows).toHaveLength(BASIC_ROWS.length);
    expect(r.sourceUrl).toContain("sggCode=41111");
    expect(r.sourceUrl).not.toContain("apiKey");
  });
  it.each([
    ["제공기관 5xx", async () => new Response("", { status: 503 }), "http"],
    ["인증 오류(결과 코드 fail)", async () => new Response(JSON.stringify({ resultCode: "fail", resultMsg: "인증키 오류" })), "api"],
    ["호출 한도 초과(HTTP 429)", async () => new Response("", { status: 429 }), "http"],
    ["형식 변경(list 없음)", async () => new Response(JSON.stringify({ resultCode: "success", data: [] })), "format"],
    ["JSON 아님", async () => new Response("<html>"), "format"],
    ["연결 실패", async () => { throw new TypeError("fetch failed"); }, "network"],
  ])("%s → %s", async (_n, impl, kind) => {
    await expect(c(impl as () => Promise<Response>).fetch(q)).rejects.toMatchObject({ kind });
  });
  it("응답 없음(시간 초과) → network(시간 초과)", async () => {
    const slow = createSchoolinfoClient({
      apiKey: "test-key-not-real",
      timeoutMs: 50,
      fetchImpl: ((_u: string, init: RequestInit) => new Promise((_r, reject) => init.signal!.addEventListener("abort", () => reject(init.signal!.reason)))) as unknown as typeof fetch,
    });
    await expect(slow.fetch(q)).rejects.toMatchObject({ kind: "network" });
  });
  it("장애 중 검색은 저장된 목록으로(stale + 안내)", async () => {
    await syncDirectory(prisma, client, { kindCode: "02", sggCode: "41111" });
    await prisma.schoolDirectoryEntry.updateMany({ data: { syncedAt: new Date("2020-01-01") } });
    client.failing = true;
    const r = await searchDirectory(prisma, client, { q: "안전초", kindCode: "02", sidoCode: "41", sggCode: "41111" });
    expect([r.stale, r.results.length > 0]).toEqual([true, true]);
    expect(r.warning).toContain("저장된 목록");
  });
});

describe("예전 시도 코드(29·46)로 저장된 목록 호환", () => {
  it("12로 검색하면 예전 코드 행도 보이고, 행은 바뀌지 않음", async () => {
    await syncDirectory(prisma, client, { kindCode: "02", sidoCode: "29" }); // 출범 전 방식으로 저장된 목록을 흉내
    const before = await prisma.schoolDirectoryEntry.findMany({ orderBy: { externalCode: "asc" } });
    client.failing = true; // 12 목록은 없으니 받기를 시도하다 실패 → 저장 목록으로
    const r = await searchDirectory(prisma, client, { q: "안전초", kindCode: "02", sidoCode: "12" });
    expect(r.results.length).toBeGreaterThan(0);
    const after = await prisma.schoolDirectoryEntry.findMany({ orderBy: { externalCode: "asc" } });
    expect(after.map((e) => [e.externalCode, e.sidoCode, e.syncedAt.getTime()])).toEqual(before.map((e) => [e.externalCode, e.sidoCode, e.syncedAt.getTime()]));
    expect(after.every((e) => e.sidoCode === "29")).toBe(true);
  });
});
