#!/usr/bin/env bash
# 국내 VPS 시범운영 서버 점검(읽기 전용 — 아무것도 바꾸지 않음). 비밀번호·키·DB 주소는 출력하지 않습니다.
#   sudo bash /srv/safe-school/current/deploy/scripts/vps-check.sh <시범운영 호스트명>
# 결과: 항목마다 [통과]/[확인 필요]. 마지막 줄에 확인 필요 개수.
set -uo pipefail
HOST="${1:-}"
ENV_FILE="${ENV_FILE:-/etc/safe-school/pilot.env}"
FAIL=0
ok()  { echo "[통과] $1"; }
bad() { echo "[확인 필요] $1"; FAIL=$((FAIL+1)); }
envval() { grep -E "^$1=" "$ENV_FILE" 2>/dev/null | tail -1 | cut -d= -f2-; }

echo "== 1. 열린 포트(외부에서 받는 것은 22·80·443만)"
LISTEN="$(ss -Hltn 2>/dev/null | awk '{print $4}')"
for addr in $LISTEN; do
  port="${addr##*:}"; ip="${addr%:*}"
  case "$port" in
    22|80|443) ;;
    5000|5432|2019) case "$ip" in 127.0.0.1|\[::1\]|::1) ok "$port 는 루프백에서만 받음($ip)";; *) bad "$port 가 외부 주소에서 받음($ip)";; esac ;;
    53) ;;   # systemd-resolved(127.0.0.53)
    *) case "$ip" in 127.*|\[::1\]|::1) ;; *) bad "예상하지 않은 포트 $port($ip)";; esac ;;
  esac
done
if command -v ufw >/dev/null; then
  UFW="$(ufw status 2>/dev/null)"
  echo "$UFW" | grep -q "Status: active" && ok "ufw 사용 중" || bad "ufw 꺼져 있음"
  echo "$UFW" | grep -Eq "^(5432|5000)[/ ]" && bad "ufw 에 5432/5000 허용 규칙이 있음" || ok "ufw 에 DB·앱 포트 허용 규칙 없음"
fi

echo "== 2. SSH"
SSHD="$(sshd -T 2>/dev/null)"
echo "$SSHD" | grep -q "^passwordauthentication no" && ok "SSH 비밀번호 로그인 거부" || bad "SSH 비밀번호 로그인 허용"
echo "$SSHD" | grep -Eq "^permitrootlogin (no|prohibit-password)" && ok "root 비밀번호 로그인 불가" || bad "root 로그인 설정 확인"

echo "== 3. 환경변수 파일(값은 출력하지 않음)"
if [ -f "$ENV_FILE" ]; then
  perm="$(stat -c '%a %U:%G' "$ENV_FILE")"
  [ "$perm" = "640 root:ss-pilot" ] && ok "env 권한 $perm" || bad "env 권한 $perm (640 root:ss-pilot 이어야 함)"
  [ "$(envval LISTEN_HOST)" = "127.0.0.1" ] && ok "LISTEN_HOST=127.0.0.1" || bad "LISTEN_HOST"
  [ "$(envval TRUST_PROXY_HOPS)" = "1" ] && ok "TRUST_PROXY_HOPS=1" || bad "TRUST_PROXY_HOPS"
  [ "$(envval DEPLOY_DB_SCHEMA)" = "safeschool_prod_pilot" ] && ok "스키마 safeschool_prod_pilot" || bad "DEPLOY_DB_SCHEMA"
  envval ALERT_PROVIDERS | grep -q mock && bad "ALERT_PROVIDERS 에 mock" || ok "모의 경보 꺼짐"
  [ -z "$(envval ALERT_MOCK_FEED)" ] && ok "ALERT_MOCK_FEED 없음" || bad "ALERT_MOCK_FEED 설정됨"
  [ -z "$(envval DEPLOY_ALLOW_NEW_SCHEMA)" ] && ok "DEPLOY_ALLOW_NEW_SCHEMA 없음" || bad "DEPLOY_ALLOW_NEW_SCHEMA 남아 있음(첫 생성 후 제거)"
  [ "$(envval SESSION_SECRET | wc -c)" -ge 33 ] && ok "SESSION_SECRET 32자 이상" || bad "SESSION_SECRET 길이"
else
  bad "env 파일 없음: $ENV_FILE"
fi

