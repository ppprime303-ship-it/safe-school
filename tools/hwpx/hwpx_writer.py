# 배치 정의(Layout) → HWPX(한글) / HTML(비교용) 그리기. 표준 라이브러리만 사용.
# HWPX 구조: base_template.hwpx(대회 공고문 HWPX의 패키지·글꼴·스타일 목록)에 이 문서용 글자·문단·테두리 모양을 덧붙이고
#            본문(section0.xml)을 새로 씁니다. 표는 한글의 일반 표(셀 병합 포함)로 만들어 한글에서 직접 편집할 수 있습니다.
# 한글 프로그램으로 연 결과는 이 도구로 검증할 수 없습니다(사용자 확인 필요).
from __future__ import annotations

import html
import io
import os
import re
import shutil
import struct
import tempfile
import zipfile
import zlib

from drill_log_layout import COL_PCT, FONT, MARGIN, MM, PAGE_H, PAGE_W, SIZE, TABLE_W, Layout

HERE = os.path.dirname(os.path.abspath(__file__))
TEMPLATE = os.path.join(HERE, "base_template.hwpx")

FILL = {"label": "#F2F2F2", "head": "#F2F2F2", "band": "#E4E4E4", "value": "#FFFFFF"}
LINE_W = "0.12 mm"
OUTER_W = "0.4 mm"


def hu(mm: float) -> int:
    return int(round(mm * MM))


def esc(t: str) -> str:
    return html.escape(t, quote=False)


def _blank_png(w=8, h=11) -> bytes:
    raw = b"".join(b"\x00" + b"\xff\xff\xff" * w for _ in range(h))
    def chunk(t, d):
        return struct.pack(">I", len(d)) + t + d + struct.pack(">I", zlib.crc32(t + d) & 0xFFFFFFFF)
    return b"\x89PNG\r\n\x1a\n" + chunk(b"IHDR", struct.pack(">IIBBBBB", w, h, 8, 2, 0, 0, 0)) + chunk(b"IDAT", zlib.compress(raw)) + chunk(b"IEND", b"")


