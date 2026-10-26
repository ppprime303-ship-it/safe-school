# 공모전 심사 환경(Replit)과 실제 학교 시범운영 환경(국내 VPS) 분리

확정(2026-10-26 오후 수정): **심사 환경은 Replit 배포, 실제 학교 시범운영은 국내 iwinv VPS에 앱 1개.** 같은 날 오전의 'VPS 1대에 앱 2개' 설계는 폐기했습니다.
설계·코드·로컬 검증만 했습니다. Replit 배포 공개, 서버 구축, DB·데이터 생성은 별도 승인 후 진행합니다.

## 1. 구성
| 항목 | 공모전 심사(judge) | 실제 학교 시범운영(pilot) |
| --- | --- | --- |
| 위치 | Replit App 공개 Deployment | 국내 iwinv VPS(`vgna_2_n`, 2GB, Ubuntu 24.04) |
| 공개 시점 | 2026년 11월, Replit 요금제 갱신 후(그 전에는 보류) | 서버 구축·점검 완료 후(승인) |
| HTTPS | Replit 배포 주소 | `<시범운영 호스트명>`(Caddy 자동 인증서) |
| 앱 | Replit 배포 실행(`npm run deploy:start`) | systemd `safe-school`, 127.0.0.1:5000 |
| DB 스키마 | `safeschool_prod_judge`(Replit 배포 DB) | `safeschool_prod_pilot`(VPS PostgreSQL 16, 계정 `ss_pilot`) |
| 데이터 | 가상 초·중학교 2곳, 역할별 가상 계정 8개, 모의 재난·훈련 자료 | 실제 학교 검색·업무용 이메일 인증·승인된 교직원 |
| 경보 | 모의 경보만(`ALERT_PROVIDERS=mock`, `deploy/judge/mock-alerts.json`) | 공식 긴급재난문자만(승인·형식 확인 후 `mois_cbs`) |
| 메일 | 미설정(공개 가입 불가, 계정은 운영자가 준비) | 실제 발송(서비스 결정 후) |
| SESSION_SECRET·키 | Replit 배포 Secrets | `/etc/safe-school/pilot.env` |
- 두 환경은 서버·DB·비밀값·도메인이 모두 다릅니다. 같은 VPS를 함께 쓰지 않으므로 오전 설계의 '공유 지점'(DB·디스크·서버 장애가 양쪽에 영향)이 없어졌습니다.

## 2. 코드에서 막는 것(`server/src/deploy/environment.ts`, 스키마로 역할 판정)
| 역할 | 모의 경보 | 공식 재난문자 API | 심사 도구(`judge:setup`) | 데모 시드(`db:seed`) | 네트워크 강제 |
| --- | --- | --- | --- | --- | --- |
| judge(Replit) | 허용 | **시작 거부** | 허용 | 기존 규칙 | 없음(Replit은 0.0.0.0 필요) |
| pilot(VPS) | **시작 거부** | 허용(키 필요) | **거부** | **거부** | `LISTEN_HOST` 루프백, `TRUST_PROXY_HOPS=1`, DB 같은 서버, https 주소 — 다르면 **시작 거부** |
| 기타 운영 | 거부 | 허용 | 거부 | 기존 규칙 | 없음 |
| dev(Replit Run·테스트) | 허용 | 키가 있으면 | 거부 | 기존 규칙 | 없음 |

## 3. DB에서 막는 것(국내 VPS)
- `deploy/sql/roles.sql`은 시범운영 계정·스키마만 만듭니다. VPS에는 심사 스키마가 **없습니다.**
- 심사 도구는 ① 대상 스키마가 `safeschool_prod_judge`가 아니면 거부(코드), ② 현재 DB 계정이 심사 외 SAFE SCHOOL 스키마를 쓸 수 있으면 거부(DB 권한 조회) → VPS의 `ss_pilot`은 두 조건 모두에 걸립니다.
- 로컬 PostgreSQL 16에서 VPS와 같은 설정(`90-safeschool.conf`, `pg_hba.conf.example`, `roles.sql`)으로 확인한 결과는 `docs/step7/step7-test-results.md`에 있습니다.

## 4. 11월 Replit 심사 배포 전 확인(별도 승인)
| # | 확인 | 이유 |
| --- | --- | --- |
| 1 | Replit 배포가 쓰는 DB가 개발 DB와 같은지(배포 전용 DB가 따로 생기는지) | 심사 스키마를 만들 위치. 기존 `public`·`safeschool_test`·`safeschool_browser_demo`는 건드리지 않음 |
| 2 | 배포 Secrets: `NODE_ENV=production`, `DEPLOY_PROFILE=production`, `DEPLOY_DB_SCHEMA=safeschool_prod_judge`, `DATABASE_URL`(…`?schema=safeschool_prod_judge`), `SESSION_SECRET`(심사 전용), `ALERT_PROVIDERS=mock`, `ALERT_MOCK_FEED=deploy/judge/mock-alerts.json` | 심사 역할 판정·모의 경보 |
| 3 | 첫 배포: `DEPLOY_ALLOW_NEW_SCHEMA=true npm run deploy:migrate`(1회) → 플래그 제거 → `npm run judge:setup`(계획 확인) → 승인 후 `--apply` | 심사 스키마·가상 계정 생성(`step6-demo-data-plan.md`) |
| 4 | Replit 배포 앞단 프록시 단계 수(`TRUST_PROXY_HOPS`, 기본 1)가 맞는지: 로그인 31회 → 429, 다른 망에서는 정상 | 요청 제한이 사용자별로 동작 |
| 5 | 심사 안내서의 주소를 Replit 배포 주소로 | `step6-judge-guide.md` |
