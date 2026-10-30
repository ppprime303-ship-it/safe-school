# Beta PILOT 2 — Phase 2 설계: 교직원 앱 내 알림 · 소재 보고 · 관리자 집계

작성 2026-10-30 · 상태: **확정 정책 반영, 구현 중** · 기준 커밋 `d9dd851`

## 확정·변경 사항(2026-10-30, 사용자 결정) — 아래 본문보다 우선
1. **소재는 실제 재난(`mode=real`)에서만 수집.** 모의훈련(`drill`)은 "재난 모의훈련이 시작되었습니다" 안내 알림과 확인 기록만 — 소재 UI 없음, 소재 API는 403 `presence_not_collected_for_drill`, 요약·상세도 403, **DB 트리거가 훈련 사건의 소재 행 생성을 거부**. 훈련 알림 확인은 안전·위치 확인이 아님.
2. 상세 열람 `presence.detail` = 학교 관리자 + 교장 + 교감 + 안전업무 담당(**등록된 직책(member_duties) 기준**, 가입 때 적은 직위 텍스트는 무관). 플랫폼 운영자 우회 없음.
3. 교내 위치 = **장소 분류 선택(교실·교무실·보건실·급식실·체육관·운동장·복도·계단·특별실·기타) + 상세 입력(선택, 40자)**. 저장은 `place_category`(enum) + `place_detail`, 표시는 '분류 / 상세'(50자 이내). '기타'는 상세 필수, 교외는 둘 다 저장 금지(CHECK). 기존 학교 시설 데이터는 교육청 자료 링크용 정적 목록뿐이라 재사용하지 않음.
4. 종료 후: 신규·수정 금지(409), 알림·응답·이력 보존, 권한별 조회 유지. 종료와 보고 경합은 사건 행 잠금(보고 FOR SHARE, 종료 FOR UPDATE 후 종료 시각 결정)으로 순서 보장 + 트리거가 종료 사건 저장 거부.
5. Phase 4 보고서: 익명 집계(`summarizePresence` 형식)만 — 이름·이메일·상세 위치·개인 이력·미응답자 명단 금지.
6. 모드 우회 없음: 발령 수정 API는 장소·대피 장소·안내만 받음(`mode` 무시), 소재 요청은 `strict` 스키마(모르는 필드 400).

## 0. 범위
- 포함: 재난·훈련 발령 시 승인 교직원별 **앱 내 알림**(읽음 관리), 교직원 **본인 소재 보고**(교내/교외·교내 위치·대피 지원 가능 여부, 수정 이력), **집계**(권한별 응답 분리).
- 제외: SMS·카카오·외부 SNS·브라우저 백그라운드 푸시, 다른 사람 소재 대리 보고, GPS 위치.
- 원칙: 알림 '생성'을 '전달'로 표시하지 않음 / 미응답을 교외·안전으로 추정하지 않음 / 화면이 아니라 서버 응답에서 권한 분리.

## 1. 기존 코드 감사
| 항목 | 현재 | Phase 2 영향 |
| --- | --- | --- |
| 알림 | 공식 경보 읽음 표시(`alert_reads`)만. 재난 발령 알림 없음. 설계 문서 `docs/step7/notifications-design.md`는 경보 대상(A·B·C 단계) | 새 모델 필요(경보 읽음과 대상·의미가 다름) |
| 비상 배너 | `AppShell`의 `EmergencyBanner`는 상황판·보고 화면이 넘겨줄 때만 표시. 다른 화면에서는 발령을 알 수 없음 | 모든 화면 공통 조회(폴링) 필요 |
| 실시간 방식 | 상황판 5초·경보함 30초 폴링. SSE·웹소켓·푸시 없음 | 폴링 유지(Caddy 구성 그대로) |
| 발령 | `issueEvent` 단일 트랜잭션, 학교당 진행 중 1건(부분 UNIQUE). 유형 추가(`addEventType`)는 같은 사건 | 알림을 발령 트랜잭션 안에서 생성, 사건·교직원 UNIQUE로 중복 방지 |
| 권한 | capability 합산(`shared/permissions.ts`), 상황판 `board.view`/`board.detail` 분리(Phase 1) | 소재 상세용 권한을 별도로 둠(교장·교감 자동 부여 안 함) |
| 이력·감사 | 보고 수정 이력 테이블 + 감사 기록(추가 전용 트리거) | 같은 방식, 단 **감사 기록에 위치 내용은 넣지 않음**(삭제 정책 대비) |

