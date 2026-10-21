// STEP 3-C 재난안전 안내문 예시 라이브러리(코드 데이터)
// - 원본은 이 파일에만 있고 화면·DB에서 바꿀 수 없습니다. 교사가 불러와 고친 글만 school_notices에 저장됩니다.
// - 참고용 예시입니다. 실제 발송 전 학교 상황과 공식 대응 지침을 확인해야 합니다.
// - 자동 채우기 빈칸: {{학교명}} {{재난유형}} {{경보제목}} {{발령시각}} {{지역}} — 확인된 값만 채웁니다.
// - 확인할 수 없는 내용(학교 조치, 문의처 등)은 [ … 입력하세요] 형태의 입력 안내로 남깁니다.
// - 예시를 고치거나 추가하면 해당 항목의 version을 올립니다(저장된 안내문에는 불러온 key·version이 남음).

export const NOTICE_DISASTER_TYPES = {
  heatwave: "폭염",
  storm_flood: "호우·태풍",
  fine_dust: "미세먼지",
  earthquake: "지진",
  cold_wave: "한파",
  fire_gas: "화재·가스",
  other: "기타 재난",
} as const;
export type NoticeDisasterType = keyof typeof NOTICE_DISASTER_TYPES;

export const NOTICE_AUDIENCES = { parent: "학부모", staff: "교직원" } as const;
export type NoticeAudience = keyof typeof NOTICE_AUDIENCES;

export const NOTICE_SITUATIONS = { issued: "발령 안내", cancelled: "해제·상황 종료 안내" } as const;
export type NoticeSituation = keyof typeof NOTICE_SITUATIONS;

export interface NoticeExample {
  key: string; // `${disasterType}.${audience}.${situation}`
  version: number;
  disasterType: NoticeDisasterType;
  audience: NoticeAudience;
  situation: NoticeSituation;
  label: string;
  title: string;
  body: string;
}

export const NOTICE_PLACEHOLDERS = ["학교명", "재난유형", "경보제목", "발령시각", "지역"] as const;
export type NoticePlaceholder = (typeof NOTICE_PLACEHOLDERS)[number];
export type NoticeFillValues = Partial<Record<NoticePlaceholder, string | null>>;

/** 확인할 수 없는 값의 입력 안내 */
export const PLACEHOLDER_GUIDE: Record<NoticePlaceholder, string> = {
  학교명: "[학교명을 입력하세요]",
  재난유형: "[재난 유형을 입력하세요]",
  경보제목: "[경보 내용을 입력하세요]",
  발령시각: "[발령 시각을 확인해 입력하세요]",
  지역: "[지역을 확인해 입력하세요]",
};

export const NOTICE_GUIDE_TEXT = {
  feature: "이 기능은 안내문 작성과 복사를 지원합니다. 공식 결재 및 실제 발송은 학교의 기존 절차와 채널을 이용해 주세요.",
  example: "예시 문구는 참고용입니다. 실제 발송 전 학교 상황과 공식 대응 지침을 확인하세요.",
  record: "처리 이력은 교직원이 직접 기록하는 값입니다. 실제 발송 성공·수신 확인이나 공식 결재 완료를 뜻하지 않습니다.",
  reuse: "취소된 안내문의 내용을 새 초안으로 복사합니다. 원본과 취소 기록은 그대로 남습니다.",
  reusePast: "원본에 적힌 발령 시각·지역·학교 조치는 과거 정보일 수 있습니다. 현재 상황에 맞게 확인하고 고쳐 주세요.",
} as const;

const ex = (
  disasterType: NoticeDisasterType,
  audience: NoticeAudience,
  situation: NoticeSituation,
  label: string,
  title: string,
  body: string,
): NoticeExample => ({ key: `${disasterType}.${audience}.${situation}`, version: 1, disasterType, audience, situation, label, title, body });