class _Header:
    """header.xml에 이 문서용 borderFill·charPr·paraPr를 새 번호로 덧붙입니다."""

    def __init__(self, xml: str):
        self.xml = xml
        self.bf, self.cp, self.pp = {}, {}, {}
        self._bf, self._cp, self._pp = [], [], []
        self.font_id = self._font_id(FONT)
        self.base_pp = re.search(r'<hh:paraPr id="37".*?</hh:paraPr>', xml, re.S).group(0)

    def _font_id(self, face):
        m = re.search(rf'<hh:fontface lang="HANGUL".*?<hh:font id="(\d+)" face="{re.escape(face)}"', self.xml, re.S)
        return int(m.group(1)) if m else 0

    def _next(self, tag, pending):
        return max(int(x) for x in re.findall(rf'<hh:{tag} id="(\d+)"', self.xml)) + 1 + len(pending)

    def border(self, key, fill, left=LINE_W, right=LINE_W, top=LINE_W, bottom=LINE_W, none=False):
        if key in self.bf:
            return self.bf[key]
        i = self._next("borderFill", self._bf)
        def b(w):
            return 'type="NONE" width="0.1 mm" color="#000000"' if none else f'type="SOLID" width="{w}" color="#000000"'
        face, hatch = (fill, "#999999") if fill else ("none", "#FF000000")
        self._bf.append(
            f'<hh:borderFill id="{i}" threeD="0" shadow="0" centerLine="NONE" breakCellSeparateLine="0">'
            '<hh:slash type="NONE" Crooked="0" isCounter="0"/><hh:backSlash type="NONE" Crooked="0" isCounter="0"/>'
            f'<hh:leftBorder {b(left)}/><hh:rightBorder {b(right)}/><hh:topBorder {b(top)}/><hh:bottomBorder {b(bottom)}/>'
            '<hh:diagonal type="SOLID" width="0.1 mm" color="#000000"/>'
            f'<hc:fillBrush><hc:winBrush faceColor="{face}" hatchColor="{hatch}" alpha="0"/></hc:fillBrush></hh:borderFill>')
        self.bf[key] = i
        return i

    def char(self, key, pt, bold=False, color="#000000"):
        if key in self.cp:
            return self.cp[key]
        i = self._next("charPr", self._cp)
        f = self.font_id
        self._cp.append(
            f'<hh:charPr id="{i}" height="{int(pt * 100)}" textColor="{color}" shadeColor="none" useFontSpace="0" useKerning="0" symMark="NONE" borderFillIDRef="2">'
            f'<hh:fontRef hangul="{f}" latin="{f}" hanja="{f}" japanese="{f}" other="{f}" symbol="{f}" user="{f}"/>'
            '<hh:ratio hangul="100" latin="100" hanja="100" japanese="100" other="100" symbol="100" user="100"/>'
            '<hh:spacing hangul="0" latin="0" hanja="0" japanese="0" other="0" symbol="0" user="0"/>'
            '<hh:relSz hangul="100" latin="100" hanja="100" japanese="100" other="100" symbol="100" user="100"/>'
            '<hh:offset hangul="0" latin="0" hanja="0" japanese="0" other="0" symbol="0" user="0"/>'
            + ("<hh:bold/>" if bold else "")
            + '<hh:underline type="NONE" shape="SOLID" color="#000000"/><hh:strikeout shape="NONE" color="#000000"/><hh:outline type="NONE"/>'
            '<hh:shadow type="NONE" color="#B2B2B2" offsetX="10" offsetY="10"/></hh:charPr>')
        self.cp[key] = i
        return i

    def para(self, key, align, line=130, prev=0, nxt=0):
        if key in self.pp:
            return self.pp[key]
        i = self._next("paraPr", self._pp)
        x = re.sub(r'<hh:paraPr id="37"', f'<hh:paraPr id="{i}"', self.base_pp)
        x = x.replace('horizontal="CENTER"', f'horizontal="{align}"')
        x = re.sub(r'<hh:lineSpacing type="PERCENT" value="\d+" unit="HWPUNIT"/>', f'<hh:lineSpacing type="PERCENT" value="{line}" unit="HWPUNIT"/>', x)
        x = re.sub(r'<hc:prev value="\d+" unit="HWPUNIT"/>', f'<hc:prev value="{prev}" unit="HWPUNIT"/>', x)
        x = re.sub(r'<hc:next value="\d+" unit="HWPUNIT"/>', f'<hc:next value="{nxt}" unit="HWPUNIT"/>', x)
        x = re.sub(r'<hc:left value="\d+" unit="HWPUNIT"/>', '<hc:left value="0" unit="HWPUNIT"/>', x)
        x = re.sub(r'<hc:intent value="-?\d+" unit="HWPUNIT"/>', '<hc:intent value="0" unit="HWPUNIT"/>', x)
        self._pp.append(x)
        self.pp[key] = i
        return i

    def render(self):
        xml = self.xml
        for plural, items in (("borderFills", self._bf), ("charProperties", self._cp), ("paraProperties", self._pp)):
            m = re.search(rf'<hh:{plural} itemCnt="(\d+)">', xml)
            xml = xml.replace(m.group(0), f'<hh:{plural} itemCnt="{int(m.group(1)) + len(items)}">', 1)
            xml = xml.replace(f"</hh:{plural}>", "".join(items) + f"</hh:{plural}>", 1)
        return xml


def _cols_hu(total_hu: int) -> list[int]:
    cols = [int(round(total_hu * p / 100)) for p in COL_PCT]
    cols[-1] += total_hu - sum(cols)  # 반올림 오차를 마지막 열에
    return cols


