> **비식별 처리본** — 원문에서 개인 이메일·GitHub 계정명·세션/문서 링크·미리보기 주소·작업공간 경로만 치환했습니다(처리 내역: `05_비식별_처리_기록.md`). 그 밖의 글자는 바꾸지 않았습니다. 원본은 비공개 보관본에 있습니다.
> 출처: **Claude** 작성 문서 'SAFE SCHOOL 설계서 (STEP 0 이전 기획)' 탭 1. 작성 시각은 2026-10-20(정확한 시각은 세션 기록 압축으로 미확보).

# SAFE SCHOOL 설계서 (STEP 0 이전 기획)

Oct 20, 2026 · @SooJu lee

## 문서 안내와 현재 상태

이 문서는 마스터 프롬프트 20항이 요청한 A\~J를 정리한 설계서이며, 앱 코드는 아직 생성하지 않습니다. 각 항목에는 상태를 붙입니다. **확인함**은 Replit 파일을 직접 열어 본 사실이고, **미검증**은 실행 결과를 보지 못한 사항, **설계**는 앞으로 구현할 내용입니다.

업무경감 기준으로 다시 검토한 결과와 수정 제안, 실증 설계는 업무경감 검토·실증 설계 탭에 있습니다. 사용자가 승인하기 전까지 이 탭의 설계는 바뀝니다.

**현재 Replit 프로젝트(2026-10-20 17:30 기준, 파일 목록만 확인)**

| 항목 | 확인한 사실 | 상태 |
| --- | --- | --- |
| 저장소 구조 | pnpm 모노레포: `artifacts/api-server`, `artifacts/school-safety`, `lib/db`, `lib/api-spec`, `lib/api-zod`, `lib/api-client-react` | 확인함 |
| 기술 스택 | Node.js 24, TypeScript 5.9, Express 5, PostgreSQL + **Drizzle ORM**, Zod, Orval(OpenAPI 코드생성) | 확인함(replit.md) |
| DB 스키마 | `lib/db/src/schema/index.ts`에 테이블 정의 없음(빈 템플릿) | 확인함 |
| API | `routes/health.ts`만 존재 | 확인함 |
| 화면 | `pages/not-found.tsx`만 존재 | 확인함 |
| 이전 개발 요청 | 1차 요청(공용 접속코드 로그인)으로 Replit Agent가 작업 중이었을 수 있음 | 미검증 |

**설계 결정 1 — 새 GitHub 저장소에서 Prisma로 시작합니다(10-20 개발지침 반영).** 기존 Replit 프로젝트는 빈 템플릿이라 유지할 코드·데이터가 없습니다. 그래서 지침의 기본 제안(React + TypeScript + Tailwind, Express, PostgreSQL + Prisma)을 따르고, 비전문가가 따라가기 쉽도록 코드생성 단계 없는 단일 저장소(client·server 폴더)로 단순화합니다. 부분 UNIQUE 인덱스와 CHECK 제약은 Prisma 마이그레이션 SQL에 직접 추가합니다. C절의 테이블 설계는 그대로 적용됩니다.

**설계 결정 2 — 1차 요청 사양은 폐기하고 이 문서로 대체합니다.** 1차 요청의 '공용 접속코드 로그인'은 3항(개인 계정, 관리자 승인)과 충돌합니다. 기존 Replit 앱에서 Agent가 아직 작업 중이면 크레딧이 계속 쓰이므로 Replit 화면에서 멈춰야 합니다.

**설계 결정 3 — 개발은 Claude가 맡고, Replit은 배포·호스팅만 담당합니다(2026-10-20 변경).** Replit Agent 크레딧을 아끼기 위한 결정입니다. Claude가 작업공간에서 코드를 작성하고 테스트해 GitHub에 올리면, Replit은 그 저장소를 가져와(Import) 배포합니다. 도구별 역할은 ChatGPT가 기획·제출자료, Claude가 설계·구현·테스트, Replit이 실행·DB·배포입니다. 이하 문서의 'Replit Agent 프롬프트'는 'Claude 개발 지시문'으로 바꾸어 적습니다.

## 개발 진행 가이드(지침 14항 1\~10)

이 절을 1번부터 순서대로 따라 하면 됩니다. **확인 필요**로 표시한 항목은 아직 실제로 검증하지 않은 내용입니다. 4\~6번은 아래 B·C·G·H절에 자세히 있어 요약만 적습니다.

### 1. Claude 중심 개발 환경

코드는 Claude가 쓰고, 실행과 테스트는 Replit의 **Shell**에서 합니다. Replit **Agent**는 쓰지 않습니다.

| 작업 | 어디서 | 누가 | 비고 |
| --- | --- | --- | --- |
| 설계, 코드 작성, 오류 수정, 코드 리뷰 | 이 Claude 대화 | Claude | 파일 단위로 작성해 GitHub에 올림 |
| 코드 저장·이력 | GitHub `safe-school`(비공개) | Claude가 올리고 사용자는 확인 | 단계마다 태그 |
| 설치·실행·테스트 | Replit Shell | 사용자가 정해진 명령을 붙여넣음 | 출력 결과를 Claude에게 그대로 전달 |
| 미리보기 | Replit Run(Webview) | 사용자 | 배포 없이 화면 확인 |
| 실제 운영 주소 | Replit Deployments | 사용자 | 테스트 통과 후에만 배포 |

**왜 실행을 Replit에서 하나요?** 10월 20일 Claude 작업공간에서 확인해 보니, PostgreSQL과 Node.js는 있지만 npm 패키지 저장소 접속이 막혀 있었습니다(403 거부). 그래서 React·Express·Prisma를 설치해 실행하는 검증은 Claude 쪽에서 할 수 없습니다. 대신 두 가지 방법이 있습니다.

- **기본안 — Replit Shell.** 다음 세 가지는 확인이 필요합니다. 요금제에서 Shell 실행이 Agent 크레딧과 별도인지, 작업공간 사용량에 한도가 있는지, 한도가 있다면 몸 시간인지는 Replit 계정의 Usage 화면에서 확인해 주세요.
- **대안 — 내 PC.** Claude 데스크톱 앱으로 이 대화를 PC에 연결하면 Claude가 PC에서 직접 실행·테스트할 수 있습니다. 이 경우 PC에 Node.js와 PostgreSQL을 설치해야 하며, 학교 PC의 보안 정책상 설치가 가능한지 확인이 필요합니다.

**Replit 비용을 아끼는 규칙**

1. Agent 킭에는 아무것도 입력하지 않습니다. 오류 수정도 Claude에게 맡깁니다.
2. Replit에서 코드를 직접 고치지 않습니다. GitHub와 내용이 어긋나기 때문입니다.
3. 개발 중에는 Run(미리보기)만 씁니다. Deploy는 STEP 7과 모의훈련 직전에만 합니다.
4. 아까 만든 Replit 앱(AffectionateApprehensiveConfigfiles)은 배포하지 않았으므로 그대로 두거나 삭제해도 됩니다. 작업은 새 Repl에서 합니다.

### 2. GitHub와 Replit 사이 코드 전달·버전 관리

코드는 항상 Claude → GitHub → Replit 한 방향으로만 흐릅니다.

**처음 한 번만 할 일**

1. GitHub에 빈 비공개 저장소 `safe-school`을 만듭니다. README 없이 만듭니다.
2. Claude가 이 저장소를 대화에 연결해 STEP 1 코드를 올립니다.
3. Replit에서 **Create App → Import from GitHub**로 `safe-school`을 가져옵니다. Replit과 GitHub 계정 연결 승인이 필요하며, 메뉴 이름은 확인이 필요합니다.
4. 가져올 때 Agent가 설정을 제안하면 건너뜁니다. 필요한 설정(`.replit`)은 저장소에 들어 있습니다.
5. Replit에서 PostgreSQL 데이터베이스를 추가하고, 10번의 Secrets를 넣습니다.

**단계마다 반복할 일**

