# 비상대피훈련일지 HWPX + 비교용 PDF 만들기(앱 미연결 도구)
# 사용: python3 tools/hwpx/build_drill_log.py <데이터.json> <출력폴더> [inline|appendix]
#   출력: SAFE_SCHOOL_비상대피훈련일지_개선본[_붙임형].hwpx, ..._비교용.pdf(Playwright가 있을 때), ..._비교용.html
import json, os, sys
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from drill_log_layout import build_layout, check_layout
from hwpx_writer import render_html, write_hwpx

data_path, out_dir = sys.argv[1], sys.argv[2]
mode = sys.argv[3] if len(sys.argv) > 3 else "inline"
data = json.load(open(data_path, encoding="utf-8"))
L = build_layout(data, class_table=mode)
errs = check_layout(L) + (check_layout(L.appendix) if L.appendix else [])
if errs:
    sys.exit("배치 오류:\n" + "\n".join(errs))
name = "SAFE_SCHOOL_비상대피훈련일지_개선본" + ("_붙임형" if mode == "appendix" else "")
os.makedirs(out_dir, exist_ok=True)
note = "비교용 PDF: HWPX와 같은 배치 정의(tools/hwpx)로 브라우저에서 그린 것입니다. 한글 프로그램 렌더링 결과가 아닙니다."
html_path = os.path.join(out_dir, name + "_비교용.html")
open(html_path, "w", encoding="utf-8").write(render_html(L, note))
png = None
try:
    from playwright.sync_api import sync_playwright
    with sync_playwright() as p:
        b = p.chromium.launch()
        pg = b.new_page()
        pg.goto("file://" + os.path.abspath(html_path))
        pg.pdf(path=os.path.join(out_dir, name + "_비교용.pdf"), format="A4", prefer_css_page_size=True, print_background=True)
        pg.set_viewport_size({"width": 794, "height": 1123})
        png = pg.screenshot(clip={"x": 0, "y": 0, "width": 794, "height": 1123})
        b.close()
except Exception as e:  # PDF는 선택 사항
    print("[비교용 PDF 생략]", e)
write_hwpx(L, os.path.join(out_dir, name + ".hwpx"), preview_png=png)
print("완료:", name, f"행 {len(L.rows_mm)} · 표 높이 {sum(L.rows_mm):.1f}mm")
