import { describe, expect, it } from "vitest";
import {
  buildSourceUrl,
  createSchoolinfoClient,
  hashPayload,
  parseBasicInfo,
  parseGradeClassStudents,
  SchoolinfoError,
} from "../server/src/integrations/schoolinfo.js";
import { BASIC_ROWS, gradeClassRow } from "./fixtures/schoolinfo.js";

describe("학교알리미 응답 해석", () => {
  it("학교기본정보에서 코드·이름·교육청·주소·폐교 여부를 읽는다", () => {
    expect(parseBasicInfo(BASIC_ROWS[0]!)).toEqual({
      externalCode: "S000000001",
      name: "안전초등학교",
      kindCode: "02",
      eduOfficeName: "가상교육청",
      eduOfficeCode: "X10",
      address: "가상시 안전로 1",
      closed: false,
    });
    expect(parseBasicInfo(BASIC_ROWS[2]!)?.closed).toBe(true);
    expect(parseBasicInfo(BASIC_ROWS[3]!)).toBeNull();
  });

  it("학년별 학급수·학생수를 읽고, 학급별로 나누지 않는다", () => {
    const parsed = parseGradeClassStudents(gradeClassRow(), "02");
    expect(parsed.grades).toEqual([
      { grade: 1, classCount: 3, studentCount: 75 },
      { grade: 2, classCount: 3, studentCount: 78 },
      { grade: 3, classCount: 2, studentCount: 55 },
    ]);
    expect(parsed.totalStudents).toBe(208);
    expect(parsed.baseDate).toBeNull(); // 기준일 필드가 없으면 비워 둠
    expect(JSON.stringify(parsed)).not.toContain("perClass");
  });

  it("기준일 필드가 있으면 YYYY-MM-DD로 저장한다", () => {
    expect(parseGradeClassStudents(gradeClassRow({ BASE_DATE: "20260401" }), "02").baseDate).toBe("2026-04-01");
  });

  it("출처 주소에 인증키를 남기지 않는다", () => {
    const url = buildSourceUrl({ apiType: "09", schulKndCode: "02", sidoCode: "41" });
    expect(url).toContain("apiType=09");
    expect(url).not.toContain("apiKey");
  });

  it("키 순서가 달라도 같은 내용이면 같은 해시", () => {
    expect(hashPayload({ a: 1, b: 2 })).toBe(hashPayload({ b: 2, a: 1 }));
  });

  it("인증키가 없으면 호출하지 않고 not_configured 오류", async () => {
    const client = createSchoolinfoClient({ apiKey: undefined });
    await expect(client.fetch({ apiType: "0", schulKndCode: "02" })).rejects.toMatchObject({ kind: "not_configured" });
  });

  it("resultCode가 fail이면 api 오류", async () => {
    const fakeFetch = (async () => new Response(JSON.stringify({ resultCode: "fail", resultMsg: "인증키 오류" }), { status: 200 })) as typeof fetch;
    const client = createSchoolinfoClient({ apiKey: "k", fetchImpl: fakeFetch });
    const error = await client.fetch({ apiType: "0", schulKndCode: "02" }).catch((e) => e);
    expect(error).toBeInstanceOf(SchoolinfoError);
    expect(error.kind).toBe("api");
  });
});
