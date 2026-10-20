# SAFE SCHOOL AI 협업 개발 기록 → 한글(HWPX) + 같은 내용의 PDF 미리보기
# 한글 양식: 사용자가 첨부한 공고문 HWPX의 패키지 구조·쪽 설정·글꼴 목록을 그대로 쓰고,
#            스타일(글자·문단·테두리)만 새 번호로 덧붙인 뒤 본문(section0)을 새로 씁니다.
#
# 사용법: python3 tools/portfolio/hwpx_report.py <내용파일.py> <출력폴더> [파일이름(확장자 없이)]
#   내용파일은 doc 목록을 만듭니다(예: tools/portfolio/days/2026-10-20/report_content.py).
#   출력: <이름>.hwpx, <이름>_미리보기.pdf(Playwright가 있으면), report.html
import html, os, re, shutil, sys, tempfile, zipfile

HERE = os.path.dirname(os.path.abspath(__file__))
CONTENT = sys.argv[1]
OUT = sys.argv[2]
BASENAME = sys.argv[3] if len(sys.argv) > 3 else os.path.basename(os.path.dirname(os.path.abspath(CONTENT)))
os.makedirs(OUT, exist_ok=True)
TPL = tempfile.mkdtemp(prefix="hwpx_tpl_")
with zipfile.ZipFile(os.path.join(HERE, "template", "hwpx_template.hwpx")) as _z:
    _z.extractall(TPL)

# ───────────────────────── 색 ─────────────────────────
NAVY, TEAL, INK, MUTED, LINE = "#183153", "#176A80", "#172B4D", "#4A5B78", "#B8C2D0"
FILLS = {
    "none": None, "head": NAVY, "light": "#F3F6FA", "white": "#FFFFFF",
    "claude": "#E6F2F5", "chatgpt": "#EAF4E4", "github": "#ECECF3", "replit": "#FEF3E2",
    "orig": "#E7EDF5", "summary": "#FFF4D6", "missing": "#FDECEA", "ok": "#E3F2EA", "warn": "#FEF3E2",
    "quote": "#F6F8FB", "kpi": "#EEF3F9",
}
SRC_FILL = {"Claude": "claude", "ChatGPT": "chatgpt", "GitHub": "github", "Replit": "replit"}
GRADE_FILL = {"원문": "orig", "원문(첨부)": "orig", "AI 요약": "summary", "미확보": "missing"}

# ───────────────────────── 내용 모델 ─────────────────────────
# 내용 파일 안에서 C(), H(), Q(), A() 와 색 상수를 그대로 쓸 수 있습니다.
# 블록: ("title", text) ("sub", text) ("h1", text) ("h2", text) ("p", text) ("small", text)
#       ("table", widths(%), rows) — row = list of cells; cell = dict(t, fill, bold, color, align, span)
#       ("quote", label, text) ("pagebreak",)
def C(t, fill="white", bold=False, color=None, align="L", span=1):
    return {"t": t, "fill": fill, "bold": bold, "color": color, "align": align, "span": span}

def H(*names):
    return [C(n, "head", True, "#FFFFFF", "C") for n in names]

doc = []
A = doc.append
def Q(label, text):
    A(("quote", label, text))
exec(compile(open(CONTENT, encoding="utf-8").read(), CONTENT, "exec"))

# ───────────────────────── HWPX 생성 ─────────────────────────
header = open(f"{TPL}/Contents/header.xml", encoding="utf-8").read()
section_tpl = open(f"{TPL}/Contents/section0.xml", encoding="utf-8").read()

def next_id(tag):
    return max(int(x) for x in re.findall(rf'<hh:{tag} id="(\d+)"', header)) + 1

# 테두리·채우기
bf_start = next_id("borderFill")
BF = {}
bf_xml = []
def border_fill(key, fill, border=True):
    i = bf_start + len(BF)
    BF[key] = i
    b = 'type="SOLID" width="0.12 mm" color="%s"' % LINE if border else 'type="NONE" width="0.1 mm" color="#000000"'
    face = fill if fill else "none"
    hatch = "#999999" if fill else "#FF000000"
    bf_xml.append(f'<hh:borderFill id="{i}" threeD="0" shadow="0" centerLine="NONE" breakCellSeparateLine="0"><hh:slash type="NONE" Crooked="0" isCounter="0"/><hh:backSlash type="NONE" Crooked="0" isCounter="0"/><hh:leftBorder {b}/><hh:rightBorder {b}/><hh:topBorder {b}/><hh:bottomBorder {b}/><hh:diagonal type="SOLID" width="0.1 mm" color="#000000"/><hc:fillBrush><hc:winBrush faceColor="{face}" hatchColor="{hatch}" alpha="0"/></hc:fillBrush></hh:borderFill>')
