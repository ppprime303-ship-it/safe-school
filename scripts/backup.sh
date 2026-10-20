#!/usr/bin/env bash
# `npm run db:backup` : 현재 DB 전체를 backups/ 폴더에 SQL 파일로 저장합니다.
# 백업 파일은 GitHub에 올리지 않습니다(.gitignore). 보관 위치는 학교가 승인한 곳으로 옮기세요.
set -euo pipefail

if [ -z "${DATABASE_URL:-}" ]; then
  echo "[backup] DATABASE_URL이 없습니다." >&2
  exit 1
fi

mkdir -p backups
FILE="backups/safeschool_$(date +%Y%m%d_%H%M%S).sql"
# Prisma 전용 '?schema=' 옵션은 pg_dump가 이해하지 못하므로 떼고 실행합니다.
PG_URL="${DATABASE_URL%%\?*}"
pg_dump --no-owner --no-privileges "$PG_URL" > "$FILE"
echo "[backup] 저장 완료: $FILE ($(du -h "$FILE" | cut -f1))"
echo "[backup] 복원 방법(빈 DB에서만): psql \"\$DATABASE_URL\" < $FILE"
