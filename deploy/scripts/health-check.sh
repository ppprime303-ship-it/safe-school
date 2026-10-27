#!/usr/bin/env bash
# STEP 8 상태 확인(읽기 전용 — 아무것도 바꾸지 않음). 앱(127.0.0.1)과 공개 주소(HTTPS)의 /api/health 를 확인합니다.
#   bash deploy/scripts/health-check.sh [공개 호스트명]
# cron 예시(5분마다, 실패만 기록 — 재시작은 systemd Restart= 가 맡고 이 스크립트는 하지 않음):
#   */5 * * * * /srv/safe-school/current/deploy/scripts/health-check.sh <호스트명> >/dev/null 2>> /srv/safe-school/logs/health.log
# 출력에는 상태·지연 시간만 남깁니다(쿠키·헤더·DB 주소 없음). 종료 코드: 0 정상, 1 확인 필요.
set -uo pipefail
HOST="${1:-}"
PORT="${PORT:-5000}"
fail=0

probe() { # probe <이름> <URL>
  local name="$1" url="$2" body code
  body="$(curl -sS --max-time 5 -w '\n%{http_code}' "$url" 2>/dev/null)" || { echo "$(date '+%F %T') [확인 필요] $name 연결 실패" >&2; fail=1; return; }
  code="${body##*$'\n'}"; body="${body%$'\n'*}"
  if [ "$code" = "200" ] && printf '%s' "$body" | grep -q '"db":"ok"'; then
    echo "$(date '+%F %T') [정상] $name $(printf '%s' "$body" | grep -o '"dbLatencyMs":[0-9]*')"
  else
    echo "$(date '+%F %T') [확인 필요] $name HTTP $code" >&2; fail=1
  fi
}

probe "앱(127.0.0.1:$PORT)" "http://127.0.0.1:$PORT/api/health"
[ -n "$HOST" ] && probe "공개(https://$HOST)" "https://$HOST/api/health"
exit "$fail"
