# 한 VPS에서 심사 환경과 실제 학교 시범운영 환경 분리

확정(2026-10-26): 국내 VPS 1대, 서비스·계정 데이터는 분리. **설계·코드·로컬 검증만 했습니다. 실제 서버 설정과 데이터 생성은 별도 승인 후 진행합니다.**

## 1. 분리 구성
| 항목 | 공모전 심사(judge) | 실제 학교 시범운영(pilot) |
| --- | --- | --- |
| HTTPS 호스트명 | `<심사 호스트명>` | `<시범운영 호스트명>` |
| 앱 프로세스·포트 | `safe-school@judge` · 127.0.0.1:5001 | `safe-school@pilot` · 127.0.0.1:5002 |
| 리눅스 실행 계정·폴더 | `ss-judge` · `/srv/safe-school/judge` | `ss-pilot` · `/srv/safe-school/pilot` |
| 환경변수 파일 | `/etc/safe-school/judge.env`(640, root:ss-judge) | `/etc/safe-school/pilot.env`(640, root:ss-pilot) |
| `SESSION_SECRET` | 심사 전용 | 시범운영 전용(다른 값) |
| DB 스키마·계정 | `safeschool_prod_judge` · `ss_judge` | `safeschool_prod_pilot` · `ss_pilot` |
| 경보 자료 | 모의 경보만(`ALERT_PROVIDERS=mock`) | 공식 긴급재난문자만(승인 후 `mois_cbs`) |
| 메일 | 미설정(공개 가입 불가) | 실제 발송(Resend) |
| 로그 | `journalctl -u safe-school@judge`, Caddy `judge-access.log` | `safe-school@pilot`, `pilot-access.log` |
| 백업 | `ss_judge`로 심사 스키마만 | `ss_pilot`으로 시범운영 스키마만 |
| 릴리스 | 환경별 `releases/`·`current` — 따로 배포·롤백 가능 | 같음 |

설정 파일: `deploy/systemd/safe-school@.service`, `deploy/env/judge.env.example`, `deploy/env/pilot.env.example`, `deploy/caddy/Caddyfile.example`, `deploy/sql/roles.sql`, `deploy/scripts/pg-backup.sh`

## 2. 코드에서 막는 것(환경 역할 — `server/src/deploy/environment.ts`)
| 역할(스키마로 판정) | 모의 경보 | 공식 재난문자 API | 심사 도구(`judge:setup`) | 데모 시드(`db:seed`) |
| --- | --- | --- | --- | --- |
| judge | 허용 | **시작 거부** | 허용 | 기존 규칙(ALLOW_DEMO_SEED) |
| pilot | **시작 거부** | 허용(키 필요) | **거부** | **거부**(플래그로도 불가) |
| 기타 운영 | 거부 | 허용 | 거부 | 기존 규칙 |
| dev(Replit·테스트) | 허용 | 키가 있으면 | 거부 | 기존 규칙 |
- 서버 시작 시 `alertProviderErrors`가 역할에 맞지 않는 공급자 설정을 발견하면 종료합니다. 모의 자료가 실제 학교 경보함에 섞이지 않게 하기 위함입니다.