1. Claude가 단계 브랜치(`step-2` 등)에 코드를 올리고, 바뀐 파일 목록과 실행할 명령을 알려 줍니다.
2. Replit **Git** 킭에서 그 브랜치로 바꾼 뒤 **Pull**을 누릅니다. Shell에서 `git pull`로 해도 됩니다.
3. Shell에 명령을 붙여넣고, 출력 전체를 Claude에게 보냅니다.
4. Claude가 결과를 검토합니다. 실패하면 수정본을 같은 브랜치에 올리고 2번으로 돌아갑니다.
5. 모두 통과하면 Claude가 `main`에 합치고 태그(`v0.2-step2` 등)를 붙입니다. 문제가 생기면 이 태그로 되돌릴 수 있습니다.

비밀번호·키는 GitHub에 절대 올리지 않고 Replit Secrets에만 둡니다. 저장소에는 값이 빈 `.env.example`만 들어갑니다. 커밋 이력은 경진대회의 ‘AI와의 협업 과정’ 증빙 자료로도 씁니다.

### 3. 기존 프로젝트 코드 확인 절차

1. 어느 코드를 확인할지 알려 주세요. Replit 앱 이름이나 GitHub 주소면 됩니다.
2. Claude가 코드를 읽기 전용으로 열어 봅니다. 파일 구조, package.json, DB 스키마, API, 화면 목록을 확인하고 아무것도 고치지 않습니다. Replit 파일 읽기에 크레딧이 드는지는 확인이 필요하므로, GitHub에 올라가 있다면 GitHub로 읽습니다.
3. DB에 데이터가 있으면 사용자가 Replit Shell에서 백업부터 합니다. `pg_dump "$DATABASE_URL" > backup_날짜.sql`
4. Claude가 ‘보존 / 수정 / 교체’ 판정표를 만들고 사용자가 승인합니다. 승인 전에는 어떤 파일이나 데이터도 삭제하지 않습니다.

현재 적용 결과: AffectionateApprehensiveConfigfiles는 빈 템플릿이고(테이블·화면 없음), 보존할 것이 없어 새 저장소로 시작합니다.

### 4. 전체 시스템 아키텍처(요약 → B절)

학부모와 교직원의 휴대폰이나 PC 브라우저가 Replit에 배포된 서버 하나에 접속합니다. 이 서버(Express)는 화면(React)과 API를 함께 제공하고, PostgreSQL에 저장합니다. 모든 요청은 ‘로그인 → 승인 여부 → 역할 → 소속 학교’ 순서의 검사를 거칩니다. 외부 서비스(메일, 웹 푸시, 나이스)는 어댑터로 분리해서, 장애가 나도 발령·보고·집계는 멈추지 않습니다.

### 5. 핵심 DB 스키마(요약 → C-2절)

STEP 1\~3의 핵심 테이블은 12개입니다. STEP 4에서 알림 테이블 3개(parent\_notices, notification\_subscriptions, notification\_deliveries)를, STEP 5에서 점검·훈련·행동요령·연락망 테이블을 추가합니다.

| 묶음 | 테이블 | 무결성을 지키는 장치 |
| --- | --- | --- |
| 사람·소속 | users, user\_identities, email\_verifications, sessions, school\_memberships | 이메일 중복 금지, 학교당 사람 1개 소속, 승인 상태 값 제한 |
| 학교·학급 | schools, classes, class\_assignments | 학년·반 중복 금지, 재적 0\~60 |
| 재난 대응 | disaster\_events, evacuation\_reports, evacuation\_report\_revisions | 진행 중 상황 학교당 1건, 대피확인 + 미확인 = 재적, 버전·멱등키 |
| 기록 | audit\_logs | 추가만 가능(수정·삭제 불가) |

개발지침 6항에 따라 두 가지를 반영합니다. 보고 시점의 재적은 학급 설정값을 기본으로 불러오고, 담당자가 고칠 수 있습니다. 고칠 때는 사유를 필수로 입력하고 이력에 남깁니다. 미확인 인원은 사람이 입력하지 않고, 서버가 ‘재적 − 대피확인’으로 계산해 저장합니다.

### 6. 구현 우선순위(요약 → G·H절)

1. **P0, 11월 2일까지**: 인증·승인, 학교·학급, 발령, 학급 보고, 상황판, 학부모 안내 승인·게시·푸시, 상황 보고서, 감사 로그
2. **P1, 일정이 허락하는 만큼**: 행동요령·연락망 → 안전훈련 → 시설 점검 → 나이스 학교 검색
3. **P2, 대회 이후**: EPKI, 하이클래스 자동 연동, 알림톡, 문자 실발송

### 7. 단계별 업무경감 효과 분석(가설)

기능별 상세는 A-3절에 있습니다. 아래는 개발 단계마다 무엇이 줄고 무엇이 늘어나는지 정리한 것입니다. STEP 1과 2는 그 자체로는 업무를 줄이지 않고 오히려 준비 업무를 만듭니다.

| 단계 | 줄어드는 업무 | 새로 생기는 업무 | 측정 지표(STEP 8에서 측정) |
| --- | --- | --- | --- |
| 1 기본 구조·DB | 없음(기반 작업) | 없음 | — |
| 2 인증·학교 관리 | 없음 | 교직원 가입 1회(약 2분, 가설), 관리자 승인·담임 배정 1회, 학급 재적 입력 1회 | 전교생 가입·배정 완료까지 걸린 시간 |
| 3 발령·보고·집계 | 인원 전달·재확인 연락, 수기 합산, 미보고 반 찾기 | 발령 버튼, 담임의 숫자 1개 입력 | 발령부터 전 학급 보고 완료까지 분, 재확인 연락 횟수, 합계 오류 |
| 4 학부모 공지·보고서 | 안내문 작성, 채널별 재작성, 결과보고서 수치 재입력 | 초안 검토·승인, 복사 붙여넣기, 발송 확인 클릭 | 발령부터 첫 안내까지 분, 보고서 작성 분 |
| 5 점검·훈련·연계 | 점검표 엑셀 옮겨 적기, 불량 목록 정리, 훈련 실적 취합, 학교정보 입력 | 템플릿 확인 1회, 훈련 평가 입력 | 월 점검 보고 분, 연간 실적 보고 분 |
| 6 보안·통합 테스트 | 장애로 인한 이중 보고 위험 감소 | 없음 | 테스트 통과율, 장애 복구 시간 |
| 7 배포 | — | 담당자의 백업 확인(월 1회, 가설) | 가동률 |
| 8 실증 | 실측으로 가설 확정 | 시간 측정·설문 | 절차 단계 수 비교, 앱 자동 기록, 담당자 후기(아래 양식) |

**실증 방법(10-20 확정): 실제 담당자의 사용 후기 검증.** 기존 업무의 시간 기록이 없으므로 ‘몇 분 단축’을 주장하지 않습니다. 대신 세 가지 근거를 묶어 신뢰도를 높입니다.

1. **절차 비교(객관).** 기존 절차와 SAFE SCHOOL 절차의 단계 수와 입력 횟수를 담당자와 함께 세어 표로 만듭니다. 시간 기록이 없어도 만들 수 있습니다.
2. **앱 자동 기록(객관).** 모의훈련에서 발령 시각과 반별 보고 시각, 전 학급 보고 완료까지 걸린 시간, 첫 학부모 안내 시각이 감사 로그에 자동으로 남습니다. SAFE SCHOOL 쪽 수치는 실측값이 됩니다.
3. **담당자 후기(주관, 서명·동의).** 안전담당자, 담임, 관리자가 직접 사용한 뒤 아래 양식에 답합니다. 기존 방식의 소요시간은 ‘담당자 추정치’로 받고, 보고서에도 추정치라고 명시합니다.

**사용 후기 양식(초안)**

