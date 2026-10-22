// 비상대피훈련일지 배치(shared/drillLog.ts의 DrillDoc) → HWPX(한글) 파일
// 원형: tools/hwpx/hwpx_writer.py(사용자가 한글에서 열림을 확인한 시험본을 만든 생성기). 같은 XML 구조를 씁니다.
// - 외부 프로그램·쉘 명령을 쓰지 않음(사용자 입력이 명령어에 섞일 여지 없음), 글자는 XML 이스케이프·제어문자 제거
// - 그림을 넣지 않고 글자·표로만 구성 → 한글에서 모든 칸 편집 가능
// - 이 파일의 구조 검사(ZIP·XML·표 칸)는 한글 호환을 보장하지 않습니다(한글 열기는 사람이 확인).
import fs from "node:fs";
import path from "node:path";
import { buildZip, type ZipEntry } from "./zip.js";
import { PAGE, TABLE_W, type DrillDoc, type LCell, type LTable } from "../../../shared/drillLog.js";

const MM = 283.465;
const hu = (mm: number) => Math.round(mm * MM);
const FONT = "맑은 고딕";
const SIZE = { title: 20, appendixTitle: 13, sub: 11, cell: 10, foot: 9 };
const FILL: Record<LCell["kind"], string> = { label: "#F2F2F2", head: "#F2F2F2", band: "#E4E4E4", value: "#FFFFFF" };
const LINE_W = "0.12 mm";
const OUTER_W = "0.4 mm";

export const HWPX_BASE_DIR = path.resolve(process.cwd(), "server/assets/hwpx-base");

export function xmlText(s: string): string {
  return s
    .replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F￾￿]/g, "")
    .replace(/[\uD800-\uDBFF](?![\uDC00-\uDFFF])|(?<![\uD800-\uDBFF])[\uDC00-\uDFFF]/g, "") // 짝 없는 대리 문자
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
}

