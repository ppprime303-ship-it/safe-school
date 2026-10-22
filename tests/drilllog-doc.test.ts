// STEP 3-D 훈련일지 배치·HWPX 생성(순수 — DB 없음)
import { describe, expect, it } from "vitest";
import { inflateRawSync } from "node:zlib";
import {
  APPX_ROWS_PER_PAGE,
  buildDrillDoc,
  checkDoc,
  defaultManual,
  diffSnapshots,
  particleRo,
  summarizeClasses,
  type DrillClassSnap,
  type DrillSnapshot,
} from "../shared/drillLog.js";
import { buildDrillLogHwpx, xmlText } from "../server/src/drilllog/hwpx.js";
import { crc32 } from "../server/src/drilllog/zip.js";

const cls = (i: number, enrolled: number | null, report: DrillClassSnap["report"]): DrillClassSnap => ({
  classId: `c${i}`, label: `${Math.ceil(i / 3)}학년 ${((i - 1) % 3) + 1}반`, grade: Math.ceil(i / 3), classNo: ((i - 1) % 3) + 1, enrolled, enrolledSource: report ? "report" : enrolled === null ? "none" : "class", report,
});
const rep = (evacuated: number, absentKnown = 0, injured = 0, version = 1, unconfirmed = 0) => ({
  evacuated, absentKnown, injured, unconfirmed, note: null, version, reportedAt: "2026-09-09T01:26:00.000Z", lastChangedAt: "2026-09-09T01:28:00.000Z",
});
export const SNAP: DrillSnapshot = {
  takenAt: "2026-09-09T02:30:00.000Z",
  schoolName: "SAFE SCHOOL 시연초등학교",
  event: { id: "e1", type: "earthquake", typeLabel: "지진", extraTypeLabels: [], mode: "drill", startedAt: "2026-09-09T01:20:00.000Z", closedAt: "2026-09-09T02:20:00.000Z", evacPlace: "운동장", location: null, issuedByName: "안전담당", closedByName: "교감" },
  classes: [cls(1, 25, rep(24, 1, 0, 2)), cls(2, 27, rep(27)), cls(3, 24, null)],
};

function unzip(buf: Buffer) {
  const out = new Map<string, { data: Buffer; method: number; crc: number }>();
  const order: string[] = [];
  let i = 0;
  while (buf.readUInt32LE(i) === 0x04034b50) {
    const method = buf.readUInt16LE(i + 8), crc = buf.readUInt32LE(i + 14), csize = buf.readUInt32LE(i + 18), nlen = buf.readUInt16LE(i + 26), xlen = buf.readUInt16LE(i + 28);
    const name = buf.subarray(i + 30, i + 30 + nlen).toString("utf8");
    const body = buf.subarray(i + 30 + nlen + xlen, i + 30 + nlen + xlen + csize);
    out.set(name, { data: method === 8 ? inflateRawSync(body) : Buffer.from(body), method, crc });
    order.push(name);
    i += 30 + nlen + xlen + csize;
  }
  return { files: out, order };
}

