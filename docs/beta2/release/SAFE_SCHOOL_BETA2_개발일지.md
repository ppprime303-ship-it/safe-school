# SAFE SCHOOL Beta PILOT 2 — 개발일지·작업 이력

작성 2026-11-03 · 대상 브랜치 `beta/pilot-2` · 배포 커밋 `57e6e01`

이 문서는 Beta PILOT 2의 개발부터 기존 도메인 전환, Prototype 종료와 서버 정리까지를 실제 커밋·CI·실행 기록으로 정리합니다. 확인되지 않은 항목은 [후속 운영 점검](SAFE_SCHOOL_BETA2_후속운영점검.md)에 따로 둡니다.

**시각 표기:** 11월 3일 실행 기록의 파일 이름 시각은 작업 PC 기준입니다. 이 PC는 표준시보다 약 163초 빨랐습니다(NTP 3곳·HTTPS Date 헤더 3곳 측정). 서버 내부 기록(예: 전환 검증 12:37:55, Prototype 종료 13:45:40)은 NTP로 동기화된 서버 시각입니다.

**관련 기존 문서:** [일별 개발일지 2026-11-03](../../devlog/2026-11-03.md) · [환경 분리 설계](beta-environment.md) · [배포 차단 요인](beta-deploy-plan.md) · [백업·복원](backup-restore.md) · [Go/No-Go](go-no-go.md) · [사용자 최종 점검표](user-final-checklist.md)

---

## 0. 한눈에 보기

| 구분 | 최종 상태 | 근거 |
|---|---|---|
| 코드 | `beta/pilot-2` 135커밋(2026-10-20~11-03), Prototype `a42ea5e` 이후 59커밋 | `git rev-list` |
| CI | 65개 테스트 파일, 1,415건 통과 | GitHub Actions 실행 41554449962 |
| DB | Beta 전용 `safeschool_beta`, 마이그레이션 15개 | 설치 기록, `prisma/migrations` |
| 도메인 | 기존 도메인 → Caddy → Beta `127.0.0.1:5100`, basicauth | `cutover-cutover-20261103123958.log` |
| 공개 검증 | 12항목 통과 | 같은 기록 5/6단계 |
| 자동화 | Beta 자동 시작 enabled, 매일 03:50(KST) 백업 예약 | `cutover-finalize-20261103125134.log` |
| Prototype | inactive / disabled, DB 학교 1·사용자 7 보존 | `cutover-protostop-20261103134811.log` |
| 정리 | Prototype VPS 백업 9개 삭제(1,417,231 bytes), 기타 4개 보존, 복원 시험 DB 2개·임시 폴더 3개 삭제 | `cutover-purgeproto-…134902.log`, `cutover-cleanup-…134957.log` |
| 시계 | 시간대 Asia/Seoul, systemd-timesyncd 동기화, 외부 NTP 대비 약 0.01초 | `cutover-inspect-20261103135049.log` |

---

## 1. 프로젝트 목표와 Beta PILOT 2 범위

- **목적:** 학교 재난안전 보조 업무시스템. 재난 발령 → 학급별 대피 보고 → 실시간 집계 → 안내 → 종료 보고를 하나로 잇습니다. 나이스·학교안전지원시스템 같은 공식 체계를 대체하지 않습니다(`README.md`).
- **Beta PILOT 2의 목표:** 실제 학교 데이터 없이 가상 학교로 시연할 수 있는 운영형 서비스를 기존 VPS와 도메인에 올리는 것입니다.
- **주요 기능 추가(2026-11-02):** 전교·학년별 대피 현황 차트, 현장 제보 후속 조치와 재난대피일지 연동, Gmail SMTP 인증코드 어댑터(Phase 5), 공공 API 현황과 재난문자 안전장치(Phase 6), 소재 보고 양식·사진 운영 통제(Phase 7), 재난문자·기상특보 교직원 안내 창, 개인정보 정책 초안과 Beta 실제 데이터 유입 차단.
- **11-03 코드 수정:** 경보 확인 저장 실패 원인 표시(`b24e929`), Beta 환경 파일 로딩·접근 제한 보강(`57e6e01`).
- **범위 밖:** 실제 교직원 가입, 실제 학교 데이터 수집, 개인정보 삭제 기능 구현(정책 초안만 있음).

## 2. GitHub 브랜치 전략과 Prototype 보존

