# 비밀값·환경변수 관리

갱신 2026-11-02. 실제 값은 이 문서와 저장소에 적지 않습니다.

## 위치

| 환경 | 보관 | 비고 |
|---|---|---|
| 학교 PC | `%USERPROFILE%\devtools\postgresql16\secrets\`, 미리보기는 `.safeschool-preview\secrets.json` | 사용자 전용 권한, 저장소 밖 |
| GitHub Actions | **API 키 등록하지 않음** | 테스트는 가짜 응답만 쓰고 외부 API를 부르지 않음 |
| Beta 서버 | `beta.env`, 권한 640 | 서비스에 필요한 키만. 등록은 별도 승인 |
| 저장소 | 변수 이름과 빈 예시만 | `.env.example`, `deploy/env/*.example` |

GitHub Actions Secrets는 지금 필요 없습니다. 배포 자동화를 만들게 되면 서버 접속 수단만 넣고, API 키는 서버에만 둡니다.

## Beta 서버 변수

| 변수 | 필요 시점 | 용도 |
|---|---|---|
| `SESSION_SECRET` | 항상 | 세션·인증코드 |
| `DATABASE_URL` | 항상 | Beta DB 전용 계정 |
| `SCHOOLINFO_API_KEY`, `SCHOOLINFO_SGG_REQUIRED=true` | 학교 검색 | 학교알리미 |
| `KMA_WARNING_SERVICE_KEY` | 기상특보 카드·수집 | `ALERT_PROVIDERS=kma_warning`은 `verified` 후 |
| `MOIS_CBS_SERVICE_KEY` | 재난문자 수집 | `verified`, 서버 IP 등록 후 |
| `NEIS_API_KEY` | 현재 불필요 | 화면에서 쓰지 않으므로 넣지 않음 |
| `MAIL_PROVIDER`, `GMAIL_SMTP_USER`, `GMAIL_SMTP_APP_PASSWORD` | 실제 학교 모드 | 개인 Gmail은 시험용, 운영 계정은 미정 |

**재난문자 IP:** 공유플랫폼은 등록되지 않은 IP를 거부합니다(코드 32). 학교 PC와 Beta 서버는 공인 IP가 다르므로 각각 등록이 필요합니다.

## 점검 결과(2026-11-02)

- 모든 커밋(152개) 이력에서 로컬 키 값 4종과 인코딩 형태: 일치 0건(값은 출력하지 않고 개수만 확인)
- `serviceKey=`, `apiKey=`, `KEY=` 뒤 실제 값 형태, 앱 비밀번호 형태: 0건
- `.gitignore`에 `.env`, `.env.*`, `secrets/`, `*.key`, `*.pw`
- 워크플로에 `secrets.` 참조 없음
- 화면 코드는 공공 API 키를 읽지 않음, API 호출은 서버에서만
