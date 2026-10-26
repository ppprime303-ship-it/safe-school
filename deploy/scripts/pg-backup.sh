#!/usr/bin/env bash
# 환경별 스키마 백업(읽기 전용 덤프). 각 환경의 DB 계정으로 자기 스키마만 덤프합니다(다른 환경 스키마는 권한이 없어 덤프 불가).
# cron 예(환경별 리눅스 계정):
#   ss-judge: 30 3 * * * DEPLOY_DB_SCHEMA=safeschool_prod_judge PGUSER=ss_judge BACKUP_DIR=/srv/safe-school/judge/backups /srv/safe-school/judge/current/deploy/scripts/pg-backup.sh
#   ss-pilot: 40 3 * * * DEPLOY_DB_SCHEMA=safeschool_prod_pilot PGUSER=ss_pilot BACKUP_DIR=/srv/safe-school/pilot/backups /srv/safe-school/pilot/current/deploy/scripts/pg-backup.sh
# DB 비밀번호는 각 계정의 ~/.pgpass(권한 600)로 — 이 파일에 적지 않습니다.
set -euo pipefail
SCHEMA="${DEPLOY_DB_SCHEMA:-safeschool_prod_judge}"
case "$SCHEMA" in safeschool_prod*) ;; *) echo "운영 스키마가 아닙니다: $SCHEMA" >&2; exit 1;; esac
DB="${PGDATABASE:-safeschool}"
DIR="${BACKUP_DIR:-/var/backups/safe-school}"
KEEP_DAYS="${KEEP_DAYS:-14}"
umask 077
mkdir -p "$DIR"
OUT="$DIR/${SCHEMA}_$(date +%Y%m%d_%H%M%S).dump"
pg_dump --host=127.0.0.1 --format=custom --no-owner --schema="$SCHEMA" --file="$OUT" "$DB"
pg_restore --list "$OUT" > /dev/null   # 덤프가 읽히는지 확인
find "$DIR" -name "${SCHEMA}_*.dump" -mtime +"$KEEP_DAYS" -delete
echo "백업 완료: $OUT"