echo "== 4. PostgreSQL"
PSQL="${PSQL:-sudo -u postgres psql}"
PG_HBA="${PG_HBA:-/etc/postgresql/16/main/pg_hba.conf}"
q() { $PSQL -XAt -d "${2:-postgres}" -c "$1" 2>/dev/null; }
check() { # check <설명> <기대값> <실제값>
  if [ -z "$3" ]; then bad "$1 — 조회 실패(PostgreSQL 실행·권한 확인)"; elif [ "$3" = "$2" ]; then ok "$1"; else bad "$1 (현재: $3)"; fi
}
check "listen_addresses=localhost(외부 접속 불가)" "localhost" "$(q "SHOW listen_addresses")"
check "password_encryption=scram-sha-256" "scram-sha-256" "$(q "SHOW password_encryption")"
check "SQL 문장 로그 끔(log_statement=none)" "none" "$(q "SHOW log_statement")"
check "오류 로그에 SQL 문장 안 남김(log_min_error_statement=panic)" "panic" "$(q "SHOW log_min_error_statement")"
check "오류 로그에 값 상세 안 남김(log_error_verbosity=terse)" "terse" "$(q "SHOW log_error_verbosity")"
check "ss_pilot 관리자 권한 없음(super·createdb·createrole)" "000" "$(q "SELECT rolsuper::int::text||rolcreatedb::int::text||rolcreaterole::int::text FROM pg_roles WHERE rolname='ss_pilot'" safeschool)"
check "심사 스키마 없음(이 서버는 시범운영 전용)" "0" "$(q "SELECT count(*) FROM pg_namespace WHERE nspname='safeschool_prod_judge'" safeschool)"
check "시범운영 스키마 소유자 ss_pilot" "ss_pilot" "$(q "SELECT nspowner::regrole::text FROM pg_namespace WHERE nspname='safeschool_prod_pilot'" safeschool)"
check "public 에 객체 생성 불가" "f" "$(q "SELECT has_schema_privilege('ss_pilot','public','CREATE')" safeschool)"
if [ -r "$PG_HBA" ]; then
  EXT="$(awk '$1 ~ /^host/ && $4 != "127.0.0.1/32" && $4 != "::1/128" {print NR": "$1" "$2" "$3" "$4}' "$PG_HBA")"
  [ -z "$EXT" ] && ok "pg_hba: TCP 접속은 루프백 주소만" || bad "pg_hba 에 루프백이 아닌 줄: $EXT"
else
  bad "pg_hba 파일을 읽을 수 없음: $PG_HBA"
fi

echo "== 5. 서비스·메모리"
for s in safe-school postgresql caddy; do systemctl is-active --quiet "$s" && ok "$s 실행 중" || bad "$s 실행 안 됨"; done
systemctl is-enabled --quiet safe-school && ok "재부팅 자동 시작" || bad "safe-school enable 안 됨"
SWAP="$(free -m | awk '/^Swap:/{print $2}')"
[ "${SWAP:-0}" -ge 1500 ] && ok "스왑 ${SWAP}MB" || bad "스왑 ${SWAP:-0}MB(2GB 서버는 2GB 권장)"
free -m | awk '/^Mem:/{print "     메모리: 전체 "$2"MB, 사용 "$3"MB, 사용 가능 "$7"MB"} /^Swap:/{print "     스왑 사용 "$3"MB"}'
echo "     앱 메모리: $(systemctl show safe-school -p MemoryCurrent --value 2>/dev/null) bytes / 한도 $(systemctl show safe-school -p MemoryMax --value 2>/dev/null)"
df -h / | awk 'NR==2{print "     디스크: 사용 "$5" (남은 "$4")"}'

echo "== 6. 백업"
LAST="$(ls -1t /srv/safe-school/backups/safeschool_prod_pilot_*.dump 2>/dev/null | head -1)"
if [ -n "$LAST" ]; then
  [ "$(stat -c %a "$LAST")" = "600" ] && ok "최근 백업 $(basename "$LAST") 권한 600" || bad "백업 권한"
  [ -n "$(find "$LAST" -mtime -2)" ] && ok "2일 이내 백업 있음" || bad "최근 백업이 2일보다 오래됨"
else
  bad "백업 파일 없음"
fi

echo "== 7. HTTPS(외부 주소)"
if [ -n "$HOST" ]; then
  H="$(curl -sS -m 10 -D - -o /dev/null "https://$HOST/api/health" 2>/dev/null)"
  echo "$H" | head -1 | grep -q " 200" && ok "https://$HOST/api/health 200" || bad "health 응답 $(echo "$H" | head -1)"
  echo "$H" | grep -qi "^strict-transport-security" && ok "HSTS" || bad "HSTS 없음"
  echo "$H" | grep -qi "^x-powered-by" && bad "x-powered-by 노출" || ok "x-powered-by 없음"
  curl -sS -m 5 -o /dev/null "http://$HOST:5000/" 2>/dev/null && bad "앱 포트 5000 외부 접속됨" || ok "앱 포트 5000 외부 차단"
else
  echo "     (호스트명을 주면 HTTPS·헤더를 확인합니다)"
fi

echo "== 결과: 확인 필요 $FAIL 건"
exit $([ "$FAIL" -eq 0 ] && echo 0 || echo 1)
