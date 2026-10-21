// 학교 소재지·경보 지역 매칭(순수 함수)
import { describe, expect, it } from "vitest";
import { matchRegion, normalizeArea, parseAddress, parseAreas } from "../server/src/alerts/region.js";
import { contentHash, sanitizeError } from "../server/src/alerts/collector.js";
import { planRegroup, REBROADCAST_SUFFIX } from "../server/src/alerts/grouping.js";

describe("학교 주소 → 시도·시군구", () => {
  it("광역시·도·시+구·세종을 해석한다", () => {
    expect(parseAddress("인천광역시 남동구 안전로 1")).toEqual({ sido: "인천광역시", sigungu: "남동구" });
    expect(parseAddress("경기도 수원시 장안구 정자로 1")).toEqual({ sido: "경기도", sigungu: "수원시 장안구" });
    expect(parseAddress("경기도 가평군 가평읍 1")).toEqual({ sido: "경기도", sigungu: "가평군" });
    expect(parseAddress("강원도 춘천시 1")).toEqual({ sido: "강원특별자치도", sigungu: "춘천시" });
    expect(parseAddress("세종특별자치시 한누리대로 1")).toEqual({ sido: "세종특별자치시", sigungu: null });
  });
  it("확실하지 않으면 추측하지 않는다(null)", () => {
    expect(parseAddress(null)).toBeNull();
    expect(parseAddress("가상시 안전로 1")).toBeNull();
    expect(parseAddress("인천광역시 안전로 1")).toBeNull();
  });
});

describe("경보 지역 정규화", () => {
  it("약칭·전체·여러 지역", () => {
    expect(normalizeArea("인천 전체")).toMatchObject({ sido: "인천광역시", sigungu: null });
    expect(parseAreas("인천광역시 남동구, 부산 해운대구").map((a) => [a.sido, a.sigungu])).toEqual([
      ["인천광역시", "남동구"],
      ["부산광역시", "해운대구"],
    ]);
    expect(normalizeArea("어딘가 일대").sido).toBeNull();
  });
});

describe("매칭: 대상 / 비대상 / 미판정", () => {
  const incheonNamdong = { sido: "인천광역시", sigungu: "남동구" };
  it("같은 시도 전체·같은 시군구·전국은 대상", () => {
    expect(matchRegion(incheonNamdong, parseAreas("인천광역시")).result).toBe("target");
    expect(matchRegion(incheonNamdong, parseAreas("인천광역시 남동구")).result).toBe("target");
    expect(matchRegion(incheonNamdong, parseAreas("전국")).result).toBe("target");
    expect(matchRegion({ sido: "경기도", sigungu: "수원시 장안구" }, parseAreas("경기도 수원시")).result).toBe("target");
  });
  it("다른 시도·다른 시군구는 비대상", () => {
    expect(matchRegion(incheonNamdong, parseAreas("부산광역시 해운대구")).result).toBe("non_target");
    expect(matchRegion(incheonNamdong, parseAreas("인천광역시 연수구")).result).toBe("non_target");
  });
  it("학교 소재지 불명·지역 해석 불가는 미판정", () => {
    expect(matchRegion(null, parseAreas("인천광역시")).result).toBe("undetermined");
    expect(matchRegion(incheonNamdong, parseAreas("어딘가 일대")).result).toBe("undetermined");
    expect(matchRegion(incheonNamdong, parseAreas("인천광역시 남동공단 일대")).result).toBe("undetermined");
    expect(matchRegion(incheonNamdong, []).result).toBe("undetermined");
    expect(matchRegion({ sido: "경기도", sigungu: null }, parseAreas("경기도 수원시")).result).toBe("undetermined");
  });
});

describe("중복 판단용 내용 해시·오류 메시지", () => {
  it("공백 차이는 같은 내용, 해제(cancel)는 다른 내용", () => {
    const base = { issuer: "기상청", body: "폭염 경보  발효", areas: parseAreas("인천광역시"), msgType: "new" as const };
    expect(contentHash(base)).toBe(contentHash({ ...base, body: "폭염 경보 발효" }));
    expect(contentHash(base)).not.toBe(contentHash({ ...base, msgType: "cancel" }));
  });
  it("인증키를 가린다", () => {
    expect(sanitizeError(new Error("GET https://x/api?serviceKey=ABC123&page=1 실패"))).toBe("GET https://x/api?serviceKey=***&page=1 실패");
  });
});

describe("재송출 묶음 계획(순수 함수)", () => {
  const t = (h: number) => new Date(Date.UTC(2026, 9, 21, h));
  const m = (id: string, hash: string, h: number, dup: string | null = null, provider = "mock") =>
    ({ id: `m-${id}`, alertId: id, provider, contentHash: hash, issuedAt: t(h), duplicateOfAlertId: dup, reason: "인천 대상" });
  it("풀려 있는 같은 내용 2건 → 늦게 발령된 쪽을 먼저 발령된 쪽에 묶음", () => {
    expect(planRegroup([m("b", "H", 2), m("a", "H", 1)])).toEqual([{ id: "m-b", alertId: "b", from: null, to: "a", reason: "인천 대상" + REBROADCAST_SUFFIX }]);
  });
  it("이미 올바르면 바꿀 것이 없음(반복 실행 안전)", () => {
    const ok = { ...m("b", "H", 2, "a"), reason: "인천 대상" + REBROADCAST_SUFFIX };
    expect(planRegroup([m("a", "H", 1), ok])).toEqual([]);
  });
  it("6시간을 넘기거나 공급자·내용이 다르면 묶지 않음, 잘못 묶인 것은 풂", () => {
    expect(planRegroup([m("a", "H", 1), m("c", "H", 8), m("d", "X", 2), m("e", "H", 2, null, "mois_cbs")])).toEqual([]);
    expect(planRegroup([m("a", "H", 1), { ...m("c", "H", 8, "a"), reason: "인천 대상" + REBROADCAST_SUFFIX }])).toEqual([
      { id: "m-c", alertId: "c", from: "a", to: null, reason: "인천 대상" },
    ]);
  });
  it("더 이른 경보가 나중에 대상이 되면 대표가 바뀜", () => {
    const plan = planRegroup([{ ...m("b", "H", 2) }, m("a", "H", 1)]);
    expect(plan.map((p) => [p.alertId, p.to])).toEqual([["b", "a"]]);
  });
});
