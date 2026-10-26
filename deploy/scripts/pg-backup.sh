#!/usr/bin/env bash
# 국내 VPS 시범운영 스키마 백업(읽기 전용 덤프). ss_pilot 계정으로 safeschool_prod_pilot 만 덤프합니다.
# cron(리눅스 계정 ss-pilot, crontab -e):
#   40 3 * * * /srv/safe-school/current/deploy/scripts/pg-backup.sh >> /srv/safe-school/backups/backup.log 2>&1
# DB 비밀번호는 ss-pilot 의 ~/.pgpass(권한 600)로 — 이 파일·cron 에 적지 않습니다.
#   127.0.0.1:5432:safeschool:ss_pilot:<비밀번호>
# 백업에는 실제 교직원 이메일이 들어 있습니다. 서버 밖 사본은 암호화해 보관합니다(step7-vps-operations.md).
set -euo pipefail
SCHEMA="safeschool_prod_pilot"
if [ -n "${DEPLOY_DB_SCHEMA:-}" ] && [ "$DEPLOY_DB_SCHEMA" != "$SCHEMA" ]; then
  echo "이 서버의 백업 대상은 $SCHEMA 뿐입니다(지정값: $DEPLOY_DB_SCHEMA)" >&2; exit 1
fi
DB="${PGDATABASE:-safeschool}"
USER_NAME="${PGUSER:-ss_pilot}"
DIR="${BACKUP_DIR:-/srv/safe-school/backups}"
KEEP_DAYS="${KEEP_DAYS:-14}"
umask 077
mkdir -p "$DIR"
OUT="$DIR/${SCHEMA}_$(date +%Y%m%d_%H%M%S).dump"
pg_dump --host=127.0.0.1 --username="$USER_NAME" --no-password --format=custom --no-owner --schema="$SCHEMA" --file="$OUT" "$DB"
pg_restore --list "$OUT" > /dev/null   # 덤프가 읽히는지 확인
# 보관 기간이 지난 '백업 파일'만 정리(DB 데이터는 건드리지 않음)
find "$DIR" -maxdepth 1 -name "${SCHEMA}_*.dump" -mtime +"$KEEP_DAYS" -delete
echo "$(date '+%F %T') 백업 완료: $(basename "$OUT") ($(du -h "$OUT" | cut -f1))"