describe("자동작성 정책(배치)", () => {
  const doc = buildDrillDoc(SNAP, defaultManual());
  const main = doc.pages[0]!.table.cells.map((c) => c.text);
  const appx = doc.pages[1]!.table.cells.map((c) => c.text);

  it("붙임형: 본문 1쪽 + 붙임 1쪽, 배치 검사 통과", () => {
    expect(doc.pages.map((p) => p.titleKind)).toEqual(["main", "appendix"]);
    expect(checkDoc(doc)).toEqual([]);
    expect(doc.pages[0]!.title).toBe("비상대피훈련일지(지진)");
  });

  it("학생 수는 보고된 학급 대피 확인 합만, 미보고는 제외 표시, 총 참가 인원·교직원은 비움", () => {
    expect(main.some((t) => t.includes("학생 대피 확인 51명 (미보고 1개 학급 제외)") && t.includes("교직원 ("))).toBe(true);
    expect(main).toContain("총 (            )명");
    expect(main.some((t) => /총 \(\s*\d+\s*\)명/.test(t))).toBe(false);
  });

  it("미보고 학급은 0이 아니라 '—'·'미보고', 재적과 대피 확인은 다른 칸", () => {
    const rows = doc.pages[1]!.table.cells;
    const r3 = rows.find((c) => c.text === "1학년 3반")!.r;
    expect(rows.filter((c) => c.r === r3).map((c) => c.text)).toEqual(["1학년 3반", "24", "—", "—", "—", "—", "미보고"]);
    expect(appx.slice(0, 7)).toEqual(["학년·반", "재적", "사전 파악 부재", "대피 확인", "미확인", "부상", "보고 상태·비고"]);
    expect(appx.some((t) => t.startsWith("보고 (수정 1회)"))).toBe(true);
  });

  it("합계 행은 보고 학급만(미보고 제외 명시)", () => {
    expect(appx.some((t) => t === "보고 2 / 전체 3학급 (미보고 제외 합계)")).toBe(true);
    const s = summarizeClasses(SNAP.classes);
    expect(s).toMatchObject({ evacuated: 51, absentKnown: 1, injured: 0, reportedCount: 2, enrolledReported: 52 });
  });

  it("소요 시간·평가 O/X·반영사항은 비움, 평가는 O/X 글자만", () => {
    const m = defaultManual();
    const d0 = buildDrillDoc(SNAP, m).pages[0]!.table.cells;
    const durRow = d0.find((c) => c.text === "대피소요 시간")!.r;
    expect(d0.find((c) => c.r === durRow && c.c === 1)!.text).toBe("");
    const oxCells = d0.filter((c) => c.c === 4 && c.text !== "평가결과\n(O, X)" && c.r > durRow);
    expect(oxCells.map((c) => c.text)).toEqual(["", "", "", "", "", ""]);
    m.evals[0]!.result = "O";
    m.evals[4]!.result = "X";
    const d1 = buildDrillDoc(SNAP, m).pages[0]!.table.cells.filter((c) => c.c === 4 && c.r > durRow && c.kind === "value");
    expect(d1.map((c) => c.text)).toEqual(["O", "", "", "", "X", ""]);
  });

  it("대피 장소: 기록이 있으면 자동 문장, 담당자 입력이 있으면 그 값, 기록 없으면 빈칸", () => {
    expect(main).toContain("학생들이 각 반 대피로를 따라 운동장으로 대피");
    const m = defaultManual();
    m.evacPlaceText = "강당으로 대피(우천)";
    expect(buildDrillDoc(SNAP, m).pages[0]!.table.cells.map((c) => c.text)).toContain("강당으로 대피(우천)");
    const noPlace = { ...SNAP, event: { ...SNAP.event, evacPlace: null } };
    const cells = buildDrillDoc(noPlace, defaultManual()).pages[0]!.table.cells;
    const row = cells.find((c) => c.text.includes("대피(집결)장소"))!.r;
    expect(cells.find((c) => c.r === row && c.c === 1)!.text).toBe("");
    expect(particleRo("강당")).toBe("강당으로");
    expect(particleRo("체육관 홀")).toBe("체육관 홀로");
  });

  it("실제 상황 표시는 [실제 상황](훈련일지 대상은 아니지만 배치 함수는 구분)", () => {
    const real = buildDrillDoc({ ...SNAP, event: { ...SNAP.event, mode: "real" } }, defaultManual());
    expect(real.pages[0]!.table.cells.some((c) => c.text.includes("[실제 상황]"))).toBe(true);
  });

  it("학급이 많으면 붙임 쪽이 늘어나고 쪽마다 머리글, 마지막 쪽에만 합계", () => {
    const many = { ...SNAP, classes: Array.from({ length: 70 }, (_, i) => cls(i + 1, 25, i % 7 === 0 ? null : rep(25))) };
    const d = buildDrillDoc(many, defaultManual());
    expect(d.pages).toHaveLength(1 + Math.ceil(70 / APPX_ROWS_PER_PAGE));
    expect(checkDoc(d)).toEqual([]);
    for (const p of d.pages.slice(1)) expect(p.table.cells[0]!.text).toBe("학년·반");
    expect(d.pages.slice(1).filter((p) => p.table.cells.some((c) => c.text === "보고 학급 합계"))).toHaveLength(1);
    expect(d.pages[1]!.title).toBe("붙임. 학급별 대피 현황 (1/3)");
  });

  it("스냅숏 이후 원본 기록 변화 감지(문서에 자동 반영하지 않음)", () => {
    const now: DrillSnapshot = JSON.parse(JSON.stringify(SNAP));
    now.classes[2]!.report = rep(24);
    now.classes[0]!.report!.version = 3;
    expect(diffSnapshots(SNAP, now)).toEqual(["1학년 1반: 대피 보고가 수정됨(판 2 → 3)", "1학년 3반: 자동작성 당시 미보고 → 지금은 보고됨"]);
    expect(diffSnapshots(SNAP, SNAP)).toEqual([]);
  });
});

