# 외부 경보 안내 창 화면 확인: safeschool_test + 포트 5002 임시 서버. 미리보기 DB를 쓰지 않고 외부 API·메일을 호출하지 않습니다. 끝내려면 Ctrl+C.
$ErrorActionPreference = "Stop"
$repo = (Resolve-Path (Join-Path $PSScriptRoot "..\..")).Path
$s = Get-Content (Join-Path $env:USERPROFILE ".safeschool-preview\secrets.json") -Raw | ConvertFrom-Json
$url = "postgresql://safeschool_app:$([Uri]::EscapeDataString($s.appPassword))@127.0.0.1:5432/safeschool_test?schema=safeschool_test"
$u = [Uri]$url
if ($u.Host -ne "127.0.0.1" -or $u.AbsolutePath -ne "/safeschool_test" -or $u.Query -ne "?schema=safeschool_test") { throw "대상이 safeschool_test 가 아닙니다." }
foreach ($n in "DEPLOY_PROFILE", "DEPLOY_DB_SCHEMA", "MAIL_API_KEY", "MAIL_FROM", "GMAIL_SMTP_USER", "GMAIL_SMTP_APP_PASSWORD", "MOIS_CBS_SERVICE_KEY", "NEIS_API_KEY", "SCHOOLINFO_API_KEY", "KMA_WARNING_SERVICE_KEY", "ALERT_PROVIDERS", "ALERT_MOCK_FEED", "APP_BASE_URL") { Remove-Item "Env:$n" -ErrorAction SilentlyContinue }
$env:DATABASE_URL = $url
$env:NODE_ENV = "development"
$env:PORT = "5002"
$env:LISTEN_HOST = "127.0.0.1"
$env:MAIL_PROVIDER = "console"
$env:SESSION_SECRET = "local-popup-demo-" + [guid]::NewGuid().ToString("N")
$env:INCIDENT_UPLOAD_DIR = Join-Path $env:TEMP "safeschool-popup-demo-uploads"
Set-Location $repo
npx tsx scripts/alert-popup-demo.ts
Write-Host "이 창이 임시 서버입니다. 점검이 끝날 때까지 닫거나 Ctrl+C를 누르지 마세요(복사는 마우스로 선택 후 오른쪽 클릭)." -ForegroundColor Yellow
npx tsx server/src/index.ts
Write-Host "[안내 창 확인] 임시 서버가 종료되었습니다(코드 $LASTEXITCODE, $(Get-Date -Format 'HH:mm:ss')). 이후 브라우저의 '확인'은 저장되지 않습니다." -ForegroundColor Yellow
