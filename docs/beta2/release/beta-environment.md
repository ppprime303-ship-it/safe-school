# Beta PILOT 2 — 환경 분리 설계

작성 2026-11-02 · 상태: **설계·설정 초안. VPS에 적용하지 않았고, VPS에서 동작을 확인하지 않았습니다.**

## 1. 분리 항목

| 항목 | 기존 Prototype | Beta PILOT 2 | 강제 방식 |
|---|---|---|---|
| 서비스 | `safe-school` | `safe-school-beta` | systemd 파일 분리 |
| 리눅스 계정 | `ss-pilot` | `ss-beta` | systemd |
| 코드 경로 | `/srv/safe-school` | `/srv/safe-school-beta` | systemd, Prototype 경로 접근 차단 |
| 설정 파일 | `/etc/safe-school/pilot.env` | `/etc/safe-school-beta/beta.env` | systemd, Prototype 경로 접근 차단 |
| 포트 | 5000 | 5100 | 앱 시작 거부 |
| DB | `safeschool` | `safeschool_beta` | 앱 시작 거부, 연결 후 재확인 |
| DB 계정 | `ss_pilot` | `ss_beta` | 앱 시작 거부, 연결 후 재확인 |
| 스키마 | `safeschool_prod_pilot` | `safeschool_beta` | 앱 시작 거부 |
| 사진 경로 | 없음 | `/var/lib/safe-school-beta/uploads` | 앱 시작 거부, 쓰기 확인 |
| 호스트명 | 기존 호스트 | 별도 호스트(미정) | 운영자 설정 |
| 백업 | `pg-backup.sh`, `/srv/safe-school/backups` | `beta-backup.sh`, `/var/backups/safe-school-beta` | 스크립트 대상 고정 |

같은 VPS에 올리면 PostgreSQL 서버와 Caddy는 공유합니다. 완전한 장애 격리가 필요하면 4절의 별도 VPS 안을 선택해야 합니다.

## 2. 운영 DB 오접속 방지

| 단계 | 검사 | 위치 |
|---|---|---|
| 서버 시작 | 프로필·스키마 허용 목록 | `server/src/deploy/dbTarget.ts` |
| 서버 시작 | DB 이름, 계정, 호스트, 포트, 사진 경로, 데이터 구분 | `betaEnvironmentErrors` |
| 서버 시작 | 사진 폴더 쓰기 가능 여부 | `server/src/env.ts` |
| 시작 전 점검·마이그레이션 | 위 검사 + 실제 연결 DB·계정·운영 스키마 존재 여부 | `scripts/deploy-start.ts`, `betaPreflightErrors` |
| DB 권한 | `ss_beta`는 Beta DB에만 CONNECT 권한 | `deploy/sql/beta-roles.sql`, `pg_hba.beta.example` |

반대 방향도 막습니다. `DEPLOY_PROFILE=production`은 `safeschool_beta` 스키마를 받지 않습니다.

### 자동 테스트로 확인한 내용
`tests/beta2-environment-separation.test.ts`
- Prototype 스키마·DB·계정, 운영 프로필, 포트 5000, 잘못된 사진 경로를 지정하면 거부합니다.
- 실제 시작 코드(`server/src/env.ts`)를 별도 프로세스로 실행해 종료 코드 1과 비밀번호 미출력을 확인합니다.

### 실제 환경에서 확인할 내용(승인 후)
1. `beta.env`에 Prototype DB 주소를 넣어 `deploy:check`가 거부하는지 확인합니다. 테스트용 임시 설정으로 하고, DB에 연결되기 전 단계에서 멈추는지 봅니다.
2. `ss_beta`로 `safeschool` DB 접속이 거부되는지 확인합니다.
3. `ss_pilot`으로 `safeschool_beta` DB 접속이 거부되는지 확인합니다.
4. `systemd-analyze security safe-school-beta`와 사진 폴더 쓰기를 확인합니다.
5. `caddy validate`로 `beta.caddy.example` 적용본을 검증합니다. 이 PC에 Caddy가 없어 문법을 실행으로 확인하지 못했습니다.

## 3. 사진 저장

- 코드 폴더는 읽기 전용이고 사진 폴더만 쓸 수 있습니다. 릴리스를 전환해도 사진은 유지됩니다.
- Caddy는 사진 POST 경로만 7MiB, 그 밖의 모든 요청은 1MB입니다. 앱은 사진 경로 7MiB, 그 밖 100KB입니다.
- 앱은 세션, 요청 제한, 동시 처리 수, 학교 소속을 확인한 뒤에 본문을 읽습니다. 동시 처리는 8건으로 제한합니다.

