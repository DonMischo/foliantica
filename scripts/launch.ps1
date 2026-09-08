<#
  Foliantica production launcher.

  First run (or after pulling new code): installs/updates Python + npm
  dependencies and builds the Next.js frontend. Every run after that:
  starts the existing build as-is - fast, no reinstall, no rebuild.

  Called by LaunchFoliantica.bat (thin wrapper - keep all real logic here,
  not in the .bat, to avoid the .bat/PowerShell encoding pitfalls that
  bit the old polyglot launcher scripts).
#>
param([switch]$Help, [switch]$ForceInstall, [int]$Port = 3000)

$Root = Split-Path -Parent $PSScriptRoot

# -- Colours -------------------------------------------------------------------
$E = [char]27
function co($code, $text) { "${E}[${code}m${text}${E}[0m" }
function cyan($t)   { co 96 $t }
function white($t)  { co 97 $t }
function gray($t)   { co 90 $t }
function yellow($t) { co 93 $t }
function red($t)    { co 91 $t }
function bold($t)   { co  1 $t }

# -- Help ----------------------------------------------------------------------
if ($Help) {
    Write-Host ""
    Write-Host "  $(bold (cyan "Foliantica"))  -  Launcher (production)"
    Write-Host ""
    Write-Host "  $(white "Usage:")  $(yellow "LaunchFoliantica.bat") $(gray "[-ForceInstall] [-Port <n>] [-Help]")"
    Write-Host ""
    Write-Host "  $(white "What it does:")"
    Write-Host "    $(gray "- First run (or after pulling new code): installs/updates Python +")"
    Write-Host "    $(gray "  npm dependencies, builds the Next.js frontend for production")"
    Write-Host "    $(gray "- Every run after that: starts the existing build as-is - fast,")"
    Write-Host "    $(gray "  no reinstall, no rebuild")"
    Write-Host "    $(gray "- Opens two windows: backend (8765, no reload) + frontend (3000 by default)")"
    Write-Host ""
    Write-Host "  $(white "-ForceInstall")  $(gray "Re-run the install/build steps even if a build already exists")"
    Write-Host "                 $(gray "(use after pulling new code if something seems stale).")"
    Write-Host ""
    Write-Host "  $(white "-Port <n>")     $(gray "Frontend port (default: 3000). Use this if 3000 collides")"
    Write-Host "                 $(gray "with another project on your machine, e.g.: LaunchFoliantica.bat -Port 3300")"
    Write-Host ""
    Write-Host "  $(white "Prerequisites:")"
    Write-Host "    uv    $(cyan "https://docs.astral.sh/uv/")"
    Write-Host "    Node  $(cyan "https://nodejs.org/")"
    Write-Host ""
    Write-Host "  $(white "Data folder:")  $(gray "Configure in the Settings page inside the app.")"
    Write-Host ""
    Write-Host "  $(gray "For hot-reload development, use LaunchFoliantica_dev.bat instead.")"
    Write-Host ""
    exit 0
}

Write-Host ""
Write-Host "  $(bold (cyan "Foliantica"))  $(gray "(production)")"
Write-Host "  $(gray "-------------------------------------")"
Write-Host ""

# -- Prerequisites -------------------------------------------------------------
if (-not (Get-Command uv -ErrorAction SilentlyContinue)) {
    Write-Host "  $(red "[ERROR]") uv not found."
    Write-Host "         Install: $(cyan "https://docs.astral.sh/uv/")"
    Write-Host "         or run:  $(yellow "irm https://astral.sh/uv/install.ps1 | iex")"
    Read-Host "`nPress Enter to exit"
    exit 1
}
if (-not (Get-Command node -ErrorAction SilentlyContinue)) {
    Write-Host "  $(red "[ERROR]") Node.js not found. Install from $(cyan "https://nodejs.org/")"
    Read-Host "`nPress Enter to exit"
    exit 1
}

# -- Decide install vs. fast-start ----------------------------------------------
# A build is considered present when a *working* venv and the standalone Next.js
# server both already exist. -ForceInstall always takes the slow path.
# The venv must actually run: a python.exe blocked by Windows Smart App Control
# still passes Test-Path, and treating that as "built" would fast-start straight
# into a backend that cannot boot.
$venvPath      = Join-Path $Root "api\.venv"
$standaloneSrv = Join-Path $Root "web\.next\standalone\server.js"
$venvPython    = Join-Path $venvPath "Scripts\python.exe"

$venvUsable = $false
if (Test-Path $venvPython) {
    try {
        & $venvPython -c "pass" 2>$null
        $venvUsable = ($LASTEXITCODE -eq 0)
    } catch {
        $venvUsable = $false
    }
}

