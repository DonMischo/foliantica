<#
  Test stack launcher — isolated smoke-testing environment.

  Starts the FastAPI backend on port 8799 (NOT the productive 8765) against a
  throwaway SQLite copy in %TEMP%, so test runs never touch the real database
  or collide with a running LaunchFoliantica.bat instance.

  The web dev server counterpart runs on port 3100 (NOT the productive 3000)
  with LW_API_PORT=8799 — see .claude/launch.json ("web-test") or start it
  manually:  cd web; $env:LW_API_PORT='8799'; npm run dev -- -p 3100

  Stop everything with scripts\test-stack-stop.ps1.

  Usage:
    .\scripts\test-stack-start.ps1            # reuse existing test DB
    .\scripts\test-stack-start.ps1 -FreshDb   # reset test DB from api\foliantica.db
#>
param(
    [int]$ApiPort = 8799,
    [switch]$FreshDb
)

$Root   = Split-Path -Parent $PSScriptRoot
$TestDb = Join-Path $env:TEMP "foliantica-test.db"

if ($FreshDb -or -not (Test-Path $TestDb)) {
    $src = Join-Path $Root "api\foliantica.db"
    if (Test-Path $TestDb) { Remove-Item $TestDb -Force }
    if (Test-Path $src) {
        Copy-Item $src $TestDb -Force
        Write-Host "Test DB reset from api\foliantica.db -> $TestDb"
    } else {
        Write-Host "No api\foliantica.db found - API will create an empty test DB at $TestDb"
    }
}

# Refuse to start if the port is already taken (e.g. a previous test run)
if (Get-NetTCPConnection -LocalPort $ApiPort -State Listen -ErrorAction SilentlyContinue) {
    Write-Host "Port $ApiPort is already in use - run scripts\test-stack-stop.ps1 first." -ForegroundColor Yellow
    exit 1
}

$env:LW_USE_SQLITE  = '1'
$env:LW_SQLITE_PATH = $TestDb
$env:LW_DATA_DIR    = $env:TEMP

$python = Join-Path $Root "api\.venv\Scripts\python.exe"
Start-Process -FilePath $python `
    -ArgumentList "-m", "uvicorn", "main:app", "--port", "$ApiPort" `
    -WorkingDirectory (Join-Path $Root "api") `
    -WindowStyle Hidden

# Wait for the API to come up
for ($i = 0; $i -lt 30; $i++) {
    Start-Sleep 1
    try {
        $null = Invoke-WebRequest -UseBasicParsing "http://127.0.0.1:$ApiPort/api/projects" -TimeoutSec 2
        Write-Host "Test API ready on http://127.0.0.1:$ApiPort (DB: $TestDb)"
        exit 0
    } catch {}
}
Write-Host "Test API did not become ready within 30 s." -ForegroundColor Red
exit 1