def _table_xml(L: Layout, H: _Header, tid: int) -> str:
    total = hu(TABLE_W)
    cols = _cols_hu(total)
    rows = [hu(h) for h in L.rows_mm]
    nrow, ncol = len(rows), len(cols)
    cp_n, cp_b = H.char("cell", SIZE["cell"]), H.char("cell_b", SIZE["cell"], True)
    pps = {a: H.para(f"cell_{a}", {"L": "LEFT", "C": "CENTER", "R": "RIGHT"}[a], 130) for a in "LCR"}
    by_row: dict[int, list] = {}
    for c in L.cells:
        by_row.setdefault(c.row, []).append(c)
    trs = []
    for r in range(nrow):
        tcs = []
        for c in sorted(by_row.get(r, []), key=lambda x: x.col):
            w = sum(cols[c.col:c.col + c.colspan])
            h = sum(rows[c.row:c.row + c.rowspan])
            # 바깥 테두리는 굵게(표 가장자리에 닿는 변만)
            edges = dict(
                left=OUTER_W if c.col == 0 else LINE_W,
                right=OUTER_W if c.col + c.colspan == ncol else LINE_W,
                top=OUTER_W if c.row == 0 else LINE_W,
                bottom=OUTER_W if c.row + c.rowspan == nrow else LINE_W,
            )
            key = f"{c.kind}|" + "|".join(edges.values())
            bf = H.border(key, FILL[c.kind], **edges)
            lines = c.text.split("\n") if c.text else [""]
            cp = cp_b if c.bold else cp_n
            paras = "".join(
                f'<hp:p id="2147483648" paraPrIDRef="{pps[c.align]}" styleIDRef="0" pageBreak="0" columnBreak="0" merged="0">'
                f'<hp:run charPrIDRef="{cp}">' + (f"<hp:t>{esc(t)}</hp:t>" if t else "<hp:t/>") + "</hp:run></hp:p>"
                for t in lines)
            tcs.append(
                f'<hp:tc name="" header="0" hasMargin="1" protect="0" editable="0" dirty="0" borderFillIDRef="{bf}">'
                f'<hp:subList id="" textDirection="HORIZONTAL" lineWrap="BREAK" vertAlign="{"TOP" if c.valign == "T" else "CENTER"}" '
                'linkListIDRef="0" linkListNextIDRef="0" textWidth="0" textHeight="0" hasTextRef="0" hasNumRef="0">'
                f"{paras}</hp:subList>"
                f'<hp:cellAddr colAddr="{c.col}" rowAddr="{c.row}"/><hp:cellSpan colSpan="{c.colspan}" rowSpan="{c.rowspan}"/>'
                f'<hp:cellSz width="{w}" height="{h}"/><hp:cellMargin left="{hu(1.6)}" right="{hu(1.6)}" top="{hu(0.6)}" bottom="{hu(0.6)}"/></hp:tc>')
        trs.append("<hp:tr>" + "".join(tcs) + "</hp:tr>")
    tbl_bf = H.border("tbl", None, none=True)
    return (f'<hp:tbl id="{tid}" zOrder="{tid % 1000}" numberingType="TABLE" textWrap="TOP_AND_BOTTOM" textFlow="BOTH_SIDES" lock="0" '
            f'dropcapstyle="None" pageBreak="CELL" repeatHeader="0" rowCnt="{nrow}" colCnt="{ncol}" cellSpacing="0" borderFillIDRef="{tbl_bf}" noAdjust="0">'
            f'<hp:sz width="{sum(cols)}" widthRelTo="ABSOLUTE" height="{sum(rows)}" heightRelTo="ABSOLUTE" protect="0"/>'
            '<hp:pos treatAsChar="1" affectLSpacing="0" flowWithText="1" allowOverlap="0" holdAnchorAndSO="0" vertRelTo="PARA" horzRelTo="PARA" '
            'vertAlign="TOP" horzAlign="LEFT" vertOffset="0" horzOffset="0"/>'
            f'<hp:outMargin left="0" right="0" top="0" bottom="0"/><hp:inMargin left="{hu(1.6)}" right="{hu(1.6)}" top="{hu(0.6)}" bottom="{hu(0.6)}"/>'
            + "".join(trs) + "</hp:tbl>")


