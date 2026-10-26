# STEP 6 국내 VPS 배포 계획(공모전 심사 시연)

작성 2026-10-26 · 브랜치 `step-6-deployment`(GitHub) · **계획 문서 — 서버 구매·접속·배포는 아직 하지 않았습니다.**

> **2026-10-26 갱신 — 한 VPS에 두 환경**
> - 공모전 심사(judge)와 실제 학교 시범운영(pilot)을 같은 서버에서 **호스트명·앱 프로세스·포트·DB 스키마·DB 계정·SESSION_SECRET·로그를 나눠** 운영합니다.
> - 아래 본문의 단일 앱 예시(`safe-school.service`, 포트 5000, `safe-school.env`)는 환경별 설정으로 바뀌었습니다: `safe-school@judge`/`@pilot`, 5001/5002, `judge.env`/`pilot.env`, `deploy/sql/roles.sql`.
> - 분리 설계·자원·장애 영향·로컬 권한 검증은 **`step6-environment-isolation.md`**를 따르세요.
> - 앱이 2개이므로 **4GB를 권장**합니다.
> - 각 단계 명령은 환경별 계정(`sudo -u ss-judge` / `ss-pilot`)과 그 환경의 env 파일로 실행합니다. DB·스키마는 `roles.sql`로 미리 만들므로 ② 단계의 `DEPLOY_ALLOW_NEW_SCHEMA=true`는 '마이그레이션 기록이 없는 빈 스키마'에 첫 마이그레이션을 적용할 때만 씁니다.
서버 주소, IP, 도메인, 가격은 정해지지 않아 `<시연 도메인>`처럼 빈칸으로 둡니다.

## 0. 구성 요약
```
심사위원 브라우저 ──HTTPS(443)──▶ Caddy(또는 Nginx, 인증서 자동 갱신, 보안 헤더)
                                    │ http://127.0.0.1:5000 (외부 비공개)
                                    ▼
                         SAFE SCHOOL (systemd, Node.js 22, NODE_ENV=production)
                                    │ 127.0.0.1:5432 (외부 비공개)
                                    ▼
                    PostgreSQL 16 · DB safeschool · 스키마 safeschool_prod_judge
```
- Replit DB와 **물리적으로 분리된** 새 PostgreSQL을 씁니다. Replit의 `safeschool_browser_demo`, `safeschool_test`, `public`은 건드리지 않습니다.
- 외부에 여는 포트는 22(SSH, 키 인증만), 80, 443뿐입니다. 5000(앱)과 5432(DB)는 열지 않습니다.

## 1. 2GB RAM으로 충분한가
| 구성 요소 | 예상 메모리(일반적 범위, **실측 필요**) |
| --- | --- |
| Ubuntu 기본 + SSH + Caddy | 약 300~400MB |
| PostgreSQL 16(아래 설정) | 약 300~500MB |
| SAFE SCHOOL(Node.js 서버 1개) | 약 150~300MB |
| 합계(운영 중) | 약 0.8~1.2GB |
| **빌드할 때**(`npm ci` + `vite build` + esbuild) | 순간적으로 1GB 이상 더 필요할 수 있음 |

- 심사위원 5명이 동시에 쓰는 정도라면 **운영은 2GB로 가능하다고 판단합니다.** 다만 **스왑 2GB를 반드시 만들고**, 빌드는 서비스를 멈춘 뒤 하거나 다른 곳에서 빌드한 결과를 올리세요.
- **4GB가 필요한 경우**
  - 서버에서 빌드하면서 동시에 운영해야 할 때
  - 스왑을 쓸 수 없는 상품일 때
  - 2개월 동안 로그·백업·모니터링 도구를 더 올릴 때
  - 실측해 보니 여유 메모리가 300MB보다 적을 때
- PostgreSQL 권장값(2GB): `shared_buffers=256MB`, `effective_cache_size=768MB`, `work_mem=4MB`, `maintenance_work_mem=64MB`, `max_connections=30`
- 앱 연결 수: `DATABASE_URL`에 `connection_limit=5`를 붙입니다(Prisma 기본값은 CPU 수 × 2 + 1). 마이그레이션 1개와 운영자 셸을 더해도 30을 넘지 않습니다.

## 2. 서버 최초 설정(사용자 수행 — 명령은 예시)
1. **구매·접속**: 한국 데이터센터의 Ubuntu 22.04/24.04 LTS 서버를 구매합니다(iwinv 예정, 2개월). 처음 받은 계정으로 접속합니다.
2. **관리 계정·SSH**
   - `adduser deployer`, `usermod -aG sudo deployer`
   - 내 컴퓨터의 공개키를 `~deployer/.ssh/authorized_keys`에 넣습니다.
   - `/etc/ssh/sshd_config`: `PasswordAuthentication no`, `PermitRootLogin no` → `sudo systemctl reload ssh`
   - **다른 창에서 새 키로 접속되는지 확인한 뒤** 기존 창을 닫으세요.
