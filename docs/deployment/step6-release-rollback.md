# STEP 6 릴리스·배포·롤백 절차

원칙: **Replit에서 검증한 실제 코드만 배포합니다.** 승인받지 않은 커밋은 자동 배포하지 않습니다. DB를 삭제·초기화하는 자동 롤백은 없습니다.

## 1. 릴리스 커밋 정하기(GitHub ↔ Replit 비교)
같은 변경이 cherry-pick 때문에 GitHub와 Replit에서 서로 다른 해시를 가집니다(예: `d728928` ↔ `5c95d43`). Replit에는 GitHub에 없는 로컬 커밋도 있습니다. 그래서 **해시가 아니라 파일 내용(트리)**으로 비교합니다.

Replit Shell에서 다음을 실행합니다(읽기만 함).
```bash
git fetch origin step-6-deployment
git status --short                          # 커밋 안 된 변경이 없어야 함
git diff --stat HEAD origin/step-6-deployment -- . ':(exclude)docs' ':(exclude).replit'
git diff --stat HEAD origin/step-6-deployment -- .replit   # .replit 은 Replit 전용이므로 차이가 있어도 됨
```
- 출력이 비어 있으면 코드가 같습니다. 문서(`docs/`)와 `.replit`만 다를 수 있습니다.
- 차이가 있으면 아래 (가)·(나) 중 하나로 맞춥니다. 강제 push·reset은 쓰지 않습니다.
  - (가) **권장**: GitHub의 STEP 6 커밋을 Replit `step-6-deployment`에 cherry-pick → Replit에서 전체 테스트 → 통과한 Replit 커밋을 **새 이름의 브랜치**로 GitHub에 push(`git push origin HEAD:release/step6-judge`). 기존 브랜치는 덮어쓰지 않습니다. 이렇게 하면 VPS는 Replit에서 검증한 바로 그 커밋을 받습니다.
  - (나) Replit 로컬 커밋을 GitHub에 올릴 수 없는 사정이 있으면 차이 목록을 기록하고, 사용자 승인을 받은 뒤 GitHub 쪽에 같은 내용을 반영합니다.
- 승인한 커밋에 태그를 답니다: `git tag -a judge-v1 <해시> -m "심사 시연 1차(564+ 통과)"` → `git push origin judge-v1`

## 2. 배포 순서(VPS, 매번)
| 순서 | 할 일 | 확인 |
| --- | --- | --- |
| 1 | 릴리스 태그와 해시 확인: `git rev-parse judge-v1^{commit}` | 승인 기록의 해시와 같음 |
| 2 | 새 릴리스 폴더에 받기: `git clone --branch judge-v1 --depth 1 … releases/<해시>` | `git status` 깨끗함 |
| 3 | `npm ci` → `npm run build` | 오류 없음. 테스트는 Replit에서 이미 통과(VPS에서는 DB 테스트를 돌리지 않음 — 운영 DB 보호) |
| 4 | DB 대상 확인: `npm run deploy:check` | 운영 스키마, 학교·사용자 수가 예상과 같음 |
| 5 | **마이그레이션이 있는 릴리스면** 변경 전 백업: `deploy/scripts/pg-backup.sh` | 덤프 읽기 확인 메시지 |
| 6 | (승인 후) 마이그레이션: `npm run deploy:migrate` | 적용 결과 확인. 실패하면 7번으로 넘어가지 않음 |
| 7 | 링크 전환 → 재시작: `ln -sfn releases/<새 해시> current && sudo systemctl restart safe-school` | `systemctl is-active` |
| 8 | 확인: HTTPS 접속, `/api/health`, 심사 계정 로그인, 상황판, 훈련일지 HWPX 내려받기, 안전교육·시설 자료 | 이상 없음 |
| 9 | 기록: 배포 시각·해시·확인 결과를 `docs/devlog`에 남김 | — |

## 3. 롤백
**애플리케이션 롤백**(DB 변경이 없는 릴리스):
```bash
ln -sfn /srv/safe-school/releases/<이전 해시> /srv/safe-school/current
sudo systemctl restart safe-school
```
- 이전 릴리스 폴더는 최소 2개 이상 보관합니다.

**DB 변경이 있었던 릴리스**:
- 마이그레이션은 앞으로만 진행합니다. 이전 코드는 새 컬럼·테이블이 있어도 대부분 동작하지만, 실제 동작 여부는 릴리스마다 확인해 기록합니다.
- **마이그레이션이 실패하면**: 서비스는 시작되지 않습니다(`deploy-start`가 중단). Prisma 출력에서 실패한 마이그레이션 이름을 확인 → 원인을 고침 → `npx prisma migrate resolve --rolled-back <이름>`(운영자 판단, 해당 마이그레이션이 아무것도 적용하지 않은 경우에만) → 다시 `deploy:migrate`. `migrate reset`·`db push --force-reset`은 쓰지 않습니다.
- **데이터 복구가 필요하면**: 백업을 **새 스키마 이름**에 복원해 비교합니다. 기존 스키마를 덮어쓰지 않습니다.
  ```bash
  # 덤프 안의 스키마 이름을 바꿔 복원하는 방법은 운영자 판단(pg_restore 목록 편집 등). 기존 스키마 DROP 금지.
  pg_restore --list <덤프> | head
  ```
  어느 쪽을 쓸지는 비교한 뒤 사용자가 결정하고, `DEPLOY_DB_SCHEMA`/`DATABASE_URL`을 바꿔 전환합니다.

## 4. 하지 않는 것
- 자동 배포(푸시하면 바로 배포), VPS에서 DB 테스트 실행, `prisma migrate reset`, 스키마 DROP, 강제 push, 승인 없는 마이그레이션
