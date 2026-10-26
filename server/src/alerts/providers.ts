// 공식 경보 공급자 인터페이스
// - 실제 공급자(행정안전부 긴급재난문자 등)는 활용 신청 후 요청 주소·응답 필드·호출 제한을 확인한 다음에만 추가합니다.
//   현재 이 저장소에는 실제 공급자 어댑터가 없습니다(docs/step3-plan.md 6절 '확인 필요').
// - 모의 공급자는 is_mock = true 로 저장되어 화면에 '모의 경보'로 표시되고, 운영 환경에서는 쓸 수 없습니다.
import fs from "node:fs";
import type { AlertKind, AlertMsgType, AlertProvider, AlertSeverity } from "@prisma/client";
import { parseAreas, type Area } from "./region.js";
import { mockAlertsAllowed, type DeploymentRole } from "../deploy/environment.js";

export interface NormalizedAlert {
  externalId: string;
  kind: AlertKind;
  severity: AlertSeverity;
  msgType: AlertMsgType;
  refExternalId: string | null;
  issuer: string;
  title: string | null;
  body: string;
  areasRaw: string;
  areas: Area[];
  issuedAt: Date;
  expiresAt: Date | null;
  raw: unknown;
}

export interface FetchResult {
  alerts: NormalizedAlert[];
  nextCursor: string | null;
}

export interface AlertSource {
  provider: AlertProvider;
  isMock: boolean;
  fetch(cursor: string | null): Promise<FetchResult>;
}

/** 모의 경보 입력 형식(시나리오·피드 파일 공통) */
export interface MockAlertInput {
  id: string;
  kind: AlertKind;
  severity: AlertSeverity;
  msgType?: AlertMsgType;
  refId?: string;
  issuer: string;
  title?: string;
  body: string;
  areas: string; // 예: "인천광역시 남동구, 인천광역시 연수구"
  issuedAt: string; // ISO
  expiresAt?: string;
}

export function normalizeMock(input: MockAlertInput): NormalizedAlert {
  return {
    externalId: input.id,
    kind: input.kind,
    severity: input.severity,
    msgType: input.msgType ?? "new",
    refExternalId: input.refId ?? null,
    issuer: input.issuer,
    title: input.title ?? null,
    body: input.body,
    areasRaw: input.areas,
    areas: parseAreas(input.areas),
    issuedAt: new Date(input.issuedAt),
    expiresAt: input.expiresAt ? new Date(input.expiresAt) : null,
    raw: input,
  };
}

export class MockAlertSource implements AlertSource {
  readonly provider = "mock" as const;
  readonly isMock = true;
  constructor(private readonly load: () => MockAlertInput[] | Promise<MockAlertInput[]>) {}
  async fetch(): Promise<FetchResult> {
    const list = await this.load();
    return { alerts: list.map(normalizeMock), nextCursor: null };
  }
}

/** 개발·시연용: JSON 파일(모의 경보 배열)을 주기적으로 읽는 모의 공급자 */
export const mockFileSource = (path: string) =>
  new MockAlertSource(() => {
    const text = fs.readFileSync(path, "utf8");
    const data = JSON.parse(text) as unknown;
    if (!Array.isArray(data)) throw new Error("모의 경보 파일은 배열이어야 합니다.");
    return data as MockAlertInput[];
  });

/** STEP 7: 모의 경보는 개발·심사(judge) 환경만. 역할을 모르면(이전 호출) 운영 모드에서 거부 */
export function assertMockAllowed(nodeEnv: string, role?: DeploymentRole) {
  const allowed = role ? mockAlertsAllowed(role) : nodeEnv !== "production";
  if (!allowed) throw new Error("이 운영 환경에서는 모의 경보 공급자를 사용할 수 없습니다(심사 환경 전용).");
}