border_fill("tbl", None, False)
for k, v in FILLS.items():
    border_fill(k, v)
border_fill("quote_box", FILLS["quote"])

# 글자 모양(맑은 고딕 id 3)
cp_start = next_id("charPr")
CP = {}
cp_xml = []
def char_pr(key, size, color, bold=False):
    i = cp_start + len(CP)
    CP[key] = i
    cp_xml.append(
        f'<hh:charPr id="{i}" height="{size}" textColor="{color}" shadeColor="none" useFontSpace="0" useKerning="0" symMark="NONE" borderFillIDRef="2">'
        '<hh:fontRef hangul="3" latin="3" hanja="3" japanese="3" other="3" symbol="3" user="3"/>'
        '<hh:ratio hangul="100" latin="100" hanja="100" japanese="100" other="100" symbol="100" user="100"/>'
        '<hh:spacing hangul="0" latin="0" hanja="0" japanese="0" other="0" symbol="0" user="0"/>'
        '<hh:relSz hangul="100" latin="100" hanja="100" japanese="100" other="100" symbol="100" user="100"/>'
        '<hh:offset hangul="0" latin="0" hanja="0" japanese="0" other="0" symbol="0" user="0"/>'
        + ("<hh:bold/>" if bold else "") +
        '<hh:underline type="NONE" shape="SOLID" color="#000000"/><hh:strikeout shape="NONE" color="#000000"/><hh:outline type="NONE"/>'
        '<hh:shadow type="NONE" color="#B2B2B2" offsetX="10" offsetY="10"/></hh:charPr>')
STYLE = {  # key: (size, color, bold)
    "title": (2200, NAVY, True), "sub": (1050, MUTED, False), "h1": (1500, NAVY, True), "h2": (1150, TEAL, True),
    "p": (1000, INK, False), "small": (880, MUTED, False), "quote_label": (900, TEAL, True), "quote": (980, INK, False),
}
for k, (sz, col, b) in STYLE.items():
    char_pr(k, sz, col, b)
def cell_cp(bold, color, big=False):
    key = f"cell_{bold}_{color}_{big}"
    if key not in CP:
        char_pr(key, 1700 if big else 900, color or INK, bold)
    return CP[key]

# 문단 모양: 37번(가운데)을 복사해 정렬·줄간격·간격만 바꿈
pp_start = next_id("paraPr")
base_pp = re.search(r'<hh:paraPr id="37".*?</hh:paraPr>', header, re.S).group(0)
PP = {}
pp_xml = []
def para_pr(key, align, line, prev=0, nxt=0, left=0):
    i = pp_start + len(PP)
    PP[key] = i
    x = re.sub(r'<hh:paraPr id="37"', f'<hh:paraPr id="{i}"', base_pp)
    x = x.replace('horizontal="CENTER"', f'horizontal="{align}"')
    x = x.replace('<hh:lineSpacing type="PERCENT" value="110" unit="HWPUNIT"/>', f'<hh:lineSpacing type="PERCENT" value="{line}" unit="HWPUNIT"/>')
    x = x.replace('<hc:prev value="0" unit="HWPUNIT"/>', f'<hc:prev value="{prev}" unit="HWPUNIT"/>')
    x = x.replace('<hc:next value="0" unit="HWPUNIT"/>', f'<hc:next value="{nxt}" unit="HWPUNIT"/>')
    x = x.replace('<hc:left value="0" unit="HWPUNIT"/>', f'<hc:left value="{left}" unit="HWPUNIT"/>')
    pp_xml.append(x)
para_pr("title", "LEFT", 130, 0, 400)
para_pr("sub", "LEFT", 140, 0, 900)
para_pr("h1", "LEFT", 130, 1400, 500)
para_pr("h2", "LEFT", 130, 600, 300)
para_pr("p", "JUSTIFY", 160, 0, 300)
para_pr("small", "LEFT", 150, 300, 300)
para_pr("cellL", "LEFT", 135)
para_pr("cellC", "CENTER", 135)
para_pr("tblwrap", "LEFT", 100, 0, 200)