| # | 문항 | 응답 방식 |
| --- | --- | --- |
| 1 | 역할(관리자 / 안전담당 / 담임 / 교직원), 사용한 기능 | 선택 |
| 2 | 기존 방식으로 같은 업무(예: 훈련 인원 보고·집계·결과보고)에 드는 시간 | 추정 분 |
| 3 | SAFE SCHOOL로 업무가 줄어들 것 같은 정도 | 5점 척도 |
| 4 | 사라진 작업과 새로 생긴 작업 | 서술 |
| 5 | 사용하기 쉬움, 재난 중 쓸 수 있을지 | 5점 척도 |
| 6 | 개선이 필요한 점, 다시 쓸 의향 | 서술 / 예·아니오 |
| 7 | 후기를 경진대회 증빙에 사용하는 데 동의(성명 공개 여부 선택) | 서명 |

후기는 실제 사용자가 쓴 원문 그대로 제출하고, 부정적인 의견도 ‘개선 계획’과 함께 실습니다. 심사위원에게는 긍정 후기만 있는 것보다 이쪽이 더 신뢰를 줍니다. 응답자는 최소 5명(관리자 1, 안전담당 1, 담임 3 이상)을 권장합니다.

### 8. 단계별 테스트와 완료 기준

‘완료’는 Replit Shell의 실제 출력을 Claude가 확인한 뒤에만 표시합니다. 화면이 바뀌는 것만으로는 완료가 아니고, 자동 테스트가 API 응답과 DB 저장값까지 확인해야 합니다.

| 단계 | 핵심 테스트(지침 17항 번호) | 완료 기준 |
| --- | --- | --- |
| 1 기본 구조·DB | 마이그레이션 적용, 시드, 제약조건 위반 시 저장 거부, 서버 재시작 후 데이터 유지(15) | `npm test` 전부 통과, `/api/health`가 DB 연결 ok, 데모 15학급 420명 확인 |
| 2 인증·학교 관리 | 이메일 인증(1), 미승인 차단(2), 학교 격리(3), 학급 제한(4), 권한 회수 즉시 반영, 감사 로그(17) | 학교 2개로 교차 접근했을 때 전부 거부, 실제 메일 주소로 코드 수신 1회 확인 |
| 3 발령·보고·집계 | 발령(5), 동시 보고 15건(6), 합계 검증(7), 수정·중복 방지(8), 집계 정확성(9), 통신 장애(10) | 집계가 수작업 기대값과 일치, 중복 발령 409, 미전송 보고가 재연결 후 1건만 저장 |
| 4 학부모 공지·보고서 | 승인 권한(11), 중복 발송 방지(12), 실제/훈련 구분(13), 보고서 생성(14) | 승인 전 공개 API 노출 0건, Android 폰 1대에서 푸시 수신, CSV가 엑셀에서 한글로 열림 |
| 5 점검·훈련·연계 | 불량→조치 자동 등록, 훈련 발령→실적 연결, 외부 API 장애 처리(16) | 나이스 키가 없거나 장애여도 다른 기능이 정상 동작 |
| 6 보안·통합 | 전체 회귀(18), 요청 제한, CSRF, 입력 검증 | 테스트 전부 통과, 테스트 목록에 ‘실행함 / 미실행’ 구분 표기 |
| 7 배포 | 배포 주소 헬스체크, 백업·복원 1회 실습, 데모/운영 DB 분리 | 운영 주소에서 로그인→발령→보고→종료 전 과정 성공, 복원한 DB에서 같은 결과 |
| 8 실증 | 승인된 모의훈련 1회, 앱 기록 추출, 담당자 후기 수집 | 절차 비교표, 앱 실측값, 서명한 후기 5건 이상 확보. 기존 방식 시간은 ‘추정치’로 표기 |

### 9. 첫 번째 실제 코드 작업 — STEP 1 기본 구조·DB

‘다음 단계 개발’이라고 말씀하시면 아래 범위만 작성합니다. 로그인·화면 기능은 아직 포함하지 않습니다.

| 구분 | 파일 | 내용 |
| --- | --- | --- |
| 신규 | `package.json`, `tsconfig.json`, `vite.config.ts` | 의존성, 실행 명령(`dev`, `build`, `start`, `test`, `db:migrate`, `db:seed`) |
| 신규 | `.replit`, `.env.example`, `.gitignore` | Replit 실행·배포 설정, 환경변수 이름 목록(값 없음) |
| 신규 | `prisma/schema.prisma`, `prisma/migrations/0001_init/` | 5번의 12개 테이블, CHECK·부분 UNIQUE SQL |
| 신규 | `prisma/seed.ts` | 데모초등학교(is\_demo), 15학급 × 28명, 테스트 계정(비밀번호는 환경변수) |
| 신규 | `server/src/index.ts`, `app.ts`, `env.ts`, `db.ts`, `routes/health.ts` | 환경변수 검사, DB 연결, `/api/health`, 빌드된 화면 제공 |
| 신규 | `client/index.html`, `client/src/main.tsx`, `App.tsx` | ‘SAFE SCHOOL 준비 중’ 화면과 서버 상태 표시 |
| 신규 | `shared/constants.ts` | 재난 유형, 역할 등 공통 값 |
| 신규 | `tests/db-constraints.test.ts` | 합계 불일치·음수·중복 발령이 DB에서 거부되는지 |
| 신규 | `README.md` | 설치·실행·백업·Replit 가져오기 절차(한국어) |

Replit Shell에서 실행할 명령(예정)은 다음과 같습니다. 실제 명령은 코드와 함께 확정해 드립니다.

```bash
npm install
npm run db:migrate
npm run db:seed
npm test
npm run dev
```

### 10. Replit 배포 최소 설정

| 항목 | 설정 | 비고 |
| --- | --- | --- |
| 데이터베이스 | Replit PostgreSQL 추가 → `DATABASE_URL` 자동 생성 | 개발용과 배포용 DB가 나뉘는지 확인 필요 |
| Secrets | `SESSION_SECRET`, `BOOTSTRAP_TOKEN`, `APP_BASE_URL`, `DEMO_PASSWORD` | 긴 무작위 문자열은 Claude가 만드는 법을 안내 |
| Secrets(STEP 2) | `MAIL_PROVIDER`, `MAIL_API_KEY`, `MAIL_FROM` | 미설정 시 개발 모드 |
| Secrets(STEP 4) | `VAPID_PUBLIC_KEY`, `VAPID_PRIVATE_KEY`, `VAPID_SUBJECT` | 웹 푸시용 |
| Secrets(STEP 5) | `NEIS_API_KEY` | 선택 |
| 빌드 명령 | `npm ci && npm run build && npx prisma migrate deploy` | 배포할 때마다 마이그레이션을 안전하게 적용(데이터 삭제 없음) |
| 실행 명령 | `npm start` | 포트는 `PORT` 환경변수 |
| 배포 유형 | 시범 기간에는 Reserved VM 권장, 비용이 부담되면 Autoscale | Autoscale은 첫 접속 지연이 있을 수 있음. 월 비용은 확인 필요 |
| 상태 확인 | `/api/health` | 배포 후 브라우저로 열어 `ok` 확인 |
| 백업 | 모의훈련 전후와 매주 1회 `pg_dump` | 백업 파일은 학교 승인 저장소에 보관. 개인 PC·GitHub에는 보관하지 않음 |

## A. 요구사항 명세서

SAFE SCHOOL은 재난 발령부터 반별 보고, 실시간 집계, 학부모 안내, 종료 보고서까지를 하나로 잇는 보조 업무시스템입니다. 나이스, 학교안전지원시스템 등 공식 체계는 대체하지 않습니다. 우선순위는 18항을 따릅니다.

### A-1. 기능 요구사항

