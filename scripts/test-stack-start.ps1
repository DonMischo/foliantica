<#
  Test stack launcher — isolated smoke-testing environment.

  Starts the FastAPI backend on port 8799 (NOT the productive 8765) against a
  separate PostgreSQL database (foliantica_test), so test runs never touch the
  real database or collide with a running LaunchFoliantica.bat instance.

  Requires the embedded PostgreSQL from the main dev stack to be running.
  Start it first with LaunchFoliantica.bat or scripts\dev-backend.ps1.

  The web dev server counterpart runs on port 3100 (NOT the productive 3000)
  with LW_API_PORT=8799 — see .claude/launch.json ("web-test") or start it
  manually:  cd web; $env:LW_API_PORT='8799'; npm run dev -- -p 3100

  Stop everything with scripts\test-stack-stop.ps1.
#>
param(
    [int]$ApiPort = 8799
)

$Root = Split-Path -Parent $PSScriptRoot

# Refuse to start if the port is already taken (e.g. a previous test run)
if (Get-NetTCPConnection -LocalPort $ApiPort -State Listen -ErrorAction SilentlyContinue) {
    Write-Host "Port $ApiPort is already in use - run scripts\test-stack-stop.ps1 first." -ForegroundColor Yellow
    exit 1
}

$env:LW_PG_HOST = '127.0.0.1'
$env:LW_PG_PORT = '5433'
$env:LW_PG_USER = 'foliantica'
$env:LW_PG_PASS = 'foliantica'
$env:LW_PG_DB   = 'foliantica_test'
$env:LW_DATA_DIR = $env:TEMP

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
        Write-Host "Test API ready on http://127.0.0.1:$ApiPort (DB: foliantica_test)"
        exit 0
    } catch {}
}
Write-Host "Test API did not become ready within 30 s." -ForegroundColor Red
exit 1
