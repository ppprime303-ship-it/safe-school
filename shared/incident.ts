// Beta PILOT 2 Phase 3 현장 상황 공유 규칙(화면·서버 공통)
// - 실제 재난·모의훈련 모두 제보 가능(훈련은 '훈련 상황 제보'로 표시). 교직원 소재(Phase 2)와는 별개 — 제보에 '내 위치'를 받지 않음
// - 입력은 최소: 유형 + 장소(분류·상세) + 설명(2~300자). 주민등록번호·전화번호 형태는 거부, 이름·건강 정보는 안내로 억제
// - 유사 제보는 규칙 기반 점수(같은 장소·유형, 설명 글자쌍 겹침, 최근)로 '제안'만 — 새 제보를 막지 않음
import { z } from "zod";
import { findPersonalInfo } from "./personalInfo.js";
import { PLACE_DETAIL_MAX, PRESENCE_PLACES, placeLabel, type PresencePlace } from "./presence.js";

export const INCIDENT_TYPES = ["hazard", "facility_damage", "blocked_route", "help_needed", "other"] as const;
export type IncidentType = (typeof INCIDENT_TYPES)[number];
export const INCIDENT_TYPE_LABEL: Record<IncidentType, string> = {
  hazard: "위험 발견",
  facility_damage: "시설 피해",
  blocked_route: "이동 장애",
  help_needed: "도움 필요",
  other: "기타",
};

export const INCIDENT_STATUSES = ["received", "checking", "in_progress", "resolved"] as const;
export type IncidentStatus = (typeof INCIDENT_STATUSES)[number];
export const INCIDENT_STATUS_LABEL: Record<IncidentStatus, string> = { received: "접수", checking: "확인 중", in_progress: "조치 중", resolved: "조치 완료" };

export const INCIDENT_UPDATE_KINDS = ["info", "change", "action"] as const;
export type IncidentUpdateKind = (typeof INCIDENT_UPDATE_KINDS)[number];
export const INCIDENT_UPDATE_LABEL: Record<IncidentUpdateKind, string> = { info: "추가 확인", change: "상황 변화", action: "조치" };

export const INCIDENT_TEXT_MAX = 300;
export const INCIDENT_PRIVACY_HINT = "보이는 상황만 짧게 적으세요. 학생 이름·전화번호·건강 상태 등 개인정보는 적지 마세요. 급한 구조 요청은 먼저 전화·무전으로 하세요.";
export const INCIDENT_PHOTO_HINT = "사진은 선택입니다. 사람 얼굴·이름표·화면 속 개인정보가 찍히지 않게 현장만 찍어 주세요. 위치정보(EXIF)는 저장하지 않습니다.";

const cleanText = (max: number, min = 2) =>
  z
    .string({ required_error: "내용을 적으세요.", invalid_type_error: "내용을 적으세요." })
    .transform((s) => s.normalize("NFC").trim().replace(/[ \t]+/g, " "))
    .pipe(z.string().min(min, `${min}자 이상 적으세요.`).max(max, `${max}자 이내로 적으세요.`))
    .refine((v) => findPersonalInfo(v).length === 0, "주민등록번호·전화번호는 적을 수 없습니다.");

export const incidentCreateSchema = z
  .object({
    type: z.enum(INCIDENT_TYPES, { message: "제보 유형을 고르세요." }),
    placeCategory: z.enum(PRESENCE_PLACES, { message: "장소를 고르세요." }),
    placeDetail: cleanText(PLACE_DETAIL_MAX, 1).nullable().optional(),
    description: cleanText(INCIDENT_TEXT_MAX),
  })
  .strict()
  .superRefine((v, ctx) => {
    if (v.placeCategory === "other" && !v.placeDetail) ctx.addIssue({ code: "custom", path: ["placeDetail"], message: "'기타'를 골랐다면 상세 위치를 적으세요." });
  })
  .transform((v) => ({ ...v, placeDetail: v.placeDetail ?? null }));
export type IncidentCreateInput = z.infer<typeof incidentCreateSchema>;

export const incidentUpdateSchema = z.object({ kind: z.enum(INCIDENT_UPDATE_KINDS, { message: "종류를 고르세요." }), note: cleanText(INCIDENT_TEXT_MAX) }).strict();
export const incidentStatusSchema = z.object({ status: z.enum(INCIDENT_STATUSES), expectedStatus: z.enum(INCIDENT_STATUSES) }).strict();

export const incidentPlaceLabel = (category: PresencePlace, detail: string | null) => placeLabel(category, detail)!;

// ───────────── 유사 제보(규칙 기반) ─────────────
const bigrams = (s: string) => {
  const t = s.normalize("NFC").toLowerCase().replace(/[\s\p{P}\p{S}]+/gu, "");
  const out = new Set<string>();
  for (let i = 0; i < t.length - 1; i++) out.add(t.slice(i, i + 2));
  if (t.length === 1) out.add(t);
  return out;
};
/** 두 글의 글자쌍 겹침(0~1, Jaccard). 한국어도 형태소 분석 없이 동작 */
export function textOverlap(a: string, b: string): number {
  const A = bigrams(a);
  const B = bigrams(b);
  if (A.size === 0 || B.size === 0) return 0;
  let inter = 0;
  for (const x of A) if (B.has(x)) inter++;
  return inter / (A.size + B.size - inter);
}

export interface SimilarityInput {
  type: IncidentType;
  placeCategory: PresencePlace;
  placeDetail: string | null;
  description: string;
}
export interface SimilarityCandidate extends SimilarityInput {
  createdAt: Date;
  lastActivityAt: Date;
  status: IncidentStatus;
}

/**
 * 점수: 같은 장소 분류 +3, 같은 유형 +2, 상세 위치 겹침 ≥0.5 +2(≥0.2 +1), 설명 겹침 ≥0.4 +3(≥0.2 +2, ≥0.1 +1),
 * 최근 30분 안 활동 +1, 조치 완료 −1. 4점 이상을 '유사'로 제안(같은 장소+같은 유형이면 기본 5점).
 */
export const SIMILAR_THRESHOLD = 4;
export function similarityScore(draft: SimilarityInput, c: SimilarityCandidate, now: Date = new Date()): number {
  let s = 0;
  if (draft.placeCategory === c.placeCategory) s += 3;
  if (draft.type === c.type) s += 2;
  if (draft.placeDetail && c.placeDetail) {
    const d = textOverlap(draft.placeDetail, c.placeDetail);
    s += d >= 0.5 ? 2 : d >= 0.2 ? 1 : 0;
  }
  const t = textOverlap(draft.description, c.description);
  s += t >= 0.4 ? 3 : t >= 0.2 ? 2 : t >= 0.1 ? 1 : 0;
  if (now.getTime() - c.lastActivityAt.getTime() <= 30 * 60_000) s += 1;
  if (c.status === "resolved") s -= 1;
  return s;
}

export const similarQuerySchema = z.object({
  type: z.enum(INCIDENT_TYPES),
  placeCategory: z.enum(PRESENCE_PLACES),
  placeDetail: z.string().max(PLACE_DETAIL_MAX).optional(),
  description: z.string().max(INCIDENT_TEXT_MAX).optional(),
});
