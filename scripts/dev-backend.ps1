<#
  Backend dev launcher - starts embedded PostgreSQL, then the FastAPI server.
  Called by LaunchFoliantica.bat.  Closing this window shuts down both.
#>
param([string]$Root)

$host.UI.RawUI.WindowTitle = 'Foliantica [backend]'
$E = [char]27
function cyan($t)   { "${E}[96m${t}${E}[0m" }
function gray($t)   { "${E}[90m${t}${E}[0m" }
function yellow($t) { "${E}[93m${t}${E}[0m" }

# -- Start embedded PostgreSQL -------------------------------------------------
Write-Host ""
Write-Host "  $(cyan 'PostgreSQL')  $(gray 'starting...')"

$pgLog  = "$env:TEMP\fol-dev-pg.log"
$pgData = "$env:APPDATA\Foliantica\pgdata"
"" | Set-Content $pgLog

$pgProc = Start-Process node `
    -ArgumentList "$Root\scripts\start-migration-pg.mjs", $pgData `
    -RedirectStandardOutput $pgLog `
    -RedirectStandardError  "$env:TEMP\fol-dev-pg-err.log" `
    -PassThru -NoNewWindow

$pgReady = $false
for ($i = 0; $i -lt 60; $i++) {
    Start-Sleep 1
    if ((Get-Content $pgLog -ErrorAction SilentlyContinue) -match 'READY') {
        $pgReady = $true; break
    }
}

if (-not $pgReady) {
    Write-Host "  $(yellow '[WARN]') PostgreSQL did not become ready - falling back to SQLite."
    Write-Host "         Check: $env:TEMP\fol-dev-pg-err.log"
    $env:LW_USE_SQLITE = '1'
} else {
    Write-Host "  $(cyan 'PostgreSQL')  $(gray 'ready on port 5433')"
    $env:LW_USE_SQLITE = '0'
    $env:LW_PG_PORT    = '5433'
    $env:LW_PG_USER    = 'foliantica'
    $env:LW_PG_PASS    = 'foliantica'
    $env:LW_PG_DB      = 'foliantica'
}
Write-Host ""

# -- Start FastAPI -------------------------------------------------------------
Set-Location "$Root\api"
try {
    & ".\.venv\Scripts\python.exe" run.py --dev
} finally {
    if ($pgProc -and -not $pgProc.HasExited) {
        Stop-Process $pgProc.Id -Force -ErrorAction SilentlyContinue
        Get-Process -Name postgres -ErrorAction SilentlyContinue |
            Stop-Process -Force -ErrorAction SilentlyContinue
    }
}

Read-Host "Stopped - press Enter to close"