### 미해결 위험
| 위험 | 현재 상태 |
|---|---|
| 바이러스 검사 | 없음. 형식 판별과 구조 검사, nosniff, 샌드박스 CSP로만 제한합니다 |
| 사진 속 민감정보 | 얼굴·이름표를 자동으로 가리지 않습니다. 안내로만 억제합니다 |
| 저장 암호화 | 폴더·백업 모두 암호화되어 있지 않습니다 |
| 서버 측 재인코딩 | 없음. 메타데이터 제거는 구조 정리 방식입니다 |
| 디스크 사용량 | 전체 저장 용량 상한이 없습니다. 제보당 3장, 계정별 분당 20회만 제한합니다 |
| 메모리 | 사진 8건 동시 처리 시 약 160MB로 추정하며 실측하지 않았습니다 |

## 4. 2GB 서버 동시 실행 위험

**아래 수치는 `docs/step7/step7-2gb-memory.md`의 예상치에 근거한 추정이며 실측값이 아닙니다.**

| 구성 | 평상시 추정 |
|---|---|
| OS, Caddy | 280~410MB |
| PostgreSQL | 350~500MB |
| Prototype 앱 | 150~300MB (상한 600MB) |
| Beta 앱 | 150~250MB (상한 400MB) |
| 합계 | 약 0.9~1.5GB |

위험
- 두 앱이 상한까지 쓰면 1GB이고, PostgreSQL과 OS를 합치면 2GB에 근접합니다. 실제 재난 시나리오에서 동시 사진 업로드가 겹치면 스왑을 쓸 수 있습니다.
- 서버 빌드는 순간 0.7~1.2GB를 더 씁니다. **두 앱이 켜진 상태에서 서버 빌드를 하면 안 됩니다.**
- PostgreSQL을 공유하므로 Beta 부하나 재시작이 Prototype에 영향을 줍니다. 공유 연결 수는 `max_connections=30` 안에서 나눠 씁니다.
- 현재 VPS의 메모리·스왑·Prototype 사용량은 이번에 확인하지 않았습니다.

| 안 | 내용 | 장점 | 단점 |
|---|---|---|---|
| A. 별도 VPS | Beta 전용 서버 | Prototype 영향이 없고 격리가 가장 확실합니다 | 비용, 서버 구축 시간 |
| B. 같은 VPS + 상한 | 이 문서의 설정 | 비용 없음 | 위 위험이 남고 실측이 먼저 필요합니다 |
| C. 4GB 증설 | 같은 서버 사양 변경 | 메모리 여유 | 비용, Prototype 재시작 가능성, PostgreSQL 공유 유지 |
| D. 로컬 시연 | 11/3 시연을 학교 PC에서 진행 | VPS를 건드리지 않습니다 | 외부 기기 접속 불가, 미리보기 DB 마이그레이션 승인 필요 |

권장: 11/3은 **D**, 실제 학교 시범운영은 **A**. B를 택한다면 실측 후 스왑 사용이 평상시 200MB를 넘지 않는 것을 조건으로 합니다.

## 5. 기존 Prototype 보존과 롤백

**원칙:** Beta 배포 절차에는 Prototype의 서비스, 설정 파일, DB, Caddy 블록을 수정하는 단계가 없어야 합니다.

| 상황 | 절차 |
|---|---|
| Beta 설치 전 | Prototype 커밋, 서비스 상태, 스키마 건수, Caddyfile 사본을 기록합니다(비밀값 제외). 기존 백업이 읽히는지 확인합니다 |
| Caddy에 Beta 추가 | 메인 Caddyfile 사본을 남기고 `caddy validate` 후 reload합니다. 문제가 생기면 사본으로 복구합니다 |
| Beta 앱 문제 | `systemctl stop safe-school-beta`. Prototype 절차는 없습니다 |
| Beta를 이전 코드로 | 심볼릭 링크를 이전 릴리스로 돌리고 Beta 서비스만 재시작합니다. 새 마이그레이션이 있었다면 호환성을 먼저 확인합니다 |
| Beta 마이그레이션 실패 | 멈춘 뒤 보고합니다. `migrate reset`, 스키마 DROP은 금지입니다. 복구는 `backup-restore.md`를 따릅니다 |
| Beta 폐기 | 서비스 중지·해제 후 Caddy 블록을 제거합니다. DB·사진 삭제는 `privacy-open-items.md`의 삭제 승인을 별도로 받습니다 |

**미검증:** 이전 코드가 Phase 4 구조에서 동작하는지 시험하지 않았습니다. 시험 전까지 Beta 마이그레이션 후의 코드 롤백을 안전하다고 보면 안 됩니다. Prototype은 별도 DB를 쓰므로 Beta 마이그레이션의 영향을 받지 않는 구조이지만, 실제 환경에서 확인한 것은 아닙니다.
