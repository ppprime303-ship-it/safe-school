// 2026-11-04 긴급: 인천 행정구역 개편 후 학교알리미가 일부 학교를 개편 전 시군구 코드로만 제공(인천신검단초 → 28260 서구)
// 가상 응답만 사용(실제 호출 없음). 학교 코드·이름은 실제 응답 형식을 흉내 낸 테스트 값입니다.
import { afterAll, afterEach, beforeEach, describe, expect, it } from "vitest";
import { createTestClient, resetTestData } from "./test-db.js";
import { searchDirectory, syncDirectory } from "../server/src/services/schoolDirectory.js";
import { buildSourceUrl, SchoolinfoError, type SchoolinfoClient, type SchoolinfoQuery, type SchoolinfoRow } from "../server/src/integrations/schoolinfo.js";

const prisma = createTestClient();

const row = (code: string, name: string, addr: string): SchoolinfoRow => ({
  SCHUL_CODE: code,
  SCHUL_NM: name,
  SCHUL_KND_SC_CODE: "02",
  ATPT_OFCDC_ORG_NM: "인천광역시교육청",
  SCHUL_RDNMA: addr,
  ABSCH_YN: "N",
});

const BY_SGG: Record<string, SchoolinfoRow[]> = {
  "28290": [row("T040000811", "인천검단초등학교", "인천광역시 검단구 마전로115번길 24")],
  "28260": [row("T040002358", "인천신검단초등학교", "인천광역시 검단구 금정로 55")],
  "28275": [row("T040000900", "인천서해초등학교", "인천광역시 서해구 가정로 1")],
  "28125": [row("T040000100", "인천제물포초등학교", "인천광역시 제물포구 1"), row("T040000101", "인천중앙초등학교", "인천광역시 제물포구 2")],
  // 예전 중구(28110)는 제물포구·영종구 학교가 섞여 있음
  "28110": [row("T040000101", "인천중앙초등학교", "인천광역시 제물포구 2"), row("T040000200", "인천영종초등학교", "인천광역시 영종구 1")],
  "28155": [row("T040000200", "인천영종초등학교", "인천광역시 영종구 1")],
};

class RegionClient implements SchoolinfoClient {
  calls: SchoolinfoQuery[] = [];
  failing = new Set<string>();
  async fetch(query: SchoolinfoQuery) {
    this.calls.push(query);
    if (this.failing.has(query.sggCode ?? "")) throw new SchoolinfoError("학교알리미에 연결할 수 없습니다(연결 실패).", "network");
    const rows = BY_SGG[query.sggCode ?? ""];
    if (!rows) throw new SchoolinfoError("학교알리미 오류: 해당 시도 및 시군구에 데이터가 존재하지 않습니다.", "api");
    return { rows, sourceUrl: buildSourceUrl(query) };
  }
}

let client: RegionClient;
beforeEach(async () => {
  await resetTestData(prisma);
  client = new RegionClient();
  process.env.SCHOOLINFO_SGG_REQUIRED = "true";
});
afterEach(() => {
  delete process.env.SCHOOLINFO_SGG_REQUIRED;
});
afterAll(async () => {
  await prisma.$disconnect();
});

const search = (q: string, sggCode?: string) => searchDirectory(prisma, client, { q, kindCode: "02", sidoCode: "28", sggCode });

