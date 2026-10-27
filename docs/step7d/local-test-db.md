# 로컬 테스트 DB(학교 PC, Windows) — 설치·실행·정리 절차

작성 2026-10-27. **로컬 개발·테스트 전용.** 운영·심사 DB와 무관하며 실제 개인정보를 넣지 않습니다.

## 1. 구성
| 항목 | 값 |
| --- | --- |
| 출처 | postgresql.org/download/windows → EDB "Binaries" 페이지 → `https://get.enterprisedb.com/postgresql/postgresql-16.15-5-windows-x64-binaries.zip` |
| 무결성 | 같은 호스트의 `….zip.sha256`과 SHA-256 일치(`43bb45f1…aa8281`). ZIP 안 실행 파일은 대부분 코드 서명 없음(44개 중 1개만 EnterpriseDB 서명) → 무결성 근거는 공식 HTTPS 호스트의 SHA-256 |
| 위치 | `%USERPROFILE%\devtools\postgresql16\` (`pgsql\` 서버 파일만 — pgAdmin·StackBuilder·문서 제외, `data\`, `logs\`, `secrets\`) |
| 권한 | 관리자 권한·Windows 서비스·방화벽 변경 없음. 사용자 프로세스로 `pg_ctl` 실행 |
| 접속 | `127.0.0.1:55432`만(`listen_addresses='127.0.0.1'`), `pg_hba` 로컬 주소만·scram-sha-256 |
| 계정 | `local_admin`(클러스터 관리자, 정리용) / `ss_test`(슈퍼유저·DB 생성·역할 생성 권한 없음) |
| DB | `safeschool_local_test`(소유자 `ss_test`), 테스트 스키마 `safeschool_test` |
| 비밀번호 | 무작위 생성, `secrets\*.pw`(사용자 전용)에만. 화면·로그·저장소에 쓰지 않음 |

## 2. 테스트 실행
`secrets` 밖으로 비밀번호를 내보내지 않도록 저장소 밖 실행기를 씁니다. 실행기는 `DATABASE_URL`·`TEST_DATABASE_URL`을 로컬 테스트 DB로 덮어쓰고(셸에 다른 주소가 남아 있어도), 메일은 모의 발송, 운영용 키 변수는 지웁니다.
```bash
R=~/devtools/postgresql16
"$R/pgsql/bin/pg_ctl.exe" -D "$(cygpath -w $R/data)" -l "$(cygpath -w $R/logs/postgres.log)" -w start </dev/null >/dev/null 2>&1
bash $R/safeschool-test.sh npm test
bash $R/safeschool-test.sh npm run e2e:step2      # e2e:step3 … step3e 동일
```
- Git Bash에서 `pg_ctl start`는 `</dev/null >/dev/null`로 입출력을 떼지 않으면 명령이 끝나지 않습니다(서버는 정상 실행).
- **0.0.0.0 방지(두 겹):** 실행기가 `LISTEN_HOST=127.0.0.1`을 내보내고, E2E 도구(`scripts/e2e-server.ts`)도 테스트 서버에 항상 `LISTEN_HOST=127.0.0.1`을 넘깁니다(확인: E2E 실행 중 수신 주소 `127.0.0.1:5099`만). vitest HTTP 테스트는 원래 `127.0.0.1`·임의 포트로 띄웁니다.
- 앱을 직접 띄울 때(`npm run dev`, `node dist/server/index.js`)도 실행기를 거치거나 `LISTEN_HOST=127.0.0.1`을 줍니다. 앱 기본값 0.0.0.0은 Replit용이라 바꾸지 않았고, 학교 PC에서는 교내망에 열립니다.
- 확인: `netstat -ano -p tcp | grep LISTENING | grep -E ':(5000|5097|5099|55432) '` → 모두 `127.0.0.1`

## 3. 중지·정리
```bash
"$R/pgsql/bin/pg_ctl.exe" -D "$(cygpath -w $R/data)" -m fast -w stop     # 중지(데이터 유지)
```
- 테스트 데이터만 지우기: 다음 `npm test`가 테스트 스키마를 비우고 다시 씁니다(`resetTestData`).
- 완전 삭제(평가가 끝난 뒤, 사용자 확인 후): 서버 중지 → `%USERPROFILE%\devtools\postgresql16` 폴더 삭제. 레지스트리·서비스·시스템 설정을 바꾸지 않았으므로 그 밖에 정리할 것은 없습니다.
- 확인: `Get-NetTCPConnection -LocalPort 55432` 결과 없음, `postgres.exe` 프로세스 없음.
