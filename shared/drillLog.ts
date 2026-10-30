// STEP 3-D 비상대피훈련일지 — 데이터 구조·기본값·배치 규칙(화면 미리보기와 서버 HWPX가 함께 사용)
// 승인 서식(2026-10-22): 붙임형 — 본문 A4 1쪽(학교 원본 형식) + 붙임 '학급별 대피 현황'(학급 수에 따라 쪽 늘림), 평가 결과는 O 또는 X 글자만
// 원형: tools/hwpx/drill_log_layout.py(시제품). 열 비율·행 높이·병합 구조를 같게 유지합니다.
//
// 자동작성 데이터 정책
// 1. 미보고 학급은 0명이 아니라 '미보고'  2. 재적과 대피 확인을 다른 칸에  3. 학급당 최신 보고 1건만(중복 집계 없음)
// 4. 보고 시각 ≠ 대피 완료 시각(대피 소요 시간 자동 계산 안 함 — 일시의 '총 시간'은 발령~종료 기록, 초 단위)
// 5. 총 참가 인원은 담당자 직접 입력값, 또는 교직원·학생 참가 인원(담당자 입력)이 모두 있을 때만 그 합. 미확인 값은 0으로 채우지 않음
// 6. 기록되지 않은 조치를 쓰지 않음  7. 모의훈련/실제 구분 표시
// 8. 원본 대피 보고는 이 문서에서 바꾸지 않음  9. 자동작성 당시 기록(스냅숏)과 이후 바뀐 기록을 구분해 알림

export const DRILL_FORM_KEY = "evacuation_drill";
export const DRILL_FORM_VERSION = 1;
/** Beta PILOT 2 Phase 4: 실제 재난 '재난대피 상황보고서'(같은 배치, 사건 mode 로 서식 결정) */
export const REAL_FORM_KEY = "disaster_real";
export const formKeyFor = (mode: "drill" | "real") => (mode === "real" ? REAL_FORM_KEY : DRILL_FORM_KEY);

/** Phase 4: 현장 제보·조치(제보자 이름 없음, 자유 기재는 개인정보를 가린 요약) */
export interface DrillIncidentSnap {
  no: number;
  typeLabel: string;
  placeLabel: string;
  createdAt: string;
  statusLabel: string;
  updateCount: number;
  actionCount: number;
  summary: string; // 가린 설명(최대 60자)
  lastAction: string | null; // 가린 최근 조치 기록(최대 40자)
}