| 날짜 | 작업 | 결과 |
|---|---|---|
| 10-28 | Prototype `a42ea5e` VPS 운영 | `origin/beta/pilot-2`, `origin/integration/production-preservation`에 포함 확인(11-03) |
| 11-02~03 | Beta 개발은 `beta/pilot-2`에서 진행 | `a42ea5e`가 merge-base라서 Prototype 이력이 그대로 이어집니다 |

- **원칙:** 코드는 GitHub에 보존합니다. DB 백업, 비밀값, 운영 기록은 GitHub에 올리지 않습니다.
- **배운 점:** 코드 보존(Git)과 데이터 보존(DB 백업)은 서로 다른 문제입니다. 운영을 종료하기 전에 두 가지를 각각 확인해야 합니다.

## 3. VPS 사전 점검과 서비스 분리

- **환경:** Ubuntu 24.04, Node v22, PostgreSQL 16, Caddy 2.6.2.
- **분리 설계:** 서비스(`safe-school-beta`), 리눅스 계정(`ss-beta`), 코드 경로, 설정 파일, 포트(5100), DB·계정·스키마(`safeschool_beta`), 사진 경로를 Prototype과 따로 둡니다. 앱은 시작할 때 Prototype 대상을 거부합니다([beta-environment.md](beta-environment.md)).
- **접속 방식에서 생긴 문제:** SSH 키에 passphrase가 있었고, Claude Code 환경에서는 입력할 수 없었습니다. 처음에 BatchMode로 접속을 시도해 실패했습니다.
  - **결정:** 추측으로 접속을 반복하지 않습니다. 사용자가 PowerShell에서 직접 실행하는 도구를 만들었습니다.
  - **방식:** 서버 스크립트를 명령 인자로 넣어 **한 번만 연결**합니다. 키 암호는 1회, sudo 비밀번호는 서버에서 직접 받습니다.
- **sudo 입력 창이 보이지 않던 문제:** 진행률 표시에 sudo 안내가 묻혔습니다. sudo가 고유한 입력 신호(`##AUTH_SUDO`)를 내보내게 하고, PC 쪽이 이 신호를 받아 입력 안내를 띄우도록 고쳤습니다.
- **보안 사고:** 점검 스크립트의 비밀값 가림에 결함이 있어 Prototype DB 비밀번호가 사용자 터미널과 결과 파일에 노출됐습니다.
  - **조치:** 결과 파일에서 값을 지우고, 해당 스크립트를 삭제했습니다.
  - **비밀번호 변경:** 사용자 결정으로 보류했습니다([후속 점검](SAFE_SCHOOL_BETA2_후속운영점검.md)).
- **배운 점:** 가림 처리는 출력 직전 한 곳에서 일괄 적용해야 합니다. 이후 도구는 비밀값을 처음부터 출력하지 않는 구조로 바꿨고, 기록 파일도 한 번 더 가립니다.

## 4. PostgreSQL DB 분리와 마이그레이션

- **구성:** Beta DB·계정 `safeschool_beta`/`ss_beta`를 새로 만들고, 마이그레이션 15개를 처음부터 적용했습니다. `pg_hba`는 이미 `127.0.0.1` scram 인증을 허용하고 있어 바꾸지 않았습니다.
- **설치 도구:** `beta-deploy.ps1`과 `beta-install.sh`를 만들었습니다. 모드는 Check, Install, Status, Verify, Rollback입니다.
  - 설치 전 Prototype 기준선(서비스 상태, 설정 파일 해시, DB 건수)을 `/root`에 저장했습니다.
  - 설치 후 이 기준선과 다시 비교했습니다.
- **설치 90%(10단계)에서 실패:** 백업·복원 검증 단계가 `school_classes` 테이블을 찾지 못했습니다.
  - **원인:** 실제 테이블 이름은 Prisma `@@map` 설정에 따라 `classes`였습니다.
  - **수정:** 필수 테이블 목록을 `prisma/schema.prisma`의 `@@map`과 대조하고, 전체 테이블을 비교하도록 바꿨습니다. 설치를 다시 하지 않고 확인만 하는 Verify 모드도 추가했습니다.
