<#
.SYNOPSIS
    Foliantica PostgreSQL API test suite.

.DESCRIPTION
    Spins up an embedded PostgreSQL cluster, starts the FastAPI backend in PG
    mode, exercises every REST endpoint, then tears everything down cleanly.

    Run from the project root:
        .\test\run_pg_tests.ps1

    Requirements:
        - npm install (embedded-postgres must be present in node_modules)
        - api\.venv must exist (run `uv sync` inside api\)
        - Node.js on PATH
        - psycopg2-binary installed in the venv

    Exit code: 0 = all pass, 1 = any failure or startup error.
#>
param(
    [int]$PgStartTimeoutSec = 45,
    [int]$ApiStartTimeoutSec = 30,
    [int]$Port = 8765,
    [int]$PgPort = 5433
)

$ErrorActionPreference = "Stop"
$base  = "http://127.0.0.1:$Port"
$h     = @{ "Content-Type" = "application/json" }
$pass  = 0
$fail  = 0
$ROOT  = Split-Path $PSScriptRoot -Parent   # project root

# ── Helpers ──────────────────────────────────────────────────────────────────

function T {
    param([string]$Label, [scriptblock]$Body)
    try {
        $null = & $Body
        $script:pass++
        Write-Host ("PASS  " + $Label) -ForegroundColor Green
    } catch {
        $script:fail++
        $msg = $_.Exception.Message.Split("`n")[0]
        Write-Host ("FAIL  " + $Label + "  --  " + $msg) -ForegroundColor Red
    }
}

function WaitFor {
    param([string]$Name, [scriptblock]$Check, [int]$TimeoutSec)
    for ($i = 0; $i -lt $TimeoutSec; $i++) {
        Start-Sleep 1
        try { if (& $Check) { return $true } } catch {}
    }
    return $false
}

# ── Start embedded PostgreSQL ─────────────────────────────────────────────────

Write-Host ""
Write-Host "=== Foliantica PG Test Suite ===" -ForegroundColor Cyan
Write-Host "Starting embedded PostgreSQL on port $PgPort..." -ForegroundColor Cyan

$pgLog    = "$env:TEMP\foliantica-pg-test-stdout.log"
$pgErrLog = "$env:TEMP\foliantica-pg-test-stderr.log"
$pgScript = Join-Path $ROOT "scripts\start-test-pg.mjs"

Remove-Item $pgLog    -ErrorAction SilentlyContinue
Remove-Item $pgErrLog -ErrorAction SilentlyContinue

$pgProc = Start-Process node `
    -ArgumentList $pgScript `
    -RedirectStandardOutput $pgLog `
    -RedirectStandardError  $pgErrLog `
    -PassThru -NoNewWindow

$pgReady = WaitFor "PG" {
    (Get-Content $pgLog -ErrorAction SilentlyContinue) -match "READY"
} $PgStartTimeoutSec

if (-not $pgReady) {
    Write-Host "ERROR: PostgreSQL failed to start within ${PgStartTimeoutSec}s." -ForegroundColor Red
    Write-Host (Get-Content $pgErrLog -ErrorAction SilentlyContinue | Select-Object -Last 20 | Out-String)
    Stop-Process $pgProc.Id -Force -ErrorAction SilentlyContinue
    exit 1
}
Write-Host "PostgreSQL ready." -ForegroundColor Green

# ── Start FastAPI in PG mode ──────────────────────────────────────────────────

Write-Host "Starting FastAPI on port $Port (PG mode)..." -ForegroundColor Cyan

$apiLog    = "$env:TEMP\foliantica-api-pg-stdout.log"
$apiErrLog = "$env:TEMP\foliantica-api-pg-stderr.log"
$python    = Join-Path $ROOT "api\.venv\Scripts\python.exe"
$apiDir    = Join-Path $ROOT "api"

Remove-Item $apiLog    -ErrorAction SilentlyContinue
Remove-Item $apiErrLog -ErrorAction SilentlyContinue

# Set env vars for child process
$envBackup = @{}
$envVars = @{
    LW_USE_SQLITE      = "0"
    LW_PG_PORT         = [string]$PgPort
    LW_PG_USER         = "foliantica"
    LW_PG_PASS         = "foliantica"
    LW_PG_DB           = "foliantica"
    PYTHONIOENCODING   = "utf-8"
}
foreach ($k in $envVars.Keys) {
    $envBackup[$k] = [Environment]::GetEnvironmentVariable($k)
    [Environment]::SetEnvironmentVariable($k, $envVars[$k])
}