/** Phase 4: 실제 재난 교직원 소재 익명 집계(Phase 2 summarizePresence 형식 — 이름·위치·명단 없음) */
export interface DrillPresenceSnap {
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

export interface DrillClassSnap {
  classId: string;
  label: string;
  grade: number;
  classNo: number;
  enrolled: number | null; // 보고된 재적(보고 시 담임 확인값) 또는 학급 재적(관리자 확인값), 모르면 null
  enrolledSource: "report" | "class" | "none";
  report: null | {
    evacuated: number;
    absentKnown: number;
    unconfirmed: number;
    injured: number;
    note: string | null;
    version: number;
    reportedAt: string; // 첫 보고 시각(대피 완료 시각 아님)
    lastChangedAt: string; // 마지막 수정 시각
  };
}

export interface DrillSnapshot {
  takenAt: string;
  schoolName: string;
  event: {
    id: string;
    type: string;
    typeLabel: string;
    extraTypeLabels: string[];
    mode: "drill" | "real";
    startedAt: string;
    closedAt: string | null;
    evacPlace: string | null;
    location: string | null;
    issuedByName: string | null;
    closedByName: string | null;
  };
  classes: DrillClassSnap[];
  /** Phase 4(새 스냅숏만): 현장 제보·조치. 없으면 이전 서식 그대로(붙임 1개) */
  incidents?: DrillIncidentSnap[];
  /** Phase 4: 실제 재난만 — 교직원 소재 익명 집계. 모의훈련은 항상 없음 */
  presence?: DrillPresenceSnap | null;
  /** Phase 4: 자유 기재에서 가린 개인정보 건수(전화번호·주민등록번호 형태, 교직원 이름) */
  maskedCount?: number;
}

export type OX = "" | "O" | "X";
export interface DrillManual {
  staffCount: string; // 교직원 참가 인원(숫자 문자열, 비우면 미입력)
  studentCount: string; // 실제 참가 학생 수(담당자 확인값, 비우면 미입력) — 시스템 '대피 확인' 합계와 다른 값. 이전 저장본에는 없음(빈칸으로 읽음)
  totalCount: string; // 총 참가 인원 직접 입력(비우면 교직원+학생 참가가 모두 있을 때 자동 합)
  roles: { part: string; who: string }[]; // who: 교직원 명단에서 고른 이름을 ', '로 잇거나 직접 입력(외부 인력) — 자유 문자열
  trainingNote: string; // 훈련 내용 보충 설명
  evacPlaceText: string; // 비우면 자동 문장(기록된 대피 장소) 사용
  durationText: string; // 실제 대피 소요 시간(측정값)
  evals: { item: string; result: OX; note: string }[];
  improvements: string; // 추후 대피훈련 시 반영사항
}

export const DEFAULT_ROLES = [
  { part: "안전교육 및 학생 대피", who: "각 반 담임교사" },
  { part: "신고", who: "" },
  { part: "안내 방송", who: "" },
  { part: "부상 학생 응급처치", who: "" },
  { part: "실내 잔류 확인", who: "" },
  { part: "소요시간 측정, 최종인원 점검", who: "" },
];
export const DEFAULT_EVALS = ["대피의 신속성", "대피경로의 효율성", "대피장소의 안전성", "교사 역할의 조직적 수행 정도", "비상벨 또는 사이렌 소리의 적절성", "학생의 반응"];

export function defaultManual(): DrillManual {
  return {
    staffCount: "",
    studentCount: "",
    totalCount: "",
    roles: DEFAULT_ROLES.map((r) => ({ ...r })),
    trainingNote: "",
    evacPlaceText: "",
    durationText: "",
    evals: DEFAULT_EVALS.map((item) => ({ item, result: "", note: "" })),
    improvements: "",
  };
}

// ───────────── 계산(자동 반영 값) ─────────────
export function summarizeClasses(classes: DrillClassSnap[]) {
  const reported = classes.filter((c) => c.report);
  const unreported = classes.filter((c) => !c.report);
  const sum = (k: "evacuated" | "absentKnown" | "unconfirmed" | "injured") => reported.reduce((n, c) => n + (c.report?.[k] ?? 0), 0);
  return {
    total: classes.length,
    reportedCount: reported.length,
    unreported: unreported.map((c) => c.label),
    evacuated: sum("evacuated"),
    absentKnown: sum("absentKnown"),
    unconfirmed: sum("unconfirmed"),
    injured: sum("injured"),
    enrolledReported: reported.reduce((n, c) => n + (c.enrolled ?? 0), 0),
    enrolledReportedComplete: reported.every((c) => c.enrolled !== null),
  };
}

const toCount = (v: string | undefined): number | null => (v && /^\d+$/.test(v.trim()) ? Number(v.trim()) : null);

/** 참가 인원: 교직원·학생 참가는 담당자 입력, 학생 대피 확인은 시스템(보고 학급만), 총 참가는 확인된 값만으로 */
export function participantCounts(snap: DrillSnapshot, manual: DrillManual) {
  const sum = summarizeClasses(snap.classes);
  const staff = toCount(manual.staffCount);
  const student = toCount(manual.studentCount);
  const totalManual = toCount(manual.totalCount);
  const totalAuto = staff !== null && student !== null ? staff + student : null;
  const missing = [staff === null ? "교직원" : "", student === null ? "학생 참가" : ""].filter(Boolean); // '…인원'을 붙여 씀
  return {
    staff,
    student,
    evacuated: sum.reportedCount > 0 ? sum.evacuated : null, // 보고가 하나도 없으면 0이 아니라 '보고 없음'
    evacComplete: sum.reportedCount > 0 && sum.unreported.length === 0,
    reportedCount: sum.reportedCount,
    classCount: sum.total,
    unreported: sum.unreported,
    unconfirmed: sum.unconfirmed,
    totalAuto,
    total: totalManual ?? totalAuto,
    totalSource: (totalManual !== null ? "manual" : totalAuto !== null ? "auto" : "none") as "manual" | "auto" | "none",
    missing,
  };
}

const listLabels = (labels: string[], max = 5) => (labels.length > max ? `${labels.slice(0, max).join(", ")} 외 ${labels.length - max}개` : labels.join(", "));

const WD = "일월화수목금토";
function kst(iso: string) {
  const d = new Date(new Date(iso).getTime() + 9 * 3600 * 1000);
  return { y: d.getUTCFullYear(), m: d.getUTCMonth() + 1, d: d.getUTCDate(), w: WD[d.getUTCDay()], h: d.getUTCHours(), mi: d.getUTCMinutes(), s: d.getUTCSeconds() };
}
const p2 = (n: number) => String(n).padStart(2, "0");
const hhmm = (t: { h: number; mi: number }) => `${p2(t.h)}:${p2(t.mi)}`;
const hhmmss = (t: { h: number; mi: number; s: number }) => `${p2(t.h)}:${p2(t.mi)}:${p2(t.s)}`;

/** 발령~종료 경과(초). 표시하는 시각과 맞도록 두 시각을 각각 초 단위로 버린 뒤 뺍니다(1초 미만 버림, 반올림·올림 없음). */
export function elapsedSeconds(startIso: string, endIso: string): number {
  return Math.max(0, Math.floor(new Date(endIso).getTime() / 1000) - Math.floor(new Date(startIso).getTime() / 1000));
}
export function durationLabel(sec: number): string {
  const h = Math.floor(sec / 3600), m = Math.floor((sec % 3600) / 60), s = sec % 60;
  return h > 0 ? `${h}시간 ${m}분 ${s}초` : m > 0 ? `${m}분 ${s}초` : `${s}초`;
}
export const TIME_BASIS_NOTE = "일시의 총 시간은 훈련 발령~종료 기록을 초 단위로 계산한 값(1초 미만 버림, 반올림 없음)으로, 대피 소요 시간이나 보고 저장 시각과 다릅니다.";
const TIME_BASIS_SHORT = "총 시간: 발령~종료 기록을 초 단위로 계산(1초 미만 버림·반올림 없음), 대피 소요 시간 아님.";

export function whenText(ev: DrillSnapshot["event"]): string {
  const a = kst(ev.startedAt);
  let s = `${a.y}. ${a.m}. ${a.d}.(${a.w}) ${hhmmss(a)}`;
  if (ev.closedAt) s += ` ~ ${hhmmss(kst(ev.closedAt))} (총 ${durationLabel(elapsedSeconds(ev.startedAt, ev.closedAt))})`;
  else s += " ~ (종료 전)";
  return s;
}
const dateText = (iso: string) => {
  const a = kst(iso);
  return `${a.y}. ${a.m}. ${a.d}.(${a.w})`;
};

/** '운동장' → '운동장으로', '학교 앞 놀이터' → '…놀이터로'(받침 없음·ㄹ 받침은 '로') */
export function particleRo(word: string): string {
  const w = word.trim();
  const ch = w.slice(-1);
  if (ch >= "가" && ch <= "힣") {
    const jong = (ch.charCodeAt(0) - 0xac00) % 28;
    return w + (jong === 0 || jong === 8 ? "로" : "으로");
  }
  return w + "(으)로";
}

export function autoEvacSentence(ev: DrillSnapshot["event"]): string {
  return ev.evacPlace?.trim() ? `학생들이 각 반 대피로를 따라 ${particleRo(ev.evacPlace)} 대피` : "";
}

export function docTitle(s: DrillSnapshot): string {
  const types = [s.event.typeLabel, ...s.event.extraTypeLabels].join("·");
  // Phase 4: 실제 재난은 같은 배치의 '재난대피 상황보고서'. 모의훈련은 승인 서식 제목 그대로
  return s.event.mode === "real" ? `재난대피 상황보고서(${types})` : `비상대피훈련일지(${types})`;
}

// ───────────── Phase 4 개인정보 가림·검사 ─────────────
const RRN_RE = /(?<!\d)\d{2}(0[1-9]|1[0-2])(0[1-9]|[12]\d|3[01])\s?-?\s?[1-8]\d{6}(?!\d)/g;
const MOBILE_RE = /(?<!\d)01[016789][\s.-]?\d{3,4}[\s.-]?\d{4}(?!\d)/g;
const PHONE_RE = /(?<!\d)0\d{1,2}[\s.-]\d{3,4}[\s.-]\d{4}(?!\d)/g;
export const MASK = "○○○";

/** 자유 기재 가리기: 주민등록번호·전화번호 형태와 학교 교직원 이름(2자 이상). 가린 개수도 돌려줌 */
export function maskPersonal(text: string, staffNames: readonly string[]): { text: string; masked: number } {
  let masked = 0;
  let out = text;
  for (const re of [RRN_RE, MOBILE_RE, PHONE_RE]) out = out.replace(re, () => (masked++, MASK));
  const names = [...new Set(staffNames.map((n) => n.trim()).filter((n) => n.length >= 2))].sort((a, b) => b.length - a.length);
  for (const n of names) {
    const parts = out.split(n);
    if (parts.length > 1) {
      masked += parts.length - 1;
      out = parts.join(MASK);
    }
  }
  return { text: out, masked };
}

/**
 * 출력 문서 개인정보 검사(완료·내려받기 전 서버, 화면 미리보기 공통): 문서 모든 칸·제목·주석에서
 * - 주민등록번호·전화번호 형태(모든 서식)
 * - 교직원 이름: 실제 재난 상황보고서만(checkNames). 모의훈련 일지는 승인 서식상 '역할담당 담당자'에 이름을 적으므로 검사하지 않음
 */
export function scanDocPrivacy(doc: DrillDoc, staffNames: readonly string[], opts: { checkNames: boolean }): string[] {
  const issues: string[] = [];
  const names = staffNames.map((n) => n.trim()).filter((n) => n.length >= 2);
  const texts = doc.pages.flatMap((p, pi) => [p.title, p.subtitle, p.footnote ?? "", ...p.table.cells.map((c) => c.text)].map((t) => ({ pi, t })));
  for (const { pi, t } of texts) {
    if (new RegExp(RRN_RE.source).test(t)) issues.push(`쪽 ${pi + 1}: 주민등록번호 형태`);
    if (new RegExp(MOBILE_RE.source).test(t) || new RegExp(PHONE_RE.source).test(t)) issues.push(`쪽 ${pi + 1}: 전화번호 형태`);
    if (opts.checkNames) for (const n of names) if (t.includes(n)) issues.push(`쪽 ${pi + 1}: 교직원 이름`);
  }
  return [...new Set(issues)];
}

// ───────────── 배치(레이아웃) ─────────────
export interface LCell {
  r: number;
  c: number;
  rs: number;
  cs: number;
  text: string;
  kind: "label" | "head" | "band" | "value";
  align: "L" | "C" | "R";
  valign: "T" | "C";
  bold: boolean;
}
export interface LTable {
  colPct: number[];
  rowsMm: number[];
  cells: LCell[];
  headerRows?: number; // 쪽이 넘어갈 때 반복할 머리글 행 수(붙임 표)
}
export interface LPage {
  title: string;
  titleKind: "main" | "appendix";
  subtitle: string;
  table: LTable;
  footnote?: string; // 여러 줄이면 '\n'으로 구분(HWPX에서는 줄마다 문단)
}
export interface DrillDoc {
  pages: LPage[];
}

export const PAGE = { w: 210, h: 297, margin: { left: 15, right: 15, top: 12, bottom: 12 } };
export const TABLE_W = PAGE.w - PAGE.margin.left - PAGE.margin.right - 1; // 179mm — 바깥 테두리 두께 때문에 본문 폭(180mm)보다 1mm 좁게
export const USABLE_H = PAGE.h - PAGE.margin.top - PAGE.margin.bottom; // 273mm
export const MAIN_COLS = [17.0, 15.0, 12.67, 13.0, 14.67, 13.0, 14.66];
export const APPX_COLS = [15.0, 10.0, 14.0, 13.0, 11.0, 9.0, 28.0];
export const ROW_H = 7.4;
export const APPX_ROWS_PER_PAGE = 30; // 머리글 1행 + 학급 30행(+마지막 쪽 합계 1행) ≈ 237mm — 한글에서 글꼴 차이로 행이 조금 늘어도 쪽 안에 들어가게 여유
export const PHOTO_MIN = 24; // 본문이 길어지면 사진 칸을 이 높이까지 줄임
export const IMPROVE_MIN = 22;
/** 제목·부제 높이(mm) */
export const PAGE_HEAD_H = { main: 21, appendix: 14 } as const;
/** 주석 높이 추정(9pt 한글 ≈ 3.2mm 폭 → 한 줄 약 56자, 줄 간격 130% ≈ 4.2mm) + 표와의 간격 1.5mm */
export function footnoteHeight(text?: string): number {
  if (!text) return 0;
  const width = (line: string) => [...line].reduce((w, ch) => w + (ch.charCodeAt(0) < 0x2000 ? 0.55 : 1), 0); // 영문·숫자·공백은 약 반 폭
  return 1.5 + text.split("\n").reduce((n, line) => n + Math.max(1, Math.ceil(width(line) / 56)), 0) * 4.2;
}

class TB {
  rowsMm: number[] = [];
  cells: LCell[] = [];
  row(h: number) {
    this.rowsMm.push(h);
    return this.rowsMm.length - 1;
  }
  put(r: number, c: number, text: string, o: Partial<Omit<LCell, "r" | "c" | "text">> = {}) {
    this.cells.push({ r, c, text, rs: o.rs ?? 1, cs: o.cs ?? 1, kind: o.kind ?? "value", align: o.align ?? "C", valign: o.valign ?? "C", bold: o.bold ?? false });
  }
}

const clean = (t: string, max = 2000) =>
  (t ?? "")
    .replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F￾￿]/g, "")
    .replace(/\r\n?/g, "\n")
    .slice(0, max);

