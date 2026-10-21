# SAFE SCHOOL

학교 재난안전 통합 업무지원 시스템. 공식 재난경보 확인 → 재난 발령 → 학급별 대피 보고 → 실시간 집계 → 안내문 작성 지원 → 종료 보고서를 하나로 잇는 **보조** 업무시스템입니다. 나이스·K-에듀파인·학교안전지원시스템 등 공식 체계를 대체하지 않으며, 안내문의 공식 결재와 실제 발송은 학교의 기존 절차와 채널을 이용합니다.

> **설계 기준 문서: [`docs/design-v2/`](docs/design-v2/) — 마스터 설계서 v2.0(2026-10-21).** 요구사항·권한·DB·화면·API·일정·변경 검토표가 있습니다.

> 재난 중 앱에 접속할 수 없으면 학교의 기존 비상대응 절차(방송·비상연락망)를 따릅니다.
> 실제 학교 운영 전에는 학교·교육청의 승인과 보안 검토가 필요합니다.

## 개발 방식

| 작업 | 위치 |
| --- | --- |
| 코드 작성·수정 | Claude → 이 GitHub 저장소 |
| 실행·테스트·배포 | Replit (Shell과 Run만 사용, **Agent 사용 안 함**) |

Replit에서는 코드를 직접 고치지 않습니다. GitHub에서 Pull만 합니다.

## 진행 단계

| 단계 | 내용 | 상태(2026-10-21) | 브랜치 |
| --- | --- | --- | --- |
| STEP 1 | 기본 구조·DB | 완료 | `main` |
| STEP 2 | 학교 등록·교직원 가입·학급 관리 | 핵심 기능 검증 완료 | `step-2-hardening` |
| STEP 3-A | 재난 발령·대피 보고·상황판 | 검증 완료(10/20) | `step-3a-verified` |
| STEP 3-B | 공식 경보 수집·지역 판정·교직원 경보함(모의 공급자) | 모의 환경 검증 완료(10/21, 206/206) | `step-3b-alerts` |
| STEP 3-C | 재난안전 안내문 작성 지원(예시문·편집·복사, 앱 내 결재·발송 없음) | 설계 확정·개발 중(마이그레이션 승인 대기) | `step-3c-notices` |
| STEP 3-D | 사고·재난 보고서 자동 초안 | 예정 | — |
| STEP 3-E | 통신 장애·회귀·사용성·전체 시연 | 예정 | — |
| STEP 4~6 | 안전교육·점검·보안 등 | 예정 | — |

### STEP 2 — 학교 등록·교직원 가입(브랜치 `step-2`)

- 학교알리미 공식 API로 학교 검색(저장 목록 + 장애 시 대체), 학교 기본정보 자동 입력
- 최초 등록 신청 → 운영자의 관리자 자격 확인 → 학교 활성화(첫 신청자 자동 관리자 부여 없음)
- 후속 교직원 가입 신청 → 관리자 일괄 승인 → 학급·업무 배정, 권한 회수 시 세션 즉시 무효화
- 공시자료(학년별 학급수·학생수)는 스냅숏으로만 저장, 학급 구조는 관리자가 적용, 재적은 관리자가 확인
- 이메일 인증코드 가입·로그인, 개인/공용 기기 세션, 관리자 중요 작업 재인증
- 자세한 출처·연동 정책: `docs/data-sources.md`

### STEP 1 — 기본 구조와 데이터베이스

- 폴더 구조, 서버(Express) + 화면(React) 한 포트 실행
- PostgreSQL 스키마와 첫 마이그레이션(무결성 제약 포함)
- 데모 학교 데이터(1~3학년 × 5학급 × 28명 = 420명, 테스트 계정 5개)
- `/api/health` 상태 확인, DB 무결성 자동 테스트

## 운영자 도구(학교 등록 승인)

```bash
npm run operator -- list
npm run operator -- approve <신청ID> --by "운영자 이름" --method "공문 확인"
npm run operator -- reject <신청ID> --by "운영자 이름" --note "사유"
npm run directory:sync -- --kind 02 --sido 41   # 학교 검색 목록 미리 받기(선택)
```