## 3. DB 권한 분리(로컬 PostgreSQL 16에서 실제 확인)
`deploy/sql/roles.sql`을 이름만 바꾼 시험 DB에 적용하고, 각 계정으로 마이그레이션 5개를 적용했습니다(스키마마다 테이블 30개). 그 뒤 확인한 결과입니다.
| 확인 | 결과 |
| --- | --- |
| `ss_judge` → 심사 스키마 읽기 | 성공 |
| `ss_judge` → 시범운영 스키마 읽기·쓰기 | **permission denied for schema safeschool_prod_pilot** |
| `ss_pilot` → 심사 스키마 읽기 | **permission denied** |
| `ss_judge` → public에 테이블 만들기 | **permission denied for schema public** |
| 실제 로그인 계정의 기본 검색 경로 | 자기 스키마(`safeschool_prod_judge`). 주소에 schema를 빠뜨려도 public으로 가지 않음 |
| 심사 도구가 쓰는 권한 조회(`has_schema_privilege`) | judge=t, pilot=f → 통과. 관리자·시범운영 계정이면 pilot=t → 도구가 거부 |
| `ss_judge`로 심사 스키마 백업(`pg_dump -n`) | 성공(테이블 30개 데이터) |
| `ss_judge`로 시범운영 스키마 백업 | 권한 없음으로 실패 |
| 백업을 새 DB에 복원 | 성공(시험 학교 1건 복원 확인, 원본 덮어쓰기 없음) |
- 시험 DB와 역할은 확인 후 삭제했습니다(작업공간 로컬, Replit·운영 DB와 무관).
- 실제 Prisma `migrate deploy`(마이그레이션 기록 테이블 생성 포함)를 스키마 소유 계정으로 실행하는 것은 VPS에서 확인해야 합니다.

## 4. 자원(같은 VPS)
| 구성 | 예상(일반적 범위, **실측 필요**) |
| --- | --- |
| OS·SSH·Caddy | 300~400MB |
| PostgreSQL 16(공유) | 300~500MB |
| 앱 2개 | 각 150~300MB → 300~600MB |
| 합계(운영) | 약 0.9~1.5GB |
| 빌드(`npm ci` + `vite build`) | 순간적으로 1GB 이상 추가 |
- **앱이 2개가 되었으므로 4GB를 권장합니다.** 2GB면 빌드할 때 한 앱을 멈춰야 할 수 있고, 스왑에 의존하게 되어 실제 학교 사용자 응답이 느려질 위험이 있습니다.
- systemd `MemoryMax=700M`(앱별): 한 앱의 메모리 폭주가 다른 앱과 DB를 밀어내지 않게 합니다.
- PostgreSQL: `max_connections=40`, 계정별 `CONNECTION LIMIT 15`, 앱 `connection_limit=5`
- 확인할 것: 운영 중 `free -m`, `systemctl status safe-school@*`의 메모리, `pg_stat_activity` 연결 수를 하루 2번 기록(시범운영 첫 주)

## 5. 장애 영향
| 장애 | 영향 | 대응 |
| --- | --- | --- |
| 한 앱 중단·오류 | 그 환경만 중단(프로세스·포트 분리) | systemd 자동 재시작(5회/5분 제한) |
| 한 앱 메모리 폭주 | `MemoryMax`로 그 앱만 종료 | 로그 확인 후 재시작 |
| 심사 환경 잘못된 배포 | 시범운영 영향 없음(릴리스 폴더 분리) | 심사 환경만 롤백 |
| PostgreSQL 중단 | **두 환경 모두 중단**(공유 지점) | DB 재시작, 백업 복원. 심사 기간에는 시범운영 변경 작업을 피함 |
| VPS 전체 장애 | 두 환경 모두 중단 | 서버 밖 백업 사본으로 새 서버에 복구(절차: `step6-release-rollback.md`) |
| 디스크 가득 참 | 두 환경 모두 영향 | 로그 순환(Caddy 20MB×10, journald 200MB), 백업 14일 보관 |
- 공유 지점(DB·디스크·VPS)이 남는 것이 한 대 구성의 한계입니다. 시범운영이 커지면 서버 2대로 나누는 것을 다시 검토합니다.

## 6. 백업·복구
- 환경별 cron이 자기 계정으로 자기 스키마만 덤프합니다(`deploy/scripts/pg-backup.sh`, 600 권한, 14일 보관, 덤프 목록을 읽을 수 있는지 확인).
- 복구는 **새 DB나 새 스키마 이름으로 복원**해 비교한 뒤 전환합니다. 기존 스키마를 DROP하거나 덮어쓰지 않습니다.
- 시범운영 백업에는 실제 교직원 이메일이 들어 있습니다. 서버 밖 사본은 암호화해 보관하고, 시범운영이 끝나면 보관 기간 정책에 따라 삭제합니다(`docs/step7/step7-pilot-plan.md` 4절).