export function buildDrillDoc(snap: DrillSnapshot, manual: DrillManual): DrillDoc {
  const ev = snap.event;
  const mode = ev.mode === "drill" ? "모의훈련" : "실제 상황";
  // Phase 4: 실제 재난은 같은 칸·같은 순서에 표제어만 바꿈. 새 스냅숏(v2)만 붙임 2·3과 집계 기준 주석이 붙음(이전 저장본은 그대로)
  const real = ev.mode === "real";
  const v2 = snap.incidents !== undefined;
  const W = real
    ? { people: "인원현황", student: "학생 재실", total: "총 인원", band: "대    응    내    용", overview: "상황 개요", evals: "대응 평가", improve: "문제점 및\n향후 조치 사항" }
    : { people: "참가인원", student: "학생 참가", total: "총 참가", band: "훈    련    내    용", overview: "훈련 개요", evals: "평    가", improve: "추후 대피훈련 시\n반영사항" };
  const sum = summarizeClasses(snap.classes);
  const t = new TB();
  const LBL = { kind: "label" as const, bold: true };

  let r = t.row(8.5);
  t.put(r, 0, "일    시", LBL);
  t.put(r, 1, `${whenText(ev)}   [${mode}]`, { cs: 6, align: "L" });

  // 참가 인원: 머리글 행 + 값 행(교직원 / 학생 참가 / 학생 대피 확인 / 총 참가). 미확인 값은 빈 괄호, 설명은 표 아래 주석
  const pc = participantCounts(snap, manual);
  const BLANK = "(        )명";
  const HEAD = { kind: "head" as const, bold: true };
  r = t.row(ROW_H);
  t.put(r, 0, W.people, { ...LBL, rs: 2 });
  t.put(r, 1, "교직원", HEAD);
  t.put(r, 2, W.student, { ...HEAD, cs: 2 });
  t.put(r, 4, "학생 대피 확인", { ...HEAD, cs: 2 });
  t.put(r, 6, W.total, HEAD);
  r = t.row(ROW_H);
  const evacMark = pc.unreported.length > 0 || pc.unconfirmed > 0 ? " ※" : "";
  t.put(r, 1, pc.staff !== null ? `${pc.staff}명` : BLANK);
  t.put(r, 2, pc.student !== null ? `${pc.student}명` : BLANK, { cs: 2 });
  t.put(r, 4, pc.evacuated === null ? "보고 없음 ※" : `${pc.evacuated}명${evacMark}`, { cs: 2 });
  t.put(r, 6, pc.total !== null ? `${pc.total}명` : BLANK, { bold: pc.total !== null });

  const roles = manual.roles.length ? manual.roles : DEFAULT_ROLES;
  r = t.row(ROW_H);
  t.put(r, 0, "역할담당", { ...LBL, rs: roles.length + 1 });
  t.put(r, 1, "구    분", { cs: 4, kind: "head", bold: true });
  t.put(r, 5, "담 당 자", { cs: 2, kind: "head", bold: true });
  for (const role of roles) {
    const rr = t.row(ROW_H);
    t.put(rr, 1, clean(role.part, 60), { cs: 4 });
    t.put(rr, 5, clean(role.who, 60), { cs: 2 });
  }

  r = t.row(7.0);
  t.put(r, 0, W.band, { cs: 7, kind: "band", bold: true });

  r = t.row(12.0);
  t.put(r, 0, W.overview, LBL);
  t.put(r, 1, clean(manual.trainingNote, 300), { cs: 6, align: "L" });

  r = t.row(11.0);
  t.put(r, 0, `${ev.typeLabel}발생시\n대피(집결)장소`, LBL);
  t.put(r, 1, clean(manual.evacPlaceText.trim() || autoEvacSentence(ev), 200), { cs: 6, align: "L" });

  r = t.row(8.5);
  t.put(r, 0, "대피소요 시간", LBL);
  t.put(r, 1, clean(manual.durationText, 40), { cs: 6, align: "L" });

  const evals = manual.evals.length ? manual.evals : DEFAULT_EVALS.map((item) => ({ item, result: "" as OX, note: "" }));
  r = t.row(10.0);
  t.put(r, 0, W.evals, { ...LBL, rs: evals.length + 1 });
  t.put(r, 1, "평가내용", { cs: 3, kind: "head", bold: true });
  t.put(r, 4, "평가결과\n(O, X)", { kind: "head", bold: true });
  t.put(r, 5, "비    고", { cs: 2, kind: "head", bold: true });
  for (const e of evals) {
    const rr = t.row(8.0);
    t.put(rr, 1, `▪ ${clean(e.item, 60)}`, { cs: 3, align: "L" });
    t.put(rr, 4, e.result === "O" || e.result === "X" ? e.result : "", { bold: true });
    t.put(rr, 5, clean(e.note, 80), { cs: 2, align: "L" });
  }

  const improveRow = t.row(30.0);
  t.put(improveRow, 0, W.improve, LBL);
  t.put(improveRow, 1, clean(manual.improvements, 1000), { cs: 6, align: "L", valign: "T" });

  const photoRow = t.row(40.0);
  t.put(photoRow, 0, "사    진", LBL);
  for (const c0 of [1, 3, 5]) t.put(photoRow, c0, "", { cs: 2 });

  // 표 아래 주석: 미보고·미확인·총인원 미확정·시간 계산 기준(표 칸 안에서 줄바꿈되지 않게 분리)
  const notes: string[] = [];
  // 한 줄(약 56자) 안팎으로 짧게 — 길어지면 사진 칸이 줄어듦
  if (pc.evacuated === null) notes.push(pc.classCount ? `※ 학생 대피 확인: 학급 대피 보고 없음(${pc.classCount}학급 미보고, 0명으로 적지 않음).` : "※ 학생 대피 확인: 등록된 학급 없음.");
  else if (pc.unreported.length || pc.unconfirmed) {
    const parts = [`보고 ${pc.reportedCount}/${pc.classCount}학급 합계`];
    if (pc.unreported.length) parts.push(`미보고 ${pc.unreported.length}학급 제외(${listLabels(pc.unreported, 3)})`);
    if (pc.unconfirmed) parts.push(`소재 미확인 ${pc.unconfirmed}명 별도`);
    notes.push(`※ 학생 대피 확인: ${parts.join(", ")}.`);
  }
  if (pc.totalSource === "none") notes.push(`※ ${W.total}: ${pc.missing.join("·")} 인원 확인 후 기입(미확인 값을 0으로 채우지 않음).`);
  else if (pc.totalSource === "auto") notes.push(`※ ${W.total} = 교직원 + ${W.student}(담당자 확인 값의 합).`);
  if (ev.closedAt) notes.push(`※ ${TIME_BASIS_SHORT}`);
  if (v2) {
    if (!ev.closedAt) notes.push("※ 진행 중 기록(최종본 아님) — 종료 후 '다시 불러오기'로 확정하세요.");
    notes.push(`※ 집계 기준 시각 ${kstStamp(snap.takenAt)}${ev.closedAt ? ` (사건 종료 ${kstStamp(ev.closedAt)})` : ""}.`);
    notes.push(real ? "붙임  1. 학급별 대피 현황  2. 현장 제보·조치 현황  3. 교직원 소재 응답 통계(익명) 각 1부." : "붙임  1. 학급별 대피 현황  2. 현장 제보·조치 현황 각 1부.");
  } else notes.push("붙임  학급별 대피 현황 1부.");
  const footnote = notes.join("\n");

  // 쪽 높이를 넘으면 사진 칸(30mm까지) → 반영사항 칸(22mm까지) → 사진 칸(24mm까지) 순서로 줄임(그래도 넘으면 한글에서 다음 쪽으로 이어짐)
  const over = () => PAGE_HEAD_H.main + t.rowsMm.reduce((a, b) => a + b, 0) + footnoteHeight(footnote) - USABLE_H;
  for (const [row, min] of [[photoRow, 30], [improveRow, IMPROVE_MIN], [photoRow, PHOTO_MIN]] as const) {
    const o = over();
    if (o > 0) t.rowsMm[row] = Math.max(min, t.rowsMm[row]! - Math.ceil(o * 10) / 10);
  }

  const pages: LPage[] = [
    { title: docTitle(snap), titleKind: "main", subtitle: snap.schoolName, table: { colPct: MAIN_COLS, rowsMm: t.rowsMm, cells: t.cells }, footnote },
  ];

  // 붙임: 학급별 대피 현황(학급 수에 따라 쪽 늘림)
  const chunks: DrillClassSnap[][] = [];
  for (let i = 0; i < Math.max(snap.classes.length, 1); i += APPX_ROWS_PER_PAGE) chunks.push(snap.classes.slice(i, i + APPX_ROWS_PER_PAGE));
  chunks.forEach((chunk, pi) => {
    const a = new TB();
    const hr = a.row(ROW_H);
    ["학년·반", "재적", "사전 파악 부재", "대피 확인", "미확인", "부상", "보고 상태·비고"].forEach((h, i) => a.put(hr, i, h, { kind: "head", bold: true }));
    for (const c of chunk) {
      const rr = a.row(ROW_H);
      a.put(rr, 0, clean(c.label, 30));
      a.put(rr, 1, c.enrolled === null ? "확인 필요" : String(c.enrolled));
      if (c.report) {
        a.put(rr, 2, String(c.report.absentKnown));
        a.put(rr, 3, String(c.report.evacuated));
        a.put(rr, 4, String(c.report.unconfirmed));
        a.put(rr, 5, String(c.report.injured));
        const edits = c.report.version > 1 ? ` (수정 ${c.report.version - 1}회)` : "";
        const note = c.report.note ? ` · ${clean(c.report.note, 30)}` : "";
        a.put(rr, 6, `보고${edits}${note}`, { align: "L" });
      } else {
        for (let k = 2; k <= 5; k++) a.put(rr, k, "—");
        a.put(rr, 6, "미보고", { align: "L", bold: true });
      }
    }
    if (pi === chunks.length - 1) {
      const tr = a.row(ROW_H);
      a.put(tr, 0, "보고 학급 합계", { kind: "head", bold: true });
      a.put(tr, 1, sum.enrolledReportedComplete ? String(sum.enrolledReported) : "확인 필요", { bold: true });
      a.put(tr, 2, String(sum.absentKnown), { bold: true });
      a.put(tr, 3, String(sum.evacuated), { bold: true });
      a.put(tr, 4, String(sum.unconfirmed), { bold: true });
      a.put(tr, 5, String(sum.injured), { bold: true });
      a.put(tr, 6, `보고 ${sum.reportedCount} / 전체 ${sum.total}학급${sum.unreported.length ? " (미보고 제외 합계)" : ""}`, { align: "L", bold: true });
    }
    const pageNo = chunks.length > 1 ? ` (${pi + 1}/${chunks.length})` : "";
    const last = pi === chunks.length - 1;
    pages.push({
      title: `${v2 ? "붙임 1." : "붙임."} 학급별 대피 현황${pageNo}`,
      titleKind: "appendix",
      // 부제는 한 줄로(학교명 · 훈련일 · 구분 · 기록 시점) — 줄바꿈으로 제목과 표 사이가 벌어지지 않게
      subtitle: `${snap.schoolName} · ${dateText(ev.startedAt)} ${mode} · 시스템 대피 보고 기준(기록 시점 ${kstStamp(snap.takenAt)})`,
      table: { colPct: APPX_COLS, rowsMm: a.rowsMm, cells: a.cells, headerRows: 1 },
      footnote: last
        ? "※ 미보고 학급은 0명이 아니라 '—'로 표시하고 합계에 넣지 않았습니다. 재적·사전 파악 부재·대피 확인·미확인·부상은 담임교사 보고값입니다.\n※ 보고 시각은 담임교사가 보고를 저장한 시각이며 실제 대피 완료 시각이 아닙니다."
        : "※ 다음 쪽에 이어집니다.",
    });
  });
  if (v2) pages.push(...incidentPages(snap, mode));
  if (v2 && real) pages.push(presencePage(snap, mode)); // 모의훈련에는 소재 붙임을 절대 만들지 않음
  return { pages };
}

