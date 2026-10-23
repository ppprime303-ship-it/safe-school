# STEP 3-F 배포 DB 스키마 안전장치

작성 2026-10-23 · 브랜치 `step-3e-integration` · DB·마이그레이션 변경 없음 · 실제 배포·마이그레이션 실행 없음
**현재 목적은 교직원 시연 준비이며 실제 학교 운영 전환이 아닙니다.**

## 1. 위험
| 항목 | 내용 |
| --- | --- |
| 원인 | 배포 실행 명령이 `npx prisma migrate deploy && npm start`이고, Shell·배포의 기본 `DATABASE_URL`에는 `schema` 매개변수가 없음 |
| Prisma 동작 | `schema`가 없으면 `public` 스키마 사용 |
| 결과(배포 버튼을 누르면) | ① 시연 데이터(`safeschool_browser_demo`, 학교 1·사용자 2)가 아닌 `public`에 테이블 31개를 새로 만들고 ② 앱이 빈 `public`에 연결 → 시연 계정으로 로그인 불가, 새 데이터가 엉뚱한 곳에 쌓임 |
| 추가 위험 | 주소에 `schema=safeschool_test`가 잘못 들어가면 테스트 때마다 비우는 스키마에 실제 시연 데이터를 쓰게 됨 |
| 개발 Run 워크플로 | 이미 `safeschool_browser_demo`를 명시해 실행 중 → 위험 없음(이번에 바꾸지 않음) |

## 2. 수정 후 배포 흐름(`npm run deploy:start`)
```
DATABASE_URL + DEPLOY_PROFILE + DEPLOY_DB_SCHEMA
  │ ① 설정 검증(DB 접속 없음) — 하나라도 없거나 허용 안 되면 종료 코드 1
  │    · demo → safeschool_browser_demo 만 / production → safeschool_prod(_이름) 만
  │    · public, 이름에 test, 형식 오류, URL의 schema와 불일치, PostgreSQL 아님 → 거부
  ▼
  ② 읽기 전용 사전 점검 — 스키마·마이그레이션 기록 존재 확인, 학교·사용자 '건수'만 출력
  │    · demo 인데 스키마/기록이 없으면 거부(새 스키마를 만들지 않음 — 잘못된 DB 연결로 판단)
  │    · production 새 스키마는 DEPLOY_ALLOW_NEW_SCHEMA=true 일 때만
  ▼
  ③ prisma migrate deploy — ①에서 만든 같은 주소(schema 포함)로, 적용 대기분만
  │    · 실패하면 서버를 시작하지 않음
  ▼
  ④ 서버 시작 — 같은 주소, NODE_ENV=production
       · 서버도 시작 시 다시 검사(아래 3절): schema 없는 주소로 `npm start`를 직접 실행해도 DB 연결 전에 멈춤
```
로그에는 `호스트/DB 이름 · schema=… · 프로필`과 건수만 나오고, 사용자 이름·비밀번호·전체 주소는 나오지 않습니다(오류 메시지 속 DB 주소도 `[주소 가림]`).

## 3. 서버 시작 검사(운영 모드만)
`server/src/env.ts`: `NODE_ENV=production`이면 `DEPLOY_PROFILE`·`DEPLOY_DB_SCHEMA` 검증 + `DATABASE_URL`에 같은 schema가 있어야 시작. **개발(Run)·테스트(`NODE_ENV=test`)는 검사하지 않아 기존 동작·테스트 그대로**입니다.

## 4. 명령
| 명령 | 하는 일 | DB 변경 |
| --- | --- | --- |
| `npm run deploy:check` | ①② 검증·읽기 전용 점검만 | 없음 |
| `npm run deploy:migrate` | ①②③ | 적용 대기 마이그레이션만 |
| `npm run deploy:start` | ①②③④(배포 실행용, 빌드 결과 `dist/deploy-start.js` 사용) | 적용 대기 마이그레이션만 |
`npm run db:migrate`(기존, 검증 없음)는 그대로 두었습니다. **Shell에서 기본 주소로 실행하면 `public`에 적용되므로 쓰지 말고 `deploy:migrate`를 쓰세요.**

## 5. Replit 설정(사용자가 직접 — `.replit`은 저장소 커밋에 넣지 않음)
Replit의 `.replit`은 Run 워크플로 등 로컬 수정이 있어 GitHub 쪽 `.replit`(STEP 1 판)과 다릅니다. 덮어쓰면 Run 설정이 사라질 수 있어 **이 커밋에는 `.replit`을 넣지 않았습니다.** 다음 한 줄만 직접 바꾸세요.

```toml
[deployment]
# 변경 전: run = ["sh", "-c", "npx prisma migrate deploy && npm start"]
run = ["sh", "-c", "npm run deploy:start"]
```
- `build`(`(npm ci || npm install) && npm run build`)는 그대로 — `npm run build`가 `dist/deploy-start.js`도 만듭니다.
- 배포 Secrets(Deployments → Secrets)에 추가: `DEPLOY_PROFILE=demo`, `DEPLOY_DB_SCHEMA=safeschool_browser_demo` (비밀값은 아니지만 배포 환경에만 둠). `DATABASE_URL`·`SESSION_SECRET`은 기존 그대로.
- Run 워크플로·`[env]`·`run = "npm run dev"`는 바꾸지 않습니다.

## 6. 시연·운영 분리 설계
| 구분 | 프로필 | 스키마 | 데이터 |
| --- | --- | --- | --- |
| 개발(Run) | (검사 없음, NODE_ENV=development) | `safeschool_browser_demo`(워크플로 지정) | 시연 가상 데이터 |
| 시연 배포 | `demo` | `safeschool_browser_demo`만 | 위와 같음(보존) |
| 자동 테스트 | (NODE_ENV=test) | `safeschool_test`(매번 비움) | 테스트 데이터 — 배포 대상 불가 |
| 운영(향후, 승인 후) | `production` | `safeschool_prod` 또는 `safeschool_prod_<이름>` | 실제 데이터 — 별도 DB 권장, 처음 만들 때만 `DEPLOY_ALLOW_NEW_SCHEMA=true` |

## 7. 검증
| 검증 | 결과 |
| --- | --- |
| `tests/deploy-db-target.test.ts`(DB 접속 없음) 8건 | 작업공간 8/8 |
| `tests/safe-log.test.ts`(DB 주소 가림 1건 추가) 4건 | 작업공간 4/4 |
| 배포 시작 흐름 13가지(가짜 Prisma·가짜 npx로 실제 스크립트 실행): 설정 없음·스키마 미지정·public·test·URL 충돌·잘못된 URL·프로필 누락·DB 연결 실패·시연 스키마 없음·운영 새 스키마·점검만·마이그레이션 실패·정상 | 13/13 — 거부 10가지 모두 마이그레이션 호출 0회, 정상 시 마이그레이션·서버가 같은 `schema=safeschool_browser_demo`, 비밀번호 노출 0 |
| 사전 점검 SQL(임시 PostgreSQL에서 실제 실행) | 있는 스키마 t/t/t/t, 없는 스키마 f/f/f/f |
| 대체 타입 검사 | 오류 0 |
| `npm run typecheck`·`npm test`(DB 포함) | **Replit 실행 필요** |
