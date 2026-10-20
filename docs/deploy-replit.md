# Replit 배포 준비(STEP 2, 브랜치 `step-2-integrated`)

## 1. 브랜치

| 브랜치 | 내용 | 상태 |
| --- | --- | --- |
| `main` | STEP 1 | 변경 없음(검증 전 병합 금지) |
| `step-2` | 학교 등록·가입 DB·API | `step-2-integrated`에 포함 |
| `step-2-ui` | 디자인 시스템·4개 화면 | `step-2-integrated`에 포함 |
| `step-2-integrated` | 위 둘 + 시스템 상태 화면 복원 + 운영 안전장치 | **Replit 검증 대상** |

## 2. 환경변수(Replit Secrets)

| 이름 | 필수 | 설명 |
| --- | --- | --- |
| `DATABASE_URL` | 예 | Replit PostgreSQL 추가 시 자동 생성 |
| `SESSION_SECRET` | 운영 필수 | 32자 이상 무작위 |
| `DEMO_PASSWORD` | 데모 시드 시 | 12자 이상 |
| `APP_BASE_URL` | 선택 | 배포 주소 |
| `SCHOOLINFO_API_KEY` | 학교 검색 시 | 학교알리미 인증키. 없으면 저장된 목록으로만 검색 |
| `SCHOOLINFO_GRADE_DATA` | 선택 | `enabled`일 때만 학년별 공시자료(apiType 09) 사용. **실제 응답 필드 확인 전에는 설정하지 않음** |
| `MAIL_PROVIDER`, `MAIL_API_KEY`, `MAIL_FROM` | 운영 필수 | `resend` + 키 + 보내는 주소: 실제 발송. 미설정이면 가입이 503으로 멈춤(보낸 것처럼 표시하지 않음) |
| `MAIL_PROVIDER=console` | 개발·테스트만 | 모의 발송(메일 미발송, 화면에 '테스트 전용 코드'로 표시). 운영(`NODE_ENV=production`)에서는 무시되어 인증 불가 |
| `ALLOW_DEMO_SEED` | 선택 | 운영 환경에서 데모 시드를 허용할 때만 `true` |
| `VITE_ENABLE_DESIGN_PREVIEW` | 선택 | 운영 빌드에서 `/design`을 보이게 할 때만 `true` |
| `TEST_DATABASE_URL` | 선택 | 비우면 `DATABASE_URL`의 `safeschool_test` 스키마 사용 |

키와 비밀번호는 코드·로그에 출력되지 않습니다. 학교알리미 출처 주소는 키를 뺀 형태로만 저장·표시합니다.

## 3. DB 연결과 마이그레이션 순서

1. Replit에서 PostgreSQL 추가 → `DATABASE_URL` 자동 생성을 확인합니다.
2. **적용 전 확인**
   - `npm run db:status`로 적용 대기 마이그레이션 2개(`20261020000000_init`, `20261020100000_school_registration`)를 확인합니다.
   - 기존 데이터가 있으면 먼저 `npm run db:backup`을 실행합니다.
   - 개발 DB인지 확인합니다. 운영(배포) DB에는 개발 DB 검증 후에만 적용합니다.
   - `prisma migrate reset`, `db push --force-reset`은 사용하지 않습니다.
3. `npm run db:migrate`(= `prisma migrate deploy`, 데이터 삭제 없음)
4. (개발·시연 DB만) `npm run db:seed`

마이그레이션 2의 변경 중 유일한 `DROP`은 학급 UNIQUE 인덱스를 학년도 포함 인덱스로 바꾸는 것이며 데이터는 바뀌지 않습니다.

## 4. 실행 명령(Replit Shell)

```bash
git fetch origin && git checkout step-2-integrated
npm install
npm run typecheck
npm run db:status
npm run db:migrate
npm run db:seed
npm test
npm run e2e:step2                                 # 실제 서버+DB 전체 흐름(테스트 스키마 전용)
npm run schoolinfo:verify -- --kind 02 --sido 11   # SCHOOLINFO_API_KEY 설정 후
npm run dev                                       # /status, /login, /design 확인
```

## 5. 운영 환경에서 꺼지는(또는 꺼야 하는) 데모 기능

| 기능 | 운영 동작 |
| --- | --- |
| 인증코드 화면 표시(`devCode`) | `MAIL_PROVIDER=console` + 비운영에서만 반환. 운영에서는 항상 미반환 |
| 모의 메일(`console`) | 운영에서는 비활성. 실제 메일 설정 없이는 인증 완료 불가 |
| 데모 시드 | 운영에서는 `ALLOW_DEMO_SEED=true` 없이는 실행 거부 |
| `/design` 미리보기 | 운영 빌드에서 숨김(`VITE_ENABLE_DESIGN_PREVIEW=true`일 때만) |
| 데모 학교·테스트 계정 | 실제 운영 DB에는 시드하지 않음(시연 배포와 분리 권장) |
| 학년별 공시자료(apiType 09) | 기본 꺼짐. 필드 확인 후 `SCHOOLINFO_GRADE_DATA=enabled` |
