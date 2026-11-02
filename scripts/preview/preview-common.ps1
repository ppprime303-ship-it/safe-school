# SAFE SCHOOL 로컬 미리보기 공통(다른 스크립트가 불러 씀)
# - 비밀번호는 저장소 밖 %USERPROFILE%\.safeschool-preview\secrets.json(본인 계정만 접근)에서 읽고 화면에 출력하지 않습니다.
# - 이 창(프로세스)에만 환경변수를 설정합니다. 운영 관련 변수는 지우고, 대상이 로컬 safeschool_preview 가 아니면 멈춥니다.
$ErrorActionPreference = "Stop"
$PreviewHome = Join-Path $env:USERPROFILE ".safeschool-preview"
$RepoRoot = (Resolve-Path (Join-Path $PSScriptRoot "..\..")).Path

function Stop-Preview([string]$msg) {
  Write-Host "[미리보기] 중단: $msg" -ForegroundColor Red
  exit 1
}

function Initialize-PreviewEnv {
  $secretsPath = Join-Path $PreviewHome "secrets.json"
  if (-not (Test-Path $secretsPath)) { Stop-Preview "비밀번호 파일이 없습니다($secretsPath). 로컬 PostgreSQL 준비를 먼저 하세요." }
  $svc = Get-Service -Name "postgresql-x64-16" -ErrorAction SilentlyContinue
  if (-not $svc) { Stop-Preview "로컬 PostgreSQL 16 서비스(postgresql-x64-16)가 없습니다." }
  if ($svc.Status -ne "Running") { Stop-Preview "로컬 PostgreSQL 서비스가 꺼져 있습니다. 윈도우 '서비스'에서 postgresql-x64-16 을 시작하세요." }
  $s = Get-Content $secretsPath -Raw | ConvertFrom-Json

  # 운영·배포·외부 발송 관련 변수는 이 창에서 지움(혹시 설정되어 있어도 쓰지 않음)
  foreach ($n in "DEPLOY_PROFILE", "DEPLOY_DB_SCHEMA", "DEPLOY_ALLOW_NEW_SCHEMA", "MAIL_API_KEY", "MAIL_FROM", "GMAIL_SMTP_USER", "GMAIL_SMTP_APP_PASSWORD", "MOIS_CBS_SERVICE_KEY", "NEIS_API_KEY", "SCHOOLINFO_API_KEY", "KMA_WARNING_SERVICE_KEY", "ALERT_PROVIDERS", "ALERT_MOCK_FEED", "APP_BASE_URL", "TEST_DATABASE_URL", "ALLOW_DEMO_SEED") {
    Remove-Item "Env:$n" -ErrorAction SilentlyContinue
  }
  $pw = [Uri]::EscapeDataString($s.appPassword)
  $env:NODE_ENV = "development"
  $env:DATABASE_URL = "postgresql://safeschool_app:$pw@127.0.0.1:5432/safeschool_preview?schema=public"
  $env:SESSION_SECRET = $s.sessionSecret
  $env:DEMO_PASSWORD = $s.demoPassword
  $env:MAIL_PROVIDER = "console"      # 메일은 실제로 보내지 않고 서버 창에만 표시
  $env:PORT = "5000"
  $env:LISTEN_HOST = "127.0.0.1"      # 이 PC 안에서만 접속
  $env:INCIDENT_UPLOAD_DIR = Join-Path $PreviewHome "uploads"
  $env:PREVIEW_CONFIRM = "local"

  # 최종 확인: 로컬 미리보기 DB만
  $u = [Uri]$env:DATABASE_URL
  if ($u.Host -ne "127.0.0.1" -or $u.Port -ne 5432 -or $u.AbsolutePath -ne "/safeschool_preview") { Stop-Preview "DB 대상이 로컬 safeschool_preview 가 아닙니다." }
  Write-Host "[미리보기] 로컬 DB 확인: 127.0.0.1:5432/safeschool_preview (운영 변수 제거됨)" -ForegroundColor Green
  Set-Location $RepoRoot
}
