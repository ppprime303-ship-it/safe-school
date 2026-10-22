# STEP 3-D HWPX 생성 시험용 내용(가상 데이터). 생성기: step-3-dev 브랜치 tools/portfolio/hwpx_report.py
# 시험 목적: 한글 프로그램 없이 만든 HWPX가 한글에서 열리고 표를 편집할 수 있는지 사용자가 확인
# 한계: 이 생성기는 가로 병합만 지원(세로 병합 없음) → 원본의 '역할담당'·'평가' 세로 병합은 빈 칸으로 대신함
G = "light"
A(("title", "비상대피훈련일지(지진)"))
A(("p", "SAFE SCHOOL 시연초등학교  (가상 데이터 · HWPX 생성 시험본)"))
A(("table", [17, 41, 14, 28], [
    [C("일    시", G, True, align="C"), C("2026. 9. 9.(수) 10:20 ~ 11:20 (총 60분)  [모의훈련]", span=3)],
    [C("참가인원", G, True, align="C"), C("교직원 (    )명 / 학생 대피 확인 51명(미보고 1개 학급 제외)", span=2), C("총 (확인 필요)명", align="C")],
    [C("역할담당", G, True, align="C"), C("구  분", G, True, align="C", span=2), C("담당자", G, True, align="C")],
    [C("", G), C("안전교육 및 학생 대피", align="C", span=2), C("각 반 담임교사", align="C")],
    [C("", G), C("신고", align="C", span=2), C("", align="C")],
    [C("", G), C("안내 방송", align="C", span=2), C("", align="C")],
    [C("", G), C("부상 학생 응급처치", align="C", span=2), C("", align="C")],
    [C("", G), C("실내 잔류 확인", align="C", span=2), C("", align="C")],
    [C("", G), C("소요시간 측정, 최종인원 점검", align="C", span=2), C("", align="C")],
    [C("훈  련  내  용", G, True, align="C", span=4)],
    [C("지진발생시\n대피(집결)장소", G, True, align="C"), C("학생들이 각 반 대피로를 따라 운동장으로 대피", span=3)],
    [C("대피소요 시간", G, True, align="C"), C("", span=3)],
    [C("평    가", G, True, align="C"), C("평가내용", G, True, align="C"), C("평가결과\n(O, X)", G, True, align="C"), C("비  고", G, True, align="C")],
    [C("", G), C("▪ 대피의 신속성"), C("", align="C"), C("")],
    [C("", G), C("▪ 대피경로의 효율성"), C("", align="C"), C("")],
    [C("", G), C("▪ 대피장소의 안전성"), C("", align="C"), C("")],
    [C("", G), C("▪ 교사 역할의 조직적 수행 정도"), C("", align="C"), C("")],
    [C("", G), C("▪ 비상벨 또는 사이렌 소리의 적절성"), C("", align="C"), C("")],
    [C("", G), C("▪ 학생의 반응"), C("", align="C"), C("")],
    [C("추후 대피훈련 시\n반영사항", G, True, align="C"), C("\n\n\n", span=3)],
    [C("사    진", G, True, align="C"), C("(사진 붙이기)\n\n\n\n", span=3)],
]))
A(("small", "학급별 대피 보고(시스템 기록): 1학년 1반 재적 25·대피 24·사전 파악 부재 1·부상 0 / 1학년 2반 재적 27·대피 27·부상 0 / 2학년 1반 재적 24·미보고"))