/** 붙임 2. 현장 제보·조치 현황(제보자 이름 없음, 자유 기재는 가린 요약). 쪽마다 머리글 반복 */
export const INCIDENT_COLS = [6.0, 11.0, 17.0, 10.0, 11.0, 9.0, 36.0];
export const INCIDENT_ROWS_PER_PAGE = 16;
const INCIDENT_ROW_H = 12.0;
function incidentPages(snap: DrillSnapshot, mode: string): LPage[] {
  const list = snap.incidents ?? [];
  const chunks: DrillIncidentSnap[][] = [];
  for (let i = 0; i < Math.max(list.length, 1); i += INCIDENT_ROWS_PER_PAGE) chunks.push(list.slice(i, i + INCIDENT_ROWS_PER_PAGE));
  return chunks.map((chunk, pi) => {
    const a = new TB();
    const hr = a.row(ROW_H);
    ["번호", "유형", "장소", "접수 시각", "처리 상태", "추가·조치", "제보 내용·최근 조치(요약)"].forEach((h, i) => a.put(hr, i, h, { kind: "head", bold: true }));
    if (chunk.length === 0) {
      const rr = a.row(ROW_H);
      a.put(rr, 0, "현장 제보 없음", { cs: 7 });
    }
    for (const it of chunk) {
      const rr = a.row(INCIDENT_ROW_H);
      a.put(rr, 0, String(it.no));
      a.put(rr, 1, clean(it.typeLabel, 20));
      a.put(rr, 2, clean(it.placeLabel, 50));
      a.put(rr, 3, hhmm(kst(it.createdAt)));
      a.put(rr, 4, clean(it.statusLabel, 20), { bold: it.statusLabel !== "조치 완료" });
      a.put(rr, 5, `${it.updateCount}건 / ${it.actionCount}건`);
      a.put(rr, 6, clean(it.lastAction ? `${it.summary}\n└ 조치: ${it.lastAction}` : it.summary, 120), { align: "L" });
    }
    const pageNo = chunks.length > 1 ? ` (${pi + 1}/${chunks.length})` : "";
    const last = pi === chunks.length - 1;
    return {
      title: `붙임 2. 현장 제보·조치 현황${pageNo}`,
      titleKind: "appendix" as const,
      subtitle: `${snap.schoolName} · ${dateText(snap.event.startedAt)} ${mode} · 제보 ${list.length}건(기록 시점 ${kstStamp(snap.takenAt)})`,
      table: { colPct: INCIDENT_COLS, rowsMm: a.rowsMm, cells: a.cells, headerRows: 1 },
      footnote: last
        ? "※ 제보자 이름은 싣지 않습니다. 자유 기재 내용은 전화번호·주민등록번호 형태와 교직원 이름을 '○○○'으로 가렸습니다(학생 이름 등은 자동으로 모두 가릴 수 없으니 출력 전 확인).\n※ 추가·조치 = 추가 정보 건수 / 그중 조치 기록 건수. 처리 상태는 기록 시점 기준입니다."
        : "※ 다음 쪽에 이어집니다.",
    };
  });
}

