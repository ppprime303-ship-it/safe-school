# 공공 API 실제 응답 확인(승인된 소량 호출만). 키는 저장소 밖 파일에서 읽어 이 프로세스에만 넣고 출력하지 않습니다.
#   powershell -ExecutionPolicy Bypass -File scripts\preview\api-verify.ps1 -Api schoolinfo
# 파일: %USERPROFILE%\devtools\postgresql16\secrets\<이름>.key (저장은 같은 폴더의 set-api-key.ps1, 숨김 입력)
# DB에 접속하지 않습니다.
# -DryRun: 키를 읽지 않고 호출 계획만 표시합니다(네트워크 없음). 호출 수: schoolinfo 1, neis 1, mois 1, kma 2. 재시도 없음.
param([Parameter(Mandatory = $true)][ValidateSet('schoolinfo', 'neis', 'mois', 'kma')][string]$Api, [switch]$DryRun)
$ErrorActionPreference = 'Stop'
$repo = (Resolve-Path (Join-Path $PSScriptRoot '..\..')).Path
$schoolArgs = @('--kind', '02', '--sgg', '28155', '--basic-only')
if ($DryRun) {
  Set-Location $repo
  switch ($Api) {
    'schoolinfo' { npx tsx scripts/verify-schoolinfo.ts @schoolArgs --dry-run }
    'neis' { Write-Host '[호출 계획] 1회: 학교기본정보 --office E10' }
    'mois' { Write-Host '[호출 계획] 1회: DSSP-IF-00247 1쪽' }
    'kma' { Write-Host '[호출 계획] 2회: getPwnCd 1쪽, getPwnStatus' }
  }
  exit 0
}
$secrets = Join-Path $env:USERPROFILE 'devtools\postgresql16\secrets'
$names = @{ schoolinfo = 'SCHOOLINFO_API_KEY'; neis = 'NEIS_API_KEY'; mois = 'MOIS_CBS_SERVICE_KEY'; kma = 'KMA_WARNING_SERVICE_KEY' }

foreach ($n in @($names.Values) + @('DATABASE_URL', 'TEST_DATABASE_URL', 'ALERT_PROVIDERS', 'MAIL_PROVIDER')) { Remove-Item "Env:$n" -ErrorAction SilentlyContinue }
$name = $names[$Api]
$file = Join-Path $secrets ($name.ToLower() + '.key')
if (-not (Test-Path $file) -or (Get-Item $file).Length -eq 0) {
  Write-Host "$name 파일이 없어 호출하지 않았습니다. set-api-key.ps1 -Name $name 으로 저장하세요."
  exit 1
}
Set-Item "Env:$name" ((Get-Content $file -Raw).Trim())
Set-Location $repo
try {
  switch ($Api) {
    # npm 실행기는 PowerShell 에서 '--' 뒤 인자를 잃으므로 tsx 를 직접 씁니다(2026-11-02 초과 호출 원인)
    'schoolinfo' { $env:SCHOOLINFO_SGG_REQUIRED = 'true'; npx tsx scripts/verify-schoolinfo.ts @schoolArgs }
    'neis' { npx tsx scripts/verify-neis.ts --office E10 }
    'mois' { npx tsx scripts/verify-mois.ts }
    'kma' { npx tsx scripts/verify-kma-warnings.ts }
  }
} finally {
  Remove-Item "Env:$name" -ErrorAction SilentlyContinue
}
