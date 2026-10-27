# STEP 8 운영 안정화 계획(준비 단계)

작성 2026-10-27 · 학교 PC(Windows)에서 작성. **VPS 접속·운영 DB 변경·배포는 하지 않았습니다.**
기본 절차는 `docs/step7/step7-vps-operations.md`(배포·백업·복원·롤백)를 따르고, 이 문서는 그 위에 리허설·감시·장애 대응·이번 릴리스 주의사항을 더합니다.

## 0. 저장소와 운영 서버의 차이(확인 필요)
| 항목 | 저장소(98ca057 기준) | 운영 서버(사용자 설명, 2026-10-26 STEP 7-C) | 상태 |
| --- | --- | --- | --- |
| Caddyfile | `deploy/caddy/Caddyfile.example` — 가입·인증코드 재발송 차단 규칙 **없음** | `/api/auth/signup`, `/api/auth/resend-code` 차단 | **운영 Caddyfile 미확보** |
| 7-C 배포·HTTPS 검증 기록 | `docs/devlog/2026-10-26.md`는 16:19 지시까지만 있음 | 배포·외부 검증 완료 | **기록 미확보** |
| 호스트명 | 문서에 `<시범운영 호스트명>` | duckdns 호스트 | 비밀 아님, 반영 필요 |
| `pilot.env` 실제 값 | 예시만 | 서버에만 | 저장소에 올리지 않음(정상) |

- 10월 26일 저녁 운영 문서·설정은 GitHub에 없습니다. **이 문서와 이번 작업은 그것을 복원하지 않았고, 복원했다고 보지 않습니다.**
- 집 PC(SSH 키 보유)에서 할 일: 운영 Caddyfile(비밀값 없음)을 `deploy/caddy/`에 반영, 7-C 기록을 `docs/devlog/2026-10-26.md`(또는 별도 파일)에 추가. 그 전에는 운영 Caddy 동작을 가정한 코드를 넣지 않습니다.

## 1. 백업·복원 리허설
목표: '백업이 있다'가 아니라 '빈 DB에 되살려 앱이 그 데이터로 동작한다'를 확인합니다.

| 순서 | 할 일 | 어디서 | 기록 |
| --- | --- | --- | --- |
| 1 | 로컬 리허설: 로컬 PostgreSQL 16에 테스트 스키마 → 가상 데이터 → `pg_dump -Fc --schema` → 새 DB에 `pg_restore` → 건수 비교 → 앱을 복원 DB로 실행해 로그인·상황판 확인 | 학교 PC(로컬 DB 설치 후) | 걸린 시간, 건수 |
| 2 | 운영 백업 확인: `backup.log` 최근 7일 성공, 최신 덤프 `pg_restore --list` | VPS(SSH) | 파일 크기·시각 |
| 3 | 운영 복원 시험: 최신 덤프 → `safeschool_restore_<날짜>` 새 DB → 건수 비교 → 시험 DB 삭제 | VPS(SSH), 승인 후 | 건수, 소요 시간 |
| 4 | 서버 밖 사본: 암호화 사본 1개를 운영자 PC로, 복호화 가능 여부 확인 | 집 PC | 날짜만(경로·비밀번호 기록 금지) |

- 1번 로컬 리허설 결과(2026-10-27): `pg_dump -Fc --no-owner --schema=safeschool_test` → 새 DB `safeschool_restore_rehearsal`에 `pg_restore --no-owner --role=ss_test` → 2초.
  원본·복원 건수 일치(schools·users·school_memberships·audit_logs·_prisma_migrations 5), 트리거 12·CHECK 제약 49 일치, `prisma migrate status` "up to date". 리허설 DB·덤프 삭제.
  한계: 테스트 직후라 데이터가 적었음(사용자 1명). 가상 학교 2곳 구성 뒤 다시 하면 건수 비교가 더 의미 있음. 앱을 복원 DB로 띄워 로그인하는 단계는 아직 안 함.