- **검증:** 전체 40개 테이블의 백업·복원 비교가 통과했습니다. Prototype 기준선 변경은 없었고, Verify 모드 결과 100%였습니다.
- **문서와 실제의 차이:** 설계 문서는 Prototype DB를 `safeschool`로 적었습니다. 실제 데이터가 있는 DB는 `safeschool_v01`(스키마 `safeschool_prod_pilot`)이었고, `safeschool`은 비어 있었습니다.
- **배운 점:** 테이블·DB 이름은 문서보다 실제 스키마 정의와 서버 조회 결과를 기준으로 삼아야 합니다.

## 5. 가상 학교·테스트 사용자

- **시드 데이터:** `prisma/seed.ts`가 `is_demo=true`인 가상 학교 1개와 계정 5개를 만듭니다. 계정은 `admin`, `teacher11`, `teacher12`, `teacher21`, `staff`이고, 메일 도메인은 실제 메일이 가지 않는 예약 도메인 `@demo.safeschool.invalid`입니다.
- **데이터 모드:** 앱은 `BETA_DATA_MODE=virtual_test`로 동작합니다. `/api/health`가 이 모드를 보고하고, 회원가입은 HTTP 503(`mail_not_configured`)으로 막혀 있습니다.
- **비밀번호:** 테스트 계정 비밀번호는 코드에 넣지 않고, 설치할 때 입력받아 해시로만 저장합니다.

## 6. TypeScript와 자동 테스트

- **실행 명령:** `typecheck`(tsc), `test`(vitest)
- **CI:** 실행 41554449962가 성공했습니다. 65개 파일, 1,415건 통과입니다.
- **배포 커밋에 함께 넣은 테스트:**
  - `tests/beta2-alert-confirm-error.test.ts`
  - `tests/beta2-environment-separation.test.ts`: Prototype 대상을 거부하는지, 비밀번호가 출력되지 않는지 확인
  - `tests/neis.test.ts`
- **배포·운영 도구의 검증 방식:** 저장소 밖 도구는 CI 대상이 아니므로 로컬 시뮬레이션으로 검증했습니다.
  - 가짜 `systemctl`·`caddy`·`psql`과 실제 파일 복사를 쓰는 시뮬레이션: 최종 82개 경우
  - 안전 규칙을 일부러 어긴 사본으로 시험하는 변형 시험

## 7. Prototype DB 암호화 백업 (11-03)

- **목적:** Prototype 운영을 끝내기 전에 실제 학교 데이터를 서버 밖에 암호화해 보존합니다.
- **방법(`-Mode Backup`):**
  1. 서버 RAM 디스크(`/dev/shm`)에서 `pg_dump -Fc`로 덤프합니다.
  2. `pg_restore`로 덤프 전체를 읽어 봅니다.
  3. GPG AES-256으로 암호화합니다.
  4. 서버에서 복호화해 원본과 비교합니다.
  5. base64로 PC에 내려받고 해시를 비교합니다.
  6. 서버 임시 파일을 `shred`로 지웁니다.
- **실행 결과:**
  - 실패 5회: 모두 1단계 암호 입력에서 멈췄습니다(16자 미만 또는 두 번 입력한 값이 다름). 덤프는 시작되지 않았습니다.
  - 6번째 실행(12:02, PC 시각)이 성공했습니다. 덤프 항목 277개(테이블 데이터 33개), 전체 읽기 정상, 복호화 비교 일치, 해시 일치였습니다.
  - 보관 파일: `C:\SAFE-SCHOOL-BACKUP\prototype-safeschool_v01-20261103120246.dump.gpg`(62,159 bytes)와 `.sha256`. 폴더 권한은 사용자·SYSTEM·Administrators만 접근하도록 제한했습니다. 사용자가 PC에서도 복호화해 확인했습니다(exit 0).
- **점검 중 보완:**
  - 백업 경로 기본값(문서 폴더)을 없애고 `-BackupDir` 지정을 필수로 했습니다.
  - `pg_restore -f /dev/null`로 덤프 전체를 읽는 검사를 추가했습니다.
- **한계:** 실제 PostgreSQL에 복원하는 시험은 하지 않았습니다. 복원하려면 개인정보 사본 DB를 만들어야 해서 의도적으로 뺐습니다.

## 8. 가상 관리자 비밀번호 불일치 (11-03)

- **증상:** Cutover 2/6단계 사전 로그인이 HTTP 401이었습니다. 이때 Caddy는 바꾸지 않았습니다.
- **분석:**
  - 설치 때의 확인과 Cutover 확인은 계정, 요청 형식, 주소가 모두 같았습니다.
  - `auth.ts`는 401을 "계정 없음" 또는 "비밀번호 불일치"일 때만 반환합니다. 잠금은 429, 형식 오류는 400입니다.
  - 따라서 원인은 비밀번호 불일치였습니다. 시드 데이터가 실행될 때마다 비밀번호 해시를 덮어쓰고 설치가 여러 번 실행됐기 때문으로 추정합니다.
