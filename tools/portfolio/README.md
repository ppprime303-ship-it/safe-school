# 포트폴리오 일일 기록 도구

매일 개발이 끝나면 그날의 AI 협업 기록을 세 가지로 남깁니다. 마지막에 날짜별 결과를 합쳐 제출본을 만듭니다.

| 결과물 | 위치 | 공개 |
| --- | --- | --- |
| 한눈에 보기 요약본(한글 hwpx + PDF) | `docs/portfolio/` | 공개 가능(개인정보 없음) |
| 공개용 원문(비식별) | `docs/portfolio/sources/` | 공개 가능 |
| 원본 증거 패키지 ZIP(원문 찾기 화면 포함) | 사용자에게 파일로 전달 | **비공개**(GitHub에 올리지 않음) |

## 매일 하는 순서(Claude가 수행)
1. `days/_template/`를 `days/<날짜>/`로 복사합니다.
2. `manifest.json`을 채웁니다.
   - `attachments`: 그날 첨부된 파일(업로드 폴더 기준 glob, 제목, 구분)
   - `chatgpt_messages` / `chatgpt_replies` / `chatgpt_prompts`: 사용자가 첨부한 ChatGPT 대화 원문(시각이 없으면 앞뒤 증거로 구간 표기, `exact: true`면 정확한 시각)
   - `replit_outputs`: Claude 대화 밖(ChatGPT 등)으로 전달된 Replit 콘솔 출력
   - `claude_docs`, `report_files`, `quick`(자주 찾는 원문 단추), `footer_note`
   - Claude 대화 원문·응답·명령 기록과 그날 GitHub 커밋은 **자동으로** 모읍니다(세션 기록 JSONL, `git log --since/--until`).
3. `report_content.py`에 그날의 한눈에 보기 내용(표·원문 인용)을 씁니다. 형식은 `days/2026-10-20/report_content.py` 참고.
4. 실행합니다.
   ```bash
   python3 tools/portfolio/hwpx_report.py tools/portfolio/days/<날짜>/report_content.py docs/portfolio/<날짜> SAFE_SCHOOL_AI협업_개발기록_<날짜>
   python3 tools/portfolio/package.py tools/portfolio/days/<날짜>/manifest.json <작업공간 출력 폴더>
   ```
5. 공개용 문서(`docs/portfolio/<날짜>/`)만 커밋합니다. 원본 ZIP은 사용자에게 파일로 보냅니다.

## 원칙
- **원문**과 **정리글**을 섞지 않습니다. 원문 파일은 머리글(출처·시각) 아래 `원문 시작 ~ 원문 끝` 사이에 글자 그대로 둡니다.
- 출처는 ChatGPT · Claude · GitHub · Replit 네 가지로 구분하고 색을 고정합니다.
- 기록에 없는 프롬프트나 측정하지 않은 수치는 만들지 않습니다.
- Claude 대화는 길어지면 앞부분이 자동 압축되어 원문이 기록에서 빠집니다. 큰 작업이 끝날 때마다 정리를 요청하세요.
- ChatGPT 대화는 공유 링크 대신 PDF로 저장해 첨부해야 읽을 수 있습니다.

## 파일
- `hwpx_report.py`: 내용 파일 → 한글(hwpx)·PDF 미리보기. 양식은 `template/hwpx_template.hwpx`(대회 공고문 hwpx)의 쪽 설정·글꼴을 씁니다.
- `package.py`: manifest → 원본 증거 패키지 ZIP(`00_원문찾기.html` 색인 포함).
- `days/2026-10-20/`: 첫날 실제 사용한 내용·manifest(예시).
- 한글 프로그램 없이 생성하므로, 처음 쓰는 날에는 한글에서 열어 모양을 확인하세요.
