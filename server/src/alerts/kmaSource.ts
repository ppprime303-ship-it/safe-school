// 기상특보를 공통 경보 수집 구조로 넣는 공급자. 학교 재난 발령·학부모 발송을 하지 않습니다(collector 원칙 그대로).
// - 발표 1건(구역·종류·강도·발표 시각·번호·발표 코드)이 경보 1건입니다. 재수신은 같은 ID로 걸러집니다.
// - 인천 구역만 저장합니다. 원 항목은 raw 에 그대로 보존합니다.
import type { AlertSeverity } from "@prisma/client";
import { KMA_WARNING_CONTRACT, SUPPORTED_ZONE_CODES, WARN_STRESS, WARN_VAR, zonesForRegion, type KmaWarningClient, type KmaWarningRow } from "../integrations/kmaWarnings.js";
import type { AlertSource, FetchResult, NormalizedAlert } from "./providers.js";
import type { MatchResult, Region } from "./region.js";

export const KMA_ISSUER = "기상청";
const COMMAND_LABEL: Record<string, string> = { "1": "발표", "2": "해제", "3": "연장", "6": "정정", "7": "변경 발표", "8": "변경 해제" };

/** 같은 구역·종류·강도의 특보 묶음 */
export const seriesKeyOf = (externalId: string) => externalId.split(":").slice(0, 3).join(":");
const seriesOf = (r: KmaWarningRow) => `${r.areaCode}:${r.warnVar}:${r.warnStress ?? "-"}`;
const stamp = (d: Date) => new Date(d.getTime() + 9 * 3600_000).toISOString().slice(0, 16).replace("T", " ");
const compact = (d: Date) => new Date(d.getTime() + 9 * 3600_000).toISOString().slice(0, 16).replace(/\D/g, "");
const externalIdOf = (r: KmaWarningRow) => `${seriesOf(r)}:${compact(r.tmFc)}:${r.tmSeq}:${r.command ?? "-"}:${r.cancelled ? 1 : 0}`;

function severityOf(stress: string | null): AlertSeverity {
  if (stress === "2") return "emergency";
  if (stress === "1") return "warning";
  if (stress === "0") return "advisory";
  return "info";
}

/** 학교 소재지와 특보구역 판정(지역 이름이 아니라 공식 구역 코드 기준) */
export function matchKmaZone(areaCode: string, region: Region | null): MatchResult {
  const zones = zonesForRegion(region);
  if (!zones) return { result: "non_target", reason: "이 학교 지역은 특보구역과 연결되어 있지 않음" };
  if (zones.target.has(areaCode)) return { result: "target", reason: "학교 소재지가 특보구역에 포함됨" };
  if (zones.undetermined.has(areaCode)) return { result: "undetermined", reason: "학교 주소만으로 이 특보구역 포함 여부를 단정할 수 없음 — 관리자 확인 필요" };
  return { result: "non_target", reason: "학교 소재지가 특보구역에 포함되지 않음" };
}

export function toKmaAlerts(rows: KmaWarningRow[]): NormalizedAlert[] {
  const previous = new Map<string, string>();
  const sorted = rows.filter((r) => SUPPORTED_ZONE_CODES.has(r.areaCode)).sort((a, b) => a.tmFc.getTime() - b.tmFc.getTime() || a.tmSeq - b.tmSeq);
  return sorted.map((r) => {
    const series = seriesOf(r);
    const externalId = externalIdOf(r);
    const prev = previous.get(series);
    previous.set(series, externalId);
    const name = `${WARN_VAR[r.warnVar] ?? `종류 코드 ${r.warnVar.slice(0, 4)}`}${r.warnStress ? (WARN_STRESS[r.warnStress] ?? "") : ""}`;
    const released = r.cancelled || r.command === "2" || r.command === "8";
    const label = r.cancelled ? "취소" : (COMMAND_LABEL[r.command ?? ""] ?? "상태 확인 필요");
    const msgType = released ? ("cancel" as const) : r.command === "1" || (r.command === "7" && !prev) ? ("new" as const) : ("update" as const);
    const times = [`발표 ${stamp(r.tmFc)}`, r.startTime && `발효 ${stamp(r.startTime)}`, r.endTime && `해제 ${stamp(r.endTime)}`].filter(Boolean).join(", ");
    return {
      externalId,
      kind: "weather" as const,
      severity: severityOf(r.warnStress),
      msgType,
      refExternalId: msgType === "new" ? null : (prev ?? series),
      issuer: KMA_ISSUER,
      title: `${name} ${label}`,
      body: `${r.areaName} ${name} ${label} (${times})`,
      areasRaw: r.areaName,
      areas: [{ sido: null, sigungu: null, raw: r.areaName }],
      issuedAt: r.tmFc,
      expiresAt: null,
      raw: r.raw ?? {},
      matchRegion: (region: Region | null) => matchKmaZone(r.areaCode, region),
    };
  });
}

export class KmaWarningSource implements AlertSource {
  readonly provider = "kma_warning" as const;
  readonly isMock = false;
  readonly source = KMA_WARNING_CONTRACT.source;
  constructor(private readonly client: KmaWarningClient) {}

  async fetch(): Promise<FetchResult> {
    const snap = await this.client.latest();
    if (snap.error) throw snap.error;
    return { alerts: toKmaAlerts(snap.rows), nextCursor: null };
  }
}
