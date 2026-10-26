# STEP 6 보안 점검표

구분: **[기존]** STEP 1~5 자동화 테스트가 이미 확인함 · **[신규]** STEP 6에서 테스트 추가 · **[서버]** VPS에서 직접 확인해야 함(아직 안 함)
자동화 테스트 통과는 기능 규칙을 확인한 것입니다. 운영 서버의 보안을 보증하지는 않습니다.

## 1. 점검 항목
| 항목 | 현재 구현 | 확인 상태 |
| --- | --- | --- |
| 미인증 접근 차단 | `requireAuth`/`requireVerified`, 화면도 로그인으로 이동 | [기존] e2e·단위 / [신규] `step6-proxy`: `/api/auth/me`, 학교 API → 401 |
| 승인 대기 사용자 차단 | 승인된 소속만 학교 화면·API | [기존] step2·3e e2e, 화면 점검 |
| 다른 학교 데이터 차단 | 요청마다 `resolveAccess(userId, schoolId)` | [기존] e2e step3e '권한 종합' |
| 직책별 권한 | 역할 + 직책 + 업무 합산(`capabilitiesFor`) | [기존] step3d / [신규] 심사 계획 권한 대응 |
| 관리자 자기 권한 변경 제한 | 마지막 운영자를 해제·회수하지 못함, 비밀번호 재확인, 감사 로그 | [기존] step3d(동시 해제 경쟁 포함) |
| 세션 만료·쿠키 속성 | 무작위 토큰(DB에는 해시만), 개인 기기 30일·공용 8시간 + 미사용 30분, `HttpOnly; Secure(운영); SameSite=Lax` | [신규] 운영 쿠키 속성 단위 테스트 |
| 프록시 뒤 실제 IP | `trust proxy = TRUST_PROXY_HOPS`(기본 1), 앱은 `LISTEN_HOST=127.0.0.1` | [신규] `step6-proxy`: XFF 앞쪽 위조 무시 |
| 로그인 시도 제한 | IP별 15분 30회(가입·인증·로그인·재확인) | [신규] 31번째 요청 429, 다른 IP는 별도 |
| CSRF·상태 변경 API | 변경 요청은 JSON 본문 또는 `X-Requested-With: safe-school`, SameSite=Lax | [신규] 폼 형식 415, 헤더 없는 요청 400 |
| 입력 검증·출력 이스케이프 | zod 검증(길이·범위), React 기본 이스케이프, 안내문은 텍스트로만 표시 | [기존] |
| 외부 URL 안전성 | https와 허용 도메인만, 새 탭 `noopener noreferrer` | [기존] STEP 4·5 |
| HWPX에 실제 개인정보 없음 | 훈련일지에는 학급 인원 수와 교직원 표시 이름만. 심사 데이터는 '가상' 이름과 `.invalid` 이메일 | [신규] 심사 계획 테스트(가상 표시·예약 도메인) |
| 오류 로그 비밀정보 | 이메일·전화·DB 주소(URL) 가림, Prisma 요청 값 제거 | [기존] safe-log / [신규] 운영 보호 오류 문구에 비밀번호가 없음 |
| 운영 DB 대상 | 프로필·스키마 필수, public·test·demo 거부, 운영 프로필인데 NODE_ENV가 다르면 시작 거부 | [기존] deploy-db-target / [신규] step6-deploy |
| 새 스키마 생성 오용 | 서버 시작 때는 만들지 않음. `deploy:migrate`에서 플래그가 있을 때만 | [신규] |
| 모의 경보 | 환경 역할별: 심사(judge)만 허용, 시범운영·기타 운영은 거부 | [신규] `assertMockAllowed`·`alertProviderErrors`(step6-deploy·step7-pilot) |
| 환경 분리(심사·시범운영) | 심사=Replit 배포, 시범운영=국내 VPS(서버·DB·비밀값·도메인 모두 다름) | [신규] 시범운영 네트워크 설정 강제(step7-vps), 로컬 PostgreSQL 16 확인 / [서버] |
| 심사 도구의 시범운영 실행 차단 | 코드: 스키마가 정확히 `safeschool_prod_judge`이고 확인 값이 있어야 쓰기. DB: 시범운영 스키마 권한이 있는 계정이면 거부 | [신규] 대상·권한 판정 테스트, 가짜 Prisma 흐름 |
| 공식 재난문자 API 키 | env 파일에만, 오류 기록에서 가림, 심사 환경에서 켜면 시작 거부 | [신규] step7-pilot(가짜 HTTP) |
| 보안 헤더 | 프록시에서 HSTS, nosniff, frame DENY, Referrer-Policy를 붙임. 앱은 x-powered-by를 끔 | [신규] x-powered-by 없음 / [서버] `curl -I`로 헤더 확인 |

## 2. STEP 6에서 고친 위험
| 위험 | 수정 |
| --- | --- |
| 앱이 늘 `0.0.0.0`에서 받음 → VPS에서 프록시를 거치지 않고 직접 접속하면 `X-Forwarded-For` 위조로 IP별 제한을 피할 수 있음 | `LISTEN_HOST`(기본 0.0.0.0은 Replit용, VPS는 127.0.0.1), `TRUST_PROXY_HOPS` 설정 |
| `DEPLOY_ALLOW_NEW_SCHEMA=true`를 남겨 두면 서버를 시작할 때 새 스키마를 조용히 만들 수 있음 | 생성은 `--migrate-only` 단계에서만. 남아 있으면 경고 |
| 운영 프로필인데 `NODE_ENV`가 빠지면(systemd 설정 실수) DB 보호 검사를 건너뛰고 개발 모드로 실행 | 그 조합이면 시작 거부 |
| 심사 계정 생성 중 오류가 나면 "아무것도 바꾸지 않았습니다"라고 잘못 안내 | 쓰기를 시작한 뒤에는 "일부 생성됨 — 다시 실행하면 건너뜀"으로 안내 |

## 3. 서버에서 직접 확인할 것
2026-10-26 오후 수정: 심사 환경은 Replit 배포, 국내 VPS는 실제 학교 시범운영 전용입니다.
- 국내 VPS: `docs/step7/step7-security-checklist.md`, 읽기 전용 점검 `deploy/scripts/vps-check.sh`
- Replit 심사 배포(11월): 로그인 31회 → 429(다른 망에서는 정상), 심사 계정(A학교)으로 B학교 주소 직접 입력 → 404, 쿠키 `Secure; HttpOnly; SameSite=Lax`, 모의 경보에 '[모의]' 표시

## 4. 남은 위험·한계
- 요청 제한은 앱 프로세스 메모리 기준입니다(환경마다 앱 1개). 재시작하면 기록이 사라집니다.
- 공개 회원가입: 운영 서버에 메일 발송을 설정하지 않으면 인증코드를 보낼 수 없어 가입을 마칠 수 없습니다. 심사 계정은 운영자가 미리 만듭니다. 학교 등록은 운영자 승인이 필요합니다.
- CSP(Content-Security-Policy)는 적용하지 않았습니다. 빌드 결과를 확인한 뒤 프록시에서 추가할지 검토합니다.
- 외부 보안 진단(취약점 점검)은 하지 않았습니다.

## 5. 모의 경보 정책(2026-10-26 결정 반영)
- 심사 환경: '[모의]' 표시가 붙은 모의 경보만 사용합니다(`deploy/judge/mock-alerts.json`, 4건). 공식 API는 켤 수 없습니다.
- 시범운영 환경: 모의 경보를 켤 수 없습니다. 공식 긴급재난문자 API는 활용 승인과 실제 응답 확인 뒤에만 켭니다(`docs/step7/official-alerts-api.md`).