/** 붙임 3. 교직원 소재 응답 통계(실제 재난만, 익명 집계 — 이름·위치·명단 없음) */
export const PRESENCE_COLS = [25.0, 25.0, 25.0, 25.0];
function presencePage(snap: DrillSnapshot, mode: string): LPage {
  const p = snap.presence ?? null;
  const a = new TB();
  const n = (v: number | undefined) => (p ? `${v ?? 0}명` : "—");
  const rows: [string, string, string, string][] = [
    ["집계 대상 교직원", n(p?.targetCount), "응답", n(p?.respondedCount)],
    ["미응답(추정 안 함)", n(p?.notRespondedCount), "앱 알림 확인", n(p?.alertsRead)],
    ["교내", n(p?.onCampus), "교외", n(p?.offCampus)],
    ["대피 지원 가능", n(p?.available), "지원 불가", n(p?.unavailable)],
    ["확인 필요", n(p?.unsure), "최근 응답 시각", p?.latestRespondedAt ? kstStamp(p.latestRespondedAt) : "응답 없음"],
  ];
  for (const [l1, v1, l2, vv] of rows) {
    const r = a.row(ROW_H + 1);
    a.put(r, 0, l1, { kind: "label", bold: true });
    a.put(r, 1, v1, { bold: true });
    a.put(r, 2, l2, { kind: "label", bold: true });
    a.put(r, 3, vv, { bold: true });
  }
  return {
    title: "붙임 3. 교직원 소재 응답 통계(익명 집계)",
    titleKind: "appendix",
    subtitle: `${snap.schoolName} · ${dateText(snap.event.startedAt)} ${mode} · 기록 시점 ${kstStamp(snap.takenAt)}`,
    table: { colPct: PRESENCE_COLS, rowsMm: a.rowsMm, cells: a.cells },
    footnote:
      "※ 개인별 이름·소재·교내 위치·변경 이력·미응답자 명단은 싣지 않습니다(숫자 집계만).\n※ 미응답 = 집계 대상 − 응답이며 교외·안전으로 추정하지 않습니다. 교내+교외 = 응답, 지원 가능+불가+확인 필요 = 응답.\n※ 집계 대상: 사건 알림을 받은 교직원 중 기록 시점에 승인·활성인 교직원. 알림 확인은 안전 확인이 아닙니다.",
  };
}