| ID | 요구사항 | 수용 기준(요약) | 우선 |
| --- | --- | --- | --- |
| FR-AUTH-01 | 교직원이 기관 이메일로 가입하고, 인증코드로 소유를 확인한다 | 코드 유효 10분, 5회 오류 시 잠금, 재발송 60초 간격·시간당 5회 | P0 |
| FR-AUTH-02 | 학교코드를 입력해 가입을 신청하고, 학교 관리자가 승인하거나 거절한다 | 미승인 계정은 모든 업무 API에서 403 | P0 |
| FR-AUTH-03 | 관리자가 역할과 담당 학급을 배정하고, 계정을 비활성화하거나 권한을 회수한다 | 회수 즉시 기존 세션 무효화 | P0 |
| FR-AUTH-04 | 비밀번호 재설정 | 일회용 토큰 30분, 사용 후 폐기 | P0 |
| FR-AUTH-05 | 학교 최초 관리자를 개설한다 | 운영자 전용 일회용 초대 링크, 환경변수 비밀키로만 발급 | P0 |
| FR-AUTH-06 | EPKI 연결 구조(비활성) | UserIdentities 테이블만 준비, 기능 플래그 OFF | P2 |
| FR-ORG-01 | 학교·학년·학급·재적 인원을 관리한다 | 학급별 재적은 0\~60 정수 | P0 |
| FR-EVT-01 | 관리자가 재난을 발령한다(유형, 실제/훈련, 장소, 대피장소, 안내) | 학교당 진행 중 상황은 1건, 2단계 확인 후 발령 | P0 |
| FR-EVT-02 | 상황을 갱신하고 종료한다 | 종료 후 보고 입력은 차단, 기록은 보존 | P0 |
| FR-RPT-01 | 담임이 학급 인원을 보고한다 | 대피확인 + 미확인 = 재적, 부상자 ≤ 대피확인, 음수 금지 | P0 |
| FR-RPT-02 | 보고를 수정하고 이력을 보존한다 | 버전 번호 기반 낙관적 잠금, 멱등키로 중복 저장 방지 | P0 |
| FR-RPT-03 | 통신 장애 시 기기에 임시 저장하고 재전송한다 | ‘미전송’ 배지, 서버 응답 전에는 ‘저장 완료’ 표시 금지 | P0 |
| FR-DASH-01 | 관리자 상황판에 7항의 10개 지표를 표시한다 | 미보고 학급 인원은 ‘보고 대기’로 별도 집계 | P0 |
| FR-DASH-02 | 5초 간격으로 자동 갱신하고, 지연을 표시한다 | 마지막 성공 시각 표시, 15초 초과 시 경고 | P0 |
| FR-NTC-01 | 발령·갱신·종료 시 안내문 초안을 생성한다 | 서버 집계값만 사용, 미보고 상태는 ‘확인 중’으로 표기 | P0 |
| FR-NTC-02 | 관리자 승인 후 공개 페이지에 게시하고 웹 푸시를 보낸다 | 승인 전 외부 노출 0건, 훈련 알림은 제목에 \[훈련\] 강제 | P0 |
| FR-NTC-03 | 하이클래스·문자용 문구를 복사하고 발송 확인을 기록한다 | 단문 90바이트·장문 버전 | P0 |
| FR-NTC-04 | SMS/LMS API 어댑터 | 계약이 없으면 테스트 모드만 동작 | P1 |
| FR-REP-01 | 상황 보고서를 PDF(인쇄)와 CSV로 내보낸다 | 반별 최종값, 수정 횟수, 소요시간 | P0 |
| FR-AUD-01 | 발령·보고·승인·발송·권한 변경을 감사 로그에 기록한다 | 수정·삭제 불가(append-only) | P0 |
| FR-INS-01 | 시설 점검, 불량 항목 자동 목록화, 조치 담당과 이력 | 불량 저장 시 조치 건 자동 생성 | P1 |
| FR-DRL-01 | 훈련 계획→실시→평가→개선 연결 | 훈련 모드 발령을 계획과 연결 | P1 |
| FR-GDE-01 | 행동요령(출처·최종 검토일)과 비상연락망 | `tel:` 링크로 바로 전화 | P1 |
| FR-NEIS-01 | 나이스 공개 API로 학교를 검색하고 학사일정을 조회한다 | 장애 시 수동 입력으로 대체 | P1 |

### A-2. 비기능 요구사항

| ID | 분류 | 요구사항 |
| --- | --- | --- |
| NFR-01 | 보안 | 비밀번호는 argon2id(또는 bcrypt 12)로 해시, 세션은 HttpOnly·Secure·SameSite=Lax 쿠키로 다루고 서버에 저장 |
| NFR-02 | 권한 | 모든 API에서 역할과 school\_id를 서버가 검사하고, 클라이언트가 보낸 school\_id는 신뢰하지 않음 |
| NFR-03 | 가용성 | 보고 API p95 1초 이내(동시 보고 15건 기준), 재시작 후 데이터 유지 |
| NFR-04 | 개인정보 | 학생 실명 미수집, 학부모 연락처는 P1 도입 시 AES-256-GCM으로 암호화 |
| NFR-05 | 요청 제한 | 로그인·인증코드·구독 API에 IP·계정별 rate limit |
| NFR-06 | 접근성 | 색상 외에 문구·아이콘으로 상태를 표시, 터치 영역 48px 이상, 본문 대비 4.5:1 이상 |
| NFR-07 | 데이터 분리 | 데모 학교는 is\_demo 플래그로 구분하고, 데모 초기화는 데모 학교에만 적용 |
| NFR-08 | 보존 | 감사 로그·상황 기록의 보존 기간은 학교 규정을 확인해 확정(미확정) |

### A-3. 업무경감 효과(가설)

아래 ‘기존 방식’은 일반적인 학교 절차를 가정한 것이므로, 우리 학교의 실제 절차로 고쳐야 합니다. 기존 업무의 시간 기록이 없으므로, STEP 8에서 절차 비교·앱 기록·담당자 후기로 검증합니다(개발 진행 가이드 7번).

| 기능 | 기존 방식·단계(확인 필요) | 개선 방식 | 사라지는 단계 | 새로 생기는 일 | 단축 원인(가설) | 측정 지표 |
| --- | --- | --- | --- | --- | --- | --- |
| 학급 인원 보고 | 담임이 인원을 센 뒤 안전담당자에게 구두·메신저로 전달(반마다 1회, 누락 시 재확인 전화) | 폰에서 ‘대피 확인 인원’만 입력. 재적은 자동으로 불러오고 미확인은 자동 계산 | 재확인 전화, 담당자의 받아적기 | 앱 로그인 상태 유지(사전 1회) | 입력 항목 1개, 전달·전사 없음 | 발령→전 학급 보고 완료까지 걸린 분, 재확인 연락 횟수 |
| 관리자 집계 | 담당자가 종이·화이트보드에 반별 숫자를 적고 합산, 미보고 반을 눈으로 찾음 | 상황판이 자동 합산하고 미보고·미확인·부상 학급을 구분 표시 | 수기 합산, 미보고 반 찾기 | 없음 | 계산·대조 자동화 | 집계 완료 시각, 합계 오류 건수 |
| 상황·훈련 결과 보고서 | 종료 후 한글 문서에 시각·반별 인원을 다시 입력 | 보고 데이터로 PDF·CSV 자동 생성 | 반별 수치 재입력 | 특이사항·평가 문장 검토 | 같은 데이터 재사용 | 보고서 작성 소요 분 |
| 학부모 안내 | 담당자가 상황을 파악한 뒤 문구를 새로 작성해 문자·하이클래스에 따로 입력 | 집계값으로 초안 자동 생성 → 승인 1회 → 푸시·공개페이지 게시, 채널별 문구 복사 | 문구 작성, 채널별 재작성 | 승인·복사 붙여넣기, 발송 확인 클릭 | 초안 자동화, 한 문안을 여러 채널에 재사용 | 발령→첫 학부모 안내까지 분 |
| 시설 점검 | 종이 점검표 작성 후 엑셀에 옮겨 적고, 불량 항목은 별도 정리 | 현장에서 폰으로 체크, 불량은 조치 목록에 자동 등록, 월별 보고서 자동 | 엑셀 옮겨 적기, 불량 목록 정리 | 최초 템플릿 확인 1회 | 전사 제거 | 월 점검 보고 소요 분, 조치 완료율 |
| 훈련 실적 | 훈련마다 계획·결과·사진을 따로 모아 연말 실적 작성 | 훈련 모드 발령 기록이 실적에 자동 연결, 실시율 자동 계산 | 실적 취합 | 평가·개선사항 입력 | 대피 보고 데이터 재사용 | 연간 실적 보고 소요 분 |