관리자 자격 확인 방법이 학교·교육청과 정해지기 전에는 승인하지 않습니다.

## 폴더 구조

```
client/            화면(React + Tailwind)
server/src/        서버(Express) — env.ts 환경변수, db.ts DB 연결, routes/ API
shared/            화면·서버 공통 값과 계산 규칙
prisma/            schema.prisma, migrations/(SQL), seed.ts(데모 데이터)
scripts/           테스트 DB 준비, DB 요약, 백업
tests/             자동 테스트(vitest)
```

## Replit에서 처음 설정하기 (한 번만)

1. Replit → **Create App → Import from GitHub** → `safe-school` 선택. Agent가 무언가 제안하면 건너뜁니다.
2. 왼쪽 도구에서 **PostgreSQL(Database)** 을 추가합니다. `DATABASE_URL`이 자동으로 생깁니다.
3. **Secrets**(자물쇠)에 `DEMO_PASSWORD`(12자 이상), `SESSION_SECRET`(32자 이상)을 넣습니다.
   무작위 값 만들기: Shell에서 `node -e "console.log(require('crypto').randomBytes(32).toString('base64url'))"`
4. **Shell**에서 아래를 순서대로 실행합니다.

```bash
npm install          # 의존성 설치 (처음엔 몇 분 걸림)
npm run db:migrate   # 테이블 만들기(기존 데이터 삭제 없음)
npm run db:seed      # 데모 학교 넣기
npm run db:summary   # 학급 15개, 재적 420명 확인
npm test             # 자동 테스트(테스트 전용 스키마 safeschool_test 사용)
npm run dev          # 서버 실행 → Webview에서 '정상' 표시 확인
```

5. `npm install` 이 만든 `package-lock.json` 은 Replit **Git** 탭에서 한 번만 커밋·푸시합니다(설치 버전 고정용, 유일한 예외).

## 단계마다 반복하기

```bash
git pull                 # Claude가 올린 최신 코드 받기
npm install              # 의존성이 바뀐 경우
npm run db:migrate       # 새 마이그레이션 적용(데이터 삭제 없음)
npm test                 # 결과 전체를 Claude에게 전달
```

## 데이터베이스 원칙

- 마이그레이션은 `npm run db:migrate`(= `prisma migrate deploy`)만 씁니다. **`prisma migrate reset`, `db push --force-reset` 은 사용하지 않습니다.**
- CHECK 제약·부분 UNIQUE 인덱스는 `prisma/migrations/*/migration.sql` 에 직접 작성되어 있습니다. 새 마이그레이션은 `npx prisma migrate dev --create-only` 로 만든 뒤 SQL에 `DROP` 문이 없는지 검토하고 적용합니다.
- 테스트는 `safeschool_test` 스키마에서만 데이터를 지웁니다. 스키마 이름에 `test`가 없으면 실행을 거부합니다.
- 데모 시드는 `is_demo = true` 학교만 만들거나 갱신하고, 기존 데이터를 지우지 않습니다.

## 백업과 복원

```bash
npm run db:backup                       # backups/safeschool_날짜.sql 생성(GitHub에 올라가지 않음)
psql "$DATABASE_URL" < backups/파일.sql  # 복원: 빈 DB에서만 실행
```

모의훈련 전후와 매주 1회 백업하고, 파일은 학교가 승인한 저장소로 옮깁니다.

## 핵심 무결성 규칙(DB가 직접 거부)

- 대피 확인 + 사전 파악 부재 + 미확인 = 보고 재적, 모든 값 0 이상
- 부상자는 대피 여부와 별도(부상자 ≤ 보고 재적만 검사)
- 재적을 바꾸면 사유 필수
- 한 학교에 진행 중인 상황은 1건(복합재난은 유형 추가)
- 같은 상황·학급 보고는 1건, 같은 요청(멱등키)은 한 번만 저장
- 감사 로그는 추가만 가능(수정·삭제 거부)

## 환경변수

`.env.example` 참고. 실제 값은 Replit Secrets에만 넣습니다.
