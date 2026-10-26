#!/usr/bin/env bash
# GitHub 개발 커밋과 Replit 검증 커밋의 '코드 내용'이 같은지 비교(읽기 전용). 해시가 달라도 내용이 같으면 통과.
#   Replit Shell:  git fetch origin && bash scripts/release-compare.sh <GitHub 커밋> <Replit 커밋>
#   예:            bash scripts/release-compare.sh ad6e558 98f7525
# 비교 대상: 서버·화면·공용·스크립트·DB 스키마·마이그레이션·테스트·배포 설정·package.json
# 제외: docs/, Replit 전용 파일(.replit 등), package-lock.json(별도 표시)
set -euo pipefail
A="${1:?GitHub 커밋을 지정하세요}"; B="${2:?Replit 커밋을 지정하세요}"
git cat-file -e "$A^{commit}" 2>/dev/null || { echo "커밋 없음: $A (git fetch origin 먼저)"; exit 2; }
git cat-file -e "$B^{commit}" 2>/dev/null || { echo "커밋 없음: $B"; exit 2; }
PATHS=(server client shared scripts prisma tests deploy package.json tsconfig.json vite.config.ts vitest.config.ts)
echo "비교: $(git rev-parse --short "$A") (GitHub) ↔ $(git rev-parse --short "$B") (Replit)"
DIFF="$(git diff --name-status "$A" "$B" -- "${PATHS[@]}")"
if [ -z "$DIFF" ]; then
  echo "[같음] 코드·설정 내용이 같습니다."
else
  echo "[다름] 아래 파일 내용이 다릅니다(A=GitHub 기준, B=Replit 기준):"
  echo "$DIFF"
fi
DOCS="$(git diff --name-only "$A" "$B" -- docs | wc -l)"
echo "문서(docs/) 차이: ${DOCS}개 파일(배포 코드와 무관)"
LOCK="$(git diff --name-only "$A" "$B" -- package-lock.json)"
[ -n "$LOCK" ] && echo "package-lock.json 다름(설치 버전이 달라질 수 있음 — 릴리스 전 확정 필요)"
[ -z "$DIFF" ]