**오히려 업무가 늘 수 있는 상황과 대비**

- 앱·통신이 죽으면 보고가 이중으로 될 수 있습니다. 기존 구두·무전 보고를 우선 절차로 두고, 앱에는 ‘나중에 입력’을 허용합니다.
- 로그인 만료로 재난 중 막힐 수 있습니다. 교직원 세션을 30일로 길게 유지하고, 기기별 로그아웃을 제공합니다.
- 가입·승인 업무가 새로 생깁니다. 학기 초 1회로 끝나며, 관리자는 담임 배정을 표로 한 번에 처리합니다.
- 담당자가 학교안전지원시스템에 다시 입력해야 할 수 있습니다. 그 시스템의 입력 항목 순서에 맞춘 보고서 형식을 STEP 4에서 확인해 맞춥니다.

## B. 전체 아키텍처 제안

하나의 GitHub 저장소에 client(React)와 server(Express)를 두고, 입력 규칙은 공유 Zod 스키마(shared 폴더) 하나로 화면과 서버가 함께 씁니다. 규칙이 한 곳에 있어 어긋날 일이 없고, 서버는 빌드된 화면까지 함께 제공해 Replit에서 실행 명령 하나로 동작합니다.

| 계층 | 선택 | 이유 | 상태 |
| --- | --- | --- | --- |
| 화면 | React + TypeScript + Tailwind, PWA(서비스 워커) | 모바일 우선, 홈 화면 설치, 웹 푸시 수신, 보고 임시저장 | 설계 |
| API 명세 | `공유 Zod 스키마 + 타입` | 코드생성 단계가 없어 비전문가도 흐름을 따라가기 쉬움 | 설계 |
| 서버 | Express 5 + 미들웨어(세션 → 승인상태 → 역할 → 학교 범위 → 감사 로그) | 권한 검사를 한 곳에서 처리 | 설계 |
| DB | PostgreSQL + Prisma, 모든 업무 테이블에 school\_id | 학교별 격리, 트랜잭션으로 집계 정확성 확보 | 설계 |
| 세션 | DB 저장 세션(connect-pg-simple 등) | 권한 회수 즉시 무효화가 가능(JWT보다 유리) | 설계 |
| 실시간 | 5초 폴링(우선), SSE는 후순위 | Replit Autoscale에서 연결 유지형 통신은 인스턴스가 바뀌면 끊길 수 있음 | 설계 |
| 메일 | 인증코드 발송 어댑터(Resend/SMTP 등), 미설정 시 개발 모드에서만 콘솔 출력 | 외부 서비스 계정이 필요하며 승인 여부 미확인 | 설계 |
| 푸시 | web-push(VAPID 키는 Replit Secrets) | 표준 Web Push, 별도 비용 없음 | 설계 |
| 배포 | Replit Deployments, Reserved VM 권장 | 재난 시 첫 응답 지연(콜드스타트)을 없애기 위함, 비용 확인 필요 | 설계 |
| 버전 관리 | GitHub 연결, 단계마다 커밋·태그 | 회귀 시 되돌리기, 경진대회 개발과정 증빙 | 설계 |

앱에 접속할 수 없는 상황을 대비해, 행동요령과 비상연락망은 서비스 워커가 기기에 캐시하고 인쇄본(PDF)도 제공합니다.

## C. 사용자·권한 및 DB 설계

권한은 ‘승인된 소속(SchoolMembership)’ 단위로 부여합니다. 사람을 나타내는 User, 로그인 수단을 나타내는 UserIdentity, 학교·역할을 나타내는 Membership을 분리해서, 전보는 소속만 바꾸면 되고 EPKI는 인증수단만 추가하면 됩니다.

### C-1. 권한 매트릭스

○ = 가능, △ = 담당 범위만(담임은 배정 학급, 일반 교직원은 배정 업무), × = 불가

| 기능 | 학교 관리자 | 담임교사 | 일반 교직원 | 학부모(비로그인) |
| --- | --- | --- | --- | --- |
| 가입 승인, 역할·학급 배정, 권한 회수 | ○ | × | × | × |
| 학교·학급·재적 관리 | ○ | × | × | × |
| 재난 발령·갱신·종료 | ○ | × | × | × |
| 학급 인원 보고·수정 | ○(대리 보고, 사유 필수) | △ | △(보결·전담 등 배정 시) | × |
| 상황판 전체 조회 | ○ | △(자기 반 + 전교 합계) | △(전교 합계) | × |
| 학부모 안내문 작성·승인·발송 | ○ | × | × | × |
| 승인된 공개 공지 조회, 푸시 구독·해지 | ○ | ○ | ○ | ○ |
| 시설 점검 입력 | ○ | △ | △ | × |
| 점검 항목 편집, 조치 담당 배정 | ○ | × | × | × |
| 조치 완료 처리 | ○ | △(배정된 건) | △(배정된 건) | × |
| 훈련 계획·평가 편집 | ○ | × | × | × |
| 행동요령·연락망 조회 / 편집 | ○ / ○ | ○ / × | ○ / × | × / × |
| 보고서 출력, 감사 로그 조회 | ○ | × | × | × |

모든 검사는 서버가 세션의 membership에서 school\_id와 역할을 읽어 수행합니다. 다른 학교 자원을 요청하면 존재 여부를 드러내지 않도록 404를 돌려줍니다.

### C-2. 테이블 설계(Prisma / PostgreSQL)

공통 규칙: PK는 uuid, 모든 테이블에 created\_at·updated\_at(timestamptz), 업무 테이블에는 school\_id FK(NOT NULL)와 school\_id로 시작하는 복합 인덱스를 둡니다.

