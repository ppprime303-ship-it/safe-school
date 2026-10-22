# 비상대피훈련일지 HWPX 서식 검사(표준 라이브러리 unittest). 실행: python3 tools/hwpx/test_drill_log.py
# 이 검사는 파일 구조·표 구조·데이터 정책까지만 확인합니다. 한글 프로그램에서의 열기·인쇄는 사람이 확인해야 합니다.
import copy, json, os, re, sys, tempfile, unittest, zipfile
import xml.dom.minidom

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, HERE)
from drill_log_layout import COL_PCT, build_layout, check_layout, _particle_ro  # noqa: E402
from hwpx_writer import write_hwpx  # noqa: E402

DATA = json.load(open(os.path.join(HERE, "sample_drill_data.json"), encoding="utf-8"))
NS = {"hp": "http://www.hancom.co.kr/hwpml/2011/paragraph", "hh": "http://www.hancom.co.kr/hwpml/2011/head"}


def build(mode="inline", data=DATA):
    path = os.path.join(tempfile.mkdtemp(), "t.hwpx")
    write_hwpx(build_layout(data, class_table=mode), path)
    return path


class Structure(unittest.TestCase):
    def test_zip_and_xml(self):
        for mode in ("inline", "appendix"):
            z = zipfile.ZipFile(build(mode))
            first = z.infolist()[0]
            self.assertEqual(first.filename, "mimetype")
            self.assertEqual(first.compress_type, zipfile.ZIP_STORED)
            self.assertEqual(z.read("mimetype"), b"application/hwp+zip")
            for n in z.namelist():
                if n.endswith(".xml") or n.endswith(".hpf") or n.endswith(".rdf"):
                    xml.dom.minidom.parseString(z.read(n))  # 형식 오류면 예외

    def test_table_grid(self):
        """표마다: 칸 주소·병합이 빈틈·겹침 없이 rowCnt×colCnt를 채우고, 줄마다 너비 합이 표 너비와 같음."""
        for mode in ("inline", "appendix"):
            sec = zipfile.ZipFile(build(mode)).read("Contents/section0.xml").decode("utf-8")
            tables = re.findall(r"<hp:tbl .*?</hp:tbl>", sec, re.S)
            self.assertEqual(len(tables), 2 if mode == "appendix" else 1)
            for t in tables:
                rows, cols = int(re.search(r'rowCnt="(\d+)"', t).group(1)), int(re.search(r'colCnt="(\d+)"', t).group(1))
                tw = int(re.search(r'<hp:sz width="(\d+)"', t).group(1))
                grid = [[0] * cols for _ in range(rows)]
                roww = [0] * rows
                for tc in re.findall(r"<hp:tc .*?</hp:tc>", t, re.S):
                    c, r = map(int, re.search(r'colAddr="(\d+)" rowAddr="(\d+)"', tc).groups())
                    cs, rs = map(int, re.search(r'colSpan="(\d+)" rowSpan="(\d+)"', tc).groups())
                    w = int(re.search(r'<hp:cellSz width="(\d+)"', tc).group(1))
                    for rr in range(r, r + rs):
                        roww[rr] += w
                        for cc in range(c, c + cs):
                            grid[rr][cc] += 1
                self.assertTrue(all(v == 1 for row in grid for v in row), "칸 빈틈·겹침")
                self.assertEqual(set(roww), {tw}, "줄마다 너비 합이 표 너비와 다름")
                # 각 <hp:tr>의 셀 시작 행 번호가 그 줄 번호와 같음
                for i, tr in enumerate(re.findall(r"<hp:tr>.*?</hp:tr>", t, re.S)):
                    self.assertTrue(all(int(x) == i for x in re.findall(r'rowAddr="(\d+)"', tr)))

    def test_id_refs_exist(self):
        z = zipfile.ZipFile(build())
        head = z.read("Contents/header.xml").decode("utf-8")
        sec = z.read("Contents/section0.xml").decode("utf-8")
        for attr, tag in (("charPrIDRef", "charPr"), ("paraPrIDRef", "paraPr"), ("borderFillIDRef", "borderFill")):
            have = set(re.findall(rf'<hh:{tag} id="(\d+)"', head))
            for ref in set(re.findall(rf'{attr}="(\d+)"', sec)):
                self.assertIn(ref, have, f"{attr}={ref} 없음")
        for tag, plural in (("borderFill", "borderFills"), ("charPr", "charProperties"), ("paraPr", "paraProperties")):
            cnt = int(re.search(rf'<hh:{plural} itemCnt="(\d+)"', head).group(1))
            self.assertEqual(cnt, len(re.findall(rf"<hh:{tag} id=", head)))

    def test_editable_text_not_image(self):
        z = zipfile.ZipFile(build())
        sec = z.read("Contents/section0.xml").decode("utf-8")
        self.assertNotIn("<hp:pic", sec)  # 그림 삽입 없음 — 글자·표로만 구성
        self.assertFalse(any(n.startswith("BinData/") for n in z.namelist()))
        for t in ("비상대피훈련일지(지진)", "역할담당", "평가내용", "추후 대피훈련 시", "사    진"):
            self.assertIn(t, sec)
        self.assertNotIn("pageNum", sec)  # 공고문 양식의 쪽 번호 제거
        hpf = z.read("Contents/content.hpf").decode("utf-8")
        self.assertNotIn("소방방재청", hpf)  # 양식 원본 작성자 정보 제거

    def test_layout_fits_page(self):
        for mode in ("inline", "appendix"):
            L = build_layout(DATA, class_table=mode)
            self.assertEqual(check_layout(L), [])
        self.assertAlmostEqual(sum(COL_PCT), 100, places=2)