describe("개편 전 시군구 코드로만 제공되는 학교", () => {
  it("검단구 검색: 예전 서구(28260) 목록도 받아 인천신검단초등학교가 보임(부분·전체 이름)", async () => {
    const part = await search("신검단", "28290");
    expect(part.results.map((r) => r.name)).toEqual(["인천신검단초등학교"]);
    expect(client.calls.map((c) => c.sggCode)).toEqual(["28290", "28260"]);
    expect(client.calls.every((c) => c.sidoCode === "28" && c.schulKndCode === "02" && c.apiType === "0")).toBe(true);

    const full = await search("인천신검단초등학교", "28290");
    expect(full.results).toHaveLength(1);
    expect(full.results[0]).toMatchObject({ externalCode: "T040002358", address: "인천광역시 검단구 금정로 55" });
    const spaced = await search(" 인천 신검단초 ", "28290");
    expect(spaced.results).toHaveLength(1);
    expect(client.calls).toHaveLength(2); // 최신 목록이면 다시 부르지 않음

    // 기존 검단구 학교도 그대로
    expect((await search("검단초", "28290")).results.map((r) => r.name)).toEqual(["인천검단초등학교", "인천신검단초등학교"]);
    // 인천 전체(시군구 없이)로도 저장된 목록에서 보임
    expect((await search("신검단")).results).toHaveLength(1);
  });

  it("예전 코드 행은 실제 받은 코드(28260)로 저장, 공식 코드표에 없는 코드를 직접 요청하지는 못함", async () => {
    await syncDirectory(prisma, client, { kindCode: "02", sggCode: "28290" });
    const e = await prisma.schoolDirectoryEntry.findFirstOrThrow({ where: { externalCode: "T040002358" } });
    expect([e.sidoCode, e.sggCode]).toEqual(["28", "28260"]);
    await expect(syncDirectory(prisma, client, { kindCode: "02", sggCode: "28260" })).rejects.toMatchObject({ kind: "params" });
  });

  it("둘로 나뉜 예전 중구: 새 코드로 저장된 학교는 예전 코드로 덮어쓰지 않음", async () => {
    await syncDirectory(prisma, client, { kindCode: "02", sggCode: "28125" });
    await syncDirectory(prisma, client, { kindCode: "02", sggCode: "28155" });
    const rows = await prisma.schoolDirectoryEntry.findMany({ orderBy: { externalCode: "asc" } });
    expect(rows.map((r) => [r.externalCode, r.sggCode])).toEqual([
      ["T040000100", "28125"],
      ["T040000101", "28125"],
      ["T040000200", "28155"],
    ]);
  });

  it("예전 코드 목록 받기가 실패해도 새 코드 목록은 저장·검색됨", async () => {
    client.failing.add("28260");
    const r = await search("검단초", "28290");
    expect(r.refreshFailed).toBe(false);
    expect(r.results.map((x) => x.name)).toEqual(["인천검단초등학교"]);
  });

  it("학교알리미 장애 시 기존 목록 보존(삭제·변경 없음)", async () => {
    await syncDirectory(prisma, client, { kindCode: "02", sggCode: "28290" });
    await prisma.schoolDirectoryEntry.updateMany({ data: { syncedAt: new Date("2020-01-01") } });
    const before = await prisma.schoolDirectoryEntry.findMany({ orderBy: { externalCode: "asc" } });
    client.failing.add("28290");
    client.failing.add("28260");
    const r = await search("신검단", "28290");
    expect([r.stale, r.refreshFailed, r.results.length]).toEqual([true, true, 1]);
    expect(r.warning).toContain("저장된 목록");
    const after = await prisma.schoolDirectoryEntry.findMany({ orderBy: { externalCode: "asc" } });
    expect(after.map((e) => [e.externalCode, e.sggCode, e.syncedAt.getTime()])).toEqual(before.map((e) => [e.externalCode, e.sggCode, e.syncedAt.getTime()]));
  });

  it("다른 지역(예전 코드 없음)은 예전처럼 한 번만 호출", async () => {
    await search("서해초", "28275"); // 서해구 ← 서구(28260) 함께
    expect(client.calls.map((c) => c.sggCode)).toEqual(["28275", "28260"]);
    client.calls = [];
    await searchDirectory(prisma, client, { q: "안전", kindCode: "02", sidoCode: "28", sggCode: "28185" }).catch(() => undefined);
    expect(client.calls.map((c) => c.sggCode)).toEqual(["28185"]);
  });
});

describe("시군구 필수 키에서 시군구 없이 검색", () => {
  it("저장 목록이 최신이어도 '시군구를 선택하라'는 안내를 보냄(일부 시군구만 받아 둔 상태)", async () => {
    await syncDirectory(prisma, client, { kindCode: "02", sggCode: "28275" });
    client.calls = [];
    const r = await search("영종초");
    expect(client.calls).toHaveLength(0);
    expect(r.stale).toBe(false);
    expect(r.results).toHaveLength(0);
    expect(r.warning).toContain("시군구를 선택");
  });
});