function kstStamp(iso: string) {
  const t = kst(iso);
  return `${t.y}. ${t.m}. ${t.d}. ${hhmm(t)}`;
}

/** 배치 검사: 칸이 빈틈·겹침 없이 채워지는지, 쪽 높이 안인지 */
export function checkDoc(doc: DrillDoc, opts: { height?: boolean } = {}): string[] {
  const errs: string[] = [];
  doc.pages.forEach((p, pi) => {
    const nc = p.table.colPct.length;
    const grid = p.table.rowsMm.map(() => new Array(nc).fill(0));
    for (const c of p.table.cells) {
      for (let r = c.r; r < c.r + c.rs; r++)
        for (let k = c.c; k < c.c + c.cs; k++) {
          if (r >= grid.length || k >= nc) errs.push(`쪽 ${pi + 1}: 범위 밖 칸 (${r},${k})`);
          else grid[r]![k]++;
        }
    }
    grid.forEach((row, r) => row.forEach((n: number, k: number) => n !== 1 && errs.push(`쪽 ${pi + 1}: 칸 (${r},${k}) ${n}회`)));
    const h = PAGE_HEAD_H[p.titleKind] + p.table.rowsMm.reduce((a, b) => a + b, 0) + footnoteHeight(p.footnote);
    if (opts.height !== false && h > USABLE_H) errs.push(`쪽 ${pi + 1}: 높이 ${h.toFixed(1)}mm > ${USABLE_H}mm`);
    if (Math.abs(p.table.colPct.reduce((a, b) => a + b, 0) - 100) > 0.05) errs.push(`쪽 ${pi + 1}: 열 너비 합`);
  });
  return errs;
}

