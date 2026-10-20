# STEP 3-B 공식 경보 수집·학교 알림 (브랜치 `step-3b-alerts`)

표기: **[구현]** 코드 있음 · **[검증]** 실제 실행 출력으로 확인 · **[확인 필요]** 외부 확인 전 사용 금지

## 범위와 순서
1. 공식 경보 수집 — 공급자 인터페이스, 모의 공급자, 원문 불변 저장, 수집 실행 기록, 실패 재시도·인증키 가림, 최소 간격(과다 호출 방지)
2. 학교 지역 매칭 — 학교 주소 → 시도·시군구 자동 추출(확인 전 표시), 관리자 확인·수정, 대상/비대상/미판정
3. 중복 방지 — 같은 경보 ID 재수신 무시, 같은 내용 6시간 내 재송출은 한 건으로 묶음, 해제·정정 표시
4. 교직원 경보함 — 대상 경보만(관리자는 미판정도), 출처·발령 시각·중요도 글자 라벨·모의 표시, 사용자별 읽음
5. (다음) 학교 추가 안내 작성 → 관리자 승인 → **모의 발송** — 학부모 외부 발송은 비활성

## 실제 공식 API 상태 — **[확인 필요]**
- 행정안전부 긴급재난문자(재난안전데이터 공유플랫폼 dataSn=228, 공공데이터포털 15134001)는 활용 신청 후 이용가이드로 요청 주소·응답 필드·호출 제한·지역 표기·정정/해제 표현을 확인해야 합니다.
- 이 저장소에는 **실제 공급자 어댑터가 없습니다.** DB 열거형에 `mois_cbs` 자리만 있습니다. 화면·문서에서 '실제 연동 완료'로 표시하지 않습니다.
- 이용허락(공공누리 제4유형: 출처표시·상업적 이용금지·변경금지)에 맞게 원문은 수정하지 않고, 출처를 표시하며, 학교 안내는 별도로 붙입니다.

## 데이터(마이그레이션 `20261021000000_official_alerts`, 새 테이블만 추가)
| 테이블 | 내용 |
| --- | --- |
| `official_alerts` | 원문·발령기관·발령/수신 시각·지역 원문과 정규화 값·내용 해시. 수정·삭제 트리거로 거부. 모의 경보는 `is_mock = true`(공급자 `mock`과 일치 강제) |
| `alert_collection_runs` | 수집 실행 기록(성공·실패·건너뜀, 건수, 실패 사유는 인증키를 가린 값) |
| `school_regions` | 학교 소재지(주소 자동 추출 또는 관리자 확인) |
| `school_alert_matches` | 학교별 판정(대상/비대상/미판정·사유·재송출 묶음) |
| `alert_reads` | 교직원별 읽음 |

## 안전 원칙
- 경보 수집은 학교 재난 발령을 **자동으로 만들지 않습니다**(관리자 판단, 경보 상세에서 상황판으로 이동만 안내).
- 학교 지역이 불명확하면 '미판정'으로 두고 관리자에게만 보입니다.
- 모의 공급자는 운영 환경(`NODE_ENV=production`)에서 거부합니다.
- 학부모 대상 외부 발송 기능은 없습니다(⑤에서도 모의 발송까지만).

## 시연 방법(`safeschool_browser_demo`)
새 마이그레이션이 있으므로 **테스트 스키마에서 먼저 검증(`npm test`)한 뒤** 시연 스키마에 적용합니다(새 테이블만 추가, 기존 데이터 변경 없음).

```bash
DEMO_URL="$(node -e 'const u=new URL(process.env.DATABASE_URL);u.searchParams.set("schema","safeschool_browser_demo");process.stdout.write(u.toString())')"
DATABASE_URL="$DEMO_URL" npx prisma migrate status    # 적용 전 상태 확인
DATABASE_URL="$DEMO_URL" npx prisma migrate deploy    # 20261021000000_official_alerts 1건 적용
DATABASE_URL="$DEMO_URL" npm run alerts -- collect incheon-heatwave
DATABASE_URL="$DEMO_URL" MAIL_PROVIDER=console NODE_ENV=development npm run dev
```
시연 학교 주소가 인천이 아니면 관리자 경보함의 '경보 수신 지역'에서 소재지를 '인천광역시'로 확인 저장하면 미판정 경보가 다시 판정됩니다.
해제 시연: `DATABASE_URL="$DEMO_URL" npm run alerts -- collect incheon-heatwave-cancel`
