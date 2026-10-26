# 국내 VPS(iwinv 2GB) 설치·설정 절차 — 실제 학교 시범운영 앱 1개

작성 2026-10-26 · **아직 서버를 만들거나 접속하지 않았습니다.** 각 단계는 사용자 승인 후 진행합니다.
확정 구성: iwinv `vgna_2_n`(2 vCPU, RAM 2GB, NVMe 50GB) · Ubuntu 24.04 LTS · Node.js 22 · PostgreSQL 16 · Caddy(HTTPS) · 앱 1개(`safeschool_prod_pilot`).
공모전 심사 환경은 이 서버에 두지 않습니다(Replit 배포, 2026년 11월 요금제 갱신 후 공개 — `docs/deployment/step6-environment-isolation.md`).

| 파일 | 서버 위치 |
| --- | --- |
| `deploy/systemd/safe-school.service` | `/etc/systemd/system/safe-school.service` |
| `deploy/caddy/Caddyfile.example` | `/etc/caddy/Caddyfile` |
| `deploy/env/pilot.env.example` | `/etc/safe-school/pilot.env`(640, root:ss-pilot) |
| `deploy/sql/roles.sql` | 최초 1회 실행 |
| `deploy/postgres/90-safeschool.conf` | `/etc/postgresql/16/main/conf.d/90-safeschool.conf` |
| `deploy/postgres/pg_hba.conf.example` | `/etc/postgresql/16/main/pg_hba.conf` |
| `deploy/system/journald-safe-school.conf` | `/etc/systemd/journald.conf.d/safe-school.conf` |
| `deploy/scripts/pg-backup.sh`, `vps-check.sh` | 릴리스 폴더 안에서 실행 |

폴더: `/srv/safe-school/releases/<커밋>`(릴리스), `/srv/safe-school/current`(현재 릴리스 링크), `/srv/safe-school/backups`(백업, 700).

## 0. 준비물(사용자)
| 항목 | 내용 |
| --- | --- |
| 서버 | iwinv `vgna_2_n`, Ubuntu 24.04 LTS 이미지, 공인 IP 1개(고정) |
| 도메인 | 시범운영 호스트명 1개(예: `pilot.<보유 도메인>`) — DNS A 레코드를 서버 공인 IP로 |
| SSH 키 | 사용자 PC에서 `ssh-keygen -t ed25519`로 만든 공개키(비밀번호 로그인은 끔) |
| 운영자 메일 | 인증서 만료 알림용(Caddy) |
| 비밀값 | DB 비밀번호, SESSION_SECRET(서버에서 생성 — 채팅·Git에 올리지 않음) |

## 1. 서버 기본 보안(관리자 계정으로)
```bash
# 1) 업데이트·시간대
sudo apt update && sudo apt -y full-upgrade
sudo timedatectl set-timezone Asia/Seoul
sudo apt -y install unattended-upgrades ufw fail2ban git curl ca-certificates
sudo dpkg-reconfigure -plow unattended-upgrades     # 보안 업데이트 자동 설치

# 2) 관리자 계정(예: ops)에 SSH 키 등록 후 비밀번호·root 로그인 끄기
sudo install -d -m 700 -o ops -g ops /home/ops/.ssh   # authorized_keys 에 공개키 붙여 넣기(권한 600)
sudo tee /etc/ssh/sshd_config.d/90-safe-school.conf >/dev/null <<'EOF'
PasswordAuthentication no
KbdInteractiveAuthentication no
PermitRootLogin no
EOF
sudo sshd -t && sudo systemctl reload ssh       # 다른 창에서 키 로그인이 되는지 먼저 확인한 뒤 기존 창을 닫습니다

# 3) 방화벽: SSH·HTTP·HTTPS만
sudo ufw default deny incoming && sudo ufw default allow outgoing
sudo ufw allow OpenSSH && sudo ufw allow 80/tcp && sudo ufw allow 443/tcp
sudo ufw enable && sudo ufw status verbose
```
- iwinv 콘솔에도 방화벽 기능이 있으면 같은 규칙(22·80·443만)으로 맞춥니다. 5000·5432는 어디에도 열지 않습니다.
- 스왑 2GB: `deploy/system/swap.md`(2GB 서버 필수).
- 로그 용량·보관: `sudo install -D -m 644 deploy/system/journald-safe-school.conf /etc/systemd/journald.conf.d/safe-school.conf && sudo systemctl restart systemd-journald`

## 2. Node.js 22·Caddy·PostgreSQL 16 설치
```bash
# Node.js 22(NodeSource 공식 저장소). 설치 후 /usr/bin/node 인지 확인(systemd 설정이 이 경로를 씀)
curl -fsSL https://deb.nodesource.com/setup_22.x -o /tmp/nodesource_setup.sh
less /tmp/nodesource_setup.sh            # 내용 확인 후 실행
sudo bash /tmp/nodesource_setup.sh && sudo apt -y install nodejs
node -v && which node                    # v22.x, /usr/bin/node

# Caddy(공식 저장소 — Ubuntu 기본 패키지보다 최신, 자동 HTTPS)
sudo apt -y install debian-keyring debian-archive-keyring apt-transport-https
curl -1sLf 'https://dl.cloudsmith.io/public/caddy/stable/gpg.key' | sudo gpg --dearmor -o /usr/share/keyrings/caddy-stable-archive-keyring.gpg
curl -1sLf 'https://dl.cloudsmith.io/public/caddy/stable/debian.deb.txt' | sudo tee /etc/apt/sources.list.d/caddy-stable.list
sudo apt update && sudo apt -y install caddy && caddy version   # 2.5 이상(접속 로그 헤더 기본 가림)

# PostgreSQL 16(Ubuntu 24.04 기본 버전)
sudo apt -y install postgresql
psql --version                           # 16.x
```

