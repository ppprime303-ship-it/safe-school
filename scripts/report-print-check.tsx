// Beta PILOT 2 Phase 4: 보고서 A4 인쇄 품질 점검용 HTML 만들기(가상 자료만) — `npx tsx scripts/report-print-check.tsx <출력 폴더>`
// 화면과 같은 DrillDocPreview 컴포넌트로 모의훈련 일지·실제 재난 상황보고서 HTML 을 만들고, 쪽별 HTML 도 함께 만듭니다.
// 만든 HTML 은 브라우저(Edge·Chrome) 머리 없는 인쇄로 PDF·쪽 이미지로 바꿔 확인합니다(운영 자료·DB 사용 안 함).
import fs from "node:fs";
import path from "node:path";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { DrillDocPreview } from "../client/src/pages/drill/DrillDocPreview";
import { buildDrillDoc, checkDoc, defaultManual, markDraft, scanDocPrivacy, type DrillDoc, type DrillSnapshot } from "../shared/drillLog";

const out = path.resolve(process.argv[2] ?? "report-print-check");
fs.mkdirSync(out, { recursive: true });

// 화면 index.css 의 인쇄 규칙과 같은 내용(쪽 나눔·배경색·머리글 반복·행 쪼개짐 방지)
const PRINT_CSS = `
@page { size: A4; margin: 0; }
html, body { margin: 0; padding: 0; background: #fff; }
.drill-print, .drill-print * { -webkit-print-color-adjust: exact; print-color-adjust: exact; }
.drill-page { box-shadow: none !important; margin: 0 !important; break-after: page; box-sizing: border-box; }
.drill-page:last-child { break-after: auto; }
.drill-table thead { display: table-header-group; }
.drill-row { break-inside: avoid; }
.print\\:hidden { display: none; }
`;

const classes = Array.from({ length: 36 }, (_, i) => {
  const grade = Math.floor(i / 6) + 1;
  const classNo = (i % 6) + 1;
  const reported = i % 7 !== 3; // 일부 미보고
  return {
    classId: `c${i}`,
    label: `${grade}학년 ${classNo}반`,
    grade,
    classNo,
    enrolled: 24 + (i % 5),
    enrolledSource: "report" as const,
    report: reported ? { evacuated: 22 + (i % 5), absentKnown: 1, unconfirmed: i % 11 === 0 ? 1 : 0, injured: i % 13 === 0 ? 1 : 0, note: null, version: 1 + (i % 2), reportedAt: "2026-10-30T01:08:00.000Z", lastChangedAt: "2026-10-30T01:12:00.000Z" } : null,
  };
});
const incidents = Array.from({ length: 19 }, (_, i) => ({
  no: i + 1,
  typeLabel: ["위험 발견", "시설 피해", "이동 장애", "도움 필요"][i % 4]!,
  placeLabel: ["복도 / 본관 1층", "계단 / 서관 2층", "체육관", "급식실 / 출입구"][i % 4]!,
  createdAt: new Date(Date.UTC(2026, 9, 30, 1, 5 + i)).toISOString(),
  statusLabel: ["접수", "확인 중", "조치 중", "조치 완료"][i % 4]!,
  updateCount: i % 3,
  actionCount: i % 2,
  summary: i === 0 ? "○○○ 선생님 반 앞 복도에 연기가 보입니다" : `현장 상황 가상 제보 ${i + 1}번 — 통로 일부가 막혀 우회가 필요합니다`,
  lastAction: i % 2 ? "출입을 통제하고 우회로를 안내함" : null,
}));
const snap = (mode: "drill" | "real"): DrillSnapshot => ({
  takenAt: "2026-10-30T01:45:00.000Z",
  schoolName: "가상초등학교(인쇄 점검)",
  event: { id: "e", type: "fire", typeLabel: "화재", extraTypeLabels: [], mode, startedAt: "2026-10-30T01:00:12.000Z", closedAt: "2026-10-30T01:38:40.000Z", evacPlace: "운동장", location: null, issuedByName: null, closedByName: null },
  classes,
  incidents,
  ...(mode === "real" ? { presence: { targetCount: 42, respondedCount: 35, notRespondedCount: 7, onCampus: 30, offCampus: 5, available: 26, unavailable: 4, unsure: 5, alertsRead: 39, latestRespondedAt: "2026-10-30T01:31:00.000Z" } } : {}),
  maskedCount: 1,
});
const manual = (mode: "drill" | "real") => ({
  ...defaultManual(),
  staffCount: "42",
  studentCount: mode === "real" ? "" : "850",
  trainingNote: mode === "real" ? "급식실 화재 경보 후 전교생 운동장 대피, 소방서 출동 전 초기 진화" : "사전 안전교육 후 1차 경보 대피, 2차 경보에 운동장 집결",
  durationText: "7분 10초",
  roles: [
    { part: "안전교육 및 학생 대피", who: "각 반 담임교사" },
    { part: "신고", who: "행정실" },
    { part: "안내 방송", who: "교무부" },
    { part: "부상 학생 응급처치", who: "보건교사" },
    { part: "실내 잔류 확인", who: "학년부장" },
    { part: "소요시간 측정, 최종인원 점검", who: "안전업무 담당" },
  ],
  improvements: mode === "real" ? "급식실 비상구 앞 적재물 정리, 2층 계단 비상 조명 점검, 미응답 교직원 연락 절차 보완" : "서관 계단 병목 해소를 위해 학년별 출발 시간 조정",
});

const docs: [string, DrillDoc][] = [
  ["drill-final", buildDrillDoc(snap("drill"), manual("drill"))],
  ["real-final", buildDrillDoc(snap("real"), manual("real"))],
  ["real-draft", markDraft(buildDrillDoc({ ...snap("real"), event: { ...snap("real").event, closedAt: null } }, manual("real")))],
];
const html = (title: string, doc: DrillDoc) =>
  `<!doctype html><html lang="ko"><head><meta charset="utf-8"><title>${title}</title><style>${PRINT_CSS}</style></head><body>${renderToStaticMarkup(createElement(DrillDocPreview, { doc }))}</body></html>`;
const report: Record<string, unknown> = {};
for (const [name, doc] of docs) {
  fs.writeFileSync(path.join(out, `${name}.html`), html(name, doc));
  doc.pages.forEach((p, i) => fs.writeFileSync(path.join(out, `${name}-p${i + 1}.html`), html(`${name} ${i + 1}`, { pages: [p] })));
  report[name] = {
    pages: doc.pages.map((p) => p.title),
    layoutErrors: checkDoc(doc),
    privacy: scanDocPrivacy(doc, ["홍길동", "김철수"], { checkNames: name.startsWith("real") }),
  };
}
fs.writeFileSync(path.join(out, "summary.json"), JSON.stringify(report, null, 2));
console.log(JSON.stringify(report, null, 2));
