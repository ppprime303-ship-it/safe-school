# STEP 3-D 비상대피훈련일지 — 배치 정의(레이아웃 모델)
# 하나의 배치 정의에서 HWPX(한글)와 HTML/PDF(비교용)를 함께 만듭니다. 앱 연결 전 도구이며 서버 코드에서 쓰지 않습니다.
#
# 자동작성 데이터 정책(1차 설계와 같음)
# - 시스템 기록으로 확인된 값만 채움(학교명·재난 유형·모의/실제·발령~종료 시각·학급별 보고)
# - 미보고 학급은 0명이 아니라 '미보고'
# - 재적과 대피 확인(참가)을 다른 칸에 둠
# - 교직원 참가 인원·총 참가 인원은 비워 둠(합산하지 않음)
# - 대피 소요 시간은 계산하지 않음(빈칸)
# - 평가 O/X·비고·반영사항·담당자(첫 행 기본값 제외)·사진은 비워 둠
from __future__ import annotations

from dataclasses import dataclass, field

MM = 283.465  # 1 mm = 283.465 HWPUNIT

PAGE_W, PAGE_H = 210.0, 297.0
MARGIN = {"left": 15.0, "right": 15.0, "top": 12.0, "bottom": 12.0}
TABLE_W = PAGE_W - MARGIN["left"] - MARGIN["right"]  # 180 mm

# 열 7개: 0 = 왼쪽 항목 제목, 1~6 = 내용(학급별 보고 6열에 맞춤). 사진 3칸이 같은 너비가 되도록 (1+2) = (3+4) = (5+6)
COL_PCT = [17.0, 15.0, 12.67, 13.0, 14.67, 13.0, 14.66]

FONT = "맑은 고딕"
SIZE = {"title": 20.0, "school": 11.0, "cell": 10.0}  # pt


@dataclass
class Cell:
    row: int
    col: int
    text: str = ""
    colspan: int = 1
    rowspan: int = 1
    kind: str = "value"  # label(회색 항목 제목) / head(회색 머리글) / band(가로 띠) / value(입력·값)
    align: str = "C"  # L / C / R
    valign: str = "C"  # T / C
    bold: bool = False


@dataclass
class Layout:
    title: str
    school: str
    rows_mm: list[float] = field(default_factory=list)
    cells: list[Cell] = field(default_factory=list)
    appendix: "Layout | None" = None  # 붙임(학급별 대피 보고)을 둘째 쪽에 둘 때

    def add_row(self, height_mm: float) -> int:
        self.rows_mm.append(height_mm)
        return len(self.rows_mm) - 1

    def put(self, **kw) -> None:
        self.cells.append(Cell(**kw))


WD = "월화수목금토일"


def _kst_parts(iso: str):
    from datetime import datetime, timedelta, timezone

    d = datetime.fromisoformat(iso).astimezone(timezone(timedelta(hours=9)))
    return d


def _particle_ro(word: str) -> str:
    """'운동장' → '운동장으로', '강당' → '강당으로', '학교 현관' → '학교 현관으로'(받침 ㄹ은 '로')."""
    ch = word.strip()[-1:] if word.strip() else ""
    if "가" <= ch <= "힣":
        jong = (ord(ch) - 0xAC00) % 28
        return word + ("로" if jong in (0, 8) else "으로")
    return word + "(으)로"


def when_text(event: dict) -> str:
    a = _kst_parts(event["startedAt"])
    s = f"{a.year}. {a.month}. {a.day}.({WD[a.weekday()]}) {a:%H:%M}"
    if event.get("closedAt"):
        b = _kst_parts(event["closedAt"])
        mins = round((b - a).total_seconds() / 60)
        s += f" ~ {b:%H:%M} (총 {mins}분)"
    else:
        s += " ~ (종료 전)"
    return s