class Policy(unittest.TestCase):
    def texts(self, data=DATA, mode="inline"):
        return [c.text for c in build_layout(data, class_table=mode).cells]

    def test_unreported_and_no_totals(self):
        t = self.texts()
        self.assertIn("미보고", t)
        self.assertIn("총 (          )명", t)  # 총 참가 인원 비움(합산 안 함)
        self.assertTrue(any("교직원 (        )명" in x and "학생 대피 확인 51명" in x and "미보고 1개 학급 제외" in x for x in t))
        self.assertFalse(any(re.fullmatch(r"총 \d+명", x) for x in t))

    def test_manual_fields_blank(self):
        L = build_layout(DATA)
        cells = {(c.row, c.col): c for c in L.cells}
        evals = [c for c in L.cells if c.text == "□ O    □ X"]
        self.assertEqual(len(evals), 6)  # O/X는 선택 표시만, 판정 없음
        dur_row = next(c.row for c in L.cells if c.text == "대피소요 시간")
        self.assertEqual(cells[(dur_row, 1)].text, "")  # 소요 시간 계산 안 함
        refl_row = next(c.row for c in L.cells if c.text.startswith("추후 대피훈련"))
        self.assertEqual(cells[(refl_row, 1)].text, "")
        self.assertEqual(sum(1 for c in L.cells if c.text.startswith("각 반 담임")), 1)

    def test_enrolled_vs_evacuated_separate_columns(self):
        t = self.texts()
        self.assertIn("재적", t)
        self.assertIn("대피 확인", t)

    def test_missing_evac_place_left_blank(self):
        d = copy.deepcopy(DATA)
        d["event"]["evacPlace"] = None
        L = build_layout(d)
        row = next(c.row for c in L.cells if "대피(집결)장소" in c.text)
        self.assertEqual(next(c for c in L.cells if c.row == row and c.col == 1).text, "")

    def test_real_mode_label(self):
        d = copy.deepcopy(DATA)
        d["event"]["mode"] = "real"
        self.assertTrue(any("[실제 상황]" in x for x in self.texts(d)))

    def test_appendix_mode_keeps_one_page_body(self):
        L = build_layout(DATA, class_table="appendix")
        self.assertNotIn("미보고", [c.text for c in L.cells])
        self.assertIn("미보고", [c.text for c in L.appendix.cells])

    def test_particle(self):
        self.assertEqual(_particle_ro("운동장"), "운동장으로")
        self.assertEqual(_particle_ro("강당"), "강당으로")
        self.assertEqual(_particle_ro("학교 앞 놀이터"), "학교 앞 놀이터로")
        self.assertEqual(_particle_ro("체육관 2층 홀"), "체육관 2층 홀로")


if __name__ == "__main__":
    unittest.main(verbosity=2)