$alreadyBuilt  = $venvUsable -and (Test-Path $standaloneSrv)
$needsInstall  = $ForceInstall -or (-not $alreadyBuilt)

if ($needsInstall) {
    Write-Host "  $(white "No existing build found - installing dependencies and building...")"
    Write-Host ""

    # -- Python venv -------------------------------------------------------------
    # Built with the stdlib venv module, not "uv venv": uv writes a small
    # trampoline python.exe that Windows Smart App Control blocks (unsigned, no
    # reputation), which makes every later "uv pip install" fail with
    # "Failed to inspect Python interpreter". The stdlib module copies the real
    # interpreter instead, which SAC allows.
    # A venv whose python.exe cannot run ($venvUsable, checked above) is rebuilt
    # rather than reused, so a previously blocked environment heals itself.
    if (-not $venvUsable) {
        if (Test-Path $venvPath) {
            Write-Host "  $(white "Python environment is unusable - rebuilding it...")"
            Remove-Item -Recurse -Force $venvPath
        } else {
            Write-Host "  $(white "Creating Python environment...")"
        }
        $basePython = (& uv python find 3.14 | Select-Object -First 1)
        if (-not $basePython) { $basePython = (& uv python find | Select-Object -First 1) }
        & "$($basePython.Trim())" -m venv $venvPath
        Write-Host ""
    }

    Write-Host "  $(white "Checking Python dependencies...")"
    Push-Location (Join-Path $Root "api")
    uv pip install -e .
    Pop-Location
    Write-Host ""

    # -- npm packages --------------------------------------------------------------
    Write-Host "  $(white "Checking npm packages...")"
    Push-Location (Join-Path $Root "web")
    npm install
    Pop-Location
    Write-Host ""

    # -- Clear Next.js cache -------------------------------------------------------
    $nextCache = Join-Path $Root "web\.next"
    if (Test-Path $nextCache) {
        Write-Host "  $(white "Clearing Next.js cache...")"
        Remove-Item -Recurse -Force $nextCache
        Write-Host ""
    }
} else {
    Write-Host "  $(gray "Existing build found - starting (use -ForceInstall to reinstall/rebuild).")"
    Write-Host ""
}

# -- Docker services (LanguageTool + Pandoc + Calibre + spaCy + Vale) -----------
Write-Host "  $(white "Starting Docker services...")"
if (Get-Command docker -ErrorAction SilentlyContinue) {
    Push-Location $Root
    if ($needsInstall) {
        docker compose --profile languagetool --profile pandoc --profile calibre --profile spacy --profile vale up --build -d
    } else {
        docker compose --profile languagetool --profile pandoc --profile calibre --profile spacy --profile vale up -d
    }
    Pop-Location
    if ($LASTEXITCODE -ne 0) {
        Write-Host "  $(yellow "[WARN]") Docker services failed to start - grammar check and export may be unavailable."
    }
} else {
    Write-Host "  $(yellow "[WARN]") Docker not found - LanguageTool and Pandoc skipped."
    Write-Host "         Install Docker Desktop: $(cyan "https://www.docker.com/products/docker-desktop/")"
}
Write-Host ""

# -- Launch --------------------------------------------------------------------
Write-Host "  $(white "App")    $(cyan "http://localhost:$Port")"
Write-Host "  $(white "API")    $(cyan "http://localhost:8765")  $(gray "(Swagger: /docs)")"
Write-Host "  $(gray "-------------------------------------")"
Write-Host "  $(gray "Two windows will open. Close them to stop.")"
Write-Host "  $(gray "Data folder: configure in the Settings page.")"
Write-Host ""

$webDir = Join-Path $Root "web"

# The backend needs to know the frontend's port too: collab.py's WebSocket
# auth trusts the host's own page by checking its Origin against LW_WEB_PORT
# (see _origin_matches_web_port) - without this, a non-default -Port here
# silently breaks that check and the collab WebSocket gets rejected.
# Start-Process inherits the current environment, so setting it here is
# enough to reach the backend process started below.
$env:LW_WEB_PORT = [string]$Port

Start-Process powershell -ArgumentList @(
    "-NoProfile", "-ExecutionPolicy", "Bypass",
    "-File", "$Root\scripts\prod-backend.ps1",
    "-Root", $Root
)

Start-Sleep -Seconds 1

$frontendArgs = @(
    "-NoProfile", "-ExecutionPolicy", "Bypass",
    "-File", "$Root\scripts\prod-frontend.ps1",
    "-WebDir", $webDir,
    "-Port", $Port
)
if (-not $needsInstall) { $frontendArgs += "-SkipBuild" }

Start-Process powershell -ArgumentList $frontendArgs