export const NOTICE_EXAMPLES: readonly NoticeExample[] = [
  // ───────── 폭염 ─────────
  ex("heatwave", "parent", "issued", "학부모 · 폭염 발령",
    "[{{학교명}}] 폭염 관련 학생 안전 안내",
    `안녕하십니까, {{학교명}}입니다.
{{발령시각}} {{지역}}에 '{{경보제목}}'이(가) 발표되었습니다.

학생들의 건강을 위해 다음 사항을 가정에서도 함께 지도해 주시기 바랍니다.
- 물을 자주 마시고, 한낮(오후 2~5시) 야외 활동을 피하기
- 모자·양산 사용, 가볍고 밝은 옷 입기
- 어지럼증·두통·메스꺼움이 있으면 즉시 시원한 곳에서 쉬고 보호자·교사에게 알리기

학교 조치: [학교 조치 사항(체육·야외 활동 조정, 등하교 시간 변경 등)을 입력하세요]
문의: [문의처를 입력하세요]`),
  ex("heatwave", "staff", "issued", "교직원 · 폭염 발령",
    "[교직원 공지] 폭염 대응 협조 요청",
    `{{발령시각}} {{지역}}에 '{{경보제목}}'이(가) 발표되었습니다.

교직원께서는 다음 사항에 협조해 주시기 바랍니다.
- 야외 수업·체육 활동 조정 여부 확인
- 교실 냉방·환기 상태와 학생 음수 확인
- 온열질환 의심 학생 발생 시 보건실 연계 및 보호자 연락

학교 조치: [학교 조치 사항을 입력하세요]
담당: [담당 부서·담당자를 입력하세요]`),
  ex("heatwave", "parent", "cancelled", "해제 · 폭염 상황 종료",
    "[{{학교명}}] 폭염 특보 해제 및 학사 운영 안내",
    `안녕하십니까, {{학교명}}입니다.
{{지역}}에 발표되었던 '{{경보제목}}'이(가) 해제되었음을 알려 드립니다.

학교는 [정상 운영 재개 일시 및 변경 사항을 입력하세요]
해제 이후에도 더운 날씨가 이어질 수 있으니 충분한 수분 섭취를 지도해 주시기 바랍니다.

문의: [문의처를 입력하세요]`),

  // ───────── 호우·태풍 ─────────
  ex("storm_flood", "parent", "issued", "학부모 · 호우·태풍 발령",
    "[{{학교명}}] 호우·태풍 관련 등하교 안전 안내",
    `안녕하십니까, {{학교명}}입니다.
{{발령시각}} {{지역}}에 '{{경보제목}}'이(가) 발표되었습니다.

등하교 시 다음 사항에 유의하도록 지도해 주시기 바랍니다.
- 하천변·지하차도·저지대·공사장 주변 통행 피하기
- 강풍 시 간판·나무 등 낙하물 주의, 우산보다 우비 사용
- 침수된 도로는 걸어서 건너지 않기

학교 조치: [등교 시간 조정·원격수업·조기 하교 등 학교 결정 사항을 입력하세요]
문의: [문의처를 입력하세요]`),
  ex("storm_flood", "staff", "issued", "교직원 · 호우·태풍 발령",
    "[교직원 공지] 호우·태풍 대비 시설·학생 안전 점검",
    `{{발령시각}} {{지역}}에 '{{경보제목}}'이(가) 발표되었습니다.

- 교실·복도 창문 잠금, 옥외 시설물·낙하 위험물 점검
- 배수구·지하 공간 침수 위험 확인
- 하교 시 학생 귀가 경로 안전 지도, 보호자 인계 필요 학생 파악

학교 조치: [학교 조치 사항을 입력하세요]
담당: [담당 부서·담당자를 입력하세요]`),
  ex("storm_flood", "parent", "cancelled", "해제 · 호우·태풍 상황 종료",
    "[{{학교명}}] 호우·태풍 특보 해제 안내",
    `안녕하십니까, {{학교명}}입니다.
{{지역}}에 발표되었던 '{{경보제목}}'이(가) 해제되었습니다.

학교 시설 점검 결과: [점검 결과와 학사 운영 계획을 입력하세요]
특보 해제 뒤에도 하천 수위가 높거나 길이 미끄러울 수 있으니 등하교 시 주의하도록 지도해 주십시오.

문의: [문의처를 입력하세요]`),

  // ───────── 미세먼지 ─────────
  ex("fine_dust", "parent", "issued", "학부모 · 미세먼지 발령",
    "[{{학교명}}] 미세먼지 대응 안내",
    `안녕하십니까, {{학교명}}입니다.
{{발령시각}} {{지역}}에 '{{경보제목}}'이(가) 발표되었습니다.

- 등하교 시 보건용 마스크 착용
- 외출 후 손발 씻기, 물 자주 마시기
- 호흡기·심혈관 질환이 있는 학생은 증상 변화를 살펴 주시고, 필요하면 담임교사에게 알려 주십시오

학교 조치: [실외 활동 조정 등 학교 조치 사항을 입력하세요]
문의: [문의처를 입력하세요]`),
  ex("fine_dust", "staff", "issued", "교직원 · 미세먼지 발령",
    "[교직원 공지] 미세먼지 대응 협조 요청",
    `{{발령시각}} {{지역}}에 '{{경보제목}}'이(가) 발표되었습니다.

- 실외 수업·체육 활동 실내 전환 또는 단축 검토
- 교실 창문 관리, 공기청정기 가동 상태 확인
- 민감군 학생(천식 등) 상태 확인 및 보건실 연계

학교 조치: [학교 조치 사항을 입력하세요]
담당: [담당 부서·담당자를 입력하세요]`),
  ex("fine_dust", "parent", "cancelled", "해제 · 미세먼지 상황 종료",
    "[{{학교명}}] 미세먼지 특보 해제 안내",
    `안녕하십니까, {{학교명}}입니다.
{{지역}}에 발표되었던 '{{경보제목}}'이(가) 해제되었습니다.

학교 교육활동은 [실외 활동 재개 등 운영 계획을 입력하세요]
대기 상태는 수시로 바뀔 수 있으니 가정에서도 대기질 정보를 함께 확인해 주시기 바랍니다.

문의: [문의처를 입력하세요]`),

  // ───────── 지진 ─────────
  ex("earthquake", "parent", "issued", "학부모 · 지진 발생",
    "[{{학교명}}] 지진 발생에 따른 학생 안전 안내",
    `안녕하십니까, {{학교명}}입니다.
{{발령시각}} {{지역}} 관련 '{{경보제목}}'이(가) 발표되었습니다.

현재 학생 상황: [학생 대피·안전 확인 결과를 입력하세요]
학교 조치: [수업 지속·귀가 조치·보호자 인계 방법 등 학교 결정 사항을 입력하세요]

여진이 있을 수 있으니 학교로 바로 오시기보다 학교 안내를 먼저 확인해 주시기 바랍니다.
문의: [문의처를 입력하세요]`),
  ex("earthquake", "staff", "issued", "교직원 · 지진 발생",
    "[교직원 공지] 지진 발생 대응",
    `{{발령시각}} {{지역}} 관련 '{{경보제목}}'이(가) 발표되었습니다.

- 흔들림이 멈춘 뒤 학교 대피 계획에 따라 학생 대피·인원 확인
- 학급별 인원 확인 결과 보고(SAFE SCHOOL 학급 보고 활용)
- 건물 균열·가스·전기 이상 여부 확인 전 재입실 금지

학교 조치: [학교 조치 사항을 입력하세요]
담당: [담당 부서·담당자를 입력하세요]`),
  ex("earthquake", "parent", "cancelled", "안전 확인 · 지진 상황 종료",
    "[{{학교명}}] 지진 관련 학생 안전 확인 및 학사 운영 안내",
    `안녕하십니까, {{학교명}}입니다.
{{지역}} 관련 '{{경보제목}}'에 따른 대응 상황을 알려 드립니다.

학생 안전 확인 결과: [확인 결과를 입력하세요]
건물·시설 점검 결과: [점검 결과를 입력하세요]
향후 학사 운영: [운영 계획을 입력하세요]

문의: [문의처를 입력하세요]`),

  // ───────── 한파 ─────────
  ex("cold_wave", "parent", "issued", "학부모 · 한파 발령",
    "[{{학교명}}] 한파 관련 학생 건강 안내",
    `안녕하십니까, {{학교명}}입니다.
{{발령시각}} {{지역}}에 '{{경보제목}}'이(가) 발표되었습니다.

- 모자·장갑·목도리 등 보온 용품 챙기기
- 빙판길 미끄럼 주의, 주머니에 손 넣고 걷지 않기
- 동상·저체온 증상(피부 감각 저하, 심한 떨림)이 있으면 바로 따뜻한 곳으로 이동하기

학교 조치: [등교 시간 조정 등 학교 조치 사항을 입력하세요]
문의: [문의처를 입력하세요]`),
  ex("cold_wave", "staff", "issued", "교직원 · 한파 발령",
    "[교직원 공지] 한파 대비 시설·학생 안전 점검",
    `{{발령시각}} {{지역}}에 '{{경보제목}}'이(가) 발표되었습니다.

- 수도관 동파, 난방 설비 작동 상태 점검
- 출입구·계단 결빙 구간 확인 및 미끄럼 방지 조치
- 실외 활동 조정, 등하교 시 학생 보온 상태 확인

학교 조치: [학교 조치 사항을 입력하세요]
담당: [담당 부서·담당자를 입력하세요]`),
  ex("cold_wave", "parent", "cancelled", "해제 · 한파 상황 종료",
    "[{{학교명}}] 한파 특보 해제 안내",
    `안녕하십니까, {{학교명}}입니다.
{{지역}}에 발표되었던 '{{경보제목}}'이(가) 해제되었습니다.

학교 운영: [정상 운영 여부 및 변경 사항을 입력하세요]
아침·저녁 기온이 여전히 낮을 수 있으니 등하교 시 보온에 신경 써 주시기 바랍니다.

문의: [문의처를 입력하세요]`),

  // ───────── 화재·가스 ─────────
  ex("fire_gas", "parent", "issued", "학부모 · 화재·가스 사고",
    "[{{학교명}}] 화재·가스 사고 관련 학생 안전 안내",
    `안녕하십니까, {{학교명}}입니다.
{{발령시각}} {{지역}} 관련 '{{경보제목}}'이(가) 발표되었습니다.

현재 학생 상황: [학생 대피·안전 확인 결과를 입력하세요]
학교 조치: [수업 운영·귀가 조치·보호자 인계 방법 등을 입력하세요]

현장 주변 출입이 통제될 수 있으니 학교 안내에 따라 이동해 주시기 바랍니다.
문의: [문의처를 입력하세요]`),
  ex("fire_gas", "staff", "issued", "교직원 · 화재·가스 사고",
    "[교직원 공지] 화재·가스 사고 대응",
    `{{발령시각}} {{지역}} 관련 '{{경보제목}}'이(가) 발표되었습니다.

- 학교 주변 영향 여부 확인(연기·냄새·통제 구역)
- 필요 시 창문 닫기·실내 대기 또는 대피 계획 시행
- 학급별 인원 확인 및 보고, 이상 증상 학생 보건실 연계

학교 조치: [학교 조치 사항을 입력하세요]
담당: [담당 부서·담당자를 입력하세요]`),
  ex("fire_gas", "parent", "cancelled", "안전 확인 · 화재·가스 상황 종료",
    "[{{학교명}}] 화재·가스 사고 상황 종료 및 안전 확인 안내",
    `안녕하십니까, {{학교명}}입니다.
{{지역}} 관련 '{{경보제목}}' 상황이 종료되었음을 알려 드립니다.

학생 안전 확인 결과: [확인 결과를 입력하세요]
학교 시설 점검 결과: [점검 결과를 입력하세요]
향후 학사 운영: [운영 계획을 입력하세요]

문의: [문의처를 입력하세요]`),

  // ───────── 기타 재난 ─────────
  ex("other", "parent", "issued", "학부모 · 재난 발생",
    "[{{학교명}}] 재난 상황 관련 학생 안전 안내",
    `안녕하십니까, {{학교명}}입니다.
{{발령시각}} {{지역}}에 '{{경보제목}}'이(가) 발표되었습니다.

학생 안전 수칙: [재난 유형에 맞는 안전 수칙을 입력하세요]
학교 조치: [학교 조치 사항을 입력하세요]

정확한 정보는 관계 기관의 공식 발표를 함께 확인해 주시기 바랍니다.
문의: [문의처를 입력하세요]`),
  ex("other", "staff", "issued", "교직원 · 재난 발생",
    "[교직원 공지] 재난 상황 대응 협조 요청",
    `{{발령시각}} {{지역}}에 '{{경보제목}}'이(가) 발표되었습니다.

- 학교 영향 여부 확인 및 학생 안전 확인
- 학교 재난 대응 계획에 따른 역할 수행
- 확인된 사항은 담당 부서에 보고

학교 조치: [학교 조치 사항을 입력하세요]
담당: [담당 부서·담당자를 입력하세요]`),
  ex("other", "parent", "cancelled", "해제 · 재난 상황 종료",
    "[{{학교명}}] 재난 상황 종료 안내",
    `안녕하십니까, {{학교명}}입니다.
{{지역}}에 발표되었던 '{{경보제목}}' 상황이 종료되었습니다.

학교 운영: [운영 재개 및 변경 사항을 입력하세요]

문의: [문의처를 입력하세요]`),
];

