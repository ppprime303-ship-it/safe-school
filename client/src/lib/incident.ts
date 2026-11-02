// Beta PILOT 2 Phase 3 화면 계약(서버: server/src/services/incidents.ts, 규칙: shared/incident.ts)
//   GET  /api/schools/:schoolId/events/:eventId/incidents            → { event, incidents: IncidentItem[] }
//   GET  /api/schools/:schoolId/events/:eventId/incidents/similar?…  → { similar: (IncidentItem & { score })[] }
//   POST /api/schools/:schoolId/events/:eventId/incidents            (Idempotency-Key) → { id, replayed }
//   GET  /api/schools/:schoolId/incidents/:incidentId                → { incident: IncidentDetail }
//   POST /api/schools/:schoolId/incidents/:incidentId/updates        (Idempotency-Key) → { id }
//   POST /api/schools/:schoolId/incidents/:incidentId/status         → { id, status }        (incident.manage)
//   POST /api/schools/:schoolId/incidents/:incidentId/followup       (Idempotency-Key) → { id, status } (realreport.edit, 실제 재난)
//   POST /api/schools/:schoolId/incidents/:incidentId/photos         → { id }                (Phase 3-C)
//   GET  /api/schools/:schoolId/incidents/:incidentId/photos/:photoId → image               (incident.photo)
import type { IncidentStatus, IncidentType, IncidentUpdateKind } from "@shared/incident";
import type { PresencePlace } from "@shared/presence";

export interface IncidentEventRef {
  id: string;
  mode: "real" | "drill";
  status: "active" | "closed";
}

export interface IncidentItem {
  id: string;
  type: IncidentType;
  placeCategory: PresencePlace;
  placeLabel: string;
  description: string;
  status: IncidentStatus;
  createdAt: string;
  lastActivityAt: string;
  updateCount: number;
  photoCount: number;
  mine: boolean;
  /** incident.manage 응답에만 */
  reporterName?: string;
}

export interface IncidentDetail extends IncidentItem {
  event: IncidentEventRef;
  updates: { id: string; kind: IncidentUpdateKind; note: string; createdAt: string; mine: boolean; authorName?: string }[];
  statusHistory: { from: IncidentStatus; to: IncidentStatus; createdAt: string; changedByName?: string }[];
  /** incident.photo 응답에만 */
  photos?: { id: string; mimeType: string; sizeBytes: number; createdAt: string }[];
}

export const STATUS_TONE: Record<IncidentStatus, string> = {
  received: "bg-danger text-white",
  checking: "bg-warning-strong text-white",
  in_progress: "bg-accent text-white",
  resolved: "bg-success text-white",
};
