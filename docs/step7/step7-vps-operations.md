# 국내 VPS 시범운영 — 코드 배포·백업·롤백 절차

작성 2026-10-26 · 앱 1개(`safe-school`, 스키마 `safeschool_prod_pilot`). **아직 실행하지 않았습니다.**
원칙: 자동 배포 없음, 재시작으로 DB 구조가 바뀌지 않음(마이그레이션은 백업 후 운영자가 따로), 스키마 DROP·`migrate reset` 금지, 강제 push 금지.

## 0. 릴리스 커밋 정하기(GitHub ↔ Replit)
GitHub 개발 커밋과 Replit 검증 커밋은 해시가 다릅니다(Replit에서 cherry-pick). **해시가 아니라 내용**을 비교합니다.
1. Replit Shell: `git fetch origin` → `bash scripts/release-compare.sh <GitHub 커밋> <Replit 커밋>`
   - 스크립트가 아직 Replit에 없으면: `git diff --name-status <GitHub 커밋> <Replit 커밋> -- server client shared scripts prisma tests deploy package.json`
   - 결과 `[같음]`이어야 합니다. 다르면 다른 파일을 확인해 어느 쪽이 맞는지 정한 뒤 진행합니다.
2. Replit에서 `npm run typecheck`·`npm test` 전체 통과를 확인한 커밋을 릴리스로 정합니다.
3. 그 커밋을 GitHub에 **새 이름의 브랜치**로 올리고 태그를 답니다(기존 브랜치 덮어쓰기·강제 push 금지).
   `git push origin HEAD:release/pilot-v1` → `git tag -a pilot-v1 -m "시범운영 1차" && git push origin pilot-v1`
4. **설치 버전 고정(결정 필요)**: 저장소에 `package-lock.json`이 없습니다. 이대로면 VPS의 `npm install`이 Replit과 다른 하위 버전을 받을 수 있습니다. Replit에서 테스트를 통과한 `package-lock.json`을 커밋하도록 승인해 주시면 VPS에서는 `npm ci`로 같은 버전을 설치합니다(권장).

## 1. 배포(매번)
| 순서 | 할 일(관리자 계정) | 확인 |
| --- | --- | --- |
| 1 | `cd /srv/safe-school/releases && git clone --branch pilot-v1 --depth 1 https://github.com/ppprime303-ship-it/safe-school.git <커밋>` | `git -C <커밋> rev-parse HEAD`가 승인한 해시 |
| 2 | 설치·빌드(2GB 서버 방식 — 아래 1-1) | 오류 없음, `dist/server/index.js`·`dist/client/index.html` 존재 |
| 3 | DB 점검(읽기 전용): `sudo -u ss-pilot bash -c 'cd <릴리스>; set -a; . /etc/safe-school/pilot.env; set +a; npm run deploy:check'` | 대상 스키마·학교·사용자 수가 예상과 같음 |
| 4 | **새 마이그레이션이 있으면**: ① 백업 `sudo -u ss-pilot /srv/safe-school/current/deploy/scripts/pg-backup.sh` ② (승인 후) `npm run deploy:migrate`(3번과 같은 방식) | 백업 완료 줄, 마이그레이션 결과 |
| 5 | 전환: `ln -sfn /srv/safe-school/releases/<커밋> /srv/safe-school/current && sudo systemctl restart safe-school` | `systemctl is-active safe-school`, `journalctl -u safe-school -n 30` |
| 6 | 확인: `curl -sS https://<호스트>/api/health`, 로그인, 학교 화면, 경보함 | 이상 없음 |
| 7 | 기록: 시각·커밋·결과를 `docs/devlog`에 | — |
- 새 마이그레이션 여부: `git diff --name-only <이전 커밋> <새 커밋> -- prisma/migrations`
- 테스트는 VPS에서 돌리지 않습니다(테스트가 DB를 지우고 다시 만들기 때문 — 운영 DB 보호).

