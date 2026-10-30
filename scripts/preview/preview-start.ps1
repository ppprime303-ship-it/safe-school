# SAFE SCHOOL 로컬 미리보기 시작: 웹앱을 켜고 브라우저를 엽니다. 끝내려면 이 창에서 Ctrl+C(또는 preview-stop).
. (Join-Path $PSScriptRoot "preview-common.ps1")
Initialize-PreviewEnv

$busy = Get-NetTCPConnection -LocalPort 5000 -State Listen -ErrorAction SilentlyContinue
if ($busy) { Stop-Preview "5000번 포트가 이미 사용 중입니다. 이미 켜져 있다면 브라우저에서 http://localhost:5000 을 여세요(또는 preview-stop 후 다시 시작)." }

# 서버가 뜨면 브라우저 열기(최대 60초 대기)
Start-Job -ScriptBlock {
  for ($i = 0; $i -lt 60; $i++) {
    Start-Sleep -Seconds 1
    try { Invoke-WebRequest -Uri "http://127.0.0.1:5000/api/health" -UseBasicParsing -TimeoutSec 2 | Out-Null; Start-Process "http://localhost:5000"; return } catch {}
  }
} | Out-Null

Write-Host "[미리보기] 웹앱 시작 — http://localhost:5000 (이 PC에서만 접속). 끝내려면 Ctrl+C" -ForegroundColor Green
Write-Host "[미리보기] 계정 목록: $PreviewHome\demo-accounts.txt" -ForegroundColor Green
npm run dev