- **해결:** `-Mode ResetDemo`를 추가했습니다.
  - 가상 계정 5개의 `password_hash`만 바꿉니다. 해시 방식은 앱의 scrypt `hashPassword`를 그대로 씁니다.
  - DB가 `safeschool_beta`인지, 대상이 정확히 5개인지, 모두 가상 학교 소속인지 같은 트랜잭션 안에서 다시 확인합니다.
  - 변경 후 내부 로그인이 HTTP 200인지 확인합니다.
- **전송 방식 변경:** 서버 스크립트가 커져 Windows 명령줄 한도(32,767자)에 다가갔습니다. 그래서 gzip으로 압축해 base64로 전송하도록 바꿨습니다.
- **결과:** 재설정 뒤 Cutover 2/6단계가 HTTP 200으로 통과했습니다.
- **배운 점:** 같은 값을 매번 덮어쓰도록 만든 시드는 설치를 다시 실행하면 비밀번호도 바뀝니다. 비밀번호 확인 입력은 한 번만 받으면 오타를 걸러내지 못합니다.

## 9. Caddy 2.6.2 bcrypt 해시 형식 오류 (11-03)

- **증상:** Cutover 3/6단계에서 "비밀번호 해시 형식이 예상과 다릅니다"로 멈췄습니다. 운영 설정은 바뀌지 않았고, 사본(`…_122754`)만 생성됐습니다.
- **원인:** Caddy v2.6.2 소스를 확인했습니다. `caddy hash-password`는 bcrypt 해시를 base64로 바꾸지 않고 `$2a$14$…` 원문 그대로 출력합니다. 그런데 도구는 예전 base64 형식(`JDJ…`)을 기대하고 있었습니다. 시뮬레이션의 가짜 Caddy도 예전 형식을 출력하고 있어서 이 문제를 놓쳤습니다.
- **수정:** 검사를 없애지 않고 더 엄격하게 바꿨습니다. 출력 전체가 bcrypt 원문 한 줄(`^\$2[aby]\$(1[0-9]|2[0-9]|3[01])\$[./A-Za-z0-9]{53}$`)과 일치하는지 확인합니다. v2.6.2 `basicauth`는 `$`로 시작하는 해시를 그대로 사용하므로 이 형식이 맞습니다.
- **검증:** 통과해야 하는 4종(실제 형식, CRLF, 개행 없음, `$2b`)은 통과했고, 거부해야 하는 9종(base64, 빈 출력, 안내 문구, 길이 ±1, 비용 04, 두 줄, 공백, scrypt)은 모두 거부됐습니다.
- **배운 점:** 가짜 객체(mock)는 실제 버전의 출력 형식을 기준으로 만들어야 합니다. 그렇지 않으면 시험이 오히려 오류를 숨깁니다.

## 10. HTTPS 도메인 전환과 공개 검증 (11-03)

**전환 절차(`-Mode Cutover`, 6단계)**
1. 사전 확인: Prototype 기준선, Beta 정상, 현재 5000 연결
2. 외부 비밀번호와 가상 계정 비밀번호 입력, 내부 로그인 확인
3. Caddy 사본과 해시 확보, 후보 설정 `caddy validate`
4. 사용자가 `SWITCH` 입력 → 서버 자체 자동 복귀 예약(10분) → 교체 → `systemctl reload caddy`
5. 공개 검증
6. Prototype 기준선 재확인

**자동 복귀 장치**
- 검증 실패, reload 실패, Ctrl+C, 연결 끊김이 생기면 바로 사본으로 복귀합니다.
- 강제 종료처럼 이 복귀가 작동하지 못하면 `systemd-run` 예약이 10분 안에 복귀시킵니다. 검증에 성공하면 예약을 해제합니다.
- 결함 수정: 연결이 끊기면 화면 출력 실패 때문에 복귀 전에 스크립트가 끝날 수 있었습니다. 이를 시뮬레이션으로 발견해, 끊기면 출력을 서버 기록으로 돌린 뒤 복귀하도록 고쳤습니다.