export function getNoticeExample(key: string): NoticeExample | undefined {
  return NOTICE_EXAMPLES.find((e) => e.key === key);
}

/** 빈칸 채우기: 확인된 값만 넣고, 없으면 입력 안내를 남깁니다. 예시 원본은 바꾸지 않고 새 문자열을 돌려줍니다. */
export function fillNoticeTemplate(text: string, values: NoticeFillValues): string {
  return text.replace(/\{\{(학교명|재난유형|경보제목|발령시각|지역)\}\}/g, (_m, name: NoticePlaceholder) => {
    const v = values[name]?.trim();
    return v ? v : PLACEHOLDER_GUIDE[name];
  });
}

/** 아직 채우지 않은 입력 안내([ … 입력하세요])가 남아 있는지 */
export function findUnfilledGuides(text: string): string[] {
  return [...new Set(text.match(/\[[^\[\]\n]{1,60}?입력하세요\]/g) ?? [])];
}

const TYPE_KEYWORDS: [NoticeDisasterType, RegExp][] = [
  ["earthquake", /지진|여진|해일/],
  ["fire_gas", /화재|산불|가스|폭발|유해화학|연기/],
  ["fine_dust", /미세먼지|초미세|황사|오존/],
  ["heatwave", /폭염|무더위|온열/],
  ["cold_wave", /한파|한랭|동파/],
  ["storm_flood", /호우|태풍|강풍|홍수|침수|폭우|풍랑|산사태/],
];