def add_items(xml, tag, plural, items):
    m = re.search(rf'<hh:{plural} itemCnt="(\d+)">', xml)
    cnt = int(m.group(1)) + len(items)
    xml = xml.replace(m.group(0), f'<hh:{plural} itemCnt="{cnt}">', 1)
    return xml.replace(f"</hh:{plural}>", "".join(items) + f"</hh:{plural}>", 1)
header = add_items(header, "borderFill", "borderFills", bf_xml)
header = add_items(header, "charPr", "charProperties", cp_xml)
header = add_items(header, "paraPr", "paraProperties", pp_xml)

TEXT_W = 59528 - 5669 * 2  # 쪽 너비 - 좌우 여백 = 48190
def esc(t):
    return html.escape(t, quote=False)
def runs_text(t):
    return "<hp:lineBreak/>".join(esc(x) for x in t.split("\n"))

def para(style, text, page_break=False):
    return (f'<hp:p id="0" paraPrIDRef="{PP[style]}" styleIDRef="0" pageBreak="{1 if page_break else 0}" columnBreak="0" merged="0">'
            f'<hp:run charPrIDRef="{CP[style]}"><hp:t>{runs_text(text)}</hp:t></hp:run></hp:p>')

tbl_id = [1900000000]
def table(widths, rows):
    tbl_id[0] += 1
    total = TEXT_W - 400
    cols = [round(total * w / sum(widths)) for w in widths]
    ncols = len(cols)
    out = []
    for ri, row in enumerate(rows):
        col = 0
        cells = []
        for c in row:
            span = c.get("span", 1)
            w = sum(cols[col:col + span])
            big = c["fill"] == "kpi" and c["bold"]
            pp = PP["cellC"] if c["align"] == "C" else PP["cellL"]
            cp = cell_cp(c["bold"], c["color"], big)
            lines = c["t"].split("\n")
            paras = "".join(
                f'<hp:p id="2147483648" paraPrIDRef="{pp}" styleIDRef="0" pageBreak="0" columnBreak="0" merged="0"><hp:run charPrIDRef="{cell_cp(True, TEAL) if (c.get("label") and li == 0) else cp}"><hp:t>{esc(line)}</hp:t></hp:run></hp:p>'
                for li, line in enumerate(lines))
            cells.append(
                f'<hp:tc name="" header="{1 if ri == 0 and c["fill"] == "head" else 0}" hasMargin="1" protect="0" editable="0" dirty="0" borderFillIDRef="{BF[c["fill"]]}">'
                f'<hp:subList id="" textDirection="HORIZONTAL" lineWrap="BREAK" vertAlign="CENTER" linkListIDRef="0" linkListNextIDRef="0" textWidth="0" textHeight="0" hasTextRef="0" hasNumRef="0">{paras}</hp:subList>'
                f'<hp:cellAddr colAddr="{col}" rowAddr="{ri}"/><hp:cellSpan colSpan="{span}" rowSpan="1"/><hp:cellSz width="{w}" height="1400"/>'
                f'<hp:cellMargin left="420" right="420" top="230" bottom="230"/></hp:tc>')
            col += span
        assert col == ncols, (row, col, ncols)
        out.append("<hp:tr>" + "".join(cells) + "</hp:tr>")
    height = 1400 * len(rows)
    tbl = (f'<hp:tbl id="{tbl_id[0]}" zOrder="{tbl_id[0] - 1900000000}" numberingType="TABLE" textWrap="TOP_AND_BOTTOM" textFlow="BOTH_SIDES" lock="0" dropcapstyle="None" pageBreak="CELL" repeatHeader="1" rowCnt="{len(rows)}" colCnt="{ncols}" cellSpacing="0" borderFillIDRef="{BF["tbl"]}" noAdjust="0">'
           f'<hp:sz width="{sum(cols)}" widthRelTo="ABSOLUTE" height="{height}" heightRelTo="ABSOLUTE" protect="0"/>'
           '<hp:pos treatAsChar="1" affectLSpacing="0" flowWithText="1" allowOverlap="0" holdAnchorAndSO="0" vertRelTo="PARA" horzRelTo="PARA" vertAlign="TOP" horzAlign="LEFT" vertOffset="0" horzOffset="0"/>'
           '<hp:outMargin left="0" right="0" top="0" bottom="0"/><hp:inMargin left="420" right="420" top="230" bottom="230"/>'
           + "".join(out) + "</hp:tbl>")
    return (f'<hp:p id="0" paraPrIDRef="{PP["tblwrap"]}" styleIDRef="0" pageBreak="0" columnBreak="0" merged="0">'
            f'<hp:run charPrIDRef="{CP["p"]}">{tbl}<hp:t/></hp:run></hp:p>')