## 2. DB 모델(추가 전용 마이그레이션 1개, 기존 테이블 변경 없음)
```prisma
enum PresenceLocation { on_campus off_campus }
enum PresenceAvailability { available unavailable unsure }   // unsure = 본인이 '확인 필요'로 응답(미응답과 다름)

/// 사건별·교직원별 앱 내 알림 1건. 생성(created_at) ≠ 전달. read_at = 본인이 앱에서 확인한 시각
model StaffAlert {
  id           String    @id @default(dbgenerated("gen_random_uuid()")) @db.Uuid
  schoolId     String    @map("school_id") @db.Uuid
  eventId      String    @map("event_id") @db.Uuid
  membershipId String    @map("membership_id") @db.Uuid
  createdAt    DateTime  @default(now()) @map("created_at") @db.Timestamptz(6)
  readAt       DateTime? @map("read_at") @db.Timestamptz(6)
  @@unique([eventId, membershipId])              // 중복 생성 방지
  @@index([membershipId, readAt])
  @@map("staff_alerts")
}

/// 사건별·교직원별 현재 소재(본인만 작성). 재난 사건마다 독립
model StaffPresence {
  id           String               @id @default(dbgenerated("gen_random_uuid()")) @db.Uuid
  schoolId     String               @map("school_id") @db.Uuid
  eventId      String               @map("event_id") @db.Uuid
  membershipId String               @map("membership_id") @db.Uuid
  location     PresenceLocation
  place        String?              // 교내일 때만(필수), 교외면 NULL — 교외 상세 위치는 받지 않음
  availability PresenceAvailability
  version      Int                  @default(1)
  firstRespondedAt DateTime         @default(now()) @map("first_responded_at") @db.Timestamptz(6)
  respondedAt  DateTime             @default(now()) @map("responded_at") @db.Timestamptz(6)   // 최신 응답
  @@unique([eventId, membershipId])
  @@index([schoolId, eventId])
  @@map("staff_presences")
}

/// 응답 수정 이력(판마다 1행, 본인 변경만)
model StaffPresenceHistory {
  id             String               @id @default(dbgenerated("gen_random_uuid()")) @db.Uuid
  presenceId     String               @map("presence_id") @db.Uuid
  version        Int
  location       PresenceLocation
  place          String?
  availability   PresenceAvailability
  idempotencyKey String               @unique @map("idempotency_key")
  changedAt      DateTime             @default(now()) @map("changed_at") @db.Timestamptz(6)
  @@unique([presenceId, version])
  @@map("staff_presence_history")
}
```
- 외래키: 학교·사건·소속 `ON DELETE RESTRICT`, 이력→소재 `RESTRICT`.
- SQL CHECK: `(location='on_campus' AND place IS NOT NULL AND char_length(place) BETWEEN 1 AND 50) OR (location='off_campus' AND place IS NULL)`, `version >= 1`.
- 이력 트리거: **UPDATE 금지**(변조 방지). **DELETE는 트리거로 막지 않음** — 보관 기간이 확정되면 승인된 절차로 사건 단위 삭제가 가능하도록(감사 기록 테이블과 다르게 설계).
- 소재 보고는 사건이 `active`일 때만 생성·수정(종료 후 409, 조회만).