def write_hwpx(L: Layout, out_path: str, preview_png: bytes | None = None, doc_title: str | None = None) -> None:
    tmp = tempfile.mkdtemp(prefix="hwpx_")
    with zipfile.ZipFile(TEMPLATE) as z:
        z.extractall(tmp)
    H = _Header(open(f"{tmp}/Contents/header.xml", encoding="utf-8").read())
    sec_tpl = open(f"{tmp}/Contents/section0.xml", encoding="utf-8").read()

    cp_title = H.char("title", SIZE["title"], True)
    cp_school = H.char("school", SIZE["school"], True)
    cp_small = H.char("small", SIZE["cell"])
    pp_title = H.para("title", "CENTER", 120, 0, hu(4.0))
    pp_school = H.para("school", "RIGHT", 120, 0, hu(1.5))
    pp_tbl = H.para("tblwrap", "LEFT", 100, 0, 0)
    pp_app_title = H.para("app_title", "LEFT", 120, 0, hu(1.5))

    # 첫 문단 = 쪽 설정(secPr) + 제목. 공고문 양식의 쪽 번호는 지우고 여백만 바꿈
    first = sec_tpl[sec_tpl.find("<hp:p "):sec_tpl.find("</hp:p>") + len("</hp:p>")]
    sec_pr = re.search(r"<hp:secPr .*?</hp:secPr>", first, re.S).group(0)
    sec_pr = re.sub(r'<hp:margin [^>]*/>',
                    f'<hp:margin header="0" footer="0" gutter="0" left="{hu(MARGIN["left"])}" right="{hu(MARGIN["right"])}" '
                    f'top="{hu(MARGIN["top"])}" bottom="{hu(MARGIN["bottom"])}"/>', sec_pr)
    sec_pr = re.sub(r'<hp:pagePr [^>]*>', f'<hp:pagePr landscape="WIDELY" width="{hu(PAGE_W)}" height="{hu(PAGE_H)}" gutterType="LEFT_ONLY">', sec_pr)
    col_ctrl = re.search(r"<hp:ctrl><hp:colPr .*?</hp:ctrl>", first, re.S).group(0)
    head_p = (f'<hp:p id="0" paraPrIDRef="{pp_title}" styleIDRef="0" pageBreak="0" columnBreak="0" merged="0">'
              f'<hp:run charPrIDRef="{cp_title}">{sec_pr}{col_ctrl}</hp:run>'
              f'<hp:run charPrIDRef="{cp_title}"><hp:t>{esc(L.title)}</hp:t></hp:run></hp:p>')

    def p(pp, cp, text, page_break=False):
        return (f'<hp:p id="0" paraPrIDRef="{pp}" styleIDRef="0" pageBreak="{1 if page_break else 0}" columnBreak="0" merged="0">'
                f'<hp:run charPrIDRef="{cp}">' + (f"<hp:t>{esc(text)}</hp:t>" if text else "<hp:t/>") + "</hp:run></hp:p>")

    def tbl_p(layout, tid):
        return (f'<hp:p id="0" paraPrIDRef="{pp_tbl}" styleIDRef="0" pageBreak="0" columnBreak="0" merged="0">'
                f'<hp:run charPrIDRef="{cp_small}">{_table_xml(layout, H, tid)}<hp:t/></hp:run></hp:p>')

    body = [head_p, p(pp_school, cp_school, L.school), tbl_p(L, 1990000001)]
    if L.appendix is not None:
        A = L.appendix
        body += [p(pp_app_title, cp_school, A.title, page_break=True),
                 p(pp_school, H.char("cell", SIZE["cell"]), A.school), tbl_p(A, 1990000002)]
    open_tag = sec_tpl[:sec_tpl.find("<hp:p ")]
    open(f"{tmp}/Contents/section0.xml", "w", encoding="utf-8").write(open_tag + "".join(body) + "</hs:sec>")
    open(f"{tmp}/Contents/header.xml", "w", encoding="utf-8").write(H.render())

    title = doc_title or L.title
    hpf = open(f"{tmp}/Contents/content.hpf", encoding="utf-8").read()
    hpf = re.sub(r"<opf:title>.*?</opf:title>", f"<opf:title>{esc(title)}</opf:title>", hpf, flags=re.S)
    for name in ("creator", "lastsaveby"):
        hpf = re.sub(rf'(<opf:meta name="{name}" content="text">).*?(</opf:meta>)', r"\1SAFE SCHOOL\2", hpf, flags=re.S)
    hpf = re.sub(r'(<opf:meta name="(?:subject|description|keyword)" content="text">).*?(</opf:meta>)', r"\1\2", hpf, flags=re.S)
    open(f"{tmp}/Contents/content.hpf", "w", encoding="utf-8").write(hpf)
    # 탐색기 미리보기: 공고문 그림·글자가 남지 않게 교체
    plain = [L.title, L.school] + [c.text.replace("\n", " ") for c in sorted(L.cells, key=lambda c: (c.row, c.col)) if c.text]
    open(f"{tmp}/Preview/PrvText.txt", "w", encoding="utf-8").write("\n".join(plain)[:1000])
    with open(f"{tmp}/Preview/PrvImage.png", "wb") as f:
        f.write(preview_png or _blank_png())
    # 커서 위치를 문서 처음으로(공고문 위치값 제거)
    st = open(f"{tmp}/settings.xml", encoding="utf-8").read()
    st = re.sub(r'<ha:CaretPosition [^>]*/>', '<ha:CaretPosition listIDRef="0" paraIDRef="0" pos="0"/>', st)
    open(f"{tmp}/settings.xml", "w", encoding="utf-8").write(st)

    os.makedirs(os.path.dirname(os.path.abspath(out_path)), exist_ok=True)
    with zipfile.ZipFile(out_path, "w") as z:
        z.write(f"{tmp}/mimetype", "mimetype", compress_type=zipfile.ZIP_STORED)  # mimetype은 첫 항목·무압축
        for root, _, files in os.walk(tmp):
            for f in sorted(files):
                full = os.path.join(root, f)
                arc = os.path.relpath(full, tmp)
                if arc != "mimetype":
                    z.write(full, arc, compress_type=zipfile.ZIP_DEFLATED)
    shutil.rmtree(tmp, ignore_errors=True)


