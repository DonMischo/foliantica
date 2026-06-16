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
    Write-Host "  $(bold (cyan "Foliantica"))  -  Start (no install/build)"
    Write-Host ""
    Write-Host "  $(white "Usage:")  $(yellow "StartFoliantica.bat") $(gray "[-Help]")"
    Write-Host ""
    Write-Host "  $(white "What it does:")"
    Write-Host "    $(gray "- Starts the existing build as-is - no dependency install, no rebuild")"
    Write-Host "    $(gray "- Opens two windows: backend (8765, no reload) + frontend (3000)")"
    Write-Host ""
    Write-Host "  $(white "First time, or after pulling new code:")"
    Write-Host "    $(gray "Run") $(yellow "LaunchFoliantica.bat") $(gray "instead - it installs deps and builds.")"
    Write-Host ""
    exit 0
}

Write-Host ""
Write-Host "  $(bold (cyan "Foliantica"))  $(gray "(start)")"
Write-Host "  $(gray "-------------------------------------")"
Write-Host ""

# -- Verify a build already exists ----------------------------------------------
$venvPath      = Join-Path $Root "api\.venv"
$standaloneSrv = Join-Path $Root "web\.next\standalone\server.js"

if (-not (Test-Path $venvPath) -or -not (Test-Path $standaloneSrv)) {
    Write-Host "  $(red "[ERROR]") No existing install/build found."
    Write-Host "         Run $(yellow "LaunchFoliantica.bat") first to install dependencies and build."
    Read-Host "`nPress Enter to exit"
    exit 1
}

# -- Docker services (LanguageTool + Pandoc) -----------------------------------
Write-Host "  $(white "Starting Docker services...")"
if (Get-Command docker -ErrorAction SilentlyContinue) {
    Push-Location $Root
    docker compose up -d
    Pop-Location
    if ($LASTEXITCODE -ne 0) {
        Write-Host "  $(yellow "[WARN]") Docker services failed to start - grammar check and export may be unavailable."
    }
} else {
    Write-Host "  $(yellow "[WARN]") Docker not found - LanguageTool and Pandoc skipped."
}
Write-Host ""

# -- Launch --------------------------------------------------------------------
Write-Host "  $(white "App")    $(cyan "http://localhost:3000")"
Write-Host "  $(white "API")    $(cyan "http://localhost:8765")  $(gray "(Swagger: /docs)")"
Write-Host "  $(gray "-------------------------------------")"
Write-Host "  $(gray "Two windows will open. Close them to stop.")"
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
    "-WebDir", $webDir,
    "-SkipBuild"
)
