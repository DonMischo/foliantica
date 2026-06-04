<#
.SYNOPSIS
    Smoke-test: verify embedded PostgreSQL starts and FastAPI schema is created.

.DESCRIPTION
    Lighter than run_pg_tests.ps1 — only checks that:
      1. embedded-postgres node module loads and initialises a cluster
      2. FastAPI starts without errors (create_all succeeds, seeds run)
      3. /api/health and /api/settings return 200

    Run from the project root:
        .\test\smoke_pg_schema.ps1

    Exit code: 0 = pass, 1 = failure.
#>
param(
    [int]$PgStartTimeoutSec = 45,
    [int]$ApiStartTimeoutSec = 30,
    [int]$Port    = 8765,
    [int]$PgPort  = 5433
)

$ErrorActionPreference = "Stop"
$base  = "http://127.0.0.1:$Port"
$ROOT  = Split-Path $PSScriptRoot -Parent

function WaitFor {
    param([string]$Name, [scriptblock]$Check, [int]$TimeoutSec)
    for ($i = 0; $i -lt $TimeoutSec; $i++) {
        Start-Sleep 1
        try { if (& $Check) { return $true } } catch {}
    }
    return $false
}

# ── Start PG ──────────────────────────────────────────────────────────────────
Write-Host "Starting embedded PostgreSQL..." -ForegroundColor Cyan
$pgLog = "$env:TEMP\foliantica-smoke-pg.log"
Remove-Item $pgLog -ErrorAction SilentlyContinue

$pgProc = Start-Process node `
    -ArgumentList (Join-Path $ROOT "scripts\start-test-pg.mjs") `
    -RedirectStandardOutput $pgLog `
    -RedirectStandardError  "$env:TEMP\foliantica-smoke-pg-err.log" `
    -PassThru -NoNewWindow

if (-not (WaitFor "PG" { (Get-Content $pgLog -ErrorAction SilentlyContinue) -match "READY" } $PgStartTimeoutSec)) {
    Write-Host "FAIL: PostgreSQL did not become ready in ${PgStartTimeoutSec}s" -ForegroundColor Red
    Stop-Process $pgProc.Id -Force -ErrorAction SilentlyContinue
    exit 1
}
Write-Host "PG ready." -ForegroundColor Green

# ── Start FastAPI ─────────────────────────────────────────────────────────────
Write-Host "Starting FastAPI (PG mode)..." -ForegroundColor Cyan
$apiLog = "$env:TEMP\foliantica-smoke-api.log"
Remove-Item $apiLog -ErrorAction SilentlyContinue

$envVars = @{
    LW_USE_SQLITE    = "0"; LW_PG_PORT = [string]$PgPort
    LW_PG_USER       = "foliantica"; LW_PG_PASS = "foliantica"
    LW_PG_DB         = "foliantica"; PYTHONIOENCODING = "utf-8"
}
$envBackup = @{}
foreach ($k in $envVars.Keys) {
    $envBackup[$k] = [Environment]::GetEnvironmentVariable($k)
    [Environment]::SetEnvironmentVariable($k, $envVars[$k])
}

$apiProc = Start-Process (Join-Path $ROOT "api\.venv\Scripts\python.exe") `
    -ArgumentList "run.py" `
    -WorkingDirectory (Join-Path $ROOT "api") `
    -RedirectStandardOutput $apiLog `
    -RedirectStandardError  "$env:TEMP\foliantica-smoke-api-err.log" `
    -PassThru -NoNewWindow

$ok = $false
try {
    if (-not (WaitFor "API" {
            try { $null = Invoke-RestMethod "$base/api/health"; $true } catch { $false }
        } $ApiStartTimeoutSec)) {
        Write-Host "FAIL: FastAPI did not become ready in ${ApiStartTimeoutSec}s" -ForegroundColor Red
        Write-Host (Get-Content "$env:TEMP\foliantica-smoke-api-err.log" -ErrorAction SilentlyContinue |
            Select-Object -Last 30 | Out-String)
        exit 1
    }
    Write-Host "API ready." -ForegroundColor Green

    # Spot-checks
    $health   = Invoke-RestMethod "$base/api/health"
    $settings = Invoke-RestMethod "$base/api/settings"

    Write-Host ""
    Write-Host "health   : OK" -ForegroundColor Green
    Write-Host "settings : OK (id=$($settings.id))" -ForegroundColor Green
    Write-Host ""
    Write-Host "=== SMOKE TEST PASSED ===" -ForegroundColor Green
    $ok = $true
} finally {
    foreach ($k in $envBackup.Keys) { [Environment]::SetEnvironmentVariable($k, $envBackup[$k]) }
    Stop-Process $apiProc.Id -Force -ErrorAction SilentlyContinue
    Stop-Process $pgProc.Id  -Force -ErrorAction SilentlyContinue
    Get-Process -Name postgres -ErrorAction SilentlyContinue |
        Stop-Process -Force -ErrorAction SilentlyContinue
    Remove-Item -Recurse -Force "$env:TEMP\foliantica-pg-test" -ErrorAction SilentlyContinue
}

if (-not $ok) { exit 1 }
