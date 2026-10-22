// STEP 3-D 비상대피훈련일지 — 데이터 구조·기본값·배치 규칙(화면 미리보기와 서버 HWPX가 함께 사용)
// 승인 서식(2026-10-22): 붙임형 — 본문 A4 1쪽(학교 원본 형식) + 붙임 '학급별 대피 현황'(학급 수에 따라 쪽 늘림), 평가 결과는 O 또는 X 글자만
// 원형: tools/hwpx/drill_log_layout.py(시제품). 열 비율·행 높이·병합 구조를 같게 유지합니다.
//
// 자동작성 데이터 정책
// 1. 미보고 학급은 0명이 아니라 '미보고'  2. 재적과 대피 확인을 다른 칸에  3. 학급당 최신 보고 1건만(중복 집계 없음)
// 4. 보고 시각 ≠ 대피 완료 시각(소요 시간 자동 계산 안 함)  5. 총 참가 인원은 담당자 입력값만
// 6. 기록되지 않은 조치를 쓰지 않음  7. 모의훈련/실제 구분 표시
// 8. 원본 대피 보고는 이 문서에서 바꾸지 않음  9. 자동작성 당시 기록(스냅숏)과 이후 바뀐 기록을 구분해 알림

export const DRILL_FORM_KEY = "evacuation_drill";
export const DRILL_FORM_VERSION = 1;

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
}

export type OX = "" | "O" | "X";
export interface DrillManual {
  staffCount: string; // 교직원 참가 인원(숫자 문자열, 비우면 미입력)
  totalCount: string; // 총 참가 인원(담당자 확인값만)
  roles: { part: string; who: string }[];
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

const WD = "일월화수목금토";
function kst(iso: string) {
  const d = new Date(new Date(iso).getTime() + 9 * 3600 * 1000);
  return { y: d.getUTCFullYear(), m: d.getUTCMonth() + 1, d: d.getUTCDate(), w: WD[d.getUTCDay()], h: d.getUTCHours(), mi: d.getUTCMinutes() };
}
const hhmm = (t: { h: number; mi: number }) => `${String(t.h).padStart(2, "0")}:${String(t.mi).padStart(2, "0")}`;

export function whenText(ev: DrillSnapshot["event"]): string {
  const a = kst(ev.startedAt);
  let s = `${a.y}. ${a.m}. ${a.d}.(${a.w}) ${hhmm(a)}`;
  if (ev.closedAt) {
    const b = kst(ev.closedAt);
    const mins = Math.round((new Date(ev.closedAt).getTime() - new Date(ev.startedAt).getTime()) / 60000);
    s += ` ~ ${hhmm(b)} (총 ${mins}분)`;
  } else s += " ~ (종료 전)";
  return s;
}

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
  return `비상대피훈련일지(${types})`;
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
}
export interface LPage {
  title: string;
  titleKind: "main" | "appendix";
  subtitle: string;
  table: LTable;
  footnote?: string;
}
export interface DrillDoc {
  pages: LPage[];
}