/** 스냅숏 이후 원본 기록이 바뀌었는지(문서에는 자동 반영하지 않고 알림만) */
export function diffSnapshots(saved: DrillSnapshot, current: DrillSnapshot): string[] {
  const out: string[] = [];
  const byId = new Map(saved.classes.map((c) => [c.classId, c]));
  for (const c of current.classes) {
    const o = byId.get(c.classId);
    if (!o) {
      out.push(`${c.label}: 자동작성 이후 추가된 학급`);
      continue;
    }
    if (!o.report && c.report) out.push(`${c.label}: 자동작성 당시 미보고 → 지금은 보고됨`);
    else if (o.report && c.report && o.report.version !== c.report.version) out.push(`${c.label}: 대피 보고가 수정됨(판 ${o.report.version} → ${c.report.version})`);
    else if (o.enrolled !== c.enrolled) out.push(`${c.label}: 재적 ${o.enrolled ?? "확인 필요"} → ${c.enrolled ?? "확인 필요"}`);
  }
  for (const o of saved.classes) if (!current.classes.some((c) => c.classId === o.classId)) out.push(`${o.label}: 지금은 목록에 없음`);
  if (saved.event.evacPlace !== current.event.evacPlace) out.push(`대피 장소 기록 변경: ${saved.event.evacPlace ?? "없음"} → ${current.event.evacPlace ?? "없음"}`);
  if (saved.schoolName !== current.schoolName) out.push(`학교명 변경: ${saved.schoolName} → ${current.schoolName}`);
  // Phase 4(새 스냅숏만): 현장 제보·조치, 실제 재난 소재 익명 집계가 바뀌었는지
  if (saved.incidents !== undefined) {
    if (stableKey(saved.incidents) !== stableKey(current.incidents ?? [])) out.push(`현장 제보·조치 기록이 바뀜(제보 ${saved.incidents.length}건 → ${(current.incidents ?? []).length}건)`);
    if (saved.event.mode === "real" && stableKey(saved.presence ?? null) !== stableKey(current.presence ?? null)) out.push("교직원 소재 응답 집계가 바뀜");
  }
  return out;
}

const stableKey = (v: unknown): string => JSON.stringify(v, (_k, x) => (x && typeof x === "object" && !Array.isArray(x) ? Object.fromEntries(Object.entries(x).sort(([a], [b]) => a.localeCompare(b))) : x));