class Header {
  private bf: string[] = [];
  private cp: string[] = [];
  private pp: string[] = [];
  private keys = new Map<string, number>();
  private fontId: number;
  private basePp: string;
  constructor(private xml: string) {
    const m = new RegExp(`<hh:fontface lang="HANGUL"[\\s\\S]*?<hh:font id="(\\d+)" face="${FONT}"`).exec(xml);
    this.fontId = m ? Number(m[1]) : 0;
    const pp = /<hh:paraPr id="37"[\s\S]*?<\/hh:paraPr>/.exec(xml);
    if (!pp) throw new Error("양식의 문단 모양(37)을 찾을 수 없습니다.");
    this.basePp = pp[0];
  }
  private next(tag: string, pending: string[]) {
    let max = 0;
    for (const m of this.xml.matchAll(new RegExp(`<hh:${tag} id="(\\d+)"`, "g"))) max = Math.max(max, Number(m[1]));
    return max + 1 + pending.length;
  }
  border(key: string, fill: string | null, e: { left: string; right: string; top: string; bottom: string } | null) {
    const k = `bf:${key}`;
    if (this.keys.has(k)) return this.keys.get(k)!;
    const id = this.next("borderFill", this.bf);
    const b = (w: string | null) => (w ? `type="SOLID" width="${w}" color="#000000"` : 'type="NONE" width="0.1 mm" color="#000000"');
    const [face, hatch] = fill ? [fill, "#999999"] : ["none", "#FF000000"];
    this.bf.push(
      `<hh:borderFill id="${id}" threeD="0" shadow="0" centerLine="NONE" breakCellSeparateLine="0">` +
        '<hh:slash type="NONE" Crooked="0" isCounter="0"/><hh:backSlash type="NONE" Crooked="0" isCounter="0"/>' +
        `<hh:leftBorder ${b(e?.left ?? null)}/><hh:rightBorder ${b(e?.right ?? null)}/><hh:topBorder ${b(e?.top ?? null)}/><hh:bottomBorder ${b(e?.bottom ?? null)}/>` +
        '<hh:diagonal type="SOLID" width="0.1 mm" color="#000000"/>' +
        `<hc:fillBrush><hc:winBrush faceColor="${face}" hatchColor="${hatch}" alpha="0"/></hc:fillBrush></hh:borderFill>`,
    );
    this.keys.set(k, id);
    return id;
  }
  char(key: string, pt: number, bold = false, color = "#000000") {
    const k = `cp:${key}`;
    if (this.keys.has(k)) return this.keys.get(k)!;
    const id = this.next("charPr", this.cp);
    const f = this.fontId;
    this.cp.push(
      `<hh:charPr id="${id}" height="${Math.round(pt * 100)}" textColor="${color}" shadeColor="none" useFontSpace="0" useKerning="0" symMark="NONE" borderFillIDRef="2">` +
        `<hh:fontRef hangul="${f}" latin="${f}" hanja="${f}" japanese="${f}" other="${f}" symbol="${f}" user="${f}"/>` +
        '<hh:ratio hangul="100" latin="100" hanja="100" japanese="100" other="100" symbol="100" user="100"/>' +
        '<hh:spacing hangul="0" latin="0" hanja="0" japanese="0" other="0" symbol="0" user="0"/>' +
        '<hh:relSz hangul="100" latin="100" hanja="100" japanese="100" other="100" symbol="100" user="100"/>' +
        '<hh:offset hangul="0" latin="0" hanja="0" japanese="0" other="0" symbol="0" user="0"/>' +
        (bold ? "<hh:bold/>" : "") +
        '<hh:underline type="NONE" shape="SOLID" color="#000000"/><hh:strikeout shape="NONE" color="#000000"/><hh:outline type="NONE"/>' +
        '<hh:shadow type="NONE" color="#B2B2B2" offsetX="10" offsetY="10"/></hh:charPr>',
    );
    this.keys.set(k, id);
    return id;
  }
  para(key: string, align: "LEFT" | "CENTER" | "RIGHT", line = 130, prev = 0, next = 0) {
    const k = `pp:${key}`;
    if (this.keys.has(k)) return this.keys.get(k)!;
    const id = this.next("paraPr", this.pp);
    const x = this.basePp
      .replace(/<hh:paraPr id="37"/, `<hh:paraPr id="${id}"`)
      .replace('horizontal="CENTER"', `horizontal="${align}"`)
      .replace(/<hh:lineSpacing type="PERCENT" value="\d+" unit="HWPUNIT"\/>/g, `<hh:lineSpacing type="PERCENT" value="${line}" unit="HWPUNIT"/>`)
      .replace(/<hc:prev value="\d+" unit="HWPUNIT"\/>/g, `<hc:prev value="${prev}" unit="HWPUNIT"/>`)
      .replace(/<hc:next value="\d+" unit="HWPUNIT"\/>/g, `<hc:next value="${next}" unit="HWPUNIT"/>`)
      .replace(/<hc:left value="\d+" unit="HWPUNIT"\/>/g, '<hc:left value="0" unit="HWPUNIT"/>')
      .replace(/<hc:intent value="-?\d+" unit="HWPUNIT"\/>/g, '<hc:intent value="0" unit="HWPUNIT"/>');
    this.pp.push(x);
    this.keys.set(k, id);
    return id;
  }
  render() {
    let xml = this.xml;
    for (const [plural, items] of [["borderFills", this.bf], ["charProperties", this.cp], ["paraProperties", this.pp]] as const) {
      const m = new RegExp(`<hh:${plural} itemCnt="(\\d+)">`).exec(xml)!;
      xml = xml.replace(m[0], `<hh:${plural} itemCnt="${Number(m[1]) + items.length}">`);
      xml = xml.replace(`</hh:${plural}>`, items.join("") + `</hh:${plural}>`);
    }
    return xml;
  }
}