body = []
pending_break = False
for b in doc:
    kind = b[0]
    if kind == "pagebreak":
        pending_break = True
        continue
    if kind in ("title", "sub", "h1", "h2", "p", "small"):
        body.append(para(kind, b[1], pending_break))
    elif kind == "table":
        body.append(table(b[1], b[2]))
    elif kind == "quote":
        body.append(table([100], [[{"t": b[1] + "\n" + b[2], "fill": "quote_box", "bold": False, "color": INK, "align": "L", "span": 1, "label": True}]]))
    pending_break = False

# 첫 문단: 공고문 양식의 쪽 설정(secPr)·단 설정·쪽 번호를 그대로 쓰고, 글자만 제목으로 바꿈
first_end = section_tpl.find("</hp:p>") + len("</hp:p>")
first = section_tpl[section_tpl.find("<hp:p "):first_end]
first = re.sub(r'<hp:run charPrIDRef="55"><hp:t>.*?</hp:t></hp:run>', f'<hp:run charPrIDRef="{CP["title"]}"><hp:t>{esc("SAFE SCHOOL AI 협업 개발 기록")}</hp:t></hp:run>', first, flags=re.S)
first = re.sub(r'<hp:linesegarray>.*?</hp:linesegarray>', "", first, flags=re.S)
first = re.sub(r'paraPrIDRef="\d+"', f'paraPrIDRef="{PP["title"]}"', first, count=1)
open_tag = section_tpl[:section_tpl.find("<hp:p ")]
section = open_tag + first + "".join(body[1:]) + "</hs:sec>"  # body[0] = 제목(첫 문단에 넣음)

build = f"{OUT}/_hwpx"
shutil.rmtree(build, ignore_errors=True)
shutil.copytree(TPL, build)
open(f"{build}/Contents/header.xml", "w", encoding="utf-8").write(header)
open(f"{build}/Contents/section0.xml", "w", encoding="utf-8").write(section)
hpf = open(f"{build}/Contents/content.hpf", encoding="utf-8").read()
hpf = re.sub(r"<opf:title>.*?</opf:title>", "<opf:title>SAFE SCHOOL AI 협업 개발 기록</opf:title>", hpf)
hpf = re.sub(r'(<opf:meta name="creator" content="text">).*?(</opf:meta>)', r"\1SAFE SCHOOL\2", hpf)
hpf = re.sub(r'(<opf:meta name="lastsaveby" content="text">).*?(</opf:meta>)', r"\1SAFE SCHOOL\2", hpf)
open(f"{build}/Contents/content.hpf", "w", encoding="utf-8").write(hpf)
plain = []
for b in doc:
    if b[0] in ("title", "sub", "h1", "h2", "p", "small"):
        plain.append(b[1])
    elif b[0] == "table":
        plain.extend(" | ".join(c["t"].replace("\n", " ") for c in r) for r in b[2])
    elif b[0] == "quote":
        plain.append(b[1] + " " + b[2])
open(f"{build}/Preview/PrvText.txt", "w", encoding="utf-8").write("\r\n".join(plain)[:1024])

target = f"{OUT}/{BASENAME}.hwpx"
if os.path.exists(target):
    os.remove(target)
with zipfile.ZipFile(target, "w") as z:
    z.write(f"{build}/mimetype", "mimetype", compress_type=zipfile.ZIP_STORED)  # 규약: 첫 항목·비압축
    for root, _, files in os.walk(build):
        for f in sorted(files):
            p = os.path.join(root, f)
            rel = os.path.relpath(p, build)
            if rel != "mimetype":
                z.write(p, rel, compress_type=zipfile.ZIP_DEFLATED)

