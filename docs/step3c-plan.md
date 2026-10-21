# STEP 3-C 재난안전 안내문 작성 지원 — 설계(승인 요청용)

작성 2026-10-21 · 브랜치 `step-3c-notices`(기준 `step-3b-alerts` `6667a81`) · 상태: **최종 마이그레이션·기능 코드·테스트 작성 완료(Replit DB 미적용 — 적용은 별도 승인)**

> 개정 이력
> - 1차(10:35, `ca10d51`): 최초 설계·SQL 초안
> - 최종(11:00): 10:55 통합 지시 반영 — 취소된 안내문으로 새 초안 만들기(재사용). `source_notice_id` 추가, 점검 55/55. 기능 코드·테스트 작성
> - 2차(10:40): 사용자·ChatGPT SQL 검토(10:37) 반영 — 같은 학교 대상 경보만 연결, 처리 이력-안내문 학교 일치, 취소 후 변경 금지, 수정 이력 DB 자동 기록·판 번호 +1 강제, 핵심 연결 값 변경 금지. 1차 SQL은 어느 Replit DB에도 적용되지 않았으므로 같은 마이그레이션 파일을 고쳐 씀

## 1. 범위
- 포함: 경보함 연결 안내문 작성, 상황별 예시문 선택·불러오기, 수정·저장·수정 이력, 동시 수정 방지, 미리보기, 제목·본문 복사, 선택적 처리 이력(교사 직접 입력), 권한·학교 격리, 감사 기록
- 제외: 앱 내 승인·결재, 모의 발송, 실제 문자·카카오톡 발송, 학부모 연락처, 외부 API, 파일 내보내기(HWPX 등 — 복사 기능부터)
- 화면 안내 문구: "이 기능은 안내문 작성과 복사를 지원합니다. 공식 결재 및 실제 발송은 학교의 기존 절차와 채널을 이용해 주세요." / "예시 문구는 참고용입니다. 실제 발송 전 학교 상황과 공식 대응 지침을 확인하세요."

## 2. 예시문 라이브러리(코드 데이터, DB 아님)
- 위치: `shared/noticeExamples.ts` — 원본은 코드에만 있고 화면·DB에서 바꿀 수 없음. 사용자가 고친 글만 `school_notices`에 저장.
- 구조: `{ key, version, disasterType, audience, situation, label, title, body }`
  - `disasterType`: heatwave(폭염) · storm_flood(호우·태풍) · fine_dust(미세먼지) · earthquake(지진) · cold_wave(한파) · fire_gas(화재·가스) · other(기타 재난)
  - `audience`: parent(학부모) · staff(교직원)
  - `situation`: issued(발령) · cancelled(해제) · (필요 시) update(변경)
  - 유형마다 최소 3개: 학부모 안내(발령), 교직원 안내(발령), 해제 안내 → 7 × 3 = 21개
- 자동 채우기 빈칸: `{{학교명}}` `{{재난유형}}` `{{경보제목}}` `{{발령시각}}` `{{지역}}` — 확인 가능한 값만. 학교 조치·문의처 등 확인할 수 없는 값은 `[학교 조치 사항을 입력하세요]`처럼 입력 안내로 남김(현재 학교 정보에 연락처 항목 없음).
- 추천: 경보 제목·본문 낱말로 유형 추천(예: '폭염'→폭염), 해제 경보면 '해제 안내' 먼저. 교사가 다른 유형·예시 선택 가능.
- 예시 추가: 배열에 항목 추가 + `version` 올리기(마이그레이션 불필요). 저장된 안내문에는 불러온 예시의 `key`·`version`을 남김.

## 3. DB(새 마이그레이션 `20261022000000_school_notices`, 추가만)
| 테이블 | 내용 | 보호 장치 |
| --- | --- | --- |
| `school_notices` | 학교, 연결 경보(재송출이면 대표 경보), 불러온 예시 키·버전, 제목, 본문, 상태(작성 중/작성 완료/취소), 판 번호, 작성·수정자 | (학교, 경보) → `school_alert_matches` 복합 외래키 + 만들 때 '대상'·대표 경보 검사, 삭제 금지, 취소 후 모든 변경 금지, 학교·경보·작성자 변경 금지, 내용 바뀌면 판 번호 정확히 +1, 취소 사유 필수 |
| `school_notice_revisions` | 판마다 1행 — **DB 트리거가 자동 기록**(앱이 직접 쓰지 않음) | 안내문 현재 판과 같은 내용만 추가 가능, 수정·삭제 금지, (안내문, 판 번호) 유일 |
| `notice_handling_records` | 선택 입력: 기록용 채널 분류(문자/학교 알림 앱/카카오톡/기타), 대상 범주(문장), 교사 입력 '발송 완료'·일시, 비고 | (안내문, 학교) 복합 외래키로 학교 일치, 무효 처리만 1회(사유 필수), 삭제 금지, 개인 식별 정보 열 없음 |