$apiProc = Start-Process $python `
    -ArgumentList "run.py" `
    -WorkingDirectory $apiDir `
    -RedirectStandardOutput $apiLog `
    -RedirectStandardError  $apiErrLog `
    -PassThru -NoNewWindow

$apiReady = WaitFor "API" {
    try { $null = Invoke-RestMethod "$base/api/health"; $true } catch { $false }
} $ApiStartTimeoutSec

if (-not $apiReady) {
    Write-Host "ERROR: FastAPI failed to start within ${ApiStartTimeoutSec}s." -ForegroundColor Red
    Write-Host (Get-Content $apiErrLog -ErrorAction SilentlyContinue | Select-Object -Last 30 | Out-String)
    Stop-Process $pgProc.Id  -Force -ErrorAction SilentlyContinue
    Stop-Process $apiProc.Id -Force -ErrorAction SilentlyContinue
    foreach ($k in $envBackup.Keys) { [Environment]::SetEnvironmentVariable($k, $envBackup[$k]) }
    exit 1
}
Write-Host "FastAPI ready." -ForegroundColor Green
Write-Host ""

# ── Tests ─────────────────────────────────────────────────────────────────────

try {

    # ── Settings ──────────────────────────────────────────────────────────────
    T "GET  /api/settings" {
        Invoke-RestMethod "$base/api/settings"
    }
    T "POST /api/settings (theme)" {
        Invoke-RestMethod "$base/api/settings" -Method Post -Headers $h `
            -Body '{"theme":"dark"}'
    }

    # ── Projects ──────────────────────────────────────────────────────────────
    $proj   = Invoke-RestMethod "$base/api/projects" -Method Post -Headers $h `
                  -Body '{"title":"PG Test Project"}'
    $projId = $proj.id

    T "POST /api/projects (create)"                 { $proj }   # already created above
    T "GET  /api/projects" {
        Invoke-RestMethod "$base/api/projects"
    }
    T "GET  /api/projects/:id" {
        Invoke-RestMethod "$base/api/projects/$projId"
    }
    T "PATCH /api/projects/:id" {
        Invoke-RestMethod "$base/api/projects/$projId" -Method Patch -Headers $h `
            -Body '{"description":"pg test desc"}'
    }
    T "GET  /api/projects/:id/structure" {
        Invoke-RestMethod "$base/api/projects/$projId/structure"
    }
    T "GET  /api/projects/series" {
        Invoke-RestMethod "$base/api/projects/series"
    }

    # ── Acts ──────────────────────────────────────────────────────────────────
    $act   = Invoke-RestMethod "$base/api/acts" -Method Post -Headers $h `
                 -Body (@{ project_id = $projId; title = "Act One" } | ConvertTo-Json)
    $actId = $act.id

    T "POST /api/acts (create)"                     { $act }
    T "GET  /api/projects/:id/acts" {
        Invoke-RestMethod "$base/api/projects/$projId/acts"
    }
    T "PATCH /api/acts/:id" {
        Invoke-RestMethod "$base/api/acts/$actId" -Method Patch -Headers $h `
            -Body '{"title":"Act I"}'
    }

    # ── Chapters ──────────────────────────────────────────────────────────────
    $ch   = Invoke-RestMethod "$base/api/chapters" -Method Post -Headers $h `
                -Body (@{ act_id = $actId; title = "Chapter One" } | ConvertTo-Json)
    $chId = $ch.id

    T "POST /api/chapters (create)"                 { $ch }
    T "GET  /api/acts/:id/chapters" {
        Invoke-RestMethod "$base/api/acts/$actId/chapters"
    }
    T "PATCH /api/chapters/:id" {
        Invoke-RestMethod "$base/api/chapters/$chId" -Method Patch -Headers $h `
            -Body '{"title":"Chapter I"}'
    }

    # ── Scenes ────────────────────────────────────────────────────────────────
    $scContent = "Aragorn walked into the hall, his sword drawn. Legolas followed close behind, arrow nocked."
    $sc   = Invoke-RestMethod "$base/api/scenes" -Method Post -Headers $h `
                -Body (@{ chapter_id = $chId; title = "Scene One"; content = $scContent } | ConvertTo-Json)
    $scId = $sc.id

    T "POST /api/scenes (create)"                   { $sc }
    T "GET  /api/chapters/:id/scenes" {
        Invoke-RestMethod "$base/api/chapters/$chId/scenes"
    }
    T "GET  /api/scenes/:id" {
        Invoke-RestMethod "$base/api/scenes/$scId"
    }
    T "PATCH /api/scenes/:id" {
        Invoke-RestMethod "$base/api/scenes/$scId" -Method Patch -Headers $h `
            -Body '{"content":"Aragorn raised his sword high and called to his men."}'
    }
    T "POST /api/scenes/:id/versions" {
        Invoke-RestMethod "$base/api/scenes/$scId/versions" -Method Post -Headers $h `
            -Body '{"content":"snapshot v1"}'
    }
    T "GET  /api/scenes/:id/versions" {
        Invoke-RestMethod "$base/api/scenes/$scId/versions"
    }
    T "GET  /api/projects/:id/writing-log" {
        Invoke-RestMethod "$base/api/projects/$projId/writing-log"
    }
    T "GET  /api/writing-log (global)" {
        Invoke-RestMethod "$base/api/writing-log"
    }
    T "GET  /api/projects/:id/scenes" {
        Invoke-RestMethod "$base/api/projects/$projId/scenes"
    }
    T "GET  /api/projects/:id/ghost-texts" {
        Invoke-RestMethod "$base/api/projects/$projId/ghost-texts"
    }
    T "GET  /api/projects/:id/pov-stats" {
        Invoke-RestMethod "$base/api/projects/$projId/pov-stats"
    }
    T "GET  /api/projects/:id/time-config" {
        Invoke-RestMethod "$base/api/projects/$projId/time-config"
    }

    # ── Codex ─────────────────────────────────────────────────────────────────
    $ce    = Invoke-RestMethod "$base/api/codex" -Method Post -Headers $h `
                 -Body (@{ project_id = $projId; name = "Aragorn"; entry_type = "character";
                           color = "#cc3300"; aliases = @(); tags = @("hero") } | ConvertTo-Json)
    $ceId  = $ce.id
    $ce2   = Invoke-RestMethod "$base/api/codex" -Method Post -Headers $h `
                 -Body (@{ project_id = $projId; name = "Legolas"; entry_type = "character";
                           color = "#00cc44"; aliases = @(); tags = @() } | ConvertTo-Json)
    $ce2Id = $ce2.id

    T "POST /api/codex (create Aragorn)"            { $ce }
    T "POST /api/codex (create Legolas)"            { $ce2 }
    T "GET  /api/projects/:id/codex" {
        Invoke-RestMethod "$base/api/projects/$projId/codex"
    }
    T "GET  /api/codex/:id" {
        Invoke-RestMethod "$base/api/codex/$ceId"
    }
    T "PATCH /api/codex/:id" {
        Invoke-RestMethod "$base/api/codex/$ceId" -Method Patch -Headers $h `
            -Body '{"description":"Heir of Isildur, rightful King of Gondor"}'
    }
    T "POST /api/codex/relations" {
        Invoke-RestMethod "$base/api/codex/relations" -Method Post -Headers $h `
            -Body (@{ source_id = $ceId; target_id = $ce2Id; relation_type = "ally" } | ConvertTo-Json)
    }
    T "GET  /api/codex/:id/relations" {
        Invoke-RestMethod "$base/api/codex/$ceId/relations"
    }
    T "POST /api/projects/:id/mentions/rescan" {
        Invoke-RestMethod "$base/api/projects/$projId/mentions/rescan" -Method Post
    }
    T "GET  /api/codex/:id/scene-mentions" {
        Invoke-RestMethod "$base/api/codex/$ceId/scene-mentions"
    }
    T "GET  /api/projects/:id/mention-stats" {
        Invoke-RestMethod "$base/api/projects/$projId/mention-stats"
    }
    T "GET  /api/scenes/:id/mention-stats" {
        Invoke-RestMethod "$base/api/scenes/$scId/mention-stats"
    }

    # ── Research ──────────────────────────────────────────────────────────────
    $ri   = Invoke-RestMethod "$base/api/projects/$projId/research" -Method Post -Headers $h `
                -Body '{"title":"Middle Earth Notes","text_content":"Research about Rohan"}'
    $riId = $ri.id

    T "POST /api/projects/:id/research (create)"    { $ri }
    T "GET  /api/projects/:id/research" {
        Invoke-RestMethod "$base/api/projects/$projId/research"
    }
    T "PATCH /api/research/:id" {
        Invoke-RestMethod "$base/api/research/$riId" -Method Patch -Headers $h `
            -Body '{"tags":["tolkien","lore"]}'
    }

    # ── Fragments ─────────────────────────────────────────────────────────────
    T "GET  /api/projects/:id/fragment-tabs" {
        Invoke-RestMethod "$base/api/projects/$projId/fragment-tabs"
    }
    $fr   = Invoke-RestMethod "$base/api/projects/$projId/fragments" -Method Post -Headers $h `
                -Body '{"tab":"snippets","title":"Opening Draft","content":"It was the best of times"}'
    $frId = $fr.id

    T "POST /api/projects/:id/fragments (create)"   { $fr }
    T "GET  /api/projects/:id/fragments" {
        Invoke-RestMethod "$base/api/projects/$projId/fragments"
    }
    T "GET  /api/projects/:id/fragments?tab=snippets" {
        Invoke-RestMethod "${base}/api/projects/${projId}/fragments?tab=snippets"
    }
    T "PATCH /api/fragments/:id" {
        Invoke-RestMethod "$base/api/fragments/$frId" -Method Patch -Headers $h `
            -Body '{"content":"It was the best of times, it was the worst of times"}'
    }

    # ── Analytics & Stats ─────────────────────────────────────────────────────
    T "GET  /api/projects/:id/analytics" {
        Invoke-RestMethod "$base/api/projects/$projId/analytics"
    }
    T "GET  /api/stats/totals" {
        Invoke-RestMethod "$base/api/stats/totals"
    }
    T "POST /api/stats/ping" {
        Invoke-RestMethod "$base/api/stats/ping" -Method Post
    }

    # ── Achievements ──────────────────────────────────────────────────────────
    T "GET  /api/achievements" {
        Invoke-RestMethod "$base/api/achievements"
    }

    # ── Sync ──────────────────────────────────────────────────────────────────
    T "GET  /api/sync/status (disabled)" {
        $s = Invoke-RestMethod "$base/api/sync/status"
        # Should start disabled — mirror hasn't been configured yet
        if ($s.mode -ne "disabled") { throw "Expected mode=disabled, got $($s.mode)" }
    }

    # Enable sync to a temp mirror dir
    $mirrorDir = "$env:TEMP\foliantica-sync-test"
    New-Item -ItemType Directory -Force $mirrorDir | Out-Null
    $syncBody = @{ sync_mirror_enabled = $true; sync_local_dir = $mirrorDir } | ConvertTo-Json
    T "POST /api/settings (enable sync)" {
        Invoke-RestMethod "$base/api/settings" -Method Post -Headers $h -Body $syncBody
    }

    # Trigger immediate dump and wait up to 10 s for the file to appear
    T "POST /api/sync/trigger" {
        Invoke-RestMethod "$base/api/sync/trigger" -Method Post
    }
    $dumpFile = "$mirrorDir\foliantica.sql"
    $dumpReady = $false
    for ($i = 0; $i -lt 10; $i++) {
        Start-Sleep 1
        if (Test-Path $dumpFile) { $dumpReady = $true; break }
    }
    T "dump file created after trigger" {
        if (-not $dumpReady) { throw "foliantica.sql not found in mirror dir after 10s" }
    }
    T "dump file contains INSERT statements" {
        $content = Get-Content $dumpFile -Raw -ErrorAction Stop
        if ($content -notmatch "INSERT INTO") { throw "No INSERT statements found in dump" }
    }
    T "dump file contains projects table" {
        $content = Get-Content $dumpFile -Raw
        if ($content -notmatch '"projects"') { throw "projects table missing from dump" }
    }
    T "dump file contains scenes table" {
        $content = Get-Content $dumpFile -Raw
        if ($content -notmatch '"scenes"') { throw "scenes table missing from dump" }
    }
    T "GET  /api/sync/status (online + last_sync_at set)" {
        $s = Invoke-RestMethod "$base/api/sync/status"
        if ($s.mode -ne "online") { throw "Expected mode=online, got $($s.mode)" }
        if (-not $s.last_sync_at) { throw "last_sync_at not set after sync" }
    }

    # Disable sync and clean up
    Invoke-RestMethod "$base/api/settings" -Method Post -Headers $h `
        -Body '{"sync_mirror_enabled": false}' | Out-Null
    Remove-Item -Recurse -Force $mirrorDir -ErrorAction SilentlyContinue

    # ── PG config (GET / POST / restore) ──────────────────────────────────────
    # Save original so we don't pollute ~/.foliantica/config.json
    $lwConfigPath = "$env:USERPROFILE\.foliantica\config.json"
    $lwConfigOrig = Get-Content $lwConfigPath -Raw -ErrorAction SilentlyContinue

    T "GET  /api/settings/pg-config (defaults)" {
        $c = Invoke-RestMethod "$base/api/settings/pg-config"
        if (-not $c.PSObject.Properties["useDocker"]) { throw "useDocker field missing" }
        if (-not $c.PSObject.Properties["port"])      { throw "port field missing" }
    }
    T "POST /api/settings/pg-config (save Docker config)" {
        $body = @{ useDocker=$true; host="127.0.0.1"; port=5434; user="foliantica"; pass="foliantica"; db="foliantica" } | ConvertTo-Json
        $saved = Invoke-RestMethod "$base/api/settings/pg-config" -Method Post -Headers $h -Body $body
        if (-not $saved.useDocker) { throw "useDocker should be true after save" }
        if ($saved.port -ne 5434)  { throw "Expected port 5434, got $($saved.port)" }
    }
    T "GET  /api/settings/pg-config (reads saved Docker config)" {
        $c = Invoke-RestMethod "$base/api/settings/pg-config"
        if (-not $c.useDocker) { throw "Expected useDocker=true after save" }
        if ($c.port -ne 5434)  { throw "Expected port 5434" }
    }
    # Restore original lw-config
    if ($lwConfigOrig) { Set-Content -Path $lwConfigPath -Value $lwConfigOrig -Encoding UTF8 }
    else { Remove-Item $lwConfigPath -ErrorAction SilentlyContinue }

    # ── PG transfer (live engine -> self: target = live embedded) ────────────
    # Source is always the live engine; only target is specified
    $transferBody = @{
        target = @{ host="127.0.0.1"; port=5433; user="foliantica"; pass="foliantica"; db="foliantica" }
    } | ConvertTo-Json -Depth 4

    T "POST /api/settings/pg-transfer (self-transfer returns counts)" {
        $r = Invoke-RestMethod "$base/api/settings/pg-transfer" -Method Post -Headers $h -Body $transferBody
        if ($r.tables_copied -lt 1)  { throw "Expected at least 1 table, got $($r.tables_copied)" }
        if ($r.rows_copied   -lt 1)  { throw "Expected at least 1 row, got $($r.rows_copied)" }
        if (-not $r.tables)          { throw "tables list missing" }
    }
    T "POST /api/settings/pg-transfer (tables include projects and scenes)" {
        $r = Invoke-RestMethod "$base/api/settings/pg-transfer" -Method Post -Headers $h -Body $transferBody
        if ($r.tables -notcontains "projects") { throw "'projects' not in transferred tables" }
        if ($r.tables -notcontains "scenes")   { throw "'scenes' not in transferred tables" }
    }
    T "POST /api/settings/pg-transfer (bad target returns 500)" {
        $badBody = @{
            target = @{ host="127.0.0.1"; port=9999; user="foliantica"; pass="foliantica"; db="foliantica" }
        } | ConvertTo-Json -Depth 4
        try {
            Invoke-RestMethod "$base/api/settings/pg-transfer" -Method Post -Headers $h -Body $badBody
            throw "Expected 500 but got success"
        } catch {
            if ($_.Exception.Response.StatusCode.value__ -ne 500) {
                throw "Expected HTTP 500, got $($_.Exception.Response.StatusCode.value__)"
            }
        }
    }

    # ── Timeline ──────────────────────────────────────────────────────────────
    $tt   = Invoke-RestMethod "$base/api/projects/$projId/timeline-tracks" -Method Post -Headers $h `
                -Body '{"name":"Main Timeline","color":"#6b7280","track_type":"parallel"}'
    $ttId = $tt.id

    T "POST /api/projects/:id/timeline-tracks (create)" { $tt }
    T "GET  /api/projects/:id/timeline-tracks" {
        Invoke-RestMethod "$base/api/projects/$projId/timeline-tracks"
    }
    $tevt = Invoke-RestMethod "$base/api/projects/$projId/timeline-events" -Method Post -Headers $h `
                -Body (@{ title = "Battle of Helms Deep"; track_id = $ttId; color = "#dd0000" } | ConvertTo-Json)
    T "POST /api/projects/:id/timeline-events (create)" { $tevt }
    T "GET  /api/projects/:id/timeline-events" {
        Invoke-RestMethod "$base/api/projects/$projId/timeline-events"
    }
    T "GET  /api/projects/:id/timeline-v2" {
        Invoke-RestMethod "$base/api/projects/$projId/timeline-v2"
    }

    # ── Submissions ───────────────────────────────────────────────────────────
    $sub = Invoke-RestMethod "$base/api/projects/$projId/submissions" -Method Post -Headers $h `
               -Body '{"agent_name":"Agent X","status":"queried","submission_type":"query"}'

    T "POST /api/projects/:id/submissions (create)" { $sub }
    T "GET  /api/projects/:id/submissions" {
        Invoke-RestMethod "$base/api/projects/$projId/submissions"
    }
    T "PATCH /api/submissions/:id" {
        Invoke-RestMethod "$base/api/submissions/$($sub.id)" -Method Patch -Headers $h `
            -Body '{"status":"pass"}'
    }

    # ── Export & Publishers ───────────────────────────────────────────────────
    T "GET  /api/projects/:id/export-profiles" {
        Invoke-RestMethod "$base/api/projects/$projId/export-profiles"
    }
    T "GET  /api/export/publishers" {
        Invoke-RestMethod "$base/api/export/publishers"
    }

    # ── Graph & Corkboard ─────────────────────────────────────────────────────
    T "GET  /api/projects/:id/corkboard" {
        Invoke-RestMethod "$base/api/projects/$projId/corkboard"
    }
    T "GET  /api/projects/:id/graph" {
        Invoke-RestMethod "$base/api/projects/$projId/graph"
    }

    # ── DELETE cascade (cleanup + verifies FK cascade) ────────────────────────
    $rels = Invoke-RestMethod "$base/api/codex/$ceId/relations"
    if ($rels.Count -gt 0) {
        T "DELETE /api/codex/relations/:id" {
            Invoke-RestMethod "$base/api/codex/relations/$($rels[0].id)" -Method Delete
        }
    }
    T "DELETE /api/codex/:id (Aragorn)" {
        Invoke-RestMethod "$base/api/codex/$ceId" -Method Delete
    }
    T "DELETE /api/codex/:id (Legolas)" {
        Invoke-RestMethod "$base/api/codex/$ce2Id" -Method Delete
    }
    T "DELETE /api/research/:id" {
        Invoke-RestMethod "$base/api/research/$riId" -Method Delete
    }
    T "DELETE /api/fragments/:id" {
        Invoke-RestMethod "$base/api/fragments/$frId" -Method Delete
    }
    T "DELETE /api/scenes/:id" {
        Invoke-RestMethod "$base/api/scenes/$scId" -Method Delete
    }
    T "DELETE /api/chapters/:id" {
        Invoke-RestMethod "$base/api/chapters/$chId" -Method Delete
    }
    T "DELETE /api/acts/:id" {
        Invoke-RestMethod "$base/api/acts/$actId" -Method Delete
    }
    T "DELETE /api/projects/:id" {
        Invoke-RestMethod "$base/api/projects/$projId" -Method Delete
    }

} finally {
    # ── Teardown ──────────────────────────────────────────────────────────────
    Write-Host ""
    Write-Host "Stopping API and PostgreSQL..." -ForegroundColor Cyan

    # Restore environment variables
    foreach ($k in $envBackup.Keys) {
        [Environment]::SetEnvironmentVariable($k, $envBackup[$k])
    }

    # Stop FastAPI
    Stop-Process $apiProc.Id -Force -ErrorAction SilentlyContinue

    # Stop the PG helper process; embedded-postgres shuts down the cluster on SIGTERM
    Stop-Process $pgProc.Id -Force -ErrorAction SilentlyContinue

    # Belt-and-suspenders: kill any stray postgres.exe workers
    Get-Process -Name postgres -ErrorAction SilentlyContinue |
        Stop-Process -Force -ErrorAction SilentlyContinue

    # Remove the ephemeral PG cluster (start-test-pg.mjs uses persistent: false,
    # but the directory may persist if the process was force-killed)
    $pgDataDir = Join-Path $env:TEMP "foliantica-pg-test"
    Remove-Item -Recurse -Force $pgDataDir -ErrorAction SilentlyContinue

    Write-Host "Done." -ForegroundColor Cyan
}

# ── Summary ───────────────────────────────────────────────────────────────────
Write-Host ""
if ($fail -eq 0) {
    Write-Host "=== ALL $pass TESTS PASSED ===" -ForegroundColor Green
    exit 0
} else {
    Write-Host "=== $pass passed  /  $fail FAILED ===" -ForegroundColor Red
    exit 1
}
