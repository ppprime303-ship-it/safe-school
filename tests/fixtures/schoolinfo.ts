// 테스트용 가상 학교알리미 응답(실제 학교 아님). 필드 이름은 학교알리미 응답 형식을 따릅니다.
import type { SchoolinfoClient, SchoolinfoQuery, SchoolinfoRow } from "../../server/src/integrations/schoolinfo.js";
import { buildSourceUrl, SchoolinfoError } from "../../server/src/integrations/schoolinfo.js";

export const BASIC_ROWS: SchoolinfoRow[] = [
  {
    SCHUL_CODE: "S000000001",
    SCHUL_NM: "안전초등학교",
    SCHUL_KND_SC_CODE: "02",
    ATPT_OFCDC_ORG_NM: "가상교육청",
    ATPT_OFCDC_ORG_CODE: "X10",
    SCHUL_RDNMA: "가상시 안전로 1",
    ABSCH_YN: "N",
  },
  {
    SCHUL_CODE: "S000000002",
    SCHUL_NM: "안전중앙초등학교",
    SCHUL_KND_SC_CODE: "02",
    ATPT_OFCDC_ORG_NM: "가상교육청",
    SCHUL_RDNMA: "가상시 중앙로 2",
    ABSCH_YN: "N",
  },
  { SCHUL_CODE: "S000000003", SCHUL_NM: "옛안전초등학교", SCHUL_KND_SC_CODE: "02", ABSCH_YN: "Y" },
  { SCHUL_NM: "코드없는학교" }, // 형식 오류 행: 건너뛰어야 함
];

export function gradeClassRow(overrides: Record<string, string> = {}): SchoolinfoRow {
  return {
    SCHUL_CODE: "S000000001",
    COL_C1: "3", COL_S1: "75",
    COL_C2: "3", COL_S2: "78",
    COL_C3: "2", COL_S3: "55",
    COL_C4: "0", COL_S4: "0",
    COL_C_SUM: "8", COL_S_SUM: "208",
    ...overrides,
  };
}

export class FakeSchoolinfoClient implements SchoolinfoClient {
  failing = false;
  calls: SchoolinfoQuery[] = [];
  gradeRow: SchoolinfoRow = gradeClassRow();

  async fetch(query: SchoolinfoQuery) {
    this.calls.push(query);
    if (this.failing) throw new SchoolinfoError("학교알리미에 연결할 수 없습니다: 테스트 장애", "network");
    const rows = query.apiType === "0" ? BASIC_ROWS : query.apiType === "09" ? [this.gradeRow] : [];
    return { rows, sourceUrl: buildSourceUrl(query) };
  }
}
