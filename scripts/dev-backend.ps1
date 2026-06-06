<#
  Backend dev launcher - starts PostgreSQL (embedded or Docker), then FastAPI.
  Called by LaunchFoliantica.bat.  Closing this window shuts down both.
#>
param([string]$Root)

$host.UI.RawUI.WindowTitle = 'Foliantica [backend]'
$E = [char]27
function cyan($t)   { "${E}[96m${t}${E}[0m" }
function gray($t)   { "${E}[90m${t}${E}[0m" }
function yellow($t) { "${E}[93m${t}${E}[0m" }
function green($t)  { "${E}[92m${t}${E}[0m" }

# -- Helpers ------------------------------------------------------------------
function DockerResponsive {
    try { $null = docker info 2>$null; return ($LASTEXITCODE -eq 0) }
    catch { return $false }
}

function EnsureDockerRunning {
    if (DockerResponsive) { return $true }

    Write-Host "  $(yellow 'Docker not running - starting Docker Desktop...')"

    $candidates = @(
        "$env:PROGRAMFILES\Docker\Docker\Docker Desktop.exe",
        "$env:LOCALAPPDATA\Programs\Docker\Docker\Docker Desktop.exe"
    )
    $exe = $candidates | Where-Object { Test-Path $_ } | Select-Object -First 1
    if (-not $exe) {
        Write-Host "  $(yellow '[WARN]') Docker Desktop not found. Install from https://www.docker.com/"
        return $false
    }

    Start-Process $exe
    Write-Host "  $(gray 'Waiting for Docker daemon (up to 90 s)...')"
    for ($i = 0; $i -lt 90; $i++) {
        Start-Sleep 1
        if (DockerResponsive) {
            Write-Host "  $(green 'Docker ready.')"
            return $true
        }
    }
    Write-Host "  $(yellow '[WARN]') Docker did not become ready in 90 s."
    return $false
}

function WaitForPgContainer($containerName, $pgUser, $timeoutSec) {
    Write-Host "  $(gray 'Waiting for container to accept connections...')"
    for ($i = 0; $i -lt $timeoutSec; $i++) {
        Start-Sleep 1
        $result = docker exec $containerName pg_isready -U $pgUser 2>$null
        if ($LASTEXITCODE -eq 0) { return $true }
    }
    return $false
}

# -- Read ~/.foliantica/config.json for optional Docker PG override ------------
$lwConfig    = "$env:USERPROFILE\.foliantica\config.json"
$pgCfg       = $null
$useDockerPg = $false
if (Test-Path $lwConfig) {
    try {
        $parsed = Get-Content $lwConfig -Raw | ConvertFrom-Json
        if ($parsed.pg -and $parsed.pg.useDocker) {
            $pgCfg       = $parsed.pg
            $useDockerPg = $true
        }
    } catch {}
}

$pgProc = $null

Write-Host ""

if ($useDockerPg) {
    # -- Docker PG mode --------------------------------------------------------
    $pgPort = if ($pgCfg.port) { [string]$pgCfg.port } else { "5434" }
    $pgHost = if ($pgCfg.host) { $pgCfg.host }          else { "127.0.0.1" }
    $pgUser = if ($pgCfg.user) { $pgCfg.user }          else { "foliantica" }
    $pgPass = if ($pgCfg.pass) { $pgCfg.pass }          else { "foliantica" }
    $pgDb   = if ($pgCfg.db)   { $pgCfg.db }            else { "foliantica" }

    Write-Host "  $(cyan 'PostgreSQL')  $(gray "Docker mode - ${pgHost}:${pgPort}")"

    # Ensure Docker is running, then bring up the postgres container
    if (EnsureDockerRunning) {
        Write-Host "  $(gray 'Starting foliantica-postgres container...')"
        docker compose --profile postgres up -d 2>$null | Out-Null

        $containerUp = WaitForPgContainer "foliantica-postgres" $pgUser 30
        if ($containerUp) {
            Write-Host "  $(cyan 'PostgreSQL')  $(green "ready on port ${pgPort}")"
        } else {
            Write-Host "  $(yellow '[WARN]') Container not ready after 30 s - API will retry on its own.')"
        }
    } else {
        Write-Host "  $(yellow '[WARN]') Could not start Docker. API will keep retrying for 60 s.')"
    }

    $env:LW_USE_SQLITE = '0'
    $env:LW_PG_HOST    = $pgHost
    $env:LW_PG_PORT    = $pgPort
    $env:LW_PG_USER    = $pgUser
    $env:LW_PG_PASS    = $pgPass
    $env:LW_PG_DB      = $pgDb

} else {
    # -- Embedded PG mode: start local cluster ---------------------------------
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
        Write-Host "  $(cyan 'PostgreSQL')  $(green 'ready on port 5433')"
        $env:LW_USE_SQLITE = '0'
        $env:LW_PG_HOST    = '127.0.0.1'
        $env:LW_PG_PORT    = '5433'
        $env:LW_PG_USER    = 'foliantica'
        $env:LW_PG_PASS    = 'foliantica'
        $env:LW_PG_DB      = 'foliantica'
    }
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
