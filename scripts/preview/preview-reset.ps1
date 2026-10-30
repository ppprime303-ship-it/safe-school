# SAFE SCHOOL 로컬 미리보기 초기화: 로컬 safeschool_preview DB만 지우고 다시 만든 뒤 준비(preview-setup)를 다시 실행합니다.
# - 이 PC의 로컬 PostgreSQL(127.0.0.1:5432)의 safeschool_preview 만 대상(이름 고정). 다른 DB·운영 DB는 건드리지 않습니다.
# - '초기화'를 직접 입력해야 진행합니다. 업로드한 가상 사진 폴더도 비웁니다.
. (Join-Path $PSScriptRoot "preview-common.ps1")
Initialize-PreviewEnv

if (Get-NetTCPConnection -LocalPort 5000 -State Listen -ErrorAction SilentlyContinue) { Stop-Preview "웹앱이 켜져 있습니다. 먼저 preview-stop 으로 끄세요." }
$answer = Read-Host "로컬 미리보기 DB(safeschool_preview)의 점검 기록을 모두 지우고 처음 상태로 만듭니다. 계속하려면 '초기화'를 입력하세요"
if ($answer -ne "초기화") { Write-Host "[미리보기] 취소했습니다." -ForegroundColor Yellow; exit 0 }

$s = Get-Content (Join-Path $PreviewHome "secrets.json") -Raw | ConvertFrom-Json
$psql = "C:\Program Files\PostgreSQL\16\bin\psql.exe"
$env:PGPASSWORD = $s.postgresPassword
try {
  @"
SELECT pg_terminate_backend(pid) FROM pg_stat_activity WHERE datname = 'safeschool_preview' AND pid <> pg_backend_pid();
DROP DATABASE IF EXISTS safeschool_preview;
CREATE DATABASE safeschool_preview OWNER safeschool_app ENCODING 'UTF8' TEMPLATE template0;
"@ | & $psql -h 127.0.0.1 -p 5432 -U postgres -d postgres -v ON_ERROR_STOP=1 -q -X | Out-Null
  if ($LASTEXITCODE -ne 0) { Stop-Preview "DB 초기화 실패" }
} finally {
  Remove-Item Env:PGPASSWORD -ErrorAction SilentlyContinue
}
$uploads = Join-Path $PreviewHome "uploads"
if (Test-Path $uploads) { Remove-Item -Recurse -Force $uploads }
Write-Host "[미리보기] 로컬 DB를 비웠습니다. 다시 준비합니다." -ForegroundColor Green
& (Join-Path $PSScriptRoot "preview-setup.ps1")
