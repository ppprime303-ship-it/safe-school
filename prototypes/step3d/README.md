# STEP 3-D 1차 시제품(앱 미연결, 가상 데이터)

| 파일 | 여는 방법 | 내용 |
| --- | --- | --- |
| `evacuation-drill-log.html` | 브라우저로 열기(인터넷 연결 불필요) | A4 비상대피훈련일지 미리보기, 색으로 자동/조건부/직접 입력 구분, O/X·입력칸·사진 미리보기, 인쇄·PDF 저장 |
| `evacuation-drill-log.pdf` | PDF 보기 | 위 화면을 인쇄했을 때의 모양(색 표시 없음, A4 1쪽) |
| `비상대피훈련일지_HWPX시험본.hwpx` | 한글에서 열기 | 한글 없이 만든 HWPX가 열리는지 확인하는 시험 파일(세로 병합 없음). **한글 열기 미확인** |
| `hwpx_sample_content.py` | — | HWPX 시험본 내용(생성기: `step-3-dev` 브랜치 `tools/portfolio/hwpx_report.py`) |

설계·분석: `docs/step3d/step3d-design.md`, 영향 분석: `docs/step3d/step3d-impact.md`, 검토 체크리스트: `docs/step3d/step3d-review-checklist.md`

## 개선본(2026-10-22, `step-3d-template-refine`)
`refined/` 폴더 — PDF 시제품 모양을 기준으로 다시 만든 HWPX(세로 병합·행 높이·여백 지정)와 비교용 PDF. 자세한 내용: `docs/step3d/step3d-hwpx-refine.md`