# ───────────────────────── 같은 내용 HTML(PDF·미리보기용) ─────────────────────────
css = f"""@page{{size:A4;margin:15mm 20mm 15mm 20mm}}body{{font-family:'Malgun Gothic','Noto Sans CJK KR','Noto Sans KR',sans-serif;color:{INK};font-size:10pt;line-height:1.55;margin:0}}
h1.t{{font-size:22pt;color:{NAVY};margin:0 0 4pt}}.sub{{color:{MUTED};font-size:10.5pt;margin:0 0 14pt}}h2{{font-size:15pt;color:{NAVY};margin:18pt 0 6pt;page-break-after:avoid}}h3{{font-size:11.5pt;color:{TEAL};margin:10pt 0 4pt}}
.small{{color:{MUTED};font-size:8.8pt;margin:4pt 0 6pt}}table{{border-collapse:collapse;width:100%;margin:2pt 0 8pt;page-break-inside:auto}}tr{{page-break-inside:avoid}}td,th{{border:0.12mm solid {LINE};padding:3pt 5pt;font-size:9pt;vertical-align:middle;white-space:pre-line}}
.pb{{page-break-before:always}}"""
def qcell(c):
    if not c.get('label'): return esc(c['t'])
    head, _, rest = c['t'].partition('\n')
    return f"<b style='color:{TEAL}'>{esc(head)}</b>\n{esc(rest)}"
hb = [f"<!doctype html><html lang='ko'><head><meta charset='utf-8'><style>{css}</style></head><body>"]
pb = False
for b in doc:
    k = b[0]
    cls = " class='pb'" if pb else ""
    if k == "pagebreak":
        pb = True
        continue
    if k == "title": hb.append(f"<h1 class='t'{cls}>{esc(b[1])}</h1>")
    elif k == "sub": hb.append(f"<p class='sub'>{esc(b[1])}</p>")
    elif k == "h1": hb.append(f"<h2{cls}>{esc(b[1])}</h2>")
    elif k == "h2": hb.append(f"<h3>{esc(b[1])}</h3>")
    elif k in ("p", "small"): hb.append(f"<p class='{k}'>{esc(b[1])}</p>")
    elif k in ("table", "quote"):
        widths, rows = (b[1], b[2]) if k == "table" else ([100], [[{"t": b[1] + "\n" + b[2], "fill": "quote", "bold": False, "color": INK, "align": "L", "span": 1, "label": True}]])
        t = ["<table><colgroup>" + "".join(f"<col style='width:{w}%'>" for w in widths) + "</colgroup>"]
        for r in rows:
            t.append("<tr>" + "".join(
                f"<td colspan='{c.get('span',1)}' style='background:{FILLS.get(c['fill']) or '#fff'};color:{c['color'] or INK};font-weight:{700 if c['bold'] else 400};text-align:{'center' if c['align']=='C' else 'left'};{'font-size:17pt' if c['fill']=='kpi' and c['bold'] else ''}'>{qcell(c)}</td>" for c in r) + "</tr>")
        t.append("</table>")
        hb.append("".join(t))
    pb = False
hb.append("</body></html>")
open(f"{OUT}/report.html", "w", encoding="utf-8").write("".join(hb))
try:
    import asyncio
    from playwright.async_api import async_playwright
    async def _pdf():
        async with async_playwright() as p:
            b = await p.chromium.launch(); pg = await b.new_page()
            await pg.goto("file://" + os.path.abspath(f"{OUT}/report.html"))
            await pg.pdf(path=f"{OUT}/{BASENAME}_미리보기.pdf", format="A4", print_background=True,
                         margin={"top": "15mm", "bottom": "15mm", "left": "18mm", "right": "18mm"}, display_header_footer=True,
                         header_template="<span></span>", footer_template="<div style='font-size:8px;width:100%;text-align:center;color:#4A5B78'>- <span class='pageNumber'></span> -</div>")
            await b.close()
    asyncio.run(_pdf())
except Exception as e:  # Playwright가 없으면 HTML만 남김
    print("[미리보기 PDF 생략]", e)
shutil.rmtree(TPL, ignore_errors=True)
shutil.rmtree(build, ignore_errors=True)
print(target, os.path.getsize(target))
print("borderFill", bf_start, "charPr", cp_start, "paraPr", pp_start)
