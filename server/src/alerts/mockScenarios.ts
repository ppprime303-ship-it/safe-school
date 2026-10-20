// 시연·테스트용 모의 경보 시나리오(가상 데이터). 실제 기관 발송 내용이 아닙니다.
import type { MockAlertInput } from "./providers.js";

const at = (minutesAgo: number) => new Date(Date.now() - minutesAgo * 60_000).toISOString();

export const MOCK_SCENARIOS: Record<string, () => MockAlertInput[]> = {
  // 10/30 시연: 인천 지역 가상 폭염경보 + 다른 지역 경보(비대상) + 같은 내용 재송출 + 해제
  "incheon-heatwave": () => [
    {
      id: "MOCK-HEAT-001",
      kind: "weather",
      severity: "warning",
      issuer: "기상청(모의)",
      title: "[모의] 폭염경보",
      body: "[모의 경보] 오늘 11시 인천광역시 전역 폭염경보 발효. 야외활동 자제, 물 자주 마시기 등 건강에 유의하세요.",
      areas: "인천광역시",
      issuedAt: at(30),
    },
    {
      id: "MOCK-HEAT-002",
      kind: "weather",
      severity: "warning",
      issuer: "기상청(모의)",
      title: "[모의] 폭염경보",
      body: "[모의 경보] 오늘 11시 인천광역시 전역 폭염경보 발효. 야외활동 자제, 물 자주 마시기 등 건강에 유의하세요.",
      areas: "인천광역시",
      issuedAt: at(20), // 같은 내용 재송출
    },
    {
      id: "MOCK-RAIN-001",
      kind: "disaster_text",
      severity: "advisory",
      issuer: "부산광역시(모의)",
      body: "[모의 경보] 부산 해안가 너울 주의. 해안 접근을 자제하세요.",
      areas: "부산광역시 해운대구",
      issuedAt: at(15),
    },
  ],
  "incheon-heatwave-cancel": () => [
    {
      id: "MOCK-HEAT-003",
      kind: "weather",
      severity: "info",
      msgType: "cancel",
      refId: "MOCK-HEAT-001",
      issuer: "기상청(모의)",
      title: "[모의] 폭염경보 해제",
      body: "[모의 경보] 인천광역시 폭염경보 해제.",
      areas: "인천광역시",
      issuedAt: at(0),
    },
  ],
  "unclear-area": () => [
    {
      id: "MOCK-UNCLEAR-001",
      kind: "disaster_text",
      severity: "advisory",
      issuer: "가상기관(모의)",
      body: "[모의 경보] 지역 표기를 해석할 수 없는 경보 예시.",
      areas: "어딘가 일대",
      issuedAt: at(5),
    },
  ],
};
