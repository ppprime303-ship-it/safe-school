#!/usr/bin/env bash
# 심사 시연 스키마 백업(읽기 전용 덤프). cron 예: 30 3 * * * /srv/safe-school/current/deploy/scripts/pg-backup.sh
# DB 접속 정보는 ~/.pgpass(권한 600) 또는 환경변수 PGPASSWORD 로 — 이 파일에 적지 않습니다.
set -euo pipefail
SCHEMA="${DEPLOY_DB_SCHEMA:-safeschool_prod_judge}"
case "$SCHEMA" in safeschool_prod*) ;; *) echo "운영 스키마가 아닙니다: $SCHEMA" >&2; exit 1;; esac
DB="${PGDATABASE:-safeschool}"
DIR="${BACKUP_DIR:-/var/backups/safe-school}"
KEEP_DAYS="${KEEP_DAYS:-14}"
umask 077
mkdir -p "$DIR"
OUT="$DIR/${SCHEMA}_$(date +%Y%m%d_%H%M%S).dump"
pg_dump --format=custom --no-owner --schema="$SCHEMA" --file="$OUT" "$DB"
pg_restore --list "$OUT" > /dev/null   # 덤프가 읽히는지 확인
find "$DIR" -name "${SCHEMA}_*.dump" -mtime +"$KEEP_DAYS" -delete
echo "백업 완료: $OUT"
