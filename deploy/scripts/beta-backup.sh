#!/usr/bin/env bash
# Beta PILOT 2 백업(DB 스키마 + 현장 사진). 대상은 safeschool_beta 뿐입니다. 데이터를 바꾸지 않습니다. 아직 어디에도 설치하지 않았습니다.
# cron(리눅스 계정 ss-beta):
#   50 3 * * * /srv/safe-school-beta/current/deploy/scripts/beta-backup.sh >> /var/backups/safe-school-beta/backup.log 2>&1
# DB 비밀번호는 ss-beta 의 ~/.pgpass(권한 600)로 — 이 파일·cron 에 적지 않습니다.
#   127.0.0.1:5432:safeschool_beta:ss_beta:<비밀번호>
# 순서: DB를 먼저 덤프한 뒤 사진을 묶습니다. DB에 기록된 사진이 묶음에서 빠지지 않게 하기 위함입니다(복구 후 DB에 없는 파일이 남을 수는 있음).
# 삭제한 사진도 백업 보관 기간 동안은 백업에 남습니다. 백업은 암호화되어 있지 않으므로 서버 밖으로 옮길 때 암호화합니다.
set -euo pipefail
SCHEMA="safeschool_beta"
DB="safeschool_beta"
USER_NAME="ss_beta"
UPLOADS="${INCIDENT_UPLOAD_DIR:-/var/lib/safe-school-beta/uploads}"
DIR="${BACKUP_DIR:-/var/backups/safe-school-beta}"
KEEP_DAYS="${KEEP_DAYS:-14}"
case "$UPLOADS" in
  /var/lib/safe-school-beta/*) ;;
  *) echo "사진 백업 대상은 /var/lib/safe-school-beta 아래만 허용합니다(지정값: $UPLOADS)" >&2; exit 1 ;;
esac
if [ -n "${DEPLOY_DB_SCHEMA:-}" ] && [ "$DEPLOY_DB_SCHEMA" != "$SCHEMA" ]; then
  echo "이 스크립트의 백업 대상은 $SCHEMA 뿐입니다(지정값: $DEPLOY_DB_SCHEMA)" >&2; exit 1
fi
umask 077
mkdir -p "$DIR"
STAMP="$(date +%Y%m%d_%H%M%S)"
DUMP="$DIR/${SCHEMA}_${STAMP}.dump"
PHOTOS="$DIR/${SCHEMA}_photos_${STAMP}.tar.gz"
pg_dump --host=127.0.0.1 --username="$USER_NAME" --no-password --format=custom --no-owner --schema="$SCHEMA" --file="$DUMP" "$DB"
pg_restore --list "$DUMP" > /dev/null   # 덤프가 읽히는지 확인
tar -czf "$PHOTOS" -C "$(dirname "$UPLOADS")" "$(basename "$UPLOADS")"
tar -tzf "$PHOTOS" > /dev/null          # 묶음이 읽히는지 확인
(cd "$DIR" && sha256sum "$(basename "$DUMP")" "$(basename "$PHOTOS")" > "${SCHEMA}_${STAMP}.sha256")
# 보관 기간이 지난 '백업 파일'만 정리(DB·사진 원본은 건드리지 않음)
find "$DIR" -maxdepth 1 \( -name "${SCHEMA}_*.dump" -o -name "${SCHEMA}_photos_*.tar.gz" -o -name "${SCHEMA}_*.sha256" \) -mtime +"$KEEP_DAYS" -delete
echo "$(date '+%F %T') 백업 완료: $(basename "$DUMP") $(basename "$PHOTOS") (사진 $(tar -tzf "$PHOTOS" | grep -vc '/$' || true)개)"