function colsHu(pct: number[]): number[] {
  const total = hu(TABLE_W);
  const cols = pct.map((p) => Math.round((total * p) / 100));
  cols[cols.length - 1]! += total - cols.reduce((a, b) => a + b, 0);
  return cols;
}

function tableXml(t: LTable, H: Header, tid: number): string {
  const cols = colsHu(t.colPct);
  const rows = t.rowsMm.map(hu);
  const nrow = rows.length;
  const ncol = cols.length;
  const cpN = H.char("cell", SIZE.cell);
  const cpB = H.char("cell_b", SIZE.cell, true);
  const pps = { L: H.para("cell_L", "LEFT"), C: H.para("cell_C", "CENTER"), R: H.para("cell_R", "RIGHT") };
  const byRow = new Map<number, LCell[]>();
  for (const c of t.cells) byRow.set(c.r, [...(byRow.get(c.r) ?? []), c]);
  const trs: string[] = [];
  for (let r = 0; r < nrow; r++) {
    const tcs = (byRow.get(r) ?? [])
      .sort((a, b) => a.c - b.c)
      .map((c) => {
        const w = cols.slice(c.c, c.c + c.cs).reduce((a, b) => a + b, 0);
        const h = rows.slice(c.r, c.r + c.rs).reduce((a, b) => a + b, 0);
        const e = {
          left: c.c === 0 ? OUTER_W : LINE_W,
          right: c.c + c.cs === ncol ? OUTER_W : LINE_W,
          top: c.r === 0 ? OUTER_W : LINE_W,
          bottom: c.r + c.rs === nrow ? OUTER_W : LINE_W,
        };
        const bf = H.border(`${c.kind}|${e.left}|${e.right}|${e.top}|${e.bottom}`, FILL[c.kind], e);
        const lines = c.text ? c.text.split("\n") : [""];
        const cp = c.bold ? cpB : cpN;
        const paras = lines
          .map(
            (line) =>
              `<hp:p id="2147483648" paraPrIDRef="${pps[c.align]}" styleIDRef="0" pageBreak="0" columnBreak="0" merged="0">` +
              `<hp:run charPrIDRef="${cp}">${line ? `<hp:t>${xmlText(line)}</hp:t>` : "<hp:t/>"}</hp:run></hp:p>`,
          )
          .join("");
        return (
          `<hp:tc name="" header="${c.r < (t.headerRows ?? 0) ? 1 : 0}" hasMargin="1" protect="0" editable="0" dirty="0" borderFillIDRef="${bf}">` +
          `<hp:subList id="" textDirection="HORIZONTAL" lineWrap="BREAK" vertAlign="${c.valign === "T" ? "TOP" : "CENTER"}" ` +
          'linkListIDRef="0" linkListNextIDRef="0" textWidth="0" textHeight="0" hasTextRef="0" hasNumRef="0">' +
          `${paras}</hp:subList>` +
          `<hp:cellAddr colAddr="${c.c}" rowAddr="${c.r}"/><hp:cellSpan colSpan="${c.cs}" rowSpan="${c.rs}"/>` +
          `<hp:cellSz width="${w}" height="${h}"/><hp:cellMargin left="${hu(1.6)}" right="${hu(1.6)}" top="${hu(0.6)}" bottom="${hu(0.6)}"/></hp:tc>`
        );
      });
    trs.push(`<hp:tr>${tcs.join("")}</hp:tr>`);
  }
  const tblBf = H.border("tbl", null, null);
  return (
    `<hp:tbl id="${tid}" zOrder="${tid % 1000}" numberingType="TABLE" textWrap="TOP_AND_BOTTOM" textFlow="BOTH_SIDES" lock="0" ` +
    `dropcapstyle="None" pageBreak="CELL" repeatHeader="${t.headerRows ? 1 : 0}" rowCnt="${nrow}" colCnt="${ncol}" cellSpacing="0" borderFillIDRef="${tblBf}" noAdjust="0">` +
    `<hp:sz width="${cols.reduce((a, b) => a + b, 0)}" widthRelTo="ABSOLUTE" height="${rows.reduce((a, b) => a + b, 0)}" heightRelTo="ABSOLUTE" protect="0"/>` +
    '<hp:pos treatAsChar="1" affectLSpacing="0" flowWithText="1" allowOverlap="0" holdAnchorAndSO="0" vertRelTo="PARA" horzRelTo="PARA" ' +
    'vertAlign="TOP" horzAlign="LEFT" vertOffset="0" horzOffset="0"/>' +
    `<hp:outMargin left="0" right="0" top="0" bottom="0"/><hp:inMargin left="${hu(1.6)}" right="${hu(1.6)}" top="${hu(0.6)}" bottom="${hu(0.6)}"/>` +
    trs.join("") +
    "</hp:tbl>"
  );
}