3. **방화벽**: `sudo ufw allow OpenSSH && sudo ufw allow 80,443/tcp && sudo ufw enable`. 서버 업체 콘솔에 방화벽 기능이 있으면 같은 규칙을 넣습니다.
4. **자동 보안 업데이트·시간대**: `sudo apt install unattended-upgrades fail2ban`, `sudo timedatectl set-timezone Asia/Seoul`
5. **스왑 2GB**: `sudo fallocate -l 2G /swapfile && sudo chmod 600 /swapfile && sudo mkswap /swapfile && sudo swapon /swapfile`, 그리고 `/etc/fstab`에 등록
6. **앱 실행 계정**: `sudo adduser --system --group --home /srv/safe-school safeschool`

## 3. Node.js 22 · PostgreSQL 16 설치
- Node.js 22 LTS: NodeSource 저장소 또는 배포판 패키지로 설치하고 `node -v`로 v22인지 확인합니다.
- PostgreSQL 16: `sudo apt install postgresql-16`(배포판에 없으면 PGDG 저장소). `listen_addresses = 'localhost'`(기본값)를 유지하고 `pg_hba.conf`는 로컬 연결만 둡니다.
- DB와 계정 만들기(**DB 생성 단계** — 스키마·테이블은 아직 만들지 않음):
  ```sql
  -- sudo -u postgres psql
  CREATE ROLE safeschool_app LOGIN PASSWORD '<무작위 비밀번호>';   -- 비밀번호는 이 화면에만 입력, 기록에 남기지 않기
  CREATE DATABASE safeschool OWNER safeschool_app;
  REVOKE ALL ON DATABASE safeschool FROM PUBLIC;
  ```
  비밀번호는 `openssl rand -base64 32`로 만들고 `/etc/safe-school/safe-school.env`에만 넣습니다.

## 4. 앱 설치·빌드(릴리스 폴더 방식)
```
/srv/safe-school/releases/<커밋 해시>/   ← 릴리스마다 새 폴더(이전 판 보존 = 롤백용)
/srv/safe-school/current → releases/<커밋 해시>   ← 심볼릭 링크
/etc/safe-school/safe-school.env           ← 비밀값(저장소 밖, 권한 640)
```
1. `git clone`한 뒤 **검토·승인된 릴리스 커밋**을 checkout합니다(`step6-release-rollback.md` 1절).
2. `npm ci`: 개발 의존성도 설치합니다. 배포 스크립트가 `prisma` CLI를 쓰기 때문입니다.
3. `npm run build`: `dist/client`, `dist/server/index.js`, `dist/deploy-start.js`가 만들어집니다.
4. `ln -sfn /srv/safe-school/releases/<해시> /srv/safe-school/current`
- 환경변수 예시는 `deploy/env/safe-school.env.example`에 있습니다(비밀값 제외). 꼭 넣을 값:
  - `NODE_ENV=production`
  - `LISTEN_HOST=127.0.0.1`
  - `DEPLOY_PROFILE=production`
  - `DEPLOY_DB_SCHEMA=safeschool_prod_judge`
  - `DATABASE_URL`(같은 schema, connection_limit=5)
  - `SESSION_SECRET`(32자 이상)

## 5. 스키마 생성 → 마이그레이션 → 시연 데이터(서로 다른 단계, 각각 승인 후)
| 단계 | 명령(앱 폴더, `sudo -u safeschool` 환경에서 env 파일을 불러와 실행) | 바뀌는 것 |
| --- | --- | --- |
| ① 대상 확인 | `npm run deploy:check` | 없음. 스키마가 없으면 "아직 없음"으로 중단됨(정상) |
| ② 스키마 생성·마이그레이션(처음 한 번) | `DEPLOY_ALLOW_NEW_SCHEMA=true npm run deploy:migrate` | `safeschool_prod_judge` 스키마와 테이블 31개(마이그레이션 5개). **플래그는 이 명령에만** 붙이고 env 파일에는 넣지 않음 |
| ③ 다시 확인 | `npm run deploy:check` | 없음. 학교 0개·사용자 0명이 나와야 함 |
| ④ 시연 데이터 계획 보기 | `npm run judge:setup -- --layout independent` | 없음(읽기만) |
| ⑤ 시연 데이터 만들기 | `JUDGE_SETUP_CONFIRM=safeschool_prod_judge npm run judge:setup -- --layout independent --apply --out /root/judge-accounts.txt --sample-drill` | 가상 학교 5곳, 학급 45개, 계정 5개, 예시 훈련 5건(`step6-demo-data-plan.md`) |
| ⑥ 서비스 시작 | `sudo systemctl enable --now safe-school` | 적용할 마이그레이션 없음 → 서버만 시작 |

