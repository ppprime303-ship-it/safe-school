# SAFE SCHOOL 로컬 미리보기 준비(처음 한 번, 또는 새 기능을 받은 뒤): 마이그레이션 → 데모 학교 → 데모 교장·안전업무 담당
# 운영 DB는 쓰지 않습니다(preview-common.ps1 이 로컬 safeschool_preview 인지 확인).
. (Join-Path $PSScriptRoot "preview-common.ps1")
Initialize-PreviewEnv

Write-Host "[미리보기] 1/3 마이그레이션 적용(로컬 DB)" -ForegroundColor Cyan
npm run db:migrate
if ($LASTEXITCODE -ne 0) { Stop-Preview "마이그레이션 실패" }

Write-Host "[미리보기] 2/3 데모 학교·계정(가상)" -ForegroundColor Cyan
npm run db:seed
if ($LASTEXITCODE -ne 0) { Stop-Preview "데모 데이터 생성 실패" }

Write-Host "[미리보기] 3/3 데모 교장·안전업무 담당 계정(가상)" -ForegroundColor Cyan
npm run preview:setup
if ($LASTEXITCODE -ne 0) { Stop-Preview "미리보기 계정 준비 실패" }

# 로그인 안내 파일(본인 계정만 접근하는 폴더). 비밀번호는 화면에 출력하지 않음
$d = "demo.safeschool.invalid"
@(
  "SAFE SCHOOL 로컬 미리보기 계정(가상) — 주소: http://localhost:5000",
  "비밀번호(모든 계정 같음): $($env:DEMO_PASSWORD)",
  "",
  "학교 관리자        admin@$d",
  "교장(직책)         principal@$d",
  "안전업무 담당       safety@$d",
  "1학년1반 담임      teacher11@$d",
  "1학년2반 담임      teacher12@$d",
  "2학년1반 담임      teacher21@$d",
  "일반 교직원(보건)  staff@$d",
  "",
  "이 파일은 이 PC의 로컬 미리보기 전용입니다. 다른 곳에 옮기거나 공유하지 마세요."
) | Set-Content -Path (Join-Path $PreviewHome "demo-accounts.txt") -Encoding utf8
Write-Host "[미리보기] 준비 완료. 계정 목록: $PreviewHome\demo-accounts.txt" -ForegroundColor Green