const BLANK_PNG = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAgAAAALCAIAAADN+VtyAAAAD0lEQVR4nGP4jwMwjFgJAEeKBwhw8nN4AAAAAElFTkSuQmCC",
  "base64",
);

export interface HwpxOptions {
  baseDir?: string;
  docTitle?: string;
}

export function buildDrillLogHwpx(doc: DrillDoc, opts: HwpxOptions = {}): Buffer {
  const base = opts.baseDir ?? HWPX_BASE_DIR;
  const read = (p: string) => fs.readFileSync(path.join(base, p), "utf8");
  const H = new Header(read("Contents/header.xml"));
  const secTpl = read("Contents/section0.xml");

  const cpTitle = H.char("title", SIZE.title, true);
  const cpAppTitle = H.char("app_title", SIZE.appendixTitle, true);
  const cpSub = H.char("sub", SIZE.sub, true);
  const cpSubN = H.char("sub_n", SIZE.cell);
  const cpFoot = H.char("foot", SIZE.foot);
  const ppTitle = H.para("title", "CENTER", 120, 0, hu(4));
  // 간격: 붙임 제목 → 부제 1.5mm, 부제 → 표 2mm, 표 → 주석 1.5mm(주석 줄 사이는 0)
  const ppAppTitle = H.para("app_title", "LEFT", 120, 0, hu(1.5));
  const ppSubR = H.para("sub_r", "RIGHT", 120, 0, hu(1.5));
  const ppSubL = H.para("sub_l2", "LEFT", 120, 0, hu(2));
  const ppTbl = H.para("tblwrap", "LEFT", 100);
  const ppFoot = H.para("foot", "LEFT", 130, hu(1.5), 0);
  const ppFootN = H.para("foot_n", "LEFT", 130, 0, 0);

  // 첫 문단: 쪽 설정(secPr) + 첫 쪽 제목. 쪽 번호 없음, 여백 = 배치 정의
  const first = secTpl.slice(secTpl.indexOf("<hp:p "), secTpl.indexOf("</hp:p>") + "</hp:p>".length);
  let secPr = /<hp:secPr [\s\S]*?<\/hp:secPr>/.exec(first)?.[0];
  const colCtrl = /<hp:ctrl><hp:colPr [\s\S]*?<\/hp:ctrl>/.exec(first)?.[0];
  if (!secPr || !colCtrl) throw new Error("양식의 쪽 설정을 찾을 수 없습니다.");
  const m = PAGE.margin;
  secPr = secPr
    .replace(/<hp:margin [^>]*\/>/, `<hp:margin header="0" footer="0" gutter="0" left="${hu(m.left)}" right="${hu(m.right)}" top="${hu(m.top)}" bottom="${hu(m.bottom)}"/>`)
    .replace(/<hp:pagePr [^>]*>/, `<hp:pagePr landscape="WIDELY" width="${hu(PAGE.w)}" height="${hu(PAGE.h)}" gutterType="LEFT_ONLY">`);

  const p = (pp: number, cp: number, text: string, pageBreak = false) =>
    `<hp:p id="0" paraPrIDRef="${pp}" styleIDRef="0" pageBreak="${pageBreak ? 1 : 0}" columnBreak="0" merged="0">` +
    `<hp:run charPrIDRef="${cp}">${text ? `<hp:t>${xmlText(text)}</hp:t>` : "<hp:t/>"}</hp:run></hp:p>`;

  const body: string[] = [];
  doc.pages.forEach((pg, i) => {
    const main = pg.titleKind === "main";
    if (i === 0) {
      body.push(
        `<hp:p id="0" paraPrIDRef="${main ? ppTitle : ppAppTitle}" styleIDRef="0" pageBreak="0" columnBreak="0" merged="0">` +
          `<hp:run charPrIDRef="${main ? cpTitle : cpAppTitle}">${secPr}${colCtrl}</hp:run>` +
          `<hp:run charPrIDRef="${main ? cpTitle : cpAppTitle}"><hp:t>${xmlText(pg.title)}</hp:t></hp:run></hp:p>`,
      );
    } else {
      body.push(p(main ? ppTitle : ppAppTitle, main ? cpTitle : cpAppTitle, pg.title, true));
    }
    body.push(p(main ? ppSubR : ppSubL, main ? cpSub : cpSubN, pg.subtitle));
    body.push(
      `<hp:p id="0" paraPrIDRef="${ppTbl}" styleIDRef="0" pageBreak="0" columnBreak="0" merged="0">` +
        `<hp:run charPrIDRef="${cpSubN}">${tableXml(pg.table, H, 1990000001 + i)}<hp:t/></hp:run></hp:p>`,
    );
    if (pg.footnote) pg.footnote.split("\n").forEach((line, k) => body.push(p(k === 0 ? ppFoot : ppFootN, cpFoot, line)));
  });

  const section = secTpl.slice(0, secTpl.indexOf("<hp:p ")) + body.join("") + "</hs:sec>";
  const title = xmlText(opts.docTitle ?? doc.pages[0]?.title ?? "비상대피훈련일지");
  let hpf = read("Contents/content.hpf");
  hpf = hpf.replace(/<opf:title\/>|<opf:title>[\s\S]*?<\/opf:title>/, `<opf:title>${title}</opf:title>`);
  hpf = hpf.replace(/(<opf:meta name="(?:creator|lastsaveby)" content="text">)[\s\S]*?(<\/opf:meta>)/g, "$1SAFE SCHOOL$2");
  let settings = read("settings.xml");
  settings = settings.replace(/<ha:CaretPosition [^>]*\/>/, '<ha:CaretPosition listIDRef="0" paraIDRef="0" pos="0"/>');
  const plain = doc.pages.flatMap((pg) => [pg.title, pg.subtitle, ...pg.table.cells.filter((c) => c.text).map((c) => c.text.replace(/\n/g, " "))]).join("\n").slice(0, 1000);

  const entries: ZipEntry[] = [
    { name: "mimetype", data: Buffer.from(read("mimetype").trim(), "utf8"), store: true },
    { name: "version.xml", data: Buffer.from(read("version.xml"), "utf8") },
    { name: "Contents/header.xml", data: Buffer.from(H.render(), "utf8") },
    { name: "Contents/section0.xml", data: Buffer.from(section, "utf8") },
    { name: "Contents/content.hpf", data: Buffer.from(hpf, "utf8") },
    { name: "settings.xml", data: Buffer.from(settings, "utf8") },
    { name: "Preview/PrvText.txt", data: Buffer.from(plain, "utf8") },
    { name: "Preview/PrvImage.png", data: BLANK_PNG },
    { name: "META-INF/container.xml", data: Buffer.from(read("META-INF/container.xml"), "utf8") },
    { name: "META-INF/container.rdf", data: Buffer.from(read("META-INF/container.rdf"), "utf8") },
    { name: "META-INF/manifest.xml", data: Buffer.from(read("META-INF/manifest.xml"), "utf8") },
  ];
  return buildZip(entries);
}
