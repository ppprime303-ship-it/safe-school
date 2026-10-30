// Beta PILOT 2 Phase 2 화면 계약(서버: server/src/services/presence.ts, 규칙: shared/presence.ts)
//   GET  /api/schools/:schoolId/staff-alerts                          → { alerts: StaffAlertItem[], unreadCount }
//   POST /api/schools/:schoolId/staff-alerts/:alertId/read            → { id, readAt }
//   GET  /api/schools/:schoolId/events/:eventId/presence/me           → { eventStatus, presence }        (실제 재난만)
//   PUT  /api/schools/:schoolId/events/:eventId/presence/me           (Idempotency-Key) → { presence, replayed }
//   GET  /api/schools/:schoolId/events/:eventId/presence/summary      → PresenceSummaryResponse        (누구나, 숫자만)
//   GET  /api/schools/:schoolId/events/:eventId/presence              → PresenceDetailResponse         (presence.detail)
import type { DisasterTypeKey } from "@shared/constants";
import type { PresencePlace } from "@shared/presence";

export interface StaffAlertItem {
  id: string;
  createdAt: string;
  readAt: string | null;
  event: { id: string; mode: "real" | "drill"; status: "active" | "closed"; types: DisasterTypeKey[]; startedAt: string; closedAt: string | null };
  presenceRequested: boolean;
}

export interface MyPresence {
  id: string;
  location: "on_campus" | "off_campus";
  placeCategory: PresencePlace | null;
  placeDetail: string | null;
  placeLabel: string | null;
  availability: "available" | "unavailable" | "unsure";
  version: number;
  firstRespondedAt: string;
  respondedAt: string;
}

export interface PresenceSummary {
  targetCount: number;
  respondedCount: number;
  notRespondedCount: number;
  onCampus: number;
  offCampus: number;
  available: number;
  unavailable: number;
  unsure: number;
  alertsRead: number;
  latestRespondedAt: string | null;
}

export interface PresenceSummaryResponse {
  eventId: string;
  eventStatus: "active" | "closed";
  scope: "summary";
  summary: PresenceSummary;
}

export interface PresenceDetailResponse {
  eventId: string;
  eventStatus: "active" | "closed";
  scope: "detail";
  summary: PresenceSummary;
  byPlace: { placeCategory: PresencePlace; count: number }[];
  notResponded: { membershipId: string; name: string; alertReadAt: string | null }[];
  people: { membershipId: string; name: string; role: string; alertReadAt: string | null; presence: MyPresence | null }[];
  excludedResponses: number;
}

/** 배너에 띄울 알림: 진행 중 사건 중 아직 확인 안 한 것(실제 재난 우선), 없으면 진행 중 실제 재난(소재 미보고 안내용) */
export function pickBannerAlert(alerts: StaffAlertItem[]): StaffAlertItem | null {
  const active = alerts.filter((a) => a.event.status === "active");
  return active.find((a) => a.event.mode === "real" && !a.readAt) ?? active.find((a) => !a.readAt) ?? active.find((a) => a.event.mode === "real") ?? null;
}