- 점검표 보완
  - [ ] 덤프 직후 `pg_restore --list` 성공(기존 `pg-backup.sh`에 있음)
  - [ ] 복원 DB에서 `_prisma_migrations` 건수·`prisma migrate status` 확인(추가)
  - [ ] 감사 로그 추가 전용 트리거·CHECK 제약 수가 원본과 같음(추가 — 무결성 규칙이 복원에서 빠지지 않았는지)
  - [ ] 복원 DB로 앱을 `deploy:check` 후 띄워 로그인·상황판 조회(추가, 서비스와 다른 포트·127.0.0.1)
  - [ ] 리허설 DB 삭제와 그 기록
- 운영 스키마를 덮어쓰거나 DROP하지 않습니다. 복원은 항상 새 DB로 합니다.
- 운영 덤프에는 실제 교직원 이메일이 들어 있으므로 학교 PC로 가져오지 않습니다(로컬 리허설은 가상 데이터만).
- 기록 양식(`docs/devlog/<날짜>.md`):
  `백업 파일 시각 · 크기 / 복원 DB 이름 / schools·users·school_memberships 건수(원본 vs 복원) / 소요 시간 / 시험 DB 삭제 여부`

## 2. 상태 확인(헬스체크)
- `/api/health`: 서버 실행 + DB `SELECT 1`. 정상 200 `{status:"ok", db:"ok", dbLatencyMs}`, DB 장애 503. 개인정보 없음.
- `deploy/scripts/health-check.sh [호스트명]`(이번 추가, 읽기 전용): 앱(127.0.0.1)과 공개 HTTPS를 함께 확인합니다. 둘 다 정상이면 0, 하나라도 실패하면 1.
  - 앱 정상 + 공개 실패 → Caddy·인증서·DNS(duckdns) 문제
  - 앱 실패 → 서비스·DB 문제(아래 3절)
- 5분 간격 cron은 실패만 기록하고 **재시작하지 않습니다**(재시작은 systemd `Restart=`가 맡음).
- 서버 밖 감시(선택, 승인 필요): 외부 가동 감시 서비스는 외부 계정 생성이 필요하므로 별도 승인 후에 둡니다.
- 검증(2026-10-27, 학교 PC 로컬 앱 127.0.0.1:5097 + 로컬 PostgreSQL):
  | 시나리오 | 결과 |
  | --- | --- |
  | 정상 | `[정상]`, `dbLatencyMs` 표시, 종료 코드 0 |
  | DB 중지 | 앱 HTTP 503 → `[확인 필요]`, 1 |
  | DB 재시작 | 앱 재시작 없이 `[정상]`, 0 |
  | 앱 중지 | `연결 실패`, 1 |
  | 공개 주소 연결 실패(`.invalid` 호스트) | `[확인 필요] 공개(…) 연결 실패`, 1 |
  - **미검증:** 실제 공개 HTTPS 주소의 정상 경로(운영 서버에 요청하지 않음).

## 3. 장애 대응(시범운영)
먼저 학교에 안내합니다. 앱이 안 되면 **학교의 기존 비상대응 절차(방송·비상연락망)를 따릅니다**(앱은 보조 시스템).

| 증상 | 확인 | 조치 |
| --- | --- | --- |
| 공개 주소 접속 불가, 앱 정상 | `systemctl status caddy`, `journalctl -u caddy -n 100`, 인증서 만료일, duckdns IP | Caddy 재시작, DNS 갱신 |
| `/api/health` 503 | `systemctl status postgresql`, 디스크 `df -h`, 메모리 `free -m` | PostgreSQL 재시작, 디스크 정리(백업 보관 기간 확인) |
| 앱 반복 재시작 | `journalctl -u safe-school -n 200`(개인정보 없는 요약 로그), `deploy:check` 결과 | 직전 릴리스로 롤백(`step7-vps-operations.md` 4절) |
| 메모리 부족(2GB) | `free -m`, `step7-2gb-memory.md` | 빌드 중이면 빌드 중단, 스왑 확인 |
| 인증 메일 미수신 | 메일 서비스 대시보드 발송 기록, 앱 로그의 `[mail] 발송 실패` | 인증 우회 금지. 대체 메일 수단은 사용자 결정 |