| 테이블 | 주요 컨럼 | FK | 제약조건·인덱스 |
| --- | --- | --- | --- |
| schools | name, neis\_code, edu\_office\_code, join\_code\_hash, is\_demo, status | — | UNIQUE(neis\_code), UNIQUE(join\_code\_hash) |
| users | display\_name, email, email\_verified\_at, password\_hash, status(active/disabled) | — | UNIQUE(lower(email)) |
| user\_identities | provider(password/epki), provider\_subject, linked\_at | user\_id | UNIQUE(provider, provider\_subject) |
| email\_verifications | code\_hash, purpose(signup/reset), expires\_at, attempts, consumed\_at | user\_id | INDEX(user\_id, purpose), attempts ≤ 5 |
| sessions | sid, sess(json), expire | — | INDEX(expire); 권한 회수 시 user\_id로 일괄 삭제 |
| school\_memberships | role(admin/homeroom/staff), status(pending/approved/rejected/revoked), approved\_by, revoked\_at | school\_id, user\_id | UNIQUE(school\_id, user\_id) |
| classes | grade, class\_no, label, enrolled\_count, active | school\_id | UNIQUE(school\_id, grade, class\_no), CHECK(enrolled\_count BETWEEN 0 AND 60) |
| class\_assignments | duty(homeroom/assist/inspection) | membership\_id, class\_id | UNIQUE(membership\_id, class\_id, duty) |
| disaster\_events | type, mode(real/drill), location, evac\_place, message, status(active/closed), started\_at, closed\_at, drill\_plan\_id | school\_id, created\_by | **부분 UNIQUE(school\_id) WHERE status='active'** → 중복 발령 차단 |
| evacuation\_reports | enrolled\_snapshot, evacuated, unconfirmed, injured, note, version, reported\_by, reported\_at | event\_id, class\_id, school\_id | UNIQUE(event\_id, class\_id), CHECK(evacuated + unconfirmed = enrolled\_snapshot), CHECK(각 값 ≥ 0), CHECK(injured ≤ evacuated) |
| evacuation\_report\_revisions | version, 값 전체 스냅샷, idempotency\_key, changed\_by, reason | report\_id | UNIQUE(idempotency\_key), UNIQUE(report\_id, version) |
| parent\_notices | event\_id, kind(issued/update/closed), mode, title, body, sms\_short, sms\_long, status(draft/approved/published), approved\_by, published\_at | school\_id | INDEX(school\_id, published\_at DESC) |
| notification\_subscriptions | endpoint, p256dh, auth, active, last\_success\_at | school\_id | UNIQUE(endpoint) |
| notification\_recipients(P1) | phone\_enc, phone\_hash, class\_id, consent\_at | school\_id | UNIQUE(school\_id, phone\_hash) |
| notification\_deliveries | channel(push/sms/manual), target\_ref, status(queued/sent/failed/confirmed), provider\_msg\_id, error, attempt | notice\_id | UNIQUE(notice\_id, channel, target\_ref) → 중복 발송 방지 |
| inspection\_templates | place\_type, items(jsonb: 항목 목록), version | school\_id | INDEX(school\_id, place\_type) |
| inspections / inspection\_items | place, inspected\_at, inspector / item\_key, result(ok/bad/na), memo, photo\_key | template\_id, school\_id | INDEX(school\_id, inspected\_at) |
| corrective\_actions | status(open/in\_progress/done), assignee, due\_date, done\_at, done\_note | inspection\_item\_id, school\_id | INDEX(school\_id, status) |
| drill\_plans | drill\_type, planned\_date, target, status | school\_id | INDEX(school\_id, planned\_date) |
| drill\_results | duration\_sec, participants, evaluation, improvements, follow\_up | drill\_plan\_id, event\_id | UNIQUE(event\_id) |
| guides | disaster\_type, phase(immediate/during/after), steps(jsonb), source\_name, source\_url, reviewed\_at | school\_id | UNIQUE(school\_id, disaster\_type, phase) |
| emergency\_contacts | label, org, phone, sort\_order | school\_id | INDEX(school\_id, sort\_order) |
| audit\_logs | actor\_user\_id, action, target\_type, target\_id, before/after(jsonb), ip, at | school\_id | append-only: 앱 DB 계정의 UPDATE·DELETE 권한 회수, INDEX(school\_id, at DESC) |

집계의 정확성은 ‘발령 시점 재적 스냅샷(enrolled\_snapshot)’으로 보장합니다. 상황 중에 관리자가 재적 인원을 바꿔도 이미 들어온 보고의 합계가 깨지지 않습니다. 사진은 P1에서 Replit Object Storage에 저장하고, DB에는 키만 둡니다(미검증).

## D. 프론트엔드 화면 목록

화면은 27개 항목(P0 19, P1 8)입니다. 재난 중에는 담임이 앱을 열자마자 ‘우리 반 보고’ 화면으로 바로 가서, 메뉴를 찾지 않아도 됩니다.

| 경로 | 화면 | 사용자 | 우선 |
| --- | --- | --- | --- |
| /login | 로그인 | 교직원 | P0 |
| /signup → /signup/verify | 가입(기관 이메일·학교코드) → 인증코드 입력 | 교직원 | P0 |
| /pending | 승인 대기 안내 | 미승인 계정 | P0 |
| /reset, /reset/:token | 비밀번호 재설정 | 교직원 | P0 |
| /bootstrap/:token | 학교 최초 관리자 개설 | 운영자가 초대한 사람 | P0 |
| / | 홈: 평시에는 할 일 요약, 상황 중에는 상황판(관리자)이나 우리 반 보고(담임)로 자동 전환 | 전체 | P0 |
| 전역 배너 | 상단 고정 ‘실제 상황’(빨강)·‘훈련 중’(주황·빗금 패턴) 문구와 경과시간 | 교직원 | P0 |
| /admin/members | 가입 승인·거절, 역할·학급 배정, 비활성화 | 관리자 | P0 |
| /admin/school | 학교 정보, 학급·재적 일괄 편집, 학교코드 재발급 | 관리자 | P0 |
| /events/new | 재난 발령(유형 큰 버튼 → 실제/훈련 → 장소 → 확인 슬라이드) | 관리자 | P0 |
| /events/:id/board | 실시간 상황판(지표 10개, 반별 타일, 갱신 지연 표시) | 관리자 | P0 |
| /events/:id/report-class | 학급 보고(숫자 패드, 합계 자동 검산, 미전송 배지) | 담임·배정 교직원 | P0 |
| /events/:id/manage | 상황 갱신·종료 | 관리자 | P0 |
| /events/:id/notices | 학부모 안내문 초안 → 수정 → 승인 → 게시·푸시, 문자용 복사, 발송 확인 기록 | 관리자 | P0 |
| /events/:id/summary | 상황 보고서(인쇄·PDF, CSV) | 관리자 | P0 |
| /events | 상황 이력 목록 | 관리자 | P0 |
| /admin/audit | 감사 로그 조회·필터 | 관리자 | P0 |
| /p/:schoolSlug | 학부모 공개 공지, 알림 받기·해제, 기기별 안내(iOS는 홈 화면 추가 후 구독) | 학부모 | P0 |
| /admin/qr | 학부모 안내 QR 포스터 인쇄 | 관리자 | P0 |
| /inspections, /inspections/new | 점검 목록, 장소별 체크리스트 입력(사진·메모) | 교직원 | P1 |
| /actions | 조치 필요 목록, 담당 배정, 완료 처리 | 관리자·담당자 | P1 |
| /admin/templates | 점검 항목 편집 | 관리자 | P1 |
| /inspections/stats | 월별 점검 통계 | 관리자 | P1 |
| /drills, /drills/:id | 연간 계획(월별), 실시 결과·평가·개선사항, 실시율, 실적 보고서 | 관리자 | P1 |
| /guides, /guides/:type | 유형별 행동요령 카드(출처·최종 검토일), 오프라인 캐시 | 교직원 | P1 |
| /contacts | 비상연락망, 바로 전화, 인쇄본 | 교직원 | P1 |
| /admin/integrations | 나이스 학교 검색·학사일정, 문자 API 상태(테스트 모드 표시) | 관리자 | P1 |

## E. 백엔드 API 목록

모든 API는 `/api` 아래에 두고 OpenAPI 명세로 정의합니다. 상태를 바꾸는 요청은 CSRF 토큰과 세션을 검사하고, 보고·발령·발송은 `Idempotency-Key` 헤더를 필수로 받습니다. 권한 열의 A는 관리자, H는 담임, S는 일반 교직원, ‘공개’는 비로그인입니다.

