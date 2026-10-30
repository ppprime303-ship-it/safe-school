# SAFE SCHOOL 로컬 미리보기 종료: 5000번 포트의 웹앱(node)만 끕니다. PostgreSQL 서비스와 데이터는 그대로 둡니다.
$ErrorActionPreference = "Stop"
$conns = Get-NetTCPConnection -LocalPort 5000 -State Listen -ErrorAction SilentlyContinue
if (-not $conns) { Write-Host "[미리보기] 켜져 있는 웹앱이 없습니다." -ForegroundColor Yellow; exit 0 }
foreach ($c in $conns) {
  $p = Get-Process -Id $c.OwningProcess -ErrorAction SilentlyContinue
  if ($p -and $p.ProcessName -eq "node") {
    Stop-Process -Id $p.Id -Force
    Write-Host "[미리보기] 웹앱을 껐습니다(node, PID $($p.Id))." -ForegroundColor Green
  } elseif ($p) {
    Write-Host "[미리보기] 5000번 포트를 쓰는 프로그램이 node 가 아니어서 끄지 않았습니다: $($p.ProcessName)" -ForegroundColor Yellow
  }
}