- 기존 테이블 변경·DROP·데이터 수정 없음. 테스트 스키마는 초기화 시 TRUNCATE를 쓰므로 트리거와 충돌 없음.
- 기존 테이블에는 트리거를 달지 않음. `school_alert_matches`는 새 외래키가 참조만 함(재판정·묶음 정리 갱신은 그대로 동작, 안내문이 참조 중인 판정 행 삭제만 막힘 — 기존 코드에 판정 행 삭제 없음).
- 안전성 점검(이 작업공간 임시 PostgreSQL, 마이그레이션 4개 순서 적용): **35/35 예상대로 동작** — 결과 전체는 `docs/step3c-sql-check.md`, 재현 스크립트 `tools/db-checks/check_step3c_migration.py`

## 4. API(`/api/schools/:schoolId/…`, 모두 서버에서 소속·승인 검사)
| 메서드·경로 | 권한 | 내용 |
| --- | --- | --- |
| GET `notice-examples` | 승인 교직원 | 예시문 목록(코드 데이터) |
| GET `notices?alertId=` | 승인 교직원 | 학교 안내문 목록(취소 포함 표시) |
| POST `notices` | 승인 교직원 | `{alertId, exampleKey?}` → 빈칸 채운 초안 생성(재송출 경보는 대표 경보로 연결) |
| GET `notices/:id` | 승인 교직원 | 본문 + 수정 이력 + 처리 이력 + 연결 경보 상태(해제 여부) |
| PATCH `notices/:id` | 작성자 또는 관리자 | `{title, body, status, exampleKey?, expectedVersion}` — 조건부 갱신(`WHERE version = expectedVersion`, 새 판 = +1), 판 번호 다르면 409와 최신 내용 |
| POST `notices/:id/cancel` | 작성자 또는 관리자 | 사유 필수 |
| POST `notices/:id/records` · POST `…/records/:rid/void` | 승인 교직원 | 선택적 처리 이력 입력·무효 처리 |
- 기존 `GET alerts`: 경보별 안내문 개수만 추가.

## 4-1. 서비스 검증(DB 제약에 더해)
- 경보 ID·안내문 ID·처리 이력 ID는 항상 `schoolId`와 함께 조회 → 다른 학교 ID는 404
- 안내문 생성 시 재송출 경보를 고르면 대표 경보로 바꿔 연결, 미판정·비대상 경보는 400
- 취소된 안내문 수정·취소·처리 이력 입력은 409
- 테스트: 다른 학교 경보·안내문·처리 이력 ID 요청 차단, 동시 저장 2건 중 1건만 성공, 이력 판 번호 연속성, 취소 후 변경 거부, 공식 경보 원문 불변

## 5. 화면
- 경보함 경보 상세: '학교 안내문' 구역(작성된 안내문 목록, '안내문 작성' 단추). 해제된 경보면 "이 경보는 해제되었습니다" 표시.
- 안내문 편집 화면: 왼쪽 예시문 카드(유형 탭, 학부모/교직원/해제 구분, 추천 표시) → 누르면 편집 영역에 불러오기(작성 중 문구가 있으면 덮어쓰기 확인) · 제목·본문 편집 · 저장(판 번호) · 작성 완료 표시 · 미리보기 · 복사 단추 3개(제목/본문/전체, 모바일 대비 실패 시 선택 상태로 표시) · 수정 이력 · 처리 이력(접힘, 선택)
- 메뉴 추가 없음(경보함에서 진입). 안내문 목록은 경보함 상단 링크.

## 6. 브랜치·Replit 전략
- GitHub: `step-3c-notices`를 `step-3b-alerts`(`6667a81`)에서 새로 만듦. 3-B는 그대로 보존.
- Replit: 로컬 브랜치(병합 커밋 `d562eec`, `.replit`·`vite.config.ts`·`package-lock.json` 변경 포함)를 그대로 쓰고, `git fetch` 후 `git merge --no-ff --no-commit origin/step-3c-notices`로 병합 → 변경 파일 확인 → 커밋. 브랜치를 바꾸지 않으므로 Replit 설정 파일이 되돌아가지 않음. 병합 전 백업 브랜치 생성.