def render_html(L: Layout, note: str = "") -> str:
    """같은 배치 정의를 HTML로(비교용 PDF 출력에 사용). 한글 렌더링 결과가 아닙니다."""
    def tbl(layout):
        cols = "".join(f'<col style="width:{p}%">' for p in COL_PCT)
        by_row: dict[int, list] = {}
        for c in layout.cells:
            by_row.setdefault(c.row, []).append(c)
        ncol, nrow = len(COL_PCT), len(layout.rows_mm)
        rows = []
        for r, h in enumerate(layout.rows_mm):
            tds = []
            for c in sorted(by_row.get(r, []), key=lambda x: x.col):
                st = [f"background:{FILL[c.kind]}", f"text-align:{ {'L': 'left', 'C': 'center', 'R': 'right'}[c.align]}",
                      f"vertical-align:{'top' if c.valign == 'T' else 'middle'}", "font-weight:700" if c.bold else ""]
                b = lambda edge, outer: f"border-{edge}:{'0.4mm' if outer else '0.12mm'} solid #000"
                st += [b("left", c.col == 0), b("right", c.col + c.colspan == ncol), b("top", c.row == 0), b("bottom", c.row + c.rowspan == nrow)]
                tds.append(f'<td colspan="{c.colspan}" rowspan="{c.rowspan}" style="{";".join(s for s in st if s)}">'
                           + "<br>".join(esc(t) for t in c.text.split("\n")) + "</td>")
            rows.append(f'<tr style="height:{h}mm">' + "".join(tds) + "</tr>")
        return f'<table><colgroup>{cols}</colgroup>{"".join(rows)}</table>'

    app = ""
    if L.appendix is not None:
        A = L.appendix
        app = f'<section class="page"><div class="atitle">{esc(A.title)}</div><div class="school" style="font-weight:400">{esc(A.school)}</div>{tbl(A)}</section>'
    return f"""<!doctype html><html lang="ko"><head><meta charset="utf-8"><title>{esc(L.title)} — 비교용</title><style>
@page{{size:A4;margin:{MARGIN['top']}mm {MARGIN['right']}mm {MARGIN['bottom']}mm {MARGIN['left']}mm}}
body{{margin:0;font-family:"{FONT}","Malgun Gothic","Noto Sans CJK KR","Noto Sans KR",sans-serif;color:#000}}
.page{{width:{TABLE_W}mm;page-break-after:always}} .page:last-of-type{{page-break-after:auto}}
.title{{text-align:center;font-size:{SIZE['title']}pt;font-weight:700;margin:0 0 4mm}}
.atitle{{font-size:{SIZE['school']}pt;font-weight:700;margin:0 0 1.5mm}}
.school{{text-align:right;font-size:{SIZE['school']}pt;font-weight:700;margin:0 0 1.5mm}}
table{{width:{TABLE_W}mm;border-collapse:collapse;table-layout:fixed;font-size:{SIZE['cell']}pt;line-height:1.3}}
td{{padding:0.6mm 1.6mm;overflow:hidden;white-space:pre-wrap}}
.note{{position:fixed;bottom:2mm;left:0;right:0;text-align:center;font-size:7pt;color:#777}}
</style></head><body><section class="page"><div class="title">{esc(L.title)}</div><div class="school">{esc(L.school)}</div>{tbl(L)}</section>{app}
{f'<div class="note">{esc(note)}</div>' if note else ''}</body></html>"""