export const PAGE = { w: 210, h: 297, margin: { left: 15, right: 15, top: 12, bottom: 12 } };
export const TABLE_W = PAGE.w - PAGE.margin.left - PAGE.margin.right; // 180mm
export const USABLE_H = PAGE.h - PAGE.margin.top - PAGE.margin.bottom; // 273mm
export const MAIN_COLS = [17.0, 15.0, 12.67, 13.0, 14.67, 13.0, 14.66];
export const APPX_COLS = [15.0, 10.0, 14.0, 13.0, 11.0, 9.0, 28.0];
export const ROW_H = 7.4;
export const APPX_ROWS_PER_PAGE = 32; // 머리글 1행 + 학급 32행(+마지막 쪽 합계 1행) ≈ 252mm

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
  const sum = summarizeClasses(snap.classes);
  const t = new TB();
  const LBL = { kind: "label" as const, bold: true };

  let r = t.row(8.5);
  t.put(r, 0, "일    시", LBL);
  t.put(r, 1, `${whenText(ev)}   [${mode}]`, { cs: 6, align: "L" });

  r = t.row(8.5);
  t.put(r, 0, "참가인원", LBL);
  const staff = manual.staffCount.trim() ? manual.staffCount.trim() : "        ";
  const stu = `학생 대피 확인 ${sum.evacuated}명` + (sum.unreported.length ? ` (미보고 ${sum.unreported.length}개 학급 제외)` : "");
  t.put(r, 1, `교직원 ( ${staff} )명  /  ${stu}`, { cs: 4, align: "L" });
  t.put(r, 5, `총 ( ${manual.totalCount.trim() ? manual.totalCount.trim() : "          "} )명`, { cs: 2 });

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
  t.put(r, 0, "훈    련    내    용", { cs: 7, kind: "band", bold: true });

  r = t.row(12.0);
  t.put(r, 0, "훈련 개요", LBL);
  t.put(r, 1, clean(manual.trainingNote, 300), { cs: 6, align: "L" });

  r = t.row(11.0);
  t.put(r, 0, `${ev.typeLabel}발생시\n대피(집결)장소`, LBL);
  t.put(r, 1, clean(manual.evacPlaceText.trim() || autoEvacSentence(ev), 200), { cs: 6, align: "L" });

  r = t.row(8.5);
  t.put(r, 0, "대피소요 시간", LBL);
  t.put(r, 1, clean(manual.durationText, 40), { cs: 6, align: "L" });

  const evals = manual.evals.length ? manual.evals : DEFAULT_EVALS.map((item) => ({ item, result: "" as OX, note: "" }));
  r = t.row(10.0);
  t.put(r, 0, "평    가", { ...LBL, rs: evals.length + 1 });
  t.put(r, 1, "평가내용", { cs: 3, kind: "head", bold: true });
  t.put(r, 4, "평가결과\n(O, X)", { kind: "head", bold: true });
  t.put(r, 5, "비    고", { cs: 2, kind: "head", bold: true });
  for (const e of evals) {
    const rr = t.row(8.0);
    t.put(rr, 1, `▪ ${clean(e.item, 60)}`, { cs: 3, align: "L" });
    t.put(rr, 4, e.result === "O" || e.result === "X" ? e.result : "", { bold: true });
    t.put(rr, 5, clean(e.note, 80), { cs: 2, align: "L" });
  }

  r = t.row(30.0);
  t.put(r, 0, "추후 대피훈련 시\n반영사항", LBL);
  t.put(r, 1, clean(manual.improvements, 1000), { cs: 6, align: "L", valign: "T" });

  r = t.row(40.0);
  t.put(r, 0, "사    진", LBL);
  for (const c0 of [1, 3, 5]) t.put(r, c0, "", { cs: 2 });

  const pages: LPage[] = [
    { title: docTitle(snap), titleKind: "main", subtitle: snap.schoolName, table: { colPct: MAIN_COLS, rowsMm: t.rowsMm, cells: t.cells }, footnote: "붙임  학급별 대피 현황 1부." },
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
    pages.push({
      title: `붙임. 학급별 대피 현황${pageNo}`,
      titleKind: "appendix",
      subtitle: `${snap.schoolName} · ${whenText(ev)} [${mode}] · 시스템 대피 보고 기준(기록 시점 ${kstStamp(snap.takenAt)})`,
      table: { colPct: APPX_COLS, rowsMm: a.rowsMm, cells: a.cells },
      footnote: "보고 시각은 담임교사가 보고를 저장한 시각이며 실제 대피 완료 시각이 아닙니다. 미보고 학급은 합계에 넣지 않았습니다.",
    });
  });
  return { pages };
}

function kstStamp(iso: string) {
  const t = kst(iso);
  return `${t.y}. ${t.m}. ${t.d}. ${hhmm(t)}`;
}

/** 배치 검사: 칸이 빈틈·겹침 없이 채워지는지, 쪽 높이 안인지 */
export function checkDoc(doc: DrillDoc): string[] {
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
    const head = p.titleKind === "main" ? 21 : 14;
    const h = head + p.table.rowsMm.reduce((a, b) => a + b, 0) + (p.footnote ? 6 : 0);
    if (h > USABLE_H) errs.push(`쪽 ${pi + 1}: 높이 ${h.toFixed(1)}mm > ${USABLE_H}mm`);
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
  return out;
}