**결과(`cutover-cutover-20261103123958.log`)**
- `caddy validate`를 통과했습니다.
- 5단계 12항목 모두 통과:

| 항목 | 결과 |
|---|---|
| 인증서·인증 없는 접근 | 401 |
| 인증 없는 API | 401 |
| 틀린 비밀번호 | 401 |
| HTTP 접속 | 308로 HTTPS 이동 |
| Beta 상태 확인 | 200, DB 정상 |
| 데이터 모드 | 가상 데이터 |
| HSTS | 적용 |
| 화면 | 200 |
| 회원가입 | 503 |
| 로그인 | 200 |
| 세션 쿠키 | Secure·HttpOnly |
| 로그인 정보 | 학교 1개 |

- 6단계 기준선은 변경 없음이었고, 결과는 `CUTOVER_RESULT=ok`입니다.

**영향:** Prototype 사용자 7명은 Beta 계정이 없어 외부에서 접속할 수 없게 됐습니다.

## 11. Beta 자동 시작·정기 백업 (11-03)

- **`-Mode Finalize`:** `systemctl enable safe-school-beta`와 `/etc/cron.d/safe-school-beta-backup`(`50 3 * * *`, ss-beta 계정, 14일 보관)만 바꿉니다.
- **사전 점검 보강:** ss-beta가 백업 폴더에 쓸 수 있는지, `~/.pgpass`가 있는지, 사진 폴더가 있는지 확인하고, 전환 검증 기록·5100 연결·남은 자동 복귀 예약도 읽기만 하여 확인합니다.
- **결과(`cutover-finalize-20261103125134.log`):** 전환 검증 기록, 5100 연결, 남은 자동 복귀 예약 0개를 확인했고, `자동 시작: enabled, 백업 예약: 매일 03:50`가 출력됐습니다.
- **시간대:** 서버 시간대는 Asia/Seoul이므로 03:50은 한국 시각입니다(Inspect 확인). 첫 자동 백업이 실제로 성공했는지는 아직 확인하지 못했습니다.

## 12. 운영 복구 도구 v1과 안정화 도구 v2

| 버전 | 위치 | 모드 |
|---|---|---|
| v1 | `deployment-recovery\` (사용자가 복사, 해시 일치 확인) | Check, Backup, ResetDemo, Cutover, Rollback, Finalize, Cleanup, ProtoStop, ProtoStart, Status |
| v2 | `deployment-recovery\v2\` | v1 전부 + Inspect(읽기 전용), TimeSync, PurgeProto |

- **Git 제외:** 두 폴더 모두 저장소 로컬 제외 파일(`.git/info/exclude`)에 `/deployment-recovery/`를 등록해 Git에서 제외했습니다. `git status` 변경 0건, `git check-ignore`로 확인했습니다.
- **민감정보 점검:** 비밀번호, 해시, 접속 문자열, 개인키는 0건입니다.
- **로컬 안전성 검사(`-Mode Check`):**
  - Prototype 대상은 읽기 전용 표시(`# RO`)가 있는 줄에서만 다룹니다.
  - 상태를 바꾸는 줄은 승인 입력 뒤에, 정해진 줄 수만 허용합니다.
  - 시각 강제 변경, 시간대 변경, `find -delete`는 금지합니다.
  - 비밀값 출력과 명령 인자로 전달하는 것은 금지합니다.

## 13. Prototype 안전 종료와 복구 가능성 (11-03 13:45 서버 시각)

**`-Mode ProtoStop`이 확인하는 것:** 전환 검증, 5100 연결, Beta 정상과 Finalize, 공개 401, Caddy 사본 해시, Prototype 실행 중, DB 건수·환경 파일·서비스 파일 기준선 일치.

**`PROTOSTOP` 입력 후 바꾸는 것(두 가지만)**
- `/etc/cron.d/safe-school-backup`을 `/root/safe-school-backup.cron.before-stop-20261103_134540`으로 옮겨 보관합니다.
- `systemctl disable --now safe-school`

**결과:** Prototype은 inactive/disabled가 됐고, 5000번은 응답하지 않습니다(000). DB는 학교 1·사용자 7 그대로이고 기준선도 같습니다.

**복구 경로:** `ProtoStart`(서비스와 예약 복구, 5000 응답 200 확인) → `Rollback`(Caddy 사본 복구). 도구 없이 하는 절차는 `MANUAL-ROLLBACK.txt` 7번에 있습니다.

