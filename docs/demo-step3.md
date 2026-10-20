# STEP 3 브라우저 시연 순서(10/23 목표)

시연 데이터는 **`safeschool_browser_demo` 스키마에서만** 다룹니다. `npm test`·`e2e:step2`·`e2e:step3`는 `safeschool_test`를 초기화하므로 시연 스키마로 실행하지 마세요. STEP 3-A는 새 마이그레이션이 없어 시연 스키마에 추가로 적용할 것이 없습니다.

## 1. 서버 실행(Replit Shell)

```bash
git pull
DATABASE_URL="$(node -e 'const u=new URL(process.env.DATABASE_URL);u.searchParams.set("schema","safeschool_browser_demo");process.stdout.write(u.toString())')" \
MAIL_PROVIDER=console NODE_ENV=development npm run dev
```

## 2. 준비(관리자 계정 teacher01@example.com)

1. 학급 화면에서 1학년 1반 재적을 **25명**으로 맞춥니다(기존 재적과 다르면 저장). 
2. 교직원 화면에서 teacher02@example.com이 1학년 1반 담임으로 배정되어 있는지 확인합니다.

## 3. 시연(두 브라우저 창: 관리자 / 담임)

| 순서 | 누가 | 할 일 | 확인할 것 |
| --- | --- | --- | --- |
| 1 | 담임 | 학급 보고 화면을 열어 둠 | "진행 중인 재난 상황이 없습니다" |
| 2 | 관리자 | 상황판 → 재난 발령: 훈련 · 지진 · 대피 장소 "운동장" → 확인 | 상황판에 학급 카드가 모두 '미보고' |
| 3 | 담임 | 새로 고침 없이 기다림(5초 이내) | 1학년 1반·재적 25명 보고 화면이 자동으로 열림 |
| 4 | 담임 | 대피 확인 24명으로 조정 후 보고 | 저장 완료, 미확인 1명 |
| 5 | 관리자 | 상황판(5초마다 갱신) | 1학년 1반 '미확인 인원 있음' 1명, 다른 학급 미보고 |
| 6 | 담임 | 25명 전원 대피로 다시 보고 | 버전 2로 저장 |
| 7 | 관리자 | 상황판 | 1학년 1반 '보고 완료', 미확인 0명 |
| 8 | 관리자 | 상황 종료 → 확인 | 진행 중 상황 없음, 발령 폼이 다시 보임 |
| 9 | 담임 | 새로 고침 없이 기다림 | "진행 중인 재난 상황이 없습니다"(추가 보고 불가) |

감사 기록 확인(선택, 읽기 전용):

```bash
psql "$DATABASE_URL" -c "SET search_path TO safeschool_browser_demo; SELECT action, created_at FROM audit_logs WHERE action LIKE 'event.%' OR action LIKE 'report.%' ORDER BY created_at DESC LIMIT 10;"
```
