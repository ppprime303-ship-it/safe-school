#!/usr/bin/env bash
# STEP 3-E Replit 통합 검증(시연 DB는 건드리지 않음) — verify-step3d.sh와 같은 구조, 대상 브랜치·통합 E2E만 다름
#   bash scripts/verify-step3e.sh precheck   # 1. 상태 확인만(아무것도 바꾸지 않음)
#   bash scripts/verify-step3e.sh merge      # 2. 백업 브랜치 → --no-ff --no-commit 병합 → 보호 파일·충돌 검사 → 이상 없을 때만 커밋
#   bash scripts/verify-step3e.sh test       # 3~6. 정적 검사 + 테스트 스키마(safeschool_test)에서 전체 테스트·e2e
# 결과는 화면과 e2e-output/verify-step3d_<시각>.log 에 남습니다. 비밀값(.env·Secrets)은 출력하지 않습니다.
set -uo pipefail
TARGET_REF="origin/step-3e-integration"
BASE_COMMIT="054a574"
PROTECTED=(".replit" "vite.config.ts" "package-lock.json" "replit.nix" ".env")
mkdir -p e2e-output
LOG="e2e-output/verify-step3e_$(date +%Y%m%d_%H%M%S).log"
exec > >(tee -a "$LOG") 2>&1

say() { printf '\n== %s ==\n' "$*"; }
db_target() { # 비밀번호 없이 호스트·DB·스키마만
  node -e '
    const raw = process.argv[1] || ""; if (!raw) { console.log("(설정 없음)"); process.exit(0); }
    try { const u = new URL(raw); console.log(`${u.hostname}/${u.pathname.slice(1)} · schema=${u.searchParams.get("schema") ?? "public(기본)"}`); }
    catch { console.log("(형식을 읽을 수 없음)"); }' "${1:-}"
}

precheck() {
  say "1. 현재 브랜치·HEAD"
  git branch --show-current; git log --oneline -3
  say "원격 기준 커밋"
  git fetch -q origin "+refs/heads/step-3e-integration:refs/remotes/$TARGET_REF" || { echo "[중단] git fetch 실패"; exit 1; }
  git rev-parse -q --verify "$TARGET_REF^{commit}" >/dev/null || { echo "[중단] $TARGET_REF 를 찾을 수 없습니다"; exit 1; }
  git log --oneline -1 "$TARGET_REF"
  echo "기준 커밋 $BASE_COMMIT 포함 여부:"; git merge-base --is-ancestor "$BASE_COMMIT" "$TARGET_REF" && echo "  포함" || echo "  [주의] 포함 안 됨"
  say "기준($BASE_COMMIT) → 대상 변경 파일"
  git diff --stat "$BASE_COMMIT" "$TARGET_REF" | tail -n 60
  say "작업 트리(커밋 안 된 변경)"
  git status --short || true
  say "보호 파일이 대상 브랜치에서 바뀌는지"
  for f in "${PROTECTED[@]}"; do
    if git diff --quiet "$BASE_COMMIT" "$TARGET_REF" -- "$f" 2>/dev/null; then echo "  $f: 변경 없음"; else echo "  [주의] $f: 대상 브랜치에서 변경됨"; fi
  done
  say "DB 연결 대상(비밀번호 출력 안 함)"
  echo -n "  앱(DATABASE_URL): "; db_target "${DATABASE_URL:-}"
  echo -n "  테스트(TEST_DATABASE_URL): "; db_target "${TEST_DATABASE_URL:-}"
  echo "  ※ npm test·e2e는 TEST_DATABASE_URL이 없으면 앱 주소의 schema만 safeschool_test로 바꿔 씁니다(스키마 이름에 test가 없으면 실행 거부)."
  say "백업 파일(backups/)"
  ls -lt backups 2>/dev/null | head -n 5 || echo "  backups/ 없음 — 시연 DB 적용 전에는 npm run db:backup 필요"
  say "새 마이그레이션 적용 상태(앱 DB — 확인만, 적용 안 함)"
  npx prisma migrate status 2>&1 | tail -n 12 || true
}

merge() {
  precheck
  say "2. 백업 브랜치"
  local backup="backup/replit-before-step3e-$(date +%Y%m%d%H%M)"
  git branch "$backup" && echo "  만듦: $backup ($(git rev-parse --short HEAD))"
  say "병합 준비(--no-ff --no-commit)"
  if ! git merge --no-ff --no-commit "$TARGET_REF"; then
    echo "[중단] 충돌이 있습니다. 병합을 되돌립니다(git merge --abort). 충돌 파일:"; git diff --name-only --diff-filter=U
    git merge --abort; exit 1
  fi
  local staged; staged=$(git diff --cached --name-only)
  echo "$staged"
  for f in "${PROTECTED[@]}"; do
    if echo "$staged" | grep -qx "$f"; then echo "[중단] 보호 파일 $f 이(가) 바뀝니다. 병합을 되돌립니다."; git merge --abort; exit 1; fi
  done
  git commit -q -m "merge: step-3e-integration (통합 검증용)" && echo "  병합 커밋: $(git rev-parse --short HEAD)"
}

run() { # 이름, 명령… — 성공/실패를 표에 남김
  local name="$1"; shift
  echo; echo "▶ $name: $*"
  if "$@"; then RESULTS+=("통과|$name"); else RESULTS+=("실패|$name"); FAILED=1; fi
}

test_all() {
  RESULTS=(); FAILED=0
  say "3. 정적 검사"
  run "prisma validate" npx prisma validate
  run "prisma generate" npx prisma generate
  run "typecheck" npm run typecheck
  say "4. 테스트 스키마(safeschool_test)만 사용 — 시연 DB 변경 없음"
  run "npm test(단위·통합, step3d.test.ts 포함)" npm test
  run "e2e:step2" npm run e2e:step2
  run "e2e:step3" npm run e2e:step3
  run "e2e:step3b" npm run e2e:step3b
  run "e2e:step3c" npm run e2e:step3c
  run "e2e:step3d(권한·보안·훈련일지·HWPX)" npm run e2e:step3d
  run "e2e:step3e(통합 업무 흐름·권한 종합)" npm run e2e:step3e
  say "결과 요약"
  printf '%s\n' "${RESULTS[@]}" | sed 's/|/  /'
  echo "※ 위 각 단계의 'Tests  N passed' / '결과: N개 통과, M개 실패' 줄에 건수가 있습니다."
  echo "※ 한글 확인용 HWPX: e2e-output/step3d_훈련일지_3학급.hwpx, step3d_훈련일지_40학급.hwpx, step3e_시나리오1_훈련일지.hwpx"
  echo "로그: $LOG"
  if [ "$FAILED" -ne 0 ]; then echo "[결론] 실패한 단계가 있습니다 — 시연 DB 적용 중단"; exit 1; fi
  echo "[결론] 모든 단계 통과 — STEP 3-E는 새 마이그레이션 없음(시연 DB 변경 불필요)"
}

case "${1:-}" in
  precheck) precheck ;;
  merge) merge ;;
  test) test_all ;;
  *) echo "사용: bash scripts/verify-step3e.sh precheck|merge|test"; exit 2 ;;
esac