| 메서드 · 경로 | 기능 | 권한 | 우선 |
| --- | --- | --- | --- |
| POST /auth/signup | 가입 신청, 인증코드 발송 | 공개(rate limit) | P0 |
| POST /auth/verify-email, POST /auth/resend-code | 코드 확인, 재발송(60초·시간당 5회) | 공개 | P0 |
| POST /auth/login, POST /auth/logout, GET /auth/me | 로그인, 로그아웃, 내 정보·소속·권한 | 공개 / 로그인 | P0 |
| POST /auth/password/forgot, POST /auth/password/reset | 비밀번호 재설정 | 공개 | P0 |
| POST /bootstrap/school | 최초 학교·관리자 개설(환경변수 토큰) | 운영자 | P0 |
| GET /members?status=pending | 가입 대기 목록 | A | P0 |
| POST /members/:id/approve · /reject · /revoke | 승인, 거절, 권한 회수(세션 즉시 삭제) | A | P0 |
| PUT /members/:id/role, PUT /members/:id/assignments | 역할, 담당 학급·업무 | A | P0 |
| GET/PUT /school, POST /school/join-code | 학교 정보, 학교코드 재발급 | A | P0 |
| GET /classes, PUT /classes(일괄) | 학급·재적 | 조회 A·H·S / 수정 A | P0 |
| GET /events/active | 진행 중 상황(배너용) | A·H·S | P0 |
| POST /events | 발령(진행 중이면 409), 재적 스냅샷 생성 | A | P0 |
| PATCH /events/:id, POST /events/:id/close | 갱신, 종료 | A | P0 |
| GET /events, GET /events/:id | 이력, 상세 | A | P0 |
| GET /events/:id/board | 상황판 집계(서버 계산, `serverTime` 포함) | A(전체) / H·S(합계) | P0 |
| PUT /events/:id/reports/:classId | 학급 보고 생성·수정(`expectedVersion` 불일치 시 409) | H·S(배정 학급), A(사유 필수) | P0 |
| GET /events/:id/reports/:classId/revisions | 수정 이력 | A·H(본인 학급) | P0 |
| GET /events/:id/summary(.csv) | 상황 보고서 데이터, CSV | A | P0 |
| POST /events/:id/notices/draft | 안내문 초안(서버 집계로 템플릿 생성) | A | P0 |
| PUT /notices/:id, POST /notices/:id/approve | 수정, 승인·게시·푸시 발송 큐 등록 | A | P0 |
| POST /notices/:id/manual-sent | 하이클래스·문자 수동 발송 확인 기록 | A | P0 |
| GET /notices/:id/deliveries | 발송 상태 | A | P0 |
| GET /public/:slug/notices | 승인된 공지만 | 공개 | P0 |
| GET /public/vapid-key, POST /public/:slug/subscribe, POST /public/unsubscribe | 푸시 구독·해지 | 공개(rate limit) | P0 |
| GET /audit-logs | 감사 로그(기간·행위·사용자 필터) | A | P0 |
| GET /health | 상태 확인(DB 연결 포함) | 공개 | P0 |
| GET/POST /inspections, GET/PUT /inspection-templates | 점검, 템플릿 | 입력 A·H·S / 템플릿 A | P1 |
| POST /uploads/photo | 점검 사진(용량·형식 제한, EXIF 제거) | A·H·S | P1 |
| GET /actions, PATCH /actions/:id | 조치 목록, 배정·완료 | A / 담당자 | P1 |
| GET /inspections/stats?month= | 월별 통계 | A | P1 |
| CRUD /drill-plans, PUT /drill-plans/:id/result, GET /drills/report | 훈련 계획·결과·실적 보고서 | A | P1 |
| GET/PUT /guides, GET/PUT /contacts | 행동요령, 연락망 | 조회 전체 / 수정 A | P1 |
| GET /neis/schools?q=, GET /neis/schedule | 나이스 학교 검색·학사일정(서버 프록시, 키는 환경변수) | A | P1 |
| POST /notices/:id/sms | 문자 발송(테스트 모드 기본) | A | P1 |

오류 응답은 `{ code, message }` 형식으로 통일합니다. 401은 미로그인, 403은 권한 없음·미승인, 404는 없거나 다른 학교 자원, 409는 중복 발령·버전 충돌, 422는 합계 불일치, 429는 요청 과다입니다.

## F. 외부 플랫폼 연동 가능성과 제약

11월 10일 전에 확실히 구현할 수 있는 연동은 나이스 공개 API와 웹 푸시 두 가지뿐입니다. 나머지는 계약이나 공식 승인이 필요해서 ‘구조만 준비’하거나 ‘복사·내보내기’ 방식으로 대신합니다. 연동이 실패해도 발령·보고·집계는 외부 서비스 없이 동작합니다.

| 대상 | 이번 대회 전 범위 | 필요 조건·제약 | 판단 근거 |
| --- | --- | --- | --- |
| 나이스 교육정보 개방 포털 | 학교 검색(학교기본정보), 학사일정 조회 | 인증키 발급(회원가입), 호출 한도 있음. 학생 명단은 제공되지 않으며 조회하지 않음 | 공개 API(사용자 신청으로 키 발급) — 세부 호출 한도는 포털에서 확인 필요 |
| 웹 푸시 | 학부모 구독·발송·해지 | Android Chrome은 바로 가능. iPhone은 iOS 16.4 이상에서 ‘홈 화면에 추가’한 경우에만 가능. 도달이 보장되지 않아 유일 수단으로 쓰지 않음 | 웹 표준, 별도 계약 불필요 |
| 하이클래스 | 공지문 복사 + ‘수동 발송 완료’ 기록 | 공개된 외부 연동 API를 확인하지 못함. 자동 로그인·크롤링은 구현하지 않음 | 미확인 — 제공사 문의 필요 |
| SMS/LMS | 어댑터 구조 + 테스트 모드(가상 번호, 실제 발송 없음) | 문자 대행사 계약, 발신번호 사전등록, 건당 비용, 학부모 연락처 처리 근거·학교 승인 | 대행사·비용 미정, 학교 기존 문자 서비스 활용 여부 확인 필요 |
| 카카오 알림톡 | 구조만 고려(P2) | 비즈니스 채널, 대행사 계약, 템플릿 사전 심사 | 대회 일정 내 불가로 판단 |
| EPKI(교육부 인증서) | user\_identities 테이블과 provider 구조만(비활성) | 교육부·운영기관의 공식 연계 승인과 기술 명세. 인증서·개인키는 어떤 경우에도 업로드받지 않음 | 승인 절차 미확인 |
| 학교안전지원시스템 | 서식 참고한 PDF·CSV 보고자료(수동 입력용) | 공개 API·자료 연계 규격 미확인, 자동 제출 구현 안 함 | 미확인 |
| 이메일 발송(인증코드) | 발송 어댑터 + 개발 모드 콘솔 출력 | 메일 발송 서비스 계정 필요. 일부 교육청 메일 서버가 외부 발송 메일을 스팸 처리할 가능성 | 서비스 선정 필요 — 실제 도달 테스트로 확인 |
| Replit 호스팅 자체 | 데모·시범 운영 | 서버가 국외(미국)에 있어 실제 개인정보를 다루는 운영은 국외이전·교육청 보안 기준 검토 대상. 그래서 시범 운영은 개인정보 없는 범위(반별 인원수, 교직원 기관 이메일만)로 한정 | 학교·교육청 정보보안 담당자 확인 필요 |

## G. 11월 10일 제출을 위한 개발 일정

남은 기간은 21일입니다. 핵심은 STEP 5까지 11월 5일에 끝내, 서면심사 전에 ‘실제 업무 활용’ 증빙을 남길 기간을 확보하는 것입니다.

&#91;embedded content: 개발 일정 · STEP 0\~7, 21일\]

일정을 좌우하는 것은 개발보다 학교 승인입니다. 다음 세 가지는 이번 주 안에 시작해야 합니다.

- [ ] 참가 자격(학교 교직원이 ‘지방정부 소속’에 포함되는지)과 제출 경로(시·도 취합 여부)를 행안부 재난정보통신과(044-205-5285)에 확인
- [ ] 학교 관리자에게 시범 사용과 모의훈련 날짜(11월 4\~7일 중) 승인 요청
- [ ] 부서장 확인 서명을 받을 일정 확보(참가신청서 필수)

## H. 기능별 우선순위와 위험도

가장 위험한 것은 코드가 아니라 ‘실제 사용 증빙’과 ‘인증 메일 도달’입니다. 두 가지 모두 외부 조건에 달려 있어서, 각각 대체안을 미리 정해 둡니다.

