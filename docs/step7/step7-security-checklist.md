# 국내 VPS 시범운영 서버 보안 점검표

작성 2026-10-26 · 표기: **[코드]** 앱이 시작 때 강제 · **[자동]** 자동화 테스트로 확인 · **[로컬]** 이 작업공간의 PostgreSQL 16·systemd 도구로 확인 · **[서버]** 서버에서 확인해야 함(아직 안 함)
`deploy/scripts/vps-check.sh <호스트>`가 [서버] 항목 대부분을 읽기 전용으로 점검합니다(로컬 PostgreSQL로 DB 항목 동작 확인).

## 1. 네트워크·접속
| 항목 | 기준 | 확인 |
| --- | --- | --- |
| 외부에 열린 포트 | 22·80·443만(ufw + iwinv 콘솔 방화벽) | [서버] vps-check 1절 |
| 앱 수신 주소 | `LISTEN_HOST=127.0.0.1`, 포트 5000은 외부에서 접속 불가 | [코드] 시범운영에서 다른 값이면 시작 거부 · [자동] step7-vps · [서버] vps-check 1·7절 |
| PostgreSQL 외부 접속 | `listen_addresses='localhost'`, pg_hba는 127.0.0.1/::1 + `ss_pilot` + `safeschool`만, 5432 방화벽 미허용 | [로컬] 컨테이너 외부 IP로 접속 → Connection refused, 다른 계정·DB·소켓 접속 → pg_hba 거부 · [서버] vps-check 4절 |
| 앱 DB 주소 | 같은 서버(127.0.0.1)만 | [코드] 다른 호스트면 시작 거부 |
| SSH | 키 로그인만, root 로그인 금지, fail2ban | [서버] vps-check 2절 |
| HTTPS | Caddy 자동 인증서, HSTS, 보안 헤더, `x-powered-by` 없음 | [서버] vps-check 7절, 브라우저 자물쇠 |

## 2. 실제 접속 IP(`TRUST_PROXY_HOPS`) 검증
구조: 사용자 → Caddy(같은 서버, 443) → 앱(127.0.0.1:5000). 
- Caddy는 `trusted_proxies`를 설정하지 않으면 사용자가 보낸 `X-Forwarded-For`를 **버리고** 실제 접속 IP로 새로 씁니다(Caddy 2.5+). 그래서 앱은 Caddy 1단만 믿으면 됩니다 → `TRUST_PROXY_HOPS=1`.
- 0이면 모든 사용자가 127.0.0.1로 보여 **로그인 시도 제한을 모두가 함께 쓰게 됩니다**(한 사람이 막히면 전원 막힘). 2 이상이면 사용자가 보낸 위조 값을 믿게 됩니다. → [코드] 시범운영에서 1이 아니면 시작 거부.
- [자동] `step6-proxy`(Replit): 앞쪽 위조 값 무시. [자동] `step7-vps`: Caddy 설정에 `trusted_proxies` 없음.
- [서버] 실제 확인(배포 후, 운영자가 직접):
  1. PC에서 `X-Forwarded-For: 1.2.3.4`를 매번 바꿔 붙여 존재하지 않는 계정(`…@example.invalid`)으로 로그인 31회 → 31번째 429(위조 값이 무시됨)
  2. 그 직후 **다른 망**(휴대폰 LTE)에서 로그인 화면 접속·로그인 시도 → 429가 아님(사용자별 IP로 구분됨)
  3. 15분 뒤 PC 제한 해제 확인. 결과를 devlog에 기록

## 3. 서버·서비스
| 항목 | 기준 | 확인 |
| --- | --- | --- |
| 앱 실행 계정 | `ss-pilot`(로그인 셸 없음), 릴리스 폴더 읽기 전용 | [로컬] `systemd-analyze verify` 통과, 보안 점수 1.5(OK) · [서버] 실제 시작 |
| 환경변수 파일 | `/etc/safe-school/pilot.env` 640 root:ss-pilot, Git·채팅에 올리지 않음 | [서버] vps-check 3절 |
| 비밀값 | SESSION_SECRET 32자 이상(48자 권장), DB 비밀번호는 `\password`로, API 키는 env 파일에만 | [코드] SESSION_SECRET 길이 · [서버] |
| 모의 자료·심사 도구 | 모의 경보 설정 시 시작 거부, `judge:setup`·`db:seed` 거부, 심사 스키마 없음 | [코드]·[자동] step6-deploy·step7-pilot·step7-vps · [로컬] ss_pilot 권한 조회 결과로 심사 도구 거부 · [서버] vps-check 3·4절 |
| DB 계정 | `ss_pilot` 슈퍼유저·DB 생성·역할 생성 권한 없음, public 생성 불가 | [로컬] 확인 · [서버] vps-check 4절 |
| 재시작 시 DB 변경 | 없음(마이그레이션은 백업 후 수동) | [자동] step7-vps(systemd ExecStart) |
| 자동 보안 업데이트 | unattended-upgrades | [서버] |
| 백업 | 매일, 600 권한, 14일, 서버 밖 사본은 암호화 | [로컬] 백업·새 DB 복원 · [서버] vps-check 6절 |

## 4. 로그에 개인정보를 남기지 않기
| 로그 | 남는 것 | 점검 결과 |
| --- | --- | --- |
| 앱(journald) | 시작·종료, 오류 요약 | 오류는 `safeErrorSummary`로 이메일·전화·DB 주소를 가리고 Prisma 요청 값을 버림([자동] safe-log). 메일 실패는 상태 코드만. 요청 로그 미들웨어 없음. 이메일·인증코드를 URL 쿼리로 받는 API 없음(코드 검색) |
| 개발용 메일 모의 발송 | 받는 사람 일부(`ab***@…`) | 운영에서는 console 발송 자체가 거부됨 |
| 운영자 도구(`npm run operator`) | 신청자 정보가 **운영자 터미널 화면**에 표시 | 파일로 저장하지 않음. 화면 캡처·공유 금지 |
| PostgreSQL | 오류 종류만 | `log_statement=none`, `log_min_error_statement=panic`, `log_error_verbosity=terse` → [로컬] 이메일 중복 오류를 일으켜도 서버 로그에 이메일·SQL이 남지 않음 확인 |
| Caddy 접속 로그 | 접속 IP·경로·시각·상태 | 요청·응답 헤더 삭제(쿠키·User-Agent 포함), 20MB×5개·30일 |
| 감사 로그(DB) | 사용자 ID, 작업, 접속 IP | 이메일 대신 ID 저장. 보관 기간은 시범운영 협의 때 정함 |
| journald | 위 앱 로그 | 300MB·30일 |
- 접속 IP도 개인정보가 될 수 있습니다. 보관 기간(30일)을 개인정보 고지에 적습니다(`step7-privacy-approval-checklist.md`).

## 5. 남은 위험
- 한 서버에 앱·DB가 같이 있어 서버 장애 = 전체 중단(시범운영 규모에서는 허용, 백업으로 복구).
- 요청 제한 기록은 앱 메모리에 있어 재시작하면 초기화됩니다.
- CSP(Content-Security-Policy) 미적용, 외부 취약점 진단 미실시.
- systemd 격리 설정은 실제 서버에서 처음 확인합니다.
