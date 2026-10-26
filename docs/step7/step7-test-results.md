# STEP 7 국내 VPS 배포 준비 — 실행한 검증과 결과

작성 2026-10-26 · 실행 위치: Claude 작업공간(실제 서버·Replit DB·운영 DB 접속 없음). Replit 실행이 필요한 항목은 따로 표시합니다.
작업공간 제약: npm 저장소·GitHub 릴리스 다운로드가 막혀 Express·Prisma·Vite·Caddy를 설치할 수 없습니다. 그래서 앱 서버·빌드·Caddy는 실행하지 못했고, PostgreSQL 16·systemd 검증 도구·bash는 작업공간에 있는 것으로 확인했습니다.

## 1. 자동화 테스트(대체 실행기)
| 테스트 | 결과 | 내용 |
| --- | --- | --- |
| `tests/step7-vps.test.ts`(신규) | 17/17 통과 | 시범운영 네트워크 강제(127.0.0.1 수신, `TRUST_PROXY_HOPS=1`, 같은 서버 DB, https), Replit 심사·개발에는 미적용, 기능 미설정 경고, 심사 도구 거부(코드·DB 권한 조회 결과), 설정 파일(env·Caddy·systemd·roles.sql·PostgreSQL·pg_hba·백업) |
| `tests/step6-deploy.test.ts` | 30/30 통과(1건 추가) | Replit 배포 DB에서 개발용 가상 스키마 접근은 허용, 다른 운영 스키마는 거부 |
| `step7-pilot` 18, `deploy-db-target` 8, `safe-log` 4, `alerts-region` 12 | 모두 통과 | 회귀 확인 |
| 대체 타입 검사 | 오류 0 | 서버·화면·스크립트·테스트 |
| 변형 시험 | 설정을 일부러 틀리게 바꾸면 실패 | systemd를 `deploy-start.js`(자동 마이그레이션)로 → 1건 실패, env를 `LISTEN_HOST=0.0.0.0`으로 → 2건 실패. 원래대로 되돌림 |
- **Replit 전체 테스트(`npm run typecheck`, `npm test`)는 실행하지 못했습니다.** 예상 건수: 616 + 17(step7-vps) + 1(step6-deploy) = **634건**.

## 2. PostgreSQL 16 — VPS와 같은 설정으로 로컬 확인
작업공간에 새 클러스터를 만들고 `deploy/postgres/90-safeschool.conf`(conf.d), `pg_hba.conf.example`, `deploy/sql/roles.sql`을 그대로 적용했습니다(포트만 5433). 확인 후 삭제했습니다.
| 확인 | 결과 |
| --- | --- |
| 설정 적용 | listen_addresses=localhost, shared_buffers=256MB, max_connections=30, scram-sha-256, log_statement=none, log_min_error_statement=panic, log_error_verbosity=terse, statement_timeout=30s |
| 수신 주소 | 127.0.0.1:5433만. 작업공간의 외부 IP로 접속 → **Connection refused** |
| roles.sql | 오류 없이 실행, 확인 줄 `ss_pilot | f | f`(public 생성 불가, 심사 스키마 없음) |
| 마이그레이션 5개를 `ss_pilot`으로 적용 | 성공, 테이블 30개(Prisma 대신 psql로 SQL 적용 — 실제 `prisma migrate deploy`는 서버에서 확인 필요) |
| `ss_pilot` → public 테이블 생성 | permission denied for schema public |
| 소켓으로 `ss_pilot`, TCP로 `postgres`, `ss_pilot` → 다른 DB | 모두 pg_hba 거부 |
| 잘못된 비밀번호 | password authentication failed |
| 심사 도구가 쓰는 권한 조회(`ss_pilot`) | `safeschool_prod_pilot | t` → 심사 도구 DB 검사에서 거부 |
| 로그 개인정보 | 이메일 중복 오류를 일부러 냄 → 클라이언트에는 상세가 보이지만 **서버 로그에는 오류 종류만**(이메일·SQL 0건) |
| 백업 스크립트 | `pg-backup.sh`로 덤프(600 권한, 읽기 확인), 다른 스키마 지정 시 거부 |
| 복원 | 새 DB에 복원 → 학교 1·사용자 1·테이블 30, 원본 그대로 |
| `vps-check.sh` 4절(DB) | 정상 설정 → 모두 통과. `ss_pilot`에 CREATEDB 부여 → '확인 필요(010)', pg_hba에 `0.0.0.0/0` 줄 추가 → '확인 필요'로 잡음(시험 후 원복) |

## 3. 기타
| 확인 | 결과 |
| --- | --- |
| `systemd-analyze verify safe-school.service` | 오류 없음(작업공간은 systemd가 PID 1이 아니라 **실제 시작은 못 함**) |
| `systemd-analyze security` | 노출 점수 6.8(MEDIUM) → 격리 설정 추가 후 **1.5(OK)** |
| 스크립트 문법(`bash -n`) | pg-backup.sh, vps-check.sh, release-compare.sh 통과 |
| `release-compare.sh` | 같은 커밋 → [같음]·종료 0, 다른 커밋 → 차이 파일 목록, 없는 커밋 → 종료 2 |
| 심사 도구(가짜 DB) | 시범운영 env → "실제 학교 시범운영 스키마에서는 실행할 수 없습니다" 거부, 심사 env + 시범운영 권한 계정 → 거부, 심사 env 정상 → 계획만 표시 |
| Replit 앱 내용 대조 | Replit의 `package.json`·`server/src/deploy/environment.ts`가 GitHub `ad6e558`과 같음(일부 파일만 읽어 확인. 전체 비교는 Replit에서 `release-compare.sh`) |

## 4. 실행하지 못한 것(실제 환경 필요)
- Caddy 설정 검증(`caddy validate`)·자동 인증서·`X-Forwarded-For` 실제 처리 — 공식 문서와 커뮤니티 설명(신뢰하지 않는 클라이언트 값은 버림, Cookie·Authorization 기본 가림)에 근거
- 실제 서버에서 systemd 격리 설정으로 앱이 시작되는지, 2GB 메모리 실측, 빌드 최대 메모리
- `prisma migrate deploy` 실제 실행(Prisma 엔진 다운로드 불가)
- 학교알리미·메일 발송·공식 재난문자 API 실제 호출, 아이폰·안드로이드 알림