## 14. 과거 Prototype VPS 백업 정리 (11-03)

**확인 과정**
- Inspect 결과, Prototype 백업 예약은 실제로 `/usr/local/sbin/safe-school-backup-v01`을 실행하고 있었습니다(저장소의 `pg-backup.sh`가 아님).
- 백업 폴더에는 파일 13개가 있었습니다.

**`-Mode PurgeProto` 안전장치**
- ProtoStop이 끝난 뒤에만 실행합니다.
- 폴더가 링크이거나 실제 경로가 다르면 거부합니다.
- 이 폴더를 참조하는 예약·서비스가 남아 있으면 거부합니다.
- PC 암호화 백업의 해시가 맞아야 합니다.
- 삭제 대상은 `safeschool_prod_pilot_YYYYMMDD_HHMMSS.dump` 형식의 일반 파일 중 하드링크가 1인 것뿐입니다.
- 확인 입력은 삭제 개수가 들어간 `PURGE-9` 형식입니다.
- 파일마다 다시 확인한 뒤 `shred` 후 삭제합니다.

**결과**
- 9개 삭제(10-28~11-03, 합계 1,417,231 bytes)
- 4개 보존(대상 아님):
  - `backup.log`
  - `predeploy_a42ea5e_20261028_151120.dump`(0 bytes)
  - `predeploy_a42ea5e_20261028_151218.dump`
  - root 소유 덤프 1개(10-28 01:43, 134,847 bytes): 기록의 비밀값 가림 규칙 때문에 이름이 `***`로 표시됨
- 삭제 후 Prototype DB 기준선은 같았습니다.

**알려진 경미한 문제**
- awk가 정규식의 `\.`를 일반 `.`로 해석한다는 경고를 냈습니다. 실제 삭제 직전에는 bash `[[ =~ ]]`로 정확한 규칙을 다시 검사하므로 삭제 범위에는 영향이 없습니다.
- 가림 규칙(40자 이상 문자열)이 긴 파일 이름까지 가립니다.

**한계:** 가상 디스크와 SSD에서는 `shred`로도 완전 파기를 보장할 수 없습니다.

## 15. 복원 시험 DB·임시 폴더 Cleanup (11-03)

- **`-Mode Cleanup`:** `^safeschool_beta_restore_[0-9_]+$` 이름의 DB와 `/home/ssadmin/safe-school-beta-upload-*`, Caddy 후보 파일만 삭제합니다. 실행하려면 `CLEANUP`을 입력해야 합니다.
- **결과:** DB 2개(`safeschool_beta_restore_20261103`, `…_102835`)와 임시 업로드 폴더 3개를 삭제했습니다. 운영 DB 3개(`safeschool_beta`, `safeschool`, `safeschool_v01`)는 삭제 대상에서 제외됐다고 기록에 표시됩니다.

## 16. 최종 Inspect와 NTP 정확도 (11-03)

**결과(`cutover-inspect-20261103135049.log`)**

| 항목 | 상태 |
|---|---|
| Caddy | 5100 연결, 공개 401 |
| Beta | active/enabled, 예약 `50 3` |
| Prototype | inactive/disabled, DB 학교 1·사용자 7 |
| Prototype 백업 폴더 | 4개 보존, 이 폴더를 참조하는 예약 없음 |
| Caddy 복구 사본 | 2개 |
| 정리 후보 | 0 |
| 시간대 | Asia/Seoul, RTC는 UTC |
| 시계 동기화 | systemd-timesyncd active, 동기화 yes(서버 ntp.ubuntu.com, offset −2.4ms), 다른 동기화 서비스 없음, ufw inactive |
| 실측 오차 | 외부 NTP 3곳(time.google.com, kr.pool.ntp.org, time.cloudflare.com) 기준 약 0.01초 |

**시계 진단 정정**
- 앞서 "서버가 2분 20초 늦다"고 본 것은 작업 PC 시계를 기준으로 비교한 것이었습니다. 실제로는 PC가 약 163초 빨랐습니다.
- 서버 시계는 원래 정상이었으므로 `-Mode TimeSync`는 실행하지 않았습니다.
- 만약 서버 시계에 2분 20초를 강제로 더했다면, 정상인 시계를 틀어지게 만들었을 것입니다.

**배운 점:** 시각 오차는 두 장비를 서로 비교하지 말고 외부 표준시(NTP)를 기준으로 재야 합니다.