### 1-1. 2GB 서버 빌드 방식(`step7-2gb-memory.md`)
```bash
cd /srv/safe-school/releases/<커밋>
# 앱(서비스)은 계속 실행 중. 빌드는 메모리 상한을 둔 별도 범위에서 실행해, 넘치면 빌드만 실패하고 DB·앱은 지킴
sudo systemd-run --scope --uid=ops -p MemoryMax=1200M -p MemorySwapMax=1G nice -n 10 \
  bash -c 'npm ci && NODE_OPTIONS=--max-old-space-size=900 npm run build'   # lock 파일이 없으면 npm ci 대신 npm install
free -m    # 빌드 후 스왑 사용량 확인
```
- 빌드가 메모리 부족으로 실패하면: 야간에 다시 시도 → 그래도 실패하면 대안 B(Replit에서 만든 빌드 결과 전송) 또는 4GB로 변경(`step7-2gb-memory.md` 3절).

## 2. 백업
- 매일 03:40 `ss-pilot` cron(`deploy/scripts/pg-backup.sh`): 시범운영 스키마만 덤프, 600 권한, 14일 보관, 덤프 읽기 확인.
  `sudo -u ss-pilot crontab -e` → `40 3 * * * /srv/safe-school/current/deploy/scripts/pg-backup.sh >> /srv/safe-school/backups/backup.log 2>&1`
- 서버 밖 사본(주 1회): 백업에는 실제 교직원 이메일이 들어 있으므로 **암호화한 뒤** 옮깁니다.
  `gpg --symmetric --cipher-algo AES256 <덤프>` → `scp`로 운영자 PC(학교 보안 정책에 맞는 저장 위치)로. 비밀번호는 덤프와 따로 보관.
- 시범운영 종료 후 보관 기간이 지나면 서버·서버 밖 사본을 모두 삭제하고 기록합니다(`step7-privacy-approval-checklist.md`).

## 3. 복원(시험·실제 공통)
**기존 스키마를 덮어쓰거나 DROP하지 않습니다.** 새 DB에 복원해 비교한 뒤 전환 여부를 사용자가 정합니다.
```bash
sudo -u postgres createdb safeschool_restore_<날짜>
sudo -u postgres pg_restore --no-owner -d safeschool_restore_<날짜> <덤프>
sudo -u postgres psql -d safeschool_restore_<날짜> -XAtc "select count(*) from safeschool_prod_pilot.schools"
```
- 전환이 필요하면: 서비스 중지 → 복원 DB의 소유권을 `ss_pilot`으로 정리 → `DATABASE_URL`의 DB 이름 변경 → `deploy:check` → 시작. 원래 DB는 비교가 끝날 때까지 남겨 둡니다.
- 복원 시험은 시범운영 시작 전 1회, 이후 월 1회(빈 시험 DB로) 합니다. 로컬 PostgreSQL 16에서 같은 절차로 확인함(2026-10-26, `step7-test-results.md`).

## 4. 롤백
| 상황 | 방법 |
| --- | --- |
| 새 릴리스에 DB 변경 없음 | `ln -sfn /srv/safe-school/releases/<이전 커밋> /srv/safe-school/current && sudo systemctl restart safe-school` |
| DB 변경(마이그레이션)이 있었음 | 마이그레이션은 되돌리지 않습니다(앞으로만). 이전 코드가 새 구조에서 동작하는지 릴리스마다 확인해 기록. 안 되면 4절 위 → 3절 복원 비교 후 사용자 결정 |
| 마이그레이션 실패 | 서버는 이전 코드로 계속 실행 중(전환 전이므로). Prisma 출력의 실패 마이그레이션 확인 → 원인 수정 → 필요하면 `npx prisma migrate resolve --rolled-back <이름>`(아무것도 적용되지 않은 경우만, 운영자 판단) |
- 이전 릴리스 폴더는 최소 2개 보관합니다(디스크 50GB 중 릴리스 1개 약 0.5GB 예상 — 실측 필요).

## 5. 하지 않는 것
자동 배포, VPS에서 테스트 실행, `prisma migrate reset`·`db push --force-reset`, 스키마 DROP, 강제 push, 승인 없는 마이그레이션, 이 서버에서 `db:seed`·`judge:setup`, 환경변수 파일을 Git·채팅에 올리기