def build_layout(data: dict, class_table: str = "inline") -> Layout:
    """class_table: inline(PDF 시제품과 같이 본문에) / appendix(본문 1쪽은 원본 형식, 학급별 보고는 붙임) / none"""
    ev = data["event"]
    mode = "모의훈련" if ev["mode"] == "drill" else "실제 상황"
    L = Layout(title=f"비상대피훈련일지({ev['typeLabel']})", school=data["schoolName"])
    classes = data["classes"]
    reported = [c for c in classes if c.get("report")]
    unreported = [c for c in classes if not c.get("report")]
    evac = sum(c["report"]["evacuated"] for c in reported)

    H = 7.4  # 기본 행 높이(mm)
    r = L.add_row(8.5)
    L.put(row=r, col=0, text="일    시", kind="label", bold=True)
    L.put(row=r, col=1, colspan=6, text=f"{when_text(ev)}   [{mode}]", align="L")

    r = L.add_row(8.5)
    L.put(row=r, col=0, text="참가인원", kind="label", bold=True)
    stu = f"학생 대피 확인 {evac}명" + (f" (미보고 {len(unreported)}개 학급 제외)" if unreported else "")
    L.put(row=r, col=1, colspan=4, text=f"교직원 (        )명  /  {stu}", align="L")
    L.put(row=r, col=5, colspan=2, text="총 (          )명")

    def class_rows(T: Layout, label_col: bool):
        start = T.add_row(H)
        base = 1 if label_col else 0
        if label_col:
            T.put(row=start, col=0, rowspan=len(classes) + 1, text="학급별\n대피 보고", kind="label", bold=True)
        for i, h in enumerate(["학급", "재적", "대피 확인", "사전 파악 부재", "미확인", "부상"]):
            T.put(row=start, col=base + i, text=h, kind="head", bold=True)
        for c in classes:
            rr = T.add_row(H)
            T.put(row=rr, col=base, text=c["label"])
            T.put(row=rr, col=base + 1, text=str(c["enrolled"]) if c.get("enrolled") is not None else "확인 필요")
            if c.get("report"):
                rep = c["report"]
                for j, k in enumerate(["evacuated", "absentKnown", "unconfirmed", "injured"]):
                    T.put(row=rr, col=base + 2 + j, text=str(rep[k]))
            else:
                T.put(row=rr, col=base + 2, colspan=4, text="미보고", bold=True)

    if class_table == "inline":
        class_rows(L, True)

    roles = data["roles"]
    r = L.add_row(H)
    L.put(row=r, col=0, rowspan=len(roles) + 1, text="역할담당", kind="label", bold=True)
    L.put(row=r, col=1, colspan=4, text="구    분", kind="head", bold=True)
    L.put(row=r, col=5, colspan=2, text="담 당 자", kind="head", bold=True)
    for role in roles:
        rr = L.add_row(H)
        L.put(row=rr, col=1, colspan=4, text=role["part"])
        L.put(row=rr, col=5, colspan=2, text=role.get("who") or "")

    r = L.add_row(7.0)
    L.put(row=r, col=0, colspan=7, text="훈    련    내    용", kind="band", bold=True)

    r = L.add_row(11.0)
    L.put(row=r, col=0, text=f"{ev['typeLabel']}발생시\n대피(집결)장소", kind="label", bold=True)
    place = ev.get("evacPlace")
    L.put(row=r, col=1, colspan=6, align="L",
          text=f"학생들이 각 반 대피로를 따라 {_particle_ro(place)} 대피" if place else "")

    r = L.add_row(8.5)
    L.put(row=r, col=0, text="대피소요 시간", kind="label", bold=True)
    L.put(row=r, col=1, colspan=6, text="", align="L")  # 측정값 직접 입력(자동 계산 안 함)

    evals = data["evals"]
    r = L.add_row(10.0)
    L.put(row=r, col=0, rowspan=len(evals) + 1, text="평    가", kind="label", bold=True)
    L.put(row=r, col=1, colspan=3, text="평가내용", kind="head", bold=True)
    L.put(row=r, col=4, text="평가결과\n(O, X)", kind="head", bold=True)
    L.put(row=r, col=5, colspan=2, text="비    고", kind="head", bold=True)
    for e in evals:
        rr = L.add_row(8.0)
        L.put(row=rr, col=1, colspan=3, text=f"▪ {e}", align="L")
        L.put(row=rr, col=4, text="□ O    □ X")
        L.put(row=rr, col=5, colspan=2, text="", align="L")

    r = L.add_row(26.0 if class_table == "inline" else 34.0)
    L.put(row=r, col=0, text="추후 대피훈련 시\n반영사항", kind="label", bold=True)
    L.put(row=r, col=1, colspan=6, text="", align="L", valign="T")

    r = L.add_row(36.0 if class_table == "inline" else 46.0)
    L.put(row=r, col=0, text="사    진", kind="label", bold=True)
    for c0 in (1, 3, 5):
        L.put(row=r, col=c0, colspan=2, text="")

    if class_table == "appendix":
        A = Layout(title="붙임. 학급별 대피 보고 현황(시스템 기록)", school=f"{data['schoolName']} · {when_text(ev)} [{mode}]")
        class_rows(A, True)
        L.appendix = A
    return L


def check_layout(L: Layout) -> list[str]:
    """배치 검사: 모든 칸이 정확히 한 번 덮이는지, 쪽 안에 들어가는지."""
    errs = []
    ncol = len(COL_PCT)
    grid = [[0] * ncol for _ in L.rows_mm]
    for c in L.cells:
        for rr in range(c.row, c.row + c.rowspan):
            for cc in range(c.col, c.col + c.colspan):
                if rr >= len(L.rows_mm) or cc >= ncol:
                    errs.append(f"범위 밖: {c}")
                    continue
                grid[rr][cc] += 1
    for rr, row in enumerate(grid):
        for cc, n in enumerate(row):
            if n != 1:
                errs.append(f"칸 ({rr},{cc}) 덮인 횟수 {n}")
    usable = PAGE_H - MARGIN["top"] - MARGIN["bottom"]
    head = 14.0 + 7.0  # 제목 + 학교명 줄(대략)
    if head + sum(L.rows_mm) > usable:
        errs.append(f"쪽 넘침: {head + sum(L.rows_mm):.1f}mm > {usable:.1f}mm")
    if abs(sum(COL_PCT) - 100) > 0.01:
        errs.append(f"열 너비 합 {sum(COL_PCT)}")
    return errs
