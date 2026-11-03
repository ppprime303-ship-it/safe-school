# 긴급재난문자(행정안전부) API 계약 확인 기록(2026-11-03)

호출 위치: Beta VPS(공유플랫폼에 등록된 공인 IP). 도구 `deploy/scripts/mois-verify-once.mjs`(운영 도구 ApiCheck로 실행), 정확히 1회, 재시도 없음.
서비스키는 터미널 숨김 입력으로만 받았고 저장·출력하지 않았습니다. 문자 본문은 출력하지 않았습니다(길이만).

## 실측 결과(15:29 KST 무렵)
| 항목 | 결과 |
|---|---|
| 서버 공인 IP | 등록 IP와 일치(코드 32 없음) |
| HTTP | 200 |
| 결과 코드 | 00 NORMAL SERVICE |
| 최상위 필드 | header, numOfRows, pageNo, totalCount, body |
| 건수 | 전체 24, 받은 24 |
| 항목 필드(11) | MSG_CN, RCPTN_RGN_NM, CRT_DT, EMRG_STEP_ID, REG_YMD, DST_SE_ID, RCPTN_RGN_ID, EMRG_STEP_NM, SN, DST_SE_NM, MDFCN_YMD |
| 필수 필드 누락 | 없음 |
| SN 고유 | 24/24 |
| 정렬 | 일정하지 않음 |
| CRT_DT 형식 | `YYYY/MM/DD HH:mm:ss` (예 2026/11/02 07:01:49) |
| 긴급단계 | 안전안내 24 |
| 인천 관련 지역 표기 | 0종 |
| 전국 표기 | 0건 |
| 판정 | 정상 응답 |

## 코드와의 대조
- 응답 구조: `MoisCbsSource.fetch` 가 읽는 `header.resultCode`·`body` 배열·`totalCount` 와 일치.
- 날짜: `parseKstDateTime` 이 `YYYY/MM/DD HH:mm:ss` 를 한국 시각으로 해석해 UTC 저장(테스트 `beta2-mois-verified.test.ts`).
- 순서: 응답 순서에 의존하지 않음. 수집기가 발송 시각 순으로 정렬해 저장하고(`collector.ts`), 중복은 (공급자, SN) 고유 제약으로 거름.
- 인천 0건: 지역 필터 결과 0건은 정상 빈 결과(오류 아님). 지역은 시도·시군구 단위로 비교하고, 불확실하면 '미판정'으로 남김(`region.ts`).

## 판정
- 요청·인증·응답 계약: **실제 응답과 일치** → `MOIS_CBS_CONTRACT.verified = true`
- **미확인(계속 확인 필요):** 인천(영종구 등) 지역 표기의 실제 매칭, 전국 문자 표기, 정정·취소 표기, 발송~수집~화면 표시 지연. 실제 인천 대상 문자가 수집되면 화면과 원문을 대조합니다.
- 운영 수집 활성화는 별도 단계(서버 설정 `ALERT_PROVIDERS`·서비스키·`MOIS_CBS_DAILY_LIMIT`)이며, 이 기록은 활성화 성공을 뜻하지 않습니다.
