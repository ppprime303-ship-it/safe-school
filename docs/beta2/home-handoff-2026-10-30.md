# Beta PILOT 2 — 집 PC 인수인계(2026-10-30, 학교 PC 작업 마무리)

## 1. 오늘의 최종 상태

| 항목 | 상태 |
|---|---|
| 개발 브랜치 | `beta/pilot-2`(원격 `origin/beta/pilot-2`와 일치, 미커밋 파일 없음) |
| 기능 마지막 커밋 | `d3b1c4e` Phase 4 확정 정책 반영 — CI [41019411777](https://github.com/ppprime303-ship-it/safe-school/actions/runs/41019411777) 성공, 49개 파일 1163건 |
| 이 인수인계 문서 | 위 커밋 다음의 문서 전용 커밋(CI 결과는 보고 메시지 참고) |
| 운영 | VPS·운영 DB·`main`·`integration/production-preservation` 변경 없음, 배포 없음 |
| 로컬 미리보기 DB(학교 PC) | `safeschool_preview`: **Phase 4 마이그레이션 미적용**(Phase 1~3 상태로 화면 점검용 데이터 보관) |
| 진행 단계 | Phase 0~4 완료. **Phase 5는 시작하지 않음(지시 대기)** |

## 2. Phase 0~4 완료 내용(요약)

| Phase | 내용 |
|---|---|
| 0 | 저장소·권한·DB 구조 감사(변경 없음) |
| 1 | 관리자 대리 보고 제거, 상황판 요약은 전 교직원·민감 정보는 서버에서 제한, 실명·관리자 명칭 정리, 직책 위임 안전장치, 관리자 이양, 통합 회귀 |
| 2 | 교직원 소재 응답(실제 재난만, 모의훈련은 알림만), 익명 집계, 개인정보 보관 안내(베타 삭제 예정 2026-12-31) |
| 3 | 현장 제보·유사 제보 제안·후속 정보, 사진 비공개 첨부, Phase 1~3 통합 회귀, Windows 로컬 미리보기(PostgreSQL 16) |
| 4 | 공통 보고서: 모의훈련 **비상대피훈련일지**·실제 재난 **재난대피일지**(같은 서식, 서버 측 사건 mode 로 결정), 학급 대피·현장 제보·조치, 실제 재난만 교직원 소재 익명 통계, 종료 후 최종본, 개인정보 검사, A4 인쇄(PDF)·HWPX. 상세: `docs/beta2/phase4-reports.md` |

확정 정책(2026-10-30):
- 모의훈련: 비상대피훈련일지 / 실제 재난: 재난대피일지(내부 서식 키 `disaster_real` 그대로)
- 교장·교감: 보고서 열람·인쇄·내려받기만(생성·수정·완료 불가)
- 모의훈련 역할 담당자 이름: 기존 서식대로 허용(전화번호 등은 차단)
- 시스템 작성·수정자: 권한 있는 상세 화면에서만, 목록·PDF·HWPX·인쇄본 제외
- 실제 재난 교직원 소재: 익명 통계만 / 모의훈련: 소재 수집·출력 없음

## 3. 다음 작업

1. 사용자 화면 점검(Phase 4): `docs/beta2/phase4-reports.md` 4절 수동 점검 항목. 단, 미리보기 DB에 Phase 4 마이그레이션 적용 승인이 먼저 필요.
2. 승인 시: 학교 PC `safeschool_preview` 에 `20261101000000_disaster_reports` 적용(비파괴: 함수 교체·CHECK·트리거 추가).
3. Phase 5: 사용자 지시가 있을 때만 시작.

## 4. 미확정·승인 대기 사항

- **`safeschool_preview` 에 Phase 4 마이그레이션 적용 — 승인 전 금지(학교 PC·집 PC 모두).**
- 보고서 보관 기간·외부 제출 양식(운영 정책으로 임의 확정하지 않음).
- 운영 배포: 별도 승인 전 금지.

## 5. 집 PC 준비(처음 한 번)

**PostgreSQL·비밀번호 파일·가상 계정 목록·`node_modules`는 Git 으로 복사되지 않습니다.** 학교 PC의 `C:\Users\user\.safeschool-preview\`(secrets.json, demo-accounts.txt, 설치 스크립트)는 저장소 밖에 있으며 옮기지 않습니다. 집 PC에서는 새로 무작위 비밀번호를 만들어 쓰고, 학교 PC 비밀번호를 메신저·메일·Git 으로 옮기지 마세요.

### 5-1. 코드 받기
- Git, Node.js 22(LTS, 최소 20.19), GitHub CLI(선택) 설치.
- 아래 6절 명령으로 `beta/pilot-2` 를 받습니다.
- 의존성(CI와 같은 방식, 잠금 파일을 바꾸지 않음):
  ```
  npm install --legacy-peer-deps --package-lock=false --no-audit --no-fund
  ```
- DB 없이 할 수 있는 검사: `npm run typecheck`, `npm run build`. DB 없는 테스트만: `npx vitest run tests/beta2-report-doc.test.ts` 등(DB 테스트는 아래 5-2 필요).

### 5-2. 자동 테스트용 로컬 PostgreSQL(필요할 때만)
1. PostgreSQL 16 공식 설치 파일(EDB, Windows x64)로 설치: 포트 5432, pgAdmin·StackBuilder 제외, 관리자(postgres) 비밀번호는 새로 무작위로.
2. `postgresql.conf` 에 `listen_addresses = '127.0.0.1'`(이 PC 안에서만), 방화벽 인바운드 규칙 추가하지 않음.
3. 관리자로 접속해 일반 계정과 **테스트 DB만** 만듭니다(비밀번호는 직접 무작위로):
   ```sql
   CREATE ROLE safeschool_app LOGIN PASSWORD '<새 무작위 비밀번호>';
   CREATE DATABASE safeschool_test OWNER safeschool_app ENCODING 'UTF8' TEMPLATE template0;
   ```
4. 비밀번호는 저장소 밖 `%USERPROFILE%\.safeschool-preview\secrets.json` 에 둡니다(본인 계정만 접근). 키 이름은 학교 PC와 같게: `appPassword`, `postgresPassword`, `sessionSecret`, `demoPassword`(값은 새로 생성).
5. 테스트 실행(PowerShell, 이 창에서만 변수 설정 — 테스트가 `safeschool_test` 스키마를 스스로 준비·초기화):
   ```powershell
   $s = Get-Content "$env:USERPROFILE\.safeschool-preview\secrets.json" -Raw | ConvertFrom-Json
   $url = "postgresql://safeschool_app:$([Uri]::EscapeDataString($s.appPassword))@127.0.0.1:5432/safeschool_test?schema=safeschool_test"
   $env:DATABASE_URL = $url; $env:TEST_DATABASE_URL = $url; $env:NODE_ENV = "test"
   npx vitest run
   Remove-Item Env:DATABASE_URL, Env:TEST_DATABASE_URL
   ```
   기대값: 49개 파일 1163건 통과(CI와 같음).

### 5-3. 화면 미리보기(집 PC) — 주의
- `scripts\preview\preview-setup.cmd` 는 **모든 마이그레이션(Phase 4 포함)을 `safeschool_preview` 에 적용**합니다. 따라서 Phase 4 마이그레이션 적용 승인 전에는 **집 PC에서도 `preview-setup.cmd`·`preview-reset.cmd` 를 실행하지 마세요.**
- 승인 전에는 집 PC에 `safeschool_preview` 를 만들지 않고, 코드 작업·자동 테스트(`safeschool_test`)만 합니다.
- 운영 관련 환경변수(`.env` 의 운영 값, 운영 DB 주소, 메일·외부 API 키)는 집 PC에 두지 않습니다.

## 6. 집 PC에서 이어가기 — Git 명령

처음(저장소가 없을 때):
```
git clone https://github.com/ppprime303-ship-it/safe-school.git
cd safe-school
git switch -c beta/pilot-2 --track origin/beta/pilot-2
```

이미 저장소가 있을 때(안전하게 확인 후 빨리 감기만):
```
git status                       # 미커밋 변경이 없는지 먼저 확인(있으면 커밋하거나 따로 보관)
git fetch origin
git switch beta/pilot-2          # 없으면: git switch -c beta/pilot-2 --track origin/beta/pilot-2
git merge --ff-only origin/beta/pilot-2
git log --oneline -3             # 맨 위가 이 문서 커밋, 그 아래 d3b1c4e 인지 확인
```
- `--ff-only` 가 실패하면(집 PC에 따로 커밋이 있으면) 강제로 덮지 말고 상황을 먼저 확인합니다.
- `main`·`integration/production-preservation` 으로 전환·Push 하지 않습니다. Push 는 `git push origin beta/pilot-2`(일반 Push)만, 강제 Push 금지.
