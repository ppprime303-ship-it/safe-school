# 테스트 기록

실행한 테스트와 실행하지 않은 테스트를 구분해 적습니다. "완료"는 실제 실행 결과를 확인한 것만 표시합니다.

## STEP 1 — 기본 구조와 DB (2026-10-20)

### Claude 작업공간에서 실행함

npm 패키지 설치가 막힌 환경이라 PostgreSQL 16과 Node.js 22로 할 수 있는 범위만 실행했습니다.

| 항목 | 방법 | 결과 |
| --- | --- | --- |
| 마이그레이션 SQL 적용 | `psql`로 빈 스키마에 `migration.sql` 실행 | 통과(테이블 15개 생성) |
| DB 제약 21개 | SQL로 위반·정상 데이터 입력 | 21개 모두 기대대로 동작 |
| 제약 이름이 Prisma 규칙과 일치 | `pg_constraint` 조회 | 일치(`*_pkey`, `*_fkey`) |
| 비밀번호 해시·검증, 미확인 계산 | Node.js로 모듈 직접 실행 | 통과 |

확인한 DB 제약: 대문자 이메일 거부, 재적 61명 거부, 학년·반 중복 거부(다른 학교는 허용), 중복 발령 거부(다른 학교는 허용, 종료 후 재발령 허용), 종료 시각 없는 종료 거부, 복합재난 유형 추가 허용·중복 거부, 합계 불일치 거부, 음수 거부, 사유 없는 재적 변경 거부, 부상자 > 대피확인 허용, 부상자 > 재적 거부, 보고 중복 거부, 멱등키 중복 거부, 감사 로그 수정·삭제 거부, 승인 방식 없는 승인 거부, 명단 일괄 승인 허용.

### 미검증 — Replit Shell에서 실행 필요

| 항목 | 명령 | 기대 결과 |
| --- | --- | --- |
| 의존성 설치·Prisma 클라이언트 생성 | `npm install` | 오류 없이 완료 |
| 타입 검사 | `npm run typecheck` | 오류 0 |
| 마이그레이션(Prisma 경유) | `npm run db:migrate` | `1 migration applied` |
| 데모 시드 | `npm run db:seed` | 학급 15개, 재적 420명, 계정 5개 |
| 시드 재실행(중복 없음) | `npm run db:seed` 한 번 더 → `npm run db:summary` | 숫자 변화 없음(감사 로그만 +1) |
| 자동 테스트(vitest) | `npm test` | 전부 통과 |
| 개발 서버·화면 | `npm run dev` → Webview | '정상' 표시 |
| 상태 API | Webview 주소 뒤에 `/api/health` | `"status":"ok","db":"ok"` |
| 서버 재시작 후 데이터 보존 | 서버 중지 → 재실행 → `npm run db:summary` | 숫자 동일 |
| 운영 빌드 | `npm run build` → `NODE_ENV=production SESSION_SECRET=… npm start` | 화면·API 정상 |
| `.replit` 설정 인식 | Run 버튼 | `npm run dev` 실행 |