## 3. 대상·알림 규칙
- **보고 대상** = 그 학교의 승인(`approved`)·활성 계정 교직원 전원(역할·직책 무관, 관리자 포함 — 관리자도 본인 소재 보고).
- 발령 트랜잭션 안에서 대상 전원 알림 `createMany(skipDuplicates)` → 발령 실패 시 알림도 없음, 같은 사건 재요청에도 1건.
- 사건 진행 중 새로 승인된 교직원: 본인이 알림을 조회할 때 진행 중 사건 알림을 보충 생성(UNIQUE로 1건).
- 사건 중 회수된 교직원: 알림·응답 행은 보존, **집계 대상에서 제외**(현재 승인 상태 기준).
- 유형 추가(복합 재난)는 새 알림을 만들지 않음(같은 사건 알림의 표시만 갱신).
- 앱 화면: 모든 화면 공통으로 현재 학교의 '미확인 알림'을 30초마다 조회 → 상단 배너 "[훈련] 화재 발령 — 본인 소재를 보고하세요" + 알림 목록. 확인(읽음)은 사용자가 배너·목록을 눌렀을 때만.
- 표시 문구: 관리자 화면에는 '알림 생성 N명 · 앱에서 확인 M명 · 소재 응답 K명'. **'전송 완료'·'수신' 표현 금지**, "앱을 열지 않은 교직원은 알림을 보지 못합니다 — 기존 비상연락망 병행" 고정 안내.

## 4. API(모두 `/api/schools/:schoolId/...`, 서버에서 학교 소속·권한 검사, 다른 학교 404)
| 메서드·경로 | 권한 | 내용 |
| --- | --- | --- |
| `GET /staff-alerts?unread=1` | 승인 교직원 | **내** 알림 목록(사건 유형·훈련/실제·발령 시각·종료 여부), 미확인 수. 진행 중 사건 알림 보충 생성 |
| `POST /staff-alerts/:alertId/read` | 본인 알림만 | 확인 시각 기록(여러 번 눌러도 처음 시각 유지) |
| `GET /events/:eventId/presence/me` | 승인 교직원 | 내 현재 응답·판 |
| `PUT /events/:eventId/presence/me` + `Idempotency-Key` | 승인 교직원(본인만) | `{ location, place?, availability, expectedVersion }`. 대상자는 세션의 소속으로만 결정 — 요청에 다른 사람 id를 받지 않음 |
| `GET /events/:eventId/presence/summary` | `board.view`(승인 교직원 누구나) | 대상 수, 응답·미응답 수, 교내·교외 수, 지원 가능·불가·확인 필요 수, 최신 응답 시각. **위치별·개인별 없음** |
| `GET /events/:eventId/presence` | 신규 `presence.detail` | 위 요약 + 위치별 현황 + 개인별(이름·소재·위치·가능 여부·응답 시각) + **미응답자 명단** + 알림 확인 여부 |

- 집계 정의: `미응답 = 대상 - 응답`(추정 없음). '확인 필요'는 응답으로 세되 따로 표시. 교내·교외 합 = 응답 수.
- 수정: 판 번호 확인(동시 수정 409), 같은 요청 번호 재전송은 처음 보낸 본인에게만 같은 결과(Phase 1-3 규칙과 동일).

## 5. 권한 정책 변화(`shared/permissions.ts`)
| capability | 부여 | 비고 |
| --- | --- | --- |
| `presence.report`(새로 두지 않음) | — | 본인 보고는 승인 소속이면 누구나(권한표 대신 '본인만' 서버 규칙) |
| `presence.detail`(신규) | 학교 관리자(role) + **안전업무 담당**(duty) | **교장·교감 자동 부여 안 함**(운영 정책 확정 전). 앱 운영담당도 없음 |
| `board.view` | 기존대로 전원 | 소재 '요약'만 추가 노출 |

