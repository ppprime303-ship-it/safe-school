// Beta PILOT 2 Phase 3: 현장 사진(Phase 3-C에서 첨부·열람을 연결합니다)
import type { IncidentDetail } from "../../lib/incident";

export function IncidentPhotos({ incident }: { schoolId: string; incident: IncidentDetail; onChanged: () => void }) {
  if (incident.photoCount === 0) return null;
  return <p className="text-sm text-ink-muted">사진 {incident.photoCount}장 첨부됨</p>;
}
