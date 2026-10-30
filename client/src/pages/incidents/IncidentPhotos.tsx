// Beta PILOT 2 Phase 3-C: 현장 사진(선택)
// - 첨부: 승인 교직원, 진행 중 사건, 제보당 3장. 올리기 전에 화면에서 다시 그려(JPEG, 최대 1600px) 위치정보(EXIF)를 지우고,
//   서버도 형식 검사·메타데이터 제거를 한 번 더 함(이중 방어)
// - 열람: 서버가 사진 목록을 준 사람(incident.photo — 대응 담당자)만. 공개 주소 없이 로그인 세션으로 받아 화면 안에서만 표시
// - 삭제: incident.manage
import { useEffect, useState } from "react";
import { INCIDENT_PHOTO_HINT } from "@shared/incident";
import { api, describeError } from "../../lib/api";
import { formatDateTime } from "../../lib/format";
import type { IncidentDetail } from "../../lib/incident";
import { can } from "../../lib/permissions";
import { useSession } from "../../lib/session";
import { PrimaryButton } from "../../components/ui/PrimaryButton";

const MAX_PHOTOS = 3;
const MAX_SIDE = 1600;

/** 화면에서 다시 그리기: EXIF·위치정보가 사라지고 크기도 줄어듦. 결과는 base64(JPEG) */
async function reencode(file: File): Promise<string> {
  const bmp = await createImageBitmap(file, { imageOrientation: "from-image" } as ImageBitmapOptions);
  const scale = Math.min(1, MAX_SIDE / Math.max(bmp.width, bmp.height));
  const canvas = document.createElement("canvas");
  canvas.width = Math.round(bmp.width * scale);
  canvas.height = Math.round(bmp.height * scale);
  canvas.getContext("2d")!.drawImage(bmp, 0, 0, canvas.width, canvas.height);
  bmp.close();
  const blob = await new Promise<Blob | null>((r) => canvas.toBlob(r, "image/jpeg", 0.85));
  if (!blob) throw new Error("사진을 처리하지 못했습니다.");
  const url = await new Promise<string>((resolve, reject) => {
    const fr = new FileReader();
    fr.onload = () => resolve(String(fr.result));
    fr.onerror = () => reject(fr.error);
    fr.readAsDataURL(blob);
  });
  return url.slice(url.indexOf(",") + 1);
}

function PhotoView({ schoolId, incidentId, photoId }: { schoolId: string; incidentId: string; photoId: string }) {
  const [src, setSrc] = useState<string | null>(null);
  const [failed, setFailed] = useState(false);
  useEffect(() => {
    let url: string | null = null;
    fetch(`/api/schools/${schoolId}/incidents/${incidentId}/photos/${photoId}`, { credentials: "same-origin", headers: { "X-Requested-With": "safe-school" } })
      .then(async (r) => {
        if (!r.ok) throw new Error(String(r.status));
        url = URL.createObjectURL(await r.blob());
        setSrc(url);
      })
      .catch(() => setFailed(true));
    return () => {
      if (url) URL.revokeObjectURL(url);
    };
  }, [schoolId, incidentId, photoId]);
  if (failed) return <p className="text-sm text-danger">사진을 불러오지 못했습니다.</p>;
  if (!src) return <div className="h-32 w-full animate-pulse rounded-control bg-page" />;
  return <img src={src} alt="현장 사진" className="max-h-80 w-full rounded-control object-contain" />;
}

export function IncidentPhotos({ schoolId, incident, onChanged }: { schoolId: string; incident: IncidentDetail; onChanged: () => void }) {
  const { usableMemberships } = useSession();
  const canManage = can(usableMemberships.find((m) => m.school.id === schoolId) ?? null, "incident.manage");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const active = incident.event.status === "active";
  const canAdd = active && incident.photoCount < MAX_PHOTOS;

  const upload = async (file: File | undefined) => {
    if (!file) return;
    setBusy(true);
    setError(null);
    try {
      const data = await reencode(file);
      await api("POST", `/schools/${schoolId}/incidents/${incident.id}/photos`, { data });
      onChanged();
    } catch (e) {
      setError(e instanceof Error && !("status" in e) ? "사진을 처리하지 못했습니다. 다른 사진으로 시도하세요." : describeError(e).message);
    } finally {
      setBusy(false);
    }
  };
  const remove = async (photoId: string) => {
    setBusy(true);
    try {
      await api("DELETE", `/schools/${schoolId}/incidents/${incident.id}/photos/${photoId}`);
      onChanged();
    } catch (e) {
      setError(describeError(e).message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <section aria-labelledby="photos" className="rounded-card border border-line bg-card p-4 shadow-card">
      <h2 id="photos" className="text-lg font-bold">
        현장 사진(선택) · {incident.photoCount}/{MAX_PHOTOS}장
      </h2>
      {incident.photos ? (
        incident.photos.length > 0 && (
          <ul className="mt-2 grid gap-3 sm:grid-cols-2">
            {incident.photos.map((p) => (
              <li key={p.id} className="rounded-control border border-line p-2">
                <PhotoView schoolId={schoolId} incidentId={incident.id} photoId={p.id} />
                <div className="mt-1 flex items-center justify-between text-sm text-ink-muted">
                  <span>{formatDateTime(p.createdAt)}</span>
                  {canManage && (
                    <button type="button" disabled={busy} onClick={() => void remove(p.id)} className="font-bold text-danger underline">
                      사진 삭제
                    </button>
                  )}
                </div>
              </li>
            ))}
          </ul>
        )
      ) : (
        incident.photoCount > 0 && <p className="mt-1 text-sm text-ink-muted">사진은 대응 담당자(학교 관리자·교장·교감·안전업무 담당)만 볼 수 있습니다.</p>
      )}
      {canAdd && (
        <div className="mt-3">
          <label className={`inline-flex min-h-touch cursor-pointer items-center rounded-control border-2 border-line-strong px-4 text-base font-bold ${busy ? "opacity-50" : ""}`}>
            사진 첨부
            <input type="file" accept="image/jpeg,image/png,image/heic,image/webp" className="sr-only" disabled={busy} onChange={(e) => void upload(e.target.files?.[0])} />
          </label>
          <p className="mt-1 text-sm text-ink-muted">{INCIDENT_PHOTO_HINT}</p>
        </div>
      )}
      {!active && <p className="mt-1 text-sm text-ink-muted">종료된 상황이라 사진을 더 올릴 수 없습니다.</p>}
      {error && <p className="mt-2 font-semibold text-danger">{error}</p>}
      {busy && <PrimaryButton className="mt-2" variant="ghost" loading disabled>처리 중…</PrimaryButton>}
    </section>
  );
}