| 기능 | 우선 | 위험도 | 주요 위험 | 대응 |
| --- | --- | --- | --- | --- |
| 실제 업무 활용 증빙 | — | 높음 | 서면심사 전 실사용 요건(30+40점) 미충족 | 11월 4\~7일 학교 승인 모의훈련 1회 + 평시 점검 사용 기록, 화면 녹화·감사 로그 추출 |
| 기관 이메일 인증 | P0 | 높음 | 교육청 메일 서버의 스팸 차단, 메일 서비스 계정 미확보 | STEP 1 첫날 실제 주소로 도달 테스트. 실패 시 ‘관리자 발급 초대코드’로 대체(관리자 승인은 유지) |
| 학교별 데이터 격리·권한 | P0 | 높음 | API 하나의 검사 누락이 다른 학교 데이터 노출로 이어짐 | 공통 미들웨어 + 저장소 함수가 school\_id를 항상 요구, 학교 2개로 교차 접근 자동 테스트 |
| 학급 보고·동시 수정 | P0 | 중간 | 중복 저장, 덮어쓰기, 저장 실패인데 완료로 표시 | DB CHECK 제약 + version + 멱등키, 동시 15건 부하 테스트 |
| 상황판 집계 정확성 | P0 | 중간 | 미보고 인원을 대피/미확인으로 잘못 합산 | 서버 단일 집계 함수 + 수작업 기대값과 비교하는 단위 테스트 |
| 재난 발령·종료 | P0 | 낮음 | 중복 발령, 실제/훈련 혼동 | 부분 UNIQUE 인덱스, 훈련은 문구·색·패턴을 모두 다르게 표시 |
| 학부모 웹 푸시 | P0 | 중간 | iPhone 구독 제약, 도달 미보장 | 공개 공지 페이지와 문자용 문구 복사를 항상 병행, 기기별 안내 문구 |
| 안내문 초안 생성 | P0 | 중간 | 확인되지 않은 ‘모두 안전’ 문구 노출 | LLM 미사용, 서버 템플릿 + 집계값만, 미보고 학급 있으면 ‘확인 중’ 강제, 승인 전 비공개 |
| 상황 보고서(PDF·CSV) | P0 | 낮음 | 한글 깨짐(CSV 엑셀) | UTF-8 BOM, 인쇄용 CSS로 PDF 저장 |
| 감사 로그 | P0 | 낮음 | 로그 누락 | 서비스 계층에서 업무 처리와 같은 트랜잭션으로 기록 |
| Replit 배포·가용성 | P0 | 중간 | 콜드스타트 지연, 비용, 국외 호스팅 | Reserved VM 비용 확인 후 결정, 개인정보 없는 범위로 시범 운영 |
| 시설 점검·조치 | P1 | 낮음 | 사진 저장소 용량·개인정보(사진 속 사람) | 용량 제한, EXIF 제거, 촬영 안내 문구 |
| 안전훈련 관리 | P1 | 낮음 | — | 훈련 모드 발령과 drill\_plan\_id로 연결 |
| 행동요령·연락망 | P1 | 중간 | 내용이 공식 지침과 다름 | 출처·최종 검토일 필수, 학교 안전계획 기준으로 담당자 검토 |
| 나이스 공개 API | P1 | 낮음 | 키 발급 지연, 호출 한도 | 실패 시 수동 입력, 응답 캐시 |
| SMS 실발송 | P1 | 높음 | 계약·발신번호·개인정보 근거 미확보 | 대회까지 테스트 모드만, 실발송은 학교 승인 후 |
| EPKI, 하이클래스 연동, 알림톡 | P2 | 높음 | 공식 승인 없음 | 구조만 준비, 비활성 |

일정이 밀리면 P1 중 **행동요령·연락망과 안전훈련**을 먼저 살립니다. 모의훈련 실적과 바로 이어지는 기능이기 때문입니다. 시설 점검은 단순화한 체크리스트 버전으로, 나이스 연동은 학교 검색만 구현합니다.

## I. STEP 0 분석 결과와 준비사항

개발 방식이 바뀌어 STEP 0은 Replit Agent 대신 Claude가 수행했습니다. 기존 Replit 프로젝트는 빈 템플릿이어서 보존할 코드·DB가 없고, 새 저장소로 시작해도 잃는 것이 없습니다.

**Agent 없이 하는 Replit 환경 확인(크레딧 소모 없음).** Replit 프로젝트의 Shell 탭에 아래를 붙여넣고, 출력 결과를 그대로 Claude에게 전달하세요. 비밀번호가 들어 있는 DATABASE\_URL은 앞 몇 글자만 출력됩니다.

```bash
node -v; npm -v; git --version
echo "DB: ${DATABASE_URL:0:13}..."
psql "$DATABASE_URL" -c "select version();" 2>&1 | head -3
psql "$DATABASE_URL" -c "\dt" 2>&1 | head -20
```

**사용자가 준비할 것**

- [ ] GitHub 계정과 저장소 이름 정하기(예: safe-school, 비공개 권장). Claude가 저장소에 올릴 수 있도록 이 세션에 저장소를 연결
- [ ] 위 Shell 명령 결과 전달(또는 Replit에서 PostgreSQL 데이터베이스 추가 여부 확인)
- [ ] 인증코드 메일 발송 방법 정하기: 메일 발송 서비스 계정(Resend 등) 또는 학교가 허용하는 SMTP. 정해질 때까지는 개발 모드(화면·로그에 코드 표시)로 진행
- [ ] A-3 표의 ‘기존 방식’을 우리 학교의 실제 절차로 고치기(현재 대피훈련 때 인원 보고와 학부모 안내를 어떻게 하는지)
- [ ] 데모 학교 구성(1\~3학년 × 5학급 × 28명) 유지 여부

**STEP 1 개발 지시문(Claude가 수행)**

1. 새 저장소 구조를 만듭니다. client(Vite + React + TS + Tailwind), server(Express + TS), shared(Zod), prisma 폴더로 나누고, `.replit`과 `replit.nix`도 넣습니다.
2. C-2 설계 중 STEP 1\~3에 필요한 테이블로 Prisma 스키마와 첫 마이그레이션을 만듭니다. 부분 UNIQUE와 CHECK는 SQL로 추가합니다.
3. 데모 시드 스크립트를 만듭니다. is\_demo 학교에만 적용하고, 비밀번호는 환경변수에서 읽습니다.
4. `/api/health`(DB 연결 확인)와 서버가 화면을 함께 제공하는 구성을 만듭니다.
5. 마이그레이션, 시드, 헬스체크는 Replit Shell에서 실행하고, Claude가 그 출력을 검토해 결과를 기록합니다. Claude 작업공간은 npm 설치가 막혀 있기 때문입니다.
6. README에 환경변수, 실행 명령, 백업 방법(`pg_dump`), Replit Import 절차를 한국어로 적습니다.

## J. STEP 0 완료 판정표

STEP 0은 10개 기준 중 6개를 충족했습니다. 남은 4개는 사용자 확인이 필요하며, 그중 1·2번이 충족되면 STEP 1을 시작합니다. 나머지는 STEP 1과 병행해도 됩니다.

| # | 기준 | 판정 | 근거 |
| --- | --- | --- | --- |
| 1 | GitHub 저장소 확보와 세션 연결 | 충족 | 10-20 비공개 저장소 생성·연결·클론 확인(빈 저장소, main) |
| 2 | Replit 실행환경(Node, PostgreSQL) 확인 | 대기 | I의 Shell 명령 결과 필요 |
| 3 | 기존 Replit 코드·DB 보존 대상 확인 | 충족 | 파일 목록 확인, 스키마·화면 비어 있음 |
| 4 | 기술 스택 확정 | 충족 | 설계 결정 1 |
| 5 | 요구사항·우선순위 확정 | 충족 | A, H |
| 6 | 권한·DB 설계 | 충족 | C |
| 7 | 화면·API 목록 | 충족 | D, E |
| 8 | 외부 연동 범위 확정 | 충족 | F(미확인 항목은 비활성으로 분류) |
| 9 | 업무경감 가설의 현장 확인 | 대기 | A-3 ‘기존 방식’ 사용자 검토 필요 |
| 10 | 참가 자격·학교 승인 절차 착수 | 대기 | G의 할 일 3건 |

다음 단계 진행 조건: 1번과 2번이 ‘충족’이 되면 STEP 1(기본 구조·DB)을 시작합니다. 2번이 늦어지면 코드는 먼저 작성해 두고, 실행 검증은 Replit Shell 결과를 받은 뒤에만 완료로 표시합니다.