## 6. 보안·개인정보 위험과 대응
| 위험 | 대응(설계) |
| --- | --- |
| 다른 사람 소재 대신 보고·조작 | 경로에 '나(me)'만, 대상은 세션 소속으로 결정. 관리자도 남의 소재 수정 불가 |
| 개인별 소재 과다 노출 | 개인별·미응답자·위치별은 `presence.detail` 응답에만. 일반 교직원 요약은 전체 숫자만(소수 인원 위치 노출 방지) |
| 다른 학교·다른 사건 | 사건은 학교로, 알림은 소속으로 묶어 조회. IDOR 격리 행렬에 새 경로 추가 |
| 과다 수집 | GPS 없음, 교외 상세 위치 받지 않음, 교내 위치 50자, 자유 메모 없음(대신 선택형 위치 예시 제공) |
| 삭제 정책과 충돌 | 감사 기록에 위치 문자열을 넣지 않음(행동·판 번호만). 소재 이력은 DELETE 가능 구조 → 확정된 보관 기간으로 사건 단위 정리 가능 |
| 알림 오인(전달 보장 착각) | '생성·앱에서 확인·응답'을 구분 표시, 비상연락망 병행 안내 고정 |
| 미응답 추정 | 미응답은 항상 별도 숫자·명단(교외·안전으로 합치지 않음) |
| 훈련/실제 혼동 | 알림·배너·집계에 사건의 훈련/실제 표시, 데이터는 사건 `mode`로 구분(보관 정책 분리 가능) |
| 폴링 부하 | 30초 간격, 요약 쿼리는 사건·학교 인덱스. 교직원 수십 명 규모 전제(대규모는 후속 검토) |

## 7. 개인정보 보관 정책 미확정이 주는 제약
| 구분 | 영향 |
| --- | --- |
| **구현·테스트** | 제약 없음 — 테스트 DB(CI PostgreSQL)에서 전체 구현·검증 가능. 가상 계정·가상 위치만 사용 |
| **운영 DB 마이그레이션** | 별도 승인 대상(새 테이블 3개·enum 2개). 정책 확정 전에는 적용하지 않음 |
| **운영 배포** | **불가** — 교직원 개인별 소재(위치)는 Phase 1 실명보다 민감. 수집 목적·보관 기간·열람 범위 확정과 학교 고지 전 운영 수집 금지 |
| **설계로 미리 대비한 것** | 최소 수집, 감사 기록에 위치 미기록, 사건 단위 삭제 가능 구조, 훈련/실제 구분 |
| **확정 필요 결정** | ① 소재 데이터 보관 기간(실제 상황·훈련 각각) ② 상세 열람에 교장·교감 포함 여부 ③ 교내 위치를 자유 입력으로 둘지, 학교별 선택 목록으로 할지 ④ 소재 데이터를 훈련일지·결과 보고서(Phase 4)에 넣을지(넣으면 보관 기간이 보고서 기준을 따름) ⑤ 사건 종료 후 일반 교직원 요약 공개 유지 여부 |

## 8. 구현 순서(승인 후)
1. 마이그레이션 SQL 작성(추가 전용, CHECK·트리거·인덱스) → CI 테스트 DB 적용 검증
2. 발령 시 알림 생성 + 알림 조회·확인 API
3. 본인 소재 보고(생성·수정·이력·판 확인·재전송)
4. 요약·상세 집계 API와 `presence.detail`
5. 화면: 공통 배너·알림 목록, 소재 보고 화면, 관리자 집계(상황판 하위)
6. 테스트·Git Push·CI

## 9. 테스트 계획(요지)
- 발령 1회 → 승인 교직원 수만큼 알림, 대기·회수·다른 학교 제외, 재요청·동시 요청 중복 없음, 발령 실패 시 알림 없음
- 읽음: 본인만, 처음 시각 유지, 재접속 후 미확인 유지
- 소재: 본인만(남의 소속 id 불가), 교내 위치 필수·교외 위치 금지(CHECK), 수정 이력·판 충돌, 종료 후 409, 사건 간 독립
- 집계: 미응답 = 대상 − 응답, 회수자 제외, 요약에 개인·위치별 없음, 상세는 관리자·안전업무 담당만(교장·교감 403)
- 격리 행렬·기존 회귀 전체