- 서버 시작(`deploy:start`) 단계는 STEP 6에서 고쳐서, 플래그가 남아 있어도 **새 스키마를 만들지 않습니다.** 잘못된 DB 주소로 바뀌었을 때 빈 스키마가 조용히 만들어지는 사고를 막기 위함입니다.
- DB 보호 검사를 건너뛰는 방법(`prisma migrate deploy` 직접 실행, schema 없는 주소 등)은 절차에 넣지 않습니다.

## 6. systemd · 리버스 프록시 · HTTPS
- 서비스 파일 `deploy/systemd/safe-school.service`를 `/etc/systemd/system/`에 복사합니다. 시작 명령은 `node dist/deploy-start.js`(검증 → 점검 → 적용할 마이그레이션 → 서버)이고, `NODE_ENV=production`을 고정하며, 실패하면 재시작하되 반복 횟수를 제한합니다.
- **Caddy(권장)**: `deploy/caddy/Caddyfile.example`. 도메인의 A 레코드를 서버 IP로 맞추면 인증서가 자동으로 발급되고, 만료 전에 자동 갱신됩니다(별도 cron 불필요). 보안 헤더(HSTS·nosniff·frame DENY)를 프록시에서 붙입니다.
- **Nginx**: `deploy/nginx/safe-school.conf.example` + `certbot --nginx`. 갱신은 certbot 타이머가 하므로 `sudo certbot renew --dry-run`으로 확인합니다. `X-Forwarded-For`는 실제 접속 IP로 덮어써서 위조를 막습니다.
- 앱 설정: `TRUST_PROXY_HOPS=1`(프록시 1단). CDN을 앞에 더 두면 2로 바꿉니다. 운영 쿠키는 `Secure; HttpOnly; SameSite=Lax`입니다.
- 프런트엔드: 운영 모드에서 앱이 `dist/client`를 제공하고, `/api/` 이외의 GET 요청은 `index.html`로 보냅니다(SPA 라우팅). 프록시는 모든 경로를 앱으로 넘기면 됩니다.

## 7. 로그·백업
- 앱 로그: `journalctl -u safe-school`. 보관량은 `/etc/systemd/journald.conf`의 `SystemMaxUse=200M`으로 제한합니다. 오류 로그는 이메일·전화·DB 주소를 가립니다(STEP 3-E·3-F).
- 프록시 접속 로그: Caddy 설정에서 20MB씩 10개를 순환합니다.
- DB 백업: `deploy/scripts/pg-backup.sh`(운영 스키마만 덤프, 덤프를 읽을 수 있는지 확인, 14일 넘은 **백업 파일**만 정리). cron은 매일 03:30에 돌립니다. 백업 파일 권한은 600(umask 077)입니다.
- 서버 밖 사본: 일주일에 한 번 이상 내 컴퓨터로 `scp`합니다. 백업에는 가상 데이터만 있지만 계정 해시가 들어 있으므로 안전하게 보관합니다.

## 8. 재부팅 후 자동 시작 검증
1. `sudo reboot`
2. 다시 접속한 뒤 `systemctl is-active postgresql safe-school caddy`가 모두 `active`인지 확인합니다.
3. `journalctl -u safe-school -b | grep -E "대상:|실행 중"`에 schema·프로필 요약과 실행 메시지가 있는지 확인합니다(주소·비밀번호는 나오지 않아야 함).
4. `curl -sI https://<시연 도메인>/`가 200을 돌려주고 HSTS 헤더가 있는지 확인합니다.
5. `curl -s https://<시연 도메인>/api/health`의 status가 ok인지 확인합니다.
6. 브라우저로 심사위원 계정 하나에 로그인해 확인합니다.
7. 외부에서 `nc -zv <서버 IP> 5000`과 `5432`가 **연결 실패**하는지 확인합니다(비공개 확인).

## 9. 사용자가 직접 할 일
- 서버 구매(사양 결정: 2GB + 스왑, 또는 4GB), 도메인 준비와 DNS A 레코드 설정
- SSH 키 등록, 위 2~8절 실행. 각 DB 변경 단계(②⑤)는 실행 전에 승인
- 심사위원 계정 전달 방법 결정(비밀번호 파일은 전달한 뒤 서버에서 삭제)
- 모의 경보 시연 여부 결정(`step6-security-checklist.md` 5절)
