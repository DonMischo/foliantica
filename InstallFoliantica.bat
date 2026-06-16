@echo off
set "SELF=%~f0"
powershell -NoProfile -ExecutionPolicy Bypass -Command "$s=(gc -LiteralPath $env:SELF -Raw -Encoding UTF8) -replace '(?s)^.*?rem __PS__\r?\n',''; & ([scriptblock]::Create($s)) @args" %*
exit /b
rem __PS__
param([switch]$Help)

$Root = Split-Path -Parent $env:SELF

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
    Write-Host "  $(white "Usage:")  $(yellow "LaunchFoliantica.bat") $(gray "[-Help]")"
    Write-Host ""
    Write-Host "  $(white "What it does:")"
    Write-Host "    $(gray "- Creates api\.venv on first run")"
    Write-Host "    $(gray "- Installs/updates Python deps via uv")"
    Write-Host "    $(gray "- Installs npm packages")"
    Write-Host "    $(gray "- Builds the Next.js frontend for production")"
    Write-Host "    $(gray "- Opens two windows: backend (8765, no reload) + frontend (3000)")"
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

# -- Python venv ---------------------------------------------------------------
$venvPath = Join-Path $Root "api\.venv"
if (-not (Test-Path $venvPath)) {
    Write-Host "  $(white "Creating Python environment...")"
    uv venv $venvPath
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

# -- Docker services (LanguageTool + Pandoc) -----------------------------------
Write-Host "  $(white "Starting Docker services...")"
if (Get-Command docker -ErrorAction SilentlyContinue) {
    Push-Location $Root
    docker compose up --build -d
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
Write-Host "  $(white "App")    $(cyan "http://localhost:3000")"
Write-Host "  $(white "API")    $(cyan "http://localhost:8765")  $(gray "(Swagger: /docs)")"
Write-Host "  $(gray "-------------------------------------")"
Write-Host "  $(gray "Two windows will open. Close them to stop.")"
Write-Host "  $(gray "Data folder: configure in the Settings page.")"
Write-Host ""

$webDir = Join-Path $Root "web"

Start-Process powershell -ArgumentList @(
    "-NoProfile", "-ExecutionPolicy", "Bypass",
    "-File", "$Root\scripts\prod-backend.ps1",
    "-Root", $Root
)

Start-Sleep -Seconds 1

Start-Process powershell -ArgumentList @(
    "-NoProfile", "-ExecutionPolicy", "Bypass",
    "-File", "$Root\scripts\prod-frontend.ps1",
    "-WebDir", $webDir
)
