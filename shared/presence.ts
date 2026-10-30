// Beta PILOT 2 Phase 2 교직원 소재 보고 규칙(화면·서버 공통)
// - 소재는 실제 재난(mode=real)에서만 받습니다. 모의훈련은 안내 알림만(서버·DB가 소재 저장을 거부).
// - 교내: 장소 분류 필수 + 상세 위치(선택, '기타'는 필수, 40자 이하). 표시 문자열 '분류 / 상세'는 50자 이내.
// - 교외: 위치를 받지 않음(GPS·주소 수집 안 함).
// - 상세 위치에는 학생 이름·건강 정보를 적지 않도록 안내하고, 주민등록번호·휴대전화번호 형태는 거부합니다.
import { z } from "zod";
import { findPersonalInfo } from "./personalInfo.js";

export const PRESENCE_PLACES = ["classroom", "staff_room", "nurse_room", "cafeteria", "gym", "playground", "hallway", "stairs", "special_room", "other"] as const;
export type PresencePlace = (typeof PRESENCE_PLACES)[number];

export const PLACE_LABEL: Record<PresencePlace, string> = {
  classroom: "교실",
  staff_room: "교무실",
  nurse_room: "보건실",
  cafeteria: "급식실",
  gym: "체육관",
  playground: "운동장",
  hallway: "복도",
  stairs: "계단",
  special_room: "특별실",
  other: "기타",
};

export const PLACE_DETAIL_MAX = 40;
export const PLACE_LABEL_MAX = 50;

export const LOCATION_LABEL = { on_campus: "교내", off_campus: "교외" } as const;
export const AVAILABILITY_LABEL = { available: "대피 지원 가능", unavailable: "지원 불가", unsure: "확인 필요" } as const;

export const PRESENCE_PRIVACY_HINT = "장소만 짧게 적으세요(예: 3학년 2반, 과학실). 학생 이름·건강 상태 등 개인정보는 적지 마세요.";
export const STAFF_ALERT_NOTICE = "웹앱을 열지 않은 교직원은 알림을 확인하지 못할 수 있습니다. 긴급 상황에서는 학교 비상연락망을 함께 활용해 주세요.";
export const DRILL_ALERT_TEXT = "재난 모의훈련이 시작되었습니다";

/** 저장·표시용 교내 위치 문자열: '교실 / 3학년 2반', 상세가 없으면 '교무실' */
export function placeLabel(category: PresencePlace | null | undefined, detail: string | null | undefined): string | null {
  if (!category) return null;
  const d = detail?.trim();
  return d ? `${PLACE_LABEL[category]} / ${d}` : PLACE_LABEL[category];
}

const detailSchema = z
  .string()
  .transform((s) => s.normalize("NFC").trim().replace(/\s+/g, " "))
  .pipe(z.string().max(PLACE_DETAIL_MAX, `상세 위치는 ${PLACE_DETAIL_MAX}자 이내로 적으세요.`))
  .refine((v) => findPersonalInfo(v).length === 0, "상세 위치에 주민등록번호·전화번호를 적을 수 없습니다.")
  .transform((v) => (v === "" ? null : v));

/** 본인 소재 보고 요청(대상자는 세션의 소속으로만 결정 — 사용자·소속 id를 받지 않음) */
export const presenceInputSchema = z
  .object({
    location: z.enum(["on_campus", "off_campus"], { message: "교내·교외를 고르세요." }),
    placeCategory: z.enum(PRESENCE_PLACES).nullable().optional(),
    placeDetail: detailSchema.nullable().optional(),
    availability: z.enum(["available", "unavailable", "unsure"], { message: "대피 지원 가능 여부를 고르세요." }),
    expectedVersion: z.number().int().min(1).nullable(),
  })
  .strict()
  .superRefine((v, ctx) => {
    if (v.location === "on_campus") {
      if (!v.placeCategory) ctx.addIssue({ code: "custom", path: ["placeCategory"], message: "교내 장소를 고르세요." });
      if (v.placeCategory === "other" && !v.placeDetail) ctx.addIssue({ code: "custom", path: ["placeDetail"], message: "'기타'를 골랐다면 상세 위치를 적으세요." });
    } else if (v.placeCategory || v.placeDetail) {
      ctx.addIssue({ code: "custom", path: ["placeCategory"], message: "교외는 위치를 적지 않습니다." });
    }
  })
  .transform((v) => ({
    location: v.location,
    placeCategory: v.location === "on_campus" ? (v.placeCategory ?? null) : null,
    placeDetail: v.location === "on_campus" ? (v.placeDetail ?? null) : null,
    availability: v.availability,
    expectedVersion: v.expectedVersion,
  }));
export type PresenceInput = z.infer<typeof presenceInputSchema>;