## 7. 개발 순서
C1 예시문 데이터·빈칸 채우기(+순수 테스트) → C2 서비스·API(권한·격리·판 번호·이력·감사) → C3 처리 이력 → C4 화면(예시 카드·덮어쓰기 확인·복사) → C5 `e2e:step3c` + 회귀 206 → C6 브라우저 시연·포트폴리오

## 8. 최종 추가: 취소된 안내문 재사용(10:55 통합 지시)
| 정책 | 구현 |
| --- | --- |
| 원본 수정·삭제·직접 복구 금지, 취소 사유·시각 보존 | 2차 트리거 그대로(취소 후 모든 변경 거부, 삭제 거부) |
| 조회·복사 허용 | 취소된 안내문도 상세·미리보기·복사 가능(편집 영역만 없음) |
| 새 초안 생성 | `POST notices/:id/reuse {alertId?}` → 새 ID, `draft`, 판 1, 제목·본문·예시 키 복사, 작성자 = 재사용한 교직원 |
| 원본-초안 연결 | `school_notices.source_notice_id`(선택 열). (원본, 학교) 복합 외래키 → 다른 학교 안내문 재사용 불가. 원본은 취소된 안내문만(트리거). 연결 변경 금지 |
| 중복 실행 방지 | 같은 원본의 '작성 중' 초안은 1건만(부분 UNIQUE 인덱스). 두 번째 요청은 기존 초안을 돌려줌(200, `created:false`) |
| 감사 로그 | `notice.reused`: 재사용자·시각·원본 ID·원본 경보·새 연결 경보 |
| 경보 상태 | 같은 경보든 다른 경보든 '우리 학교 대상·대표 경보' 검사를 다시 함. 해제된 경보면 경고, 다른 경보면 '본문의 경보 정보 수정' 경고, 언제나 '과거 정보일 수 있음' 경고. 공식 경보 원문은 변경 없음 |
- 새 테이블 없음(기존 `school_notices`에 열 1개, 제약 3개, 인덱스 1개).

## 9. 구현 파일
- DB: `prisma/migrations/20261022000000_school_notices/migration.sql`, `prisma/schema.prisma`(모델 3개·열거형 2개)
- 예시문: `shared/noticeExamples.ts`(21개, 빈칸 채우기·추천), 입력 검증: `shared/schemas.ts`(개인 연락처 형태 거부)
- 서버: `server/src/services/notices.ts`, `server/src/routes/notices.ts`, `server/src/app.ts`(라우터 등록), `server/src/services/alerts.ts`(경보별 안내문 수 `noticeCount` 추가만)
- 화면: `client/src/pages/notices/NoticeEditorPage.tsx`, `NoticesPage.tsx`, `client/src/pages/alerts/AlertsPage.tsx`(안내문 작성 진입), `client/src/App.tsx`, `client/src/lib/notices.ts`, `client/src/lib/router.tsx`(검색어 변경 시 다시 그리기), 아이콘 2개
- 테스트: `tests/notice-examples.test.ts`(순수), `tests/notices.test.ts`(DB), `scripts/e2e-step3c.ts`(HTTP, `npm run e2e:step3c`)

## 10. 테스트 실행 현황(10/21 11:20 기준 — 실행한 것과 안 한 것 구분)
| 구분 | 내용 | 결과 |
| --- | --- | --- |
| 실행함 | SQL 안전성 점검(작업공간 임시 PostgreSQL) | 55/55 예상대로 |
| 실행함 | `tests/notice-examples.test.ts`(작업공간, vitest 대체 실행기) | 9/9 |
| 실행함 | 기존 순수 테스트 회귀(`alerts-region` 12, `client-disaster` 7, `schoolinfo-parse` 9) | 28/28 |
| 실행함 | 타입 검사(작업공간, Prisma·Express 타입은 대체 선언 — 실제 타입 검사 아님) | 오류 0 |
| 실행함 | 화면 동작 확인(빌드한 화면 + **모의 API**, 모바일·PC) | 29/29 |
| **미실행** | `tests/notices.test.ts`(DB 서비스 테스트) — 작업공간에 Prisma 엔진 없음 | Replit 승인 후 |
| **미실행** | `npm run e2e:step3c`, `npm test` 전체 회귀(206 + 신규), `npm run typecheck`, `npx prisma validate`·`generate` | Replit 승인 후 |
| **미실행** | 실제 서버·시연 DB 브라우저 확인 | 시연 DB 적용 승인 후 |