## 3. PostgreSQL 최초 설정·초기 스키마(1회)
```bash
# 1) 외부 접속 차단·메모리·로그 설정
sudo install -m 644 -o postgres deploy/postgres/90-safeschool.conf /etc/postgresql/16/main/conf.d/
sudo cp /etc/postgresql/16/main/pg_hba.conf /etc/postgresql/16/main/pg_hba.conf.orig
sudo install -m 640 -o postgres -g postgres deploy/postgres/pg_hba.conf.example /etc/postgresql/16/main/pg_hba.conf
sudo systemctl restart postgresql
sudo -u postgres psql -XAtc "SHOW listen_addresses"       # localhost
sudo ss -ltnp | grep 5432                                 # 127.0.0.1:5432(·[::1]:5432)만

# 2) 앱 전용 계정·DB·스키마(심사 스키마는 만들지 않음)
sudo -u postgres psql -v ON_ERROR_STOP=1 -f deploy/sql/roles.sql      # 마지막 확인 줄: ss_pilot | f | f
sudo -u postgres psql -c '\password ss_pilot'                       # 화면에 표시되지 않음. 비밀번호 관리자에 보관
```
3) 앱 리눅스 계정·폴더·환경변수
```bash
sudo useradd --system --create-home --home-dir /home/ss-pilot --shell /usr/sbin/nologin ss-pilot
sudo install -d -m 755 -o ops -g ops /srv/safe-school /srv/safe-school/releases
sudo install -d -m 700 -o ss-pilot -g ss-pilot /srv/safe-school/backups
sudo install -d -m 750 -o root -g ss-pilot /etc/safe-school
sudo install -m 640 -o root -g ss-pilot deploy/env/pilot.env.example /etc/safe-school/pilot.env
sudo nano /etc/safe-school/pilot.env      # <…> 자리 채우기. SESSION_SECRET: openssl rand -base64 48
# 백업용 ~/.pgpass(ss-pilot 계정, 600): 127.0.0.1:5432:safeschool:ss_pilot:<비밀번호>
```
4) 첫 릴리스 설치 후(`step7-vps-operations.md` 1절 1~4단계) 테이블 생성 — **사용자 승인 후 1회**
```bash
cd /srv/safe-school/current
sudo -u ss-pilot bash -c 'set -a; . /etc/safe-school/pilot.env; set +a; DEPLOY_ALLOW_NEW_SCHEMA=true npm run deploy:migrate'
# 끝나면 플래그는 남기지 않습니다(명령줄에만 지정했으므로 env 파일에는 없음)
sudo -u ss-pilot bash -c 'set -a; . /etc/safe-school/pilot.env; set +a; npm run deploy:check'   # 학교 0개, 사용자 0명
```
- `npm run db:seed`·`npm run judge:setup`은 이 서버에서 실행하지 않습니다(둘 다 시범운영 스키마에서 거부하도록 코드에 막혀 있음).

## 4. 서비스·HTTPS 연결
```bash
sudo install -m 644 deploy/systemd/safe-school.service /etc/systemd/system/
sudo systemctl daemon-reload && sudo systemctl enable --now safe-school
journalctl -u safe-school -n 30 --no-pager   # "[deploy] 점검만 했습니다" → "운영 모드로 실행 중: 127.0.0.1:5000", [시범운영 점검] 경고 확인

sudo cp deploy/caddy/Caddyfile.example /etc/caddy/Caddyfile && sudo nano /etc/caddy/Caddyfile   # 호스트명·메일
sudo install -d -m 750 -o caddy -g caddy /var/log/caddy
sudo caddy validate --config /etc/caddy/Caddyfile && sudo systemctl reload caddy
curl -sS https://<시범운영 호스트명>/api/health
sudo bash deploy/scripts/vps-check.sh <시범운영 호스트명>     # 읽기 전용 점검. '확인 필요' 0건 목표
```
- systemd 격리 설정(`ProtectSystem=strict`, `SystemCallFilter` 등)은 이 작업공간에서 문법 검증(`systemd-analyze verify`, 보안 점수 1.5 OK)만 했습니다. **실제 서버에서 시작되는지 처음 확인해야 합니다.** 시작이 실패하면 `journalctl`에서 막힌 항목을 확인하고 해당 줄만 주석 처리합니다.

## 5. 재부팅 확인
`sudo reboot` → 다시 접속해 `systemctl is-active postgresql caddy safe-school`(모두 active) → `vps-check.sh` 재실행.