/** 경보 제목·본문 낱말로 예시 유형 추천(교사가 다른 유형을 고를 수 있음) */
export function recommendNoticeType(alert: { title?: string | null; body?: string | null }): NoticeDisasterType {
  const text = `${alert.title ?? ""} ${alert.body ?? ""}`;
  return TYPE_KEYWORDS.find(([, re]) => re.test(text))?.[0] ?? "other";
}

/** 해제 경보이거나 경보가 해제되었으면 '해제 안내'를 먼저 추천 */
export function recommendNoticeSituation(alert: { msgType?: string | null; cancelled?: boolean }): NoticeSituation {
  return alert.msgType === "cancel" || alert.cancelled ? "cancelled" : "issued";
}

/** 발령 시각 표시(한국 시간, 안내문용) */
export function formatNoticeTime(iso: string | Date): string {
  const d = new Date((typeof iso === "string" ? new Date(iso) : iso).getTime() + 9 * 60 * 60 * 1000); // 한국 시간(UTC+9, 일광절약 없음)
  const mm = String(d.getUTCMinutes()).padStart(2, "0");
  return `${d.getUTCFullYear()}년 ${d.getUTCMonth() + 1}월 ${d.getUTCDate()}일 ${d.getUTCHours()}시 ${mm}분`;
}

/** 경보와 학교 정보에서 확인 가능한 값만 모읍니다. */
export function noticeFillValuesFrom(params: {
  schoolName?: string | null;
  alert?: { title?: string | null; body?: string | null; areasRaw?: string | null; issuedAt?: string | Date | null } | null;
  disasterType?: NoticeDisasterType | null;
}): NoticeFillValues {
  const a = params.alert;
  const firstLine = a?.body?.split(/\r?\n/).find((l) => l.trim())?.trim();
  const title = a?.title?.trim() || (firstLine ? (firstLine.length > 40 ? `${firstLine.slice(0, 40)}…` : firstLine) : null);
  return {
    학교명: params.schoolName ?? null,
    재난유형: params.disasterType ? NOTICE_DISASTER_TYPES[params.disasterType] : null,
    경보제목: title,
    발령시각: a?.issuedAt ? formatNoticeTime(a.issuedAt) : null,
    지역: a?.areasRaw?.trim() ? a.areasRaw.trim().slice(0, 100) : null,
  };
}