- 장애 기록: 시작·감지·복구 시각, 원인, 조치, 재발 방지. 개인정보·비밀값은 적지 않습니다.

## 4. 이번 개발 릴리스(dev/step7d-step8) 배포 시 주의
| 항목 | 내용 |
| --- | --- |
| DB 변경 | **없음**(마이그레이션 추가 없음) → 롤백은 릴리스 폴더 전환만 |
| API 변경 | `POST /api/auth/verify-email`에 `password`(필수)·`displayName`(선택) 추가. 화면과 서버가 같은 빌드로 배포되므로 따로 맞출 것 없음 |
| 동작 변경 | 가입 요청은 비밀번호를 저장하지 않음(인증할 때 확정). 인증 전 재가입은 409 대신 코드 재발송(201). 메일 미설정 시 계정을 만들지 않음 |
| 운영 영향 | 운영 DB 사용자 0명 → 인증 대기 계정 없음. Caddy 가입 차단을 유지하면 화면 동작은 이전과 같음(차단 응답) |
| `package-lock.json` | `resolved` 주소를 Replit 내부 주소에서 `registry.npmjs.org`로 바꿈(버전·integrity 동일). VPS에서 `npm ci`가 Replit 주소 없이 동작해야 함 — 7-C 때 VPS에서 어떻게 설치했는지 확인 필요 |
| 줄바꿈 | `.gitattributes`(`eol=lf`) 추가 — Windows 체크아웃에서도 배포 설정·스크립트가 LF |
| 요청 본문 | `express.json({ inflate: false })` — 압축 요청 본문 415. 본문 처리 오류(413·415)를 500 대신 해당 4xx로 응답 |

## 5. 의존성 보안(`npm audit` high 2건, 2026-10-27 확인)
| 패키지 | 내용 | 실제 영향 | 조치 |
| --- | --- | --- | --- |
| body-parser 2.3.0(express 5.3.0 경유) | GHSA-27r3-jxmh-p828: 압축 요청 본문 뒤 남는 바이트로 서비스 거부, 2.0.0~2.3.x | **있었음** — `express.json()`이 압축 본문을 기본으로 풀어 로그인 전 API에서도 도달 가능 | **완화(버전 변경 없음):** `inflate: false`로 압축 본문 거부(415). 수정판 2.4.0은 2026-10-22 공개(5일 전)라 공급망 위험을 고려해 2주 뒤 lock 갱신 검토(express 범위 `^2.3.0` 안이라 lock만 바뀜) |
| zod 3.25.76 | GHSA-mrhx-c7xc-m3w5: 큰 배열·컬렉션 검증 시 메모리 고갈, 4.6.6 미만 전부 | **제한적** — 요청 본문 100KB(앱)·1MB(Caddy) 상한 안에서만 검증, 배열 스키마는 `.max()` 있음 | 수정판은 zod 4(주 버전 변경, API 차이)뿐 → 이번에는 올리지 않음. 별도 작업으로 zod 4 이전 검토 |
- 시험: `tests/step6-proxy.test.ts`에 압축 본문 415·100KB 초과 413 추가(수정 전 코드에서는 각각 401·500으로 실패함을 확인).

## 6. 아직 하지 않은 것
- VPS 접속, 운영 Caddyfile·기록 반영(**운영 Caddyfile 계속 미확보**), 운영 백업·복원 시험, 헬스체크 cron 설치(모두 SSH 필요)
- 외부 감시 서비스, 알림(메일·메신저) — 외부 계정 필요, 승인 후
- body-parser 2.4.0 lock 갱신(공개 2주 경과 후), zod 4 이전
