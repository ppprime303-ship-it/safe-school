# Gmail 실제 인증 메일 시험(사용자 승인 후 본인이 실행): safeschool_test + 포트 5003 임시 서버. 미리보기·운영 환경과 분리됩니다.
#   powershell -ExecutionPolicy Bypass -File scripts\preview\mail-signup-test.ps1 -From 발신계정@gmail.com
# 앱 비밀번호는 숨김 입력으로 이 프로세스에만 있고 파일·로그에 남지 않습니다. 가입에는 본인이 확인할 수 있는 시험 주소만 쓰세요.
param([Parameter(Mandatory = $true)][string]$From)
$ErrorActionPreference = "Stop"
$repo = (Resolve-Path (Join-Path $PSScriptRoot "..\..")).Path
$s = Get-Content (Join-Path $env:USERPROFILE ".safeschool-preview\secrets.json") -Raw | ConvertFrom-Json
$url = "postgresql://safeschool_app:$([Uri]::EscapeDataString($s.appPassword))@127.0.0.1:5432/safeschool_test?schema=safeschool_test"
$u = [Uri]$url
if ($u.Host -ne "127.0.0.1" -or $u.AbsolutePath -ne "/safeschool_test" -or $u.Query -ne "?schema=safeschool_test") { throw "대상이 safeschool_test 가 아닙니다." }
foreach ($n in "DEPLOY_PROFILE", "DEPLOY_DB_SCHEMA", "BETA_DATA_MODE", "MAIL_API_KEY", "MAIL_FROM", "MOIS_CBS_SERVICE_KEY", "NEIS_API_KEY", "SCHOOLINFO_API_KEY", "KMA_WARNING_SERVICE_KEY", "ALERT_PROVIDERS", "ALERT_MOCK_FEED", "APP_BASE_URL") { Remove-Item "Env:$n" -ErrorAction SilentlyContinue }

$secure = Read-Host "Gmail 앱 비밀번호(표시되지 않음)" -AsSecureString
$ptr = [Runtime.InteropServices.Marshal]::SecureStringToBSTR($secure)
try {
  $env:GMAIL_SMTP_APP_PASSWORD = [Runtime.InteropServices.Marshal]::PtrToStringBSTR($ptr)
} finally {
  [Runtime.InteropServices.Marshal]::ZeroFreeBSTR($ptr)
}
$env:GMAIL_SMTP_USER = $From
$env:MAIL_PROVIDER = "gmail"
$env:DATABASE_URL = $url
$env:NODE_ENV = "development"
$env:PORT = "5003"
$env:LISTEN_HOST = "127.0.0.1"
$env:SESSION_SECRET = "local-mail-test-" + [guid]::NewGuid().ToString("N")
$env:INCIDENT_UPLOAD_DIR = Join-Path $env:TEMP "safeschool-mail-test-uploads"
Set-Location $repo
Write-Host "[메일 시험] http://127.0.0.1:5003 에서 시험 주소로 가입하고, 받은 편지함의 인증번호를 입력하세요. 끝내려면 Ctrl+C" -ForegroundColor Green
try {
  npx tsx server/src/index.ts
} finally {
  Remove-Item Env:GMAIL_SMTP_APP_PASSWORD, Env:GMAIL_SMTP_USER, Env:MAIL_PROVIDER -ErrorAction SilentlyContinue
}
