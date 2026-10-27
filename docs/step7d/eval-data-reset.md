# STEP 7-D 평가용 가상 데이터 구성·초기화·삭제 절차

**아직 실행하지 않았습니다**(평가 환경 위치 결정 대기). 운영 VPS·시범운영 DB(`safeschool_prod_pilot`)에서는 실행하지 않습니다.
구성은 기존 심사 도구(`scripts/judge-demo-setup.ts`)를 그대로 씁니다. 이 도구는 다음을 스스로 거부합니다: 운영 프로필이 아니거나 스키마가 `safeschool_prod_judge`가 아님, DB 계정이 다른 운영 스키마(`safeschool_prod*`)에 접근 가능, 스키마에 시연 학교가 아닌 학교가 있음, 확인 문구 없음, 비밀번호 파일이 저장소 안이거나 이미 있음.

## 1. 원칙
- **평가 전용 DB 1개**(예: `safeschool_eval_20261028`)와 **평가 전용 DB 계정 1개**(예: `ss_eval`)를 새로 만들어 씁니다. 로컬 테스트 DB(`safeschool_local_test`)·계정(`ss_test`)과 섞지 않습니다.
- 그 DB에는 `safeschool_prod_judge` 스키마만 둡니다. 끝나면 **DB째 삭제**합니다(행 단위 삭제 도구는 만들지 않음 — 지우다 남는 것이 없도록).
- 비밀번호 파일은 저장소 밖 절대 경로에 새로 만들고, 화면·로그에 출력하지 않습니다. 계정 카드(종이)로 배부·회수합니다.
- 아래 `<…>`는 실제 값으로 바꿉니다. DB 주소·비밀번호는 문서·채팅에 적지 않습니다.

## 2. 구성(평가 전날 또는 당일 아침, 승인 후)
```bash
# 0) 평가 전용 환경변수(셸 하나에서만). DATABASE_URL 의 schema= 와 DEPLOY_DB_SCHEMA 가 같아야 함
export DATABASE_URL='postgresql://ss_eval:<비밀번호>@127.0.0.1:<포트>/safeschool_eval_20261028?schema=safeschool_prod_judge'
export NODE_ENV=production DEPLOY_PROFILE=production DEPLOY_DB_SCHEMA=safeschool_prod_judge
export LISTEN_HOST=127.0.0.1 SESSION_SECRET='<32자 이상 새 무작위 값>'
# 1) 대상 확인(읽기만)
npm run deploy:check
# 2) 스키마 처음 만들기(이 명령에서만 일시 허용)
DEPLOY_ALLOW_NEW_SCHEMA=true npm run deploy:migrate
# 3) 계획 보기(쓰기 없음) → 학교 2곳·계정 8개·가상 담임 22명 확인
npm run judge:setup
# 4) 실제 구성 + 지난 훈련 예시(상황판·훈련일지 과제용)
JUDGE_SETUP_CONFIRM=safeschool_prod_judge npm run judge:setup -- --apply --out <저장소 밖 절대 경로>/eval-accounts.txt --sample-drill
```
- Windows에서는 비밀번호 파일 권한 600이 그대로 적용되지 않습니다. 사용자 폴더 안(다른 사용자 접근 불가)에 두고 평가 후 삭제합니다.
- 앱 실행: `npm run build` 후 `node dist/server/index.js`(위 환경변수 그대로). Windows에서는 `npm start`(POSIX 문법) 대신 이 명령을 씁니다. 모의 경보를 보이려면 `ALERT_PROVIDERS=mock ALERT_MOCK_FEED=deploy/judge/mock-alerts.json`.

## 3. 세션 사이 초기화(진행 중 훈련만 종료 — 기록은 남음)
```bash
JUDGE_SETUP_CONFIRM=safeschool_prod_judge npm run judge:setup -- --reset-active
```
- 다음 참여자 조가 '발령'부터 다시 할 수 있게 진행 중인 모의훈련만 종료합니다. 보고·훈련일지 기록은 지우지 않습니다.
- 앞 조의 기록이 화면에 남는 것이 문제라면 4절(삭제) 후 2절을 다시 합니다(약 5분).

## 4. 평가 후 삭제(당일)
```bash
# 앱 중지 후, DB 관리자 계정으로
dropdb -h 127.0.0.1 -p <포트> -U <관리자> safeschool_eval_20261028
psql  -h 127.0.0.1 -p <포트> -U <관리자> -d postgres -c 'DROP ROLE ss_eval'
```
- 비밀번호 파일 삭제, 계정 카드 회수·파기, 평가 기간에 만든 캡처 중 계정 정보가 보이는 것 삭제
- 확인: `psql … -XAtc "select datname from pg_database where datname like 'safeschool_eval%'"` 결과 없음
- 기록(`docs/devlog/2026-10-28.md`): 삭제 일시, DB 이름, 확인 결과. 주소·비밀번호는 적지 않음

## 5. 하지 않는 것
운영 VPS·시범운영 DB에서 실행, `public`·`safeschool_test` 스키마 사용, `prisma migrate reset`, 실제 이메일·실명으로 계정 만들기, 평가 계정 비밀번호를 채팅·메신저로 보내기