describe("HWPX 생성(구조 검사 — 한글 호환 보장 아님)", () => {
  const m = defaultManual();
  m.staffCount = "14";
  m.trainingNote = `특수문자 <태그> & "따옴표" '작은따옴표' \u0007제어문자 😀 한자 安全`;
  m.evals[0] = { item: "대피의 신속성", result: "O", note: "A&B < C" };
  const buf = buildDrillLogHwpx(buildDrillDoc(SNAP, m));
  const { files, order } = unzip(buf);

  it("ZIP: mimetype 첫 항목·무압축, CRC 일치, 필수 파일", () => {
    expect(order[0]).toBe("mimetype");
    expect(files.get("mimetype")!.method).toBe(0);
    expect(files.get("mimetype")!.data.toString()).toBe("application/hwp+zip");
    for (const [name, f] of files) expect(crc32(f.data)).toBe(f.crc);
    for (const n of ["Contents/header.xml", "Contents/section0.xml", "Contents/content.hpf", "META-INF/container.xml", "version.xml", "settings.xml"]) expect(files.has(n)).toBe(true);
  });

  it("특수문자 이스케이프·제어문자 제거, 그림 없음, 쪽 번호 없음", () => {
    const sec = files.get("Contents/section0.xml")!.data.toString("utf8");
    expect(sec).toContain("특수문자 &lt;태그&gt; &amp; \"따옴표\" '작은따옴표' 제어문자 😀 한자 安全");
    expect(sec).toContain("A&amp;B &lt; C");
    expect(sec).not.toContain("\u0007");
    expect(sec).not.toContain("<hp:pic");
    expect(sec).not.toContain("pageNum");
    expect(sec.split("<hp:tbl ").length - 1).toBe(2);
    expect(xmlText("a\u0000b<")).toBe("ab&lt;");
  });

  it("표 칸: 주소·병합 빈틈/겹침 없음, 줄마다 너비 합 = 표 너비, 참조 번호 존재", () => {
    const sec = files.get("Contents/section0.xml")!.data.toString("utf8");
    const head = files.get("Contents/header.xml")!.data.toString("utf8");
    for (const t of sec.match(/<hp:tbl [\s\S]*?<\/hp:tbl>/g)!) {
      const rows = Number(/rowCnt="(\d+)"/.exec(t)![1]), cols = Number(/colCnt="(\d+)"/.exec(t)![1]), tw = Number(/<hp:sz width="(\d+)"/.exec(t)![1]);
      const grid = Array.from({ length: rows }, () => new Array(cols).fill(0));
      const roww = new Array(rows).fill(0);
      for (const tc of t.match(/<hp:tc [\s\S]*?<\/hp:tc>/g)!) {
        const [c, r] = /colAddr="(\d+)" rowAddr="(\d+)"/.exec(tc)!.slice(1).map(Number) as [number, number];
        const [cs, rs] = /colSpan="(\d+)" rowSpan="(\d+)"/.exec(tc)!.slice(1).map(Number) as [number, number];
        const w = Number(/<hp:cellSz width="(\d+)"/.exec(tc)![1]);
        for (let rr = r; rr < r + rs; rr++) {
          roww[rr] += w;
          for (let cc = c; cc < c + cs; cc++) grid[rr]![cc]++;
        }
      }
      expect(grid.flat().every((n) => n === 1)).toBe(true);
      expect(new Set(roww)).toEqual(new Set([tw]));
    }
    for (const [attr, tag] of [["charPrIDRef", "charPr"], ["paraPrIDRef", "paraPr"], ["borderFillIDRef", "borderFill"]] as const) {
      const have = new Set([...head.matchAll(new RegExp(`<hh:${tag} id="(\\d+)"`, "g"))].map((x) => x[1]));
      for (const x of sec.matchAll(new RegExp(`${attr}="(\\d+)"`, "g"))) expect(have.has(x[1])).toBe(true);
    }
  });
});
