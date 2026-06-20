<#
  Foliantica - full local build (Windows).

  Steps
    1. Install Electron dependencies
    2. Build Next.js standalone
    3. Build FastAPI backend (PyInstaller)
    4. Build Electron app LOCALLY (unpacked) - verify before packaging
    5. Build Windows installer (.exe)

  Called by build.bat (thin wrapper) and directly by release.ps1's
  "Build only" option. Also the entry point CI calls on every tag push
  (.github\workflows\build.yml -> cmd /c build.bat) - must stay fully
  non-interactive whenever $env:CI is set, exactly like the original.
#>

$Root = Split-Path -Parent $PSScriptRoot
$ErrorActionPreference = "Stop"

function Fail($message) {
    Write-Host "[ERROR] $message"
    if (-not $env:CI) { Read-Host "Press Enter to exit" }
    exit 1
}

# ── Locate (and install) Node.js ─────────────────────────────────────────────
$node = Get-Command node -ErrorAction SilentlyContinue
if (-not $node) {
    $candidates = @(
        "$env:ProgramFiles\nodejs\node.exe",
        "${env:ProgramFiles(x86)}\nodejs\node.exe",
        "$env:LOCALAPPDATA\Programs\nodejs\node.exe",
        "$env:APPDATA\npm\node.exe"
    )
    $found = $candidates | Where-Object { Test-Path $_ } | Select-Object -First 1
    if (-not $found) {
        foreach ($nvmRoot in @("$env:APPDATA\nvm", "$env:LOCALAPPDATA\nvm")) {
            if (Test-Path $nvmRoot) {
                $found = Get-ChildItem -Path $nvmRoot -Filter "node.exe" -Recurse -ErrorAction SilentlyContinue |
                    Sort-Object FullName -Descending | Select-Object -First 1 -ExpandProperty FullName
                if ($found) { break }
            }
        }
    }
    if ($found) {
        $env:PATH = "$(Split-Path $found);$env:PATH"
        $node = Get-Command node -ErrorAction SilentlyContinue
    }
}
if (-not $node) {
    Write-Host "Node.js not found. Attempting to install via winget..."
    if (-not (Get-Command winget -ErrorAction SilentlyContinue)) {
        Fail "winget not available. Please install Node.js 20+ from https://nodejs.org"
    }
    winget install --id OpenJS.NodeJS.LTS --silent --accept-source-agreements --accept-package-agreements
    if ($LASTEXITCODE -ne 0) { Fail "winget install failed. Please install Node.js 20+ from https://nodejs.org" }
    $machinePath = [System.Environment]::GetEnvironmentVariable("PATH", "Machine")
    $userPath    = [System.Environment]::GetEnvironmentVariable("PATH", "User")
    $env:PATH = "$userPath;$machinePath;$env:PATH"
    $node = Get-Command node -ErrorAction SilentlyContinue
    if (-not $node) { Fail "Node.js installed but still not found - please restart and try again." }
}
Write-Host "Using Node.js $(node --version) at $($node.Source)"
Write-Host ""

# ── Locate (and install) Python ──────────────────────────────────────────────
$python = Get-Command python -ErrorAction SilentlyContinue
if (-not $python) {
    $candidates = @(
        "$env:LOCALAPPDATA\Programs\Python\Python311\python.exe",
        "$env:LOCALAPPDATA\Programs\Python\Python312\python.exe",
        "$env:ProgramFiles\Python311\python.exe",
        "$env:ProgramFiles\Python312\python.exe"
    )
    $found = $candidates | Where-Object { Test-Path $_ } | Select-Object -First 1
    if ($found) {
        $env:PATH = "$(Split-Path $found);$env:PATH"
        $python = Get-Command python -ErrorAction SilentlyContinue
    }
}
if (-not $python) {
    Write-Host "Python not found. Attempting to install via winget..."
    if (-not (Get-Command winget -ErrorAction SilentlyContinue)) {
        Fail "winget not available. Please install Python 3.11+ from https://python.org"
    }
    winget install --id Python.Python.3.11 --silent --accept-source-agreements --accept-package-agreements
    if ($LASTEXITCODE -ne 0) { Fail "winget install failed. Please install Python 3.11+ from https://python.org" }
    $machinePath = [System.Environment]::GetEnvironmentVariable("PATH", "Machine")
    $userPath    = [System.Environment]::GetEnvironmentVariable("PATH", "User")
    $env:PATH = "$userPath;$machinePath;$env:PATH"
    $python = Get-Command python -ErrorAction SilentlyContinue
    if (-not $python) { Fail "Python installed but not found - please restart and try again." }
}
Write-Host "Using $(python --version) at $($python.Source)"
Write-Host ""

# ── Step 1/5 - Electron dependencies ──────────────────────────────────────────
Write-Host ""
Write-Host "[1/5] Installing Electron dependencies..."
Set-Location $Root
if (Test-Path "node_modules") { Remove-Item -Recurse -Force "node_modules" }
npm install
if ($LASTEXITCODE -ne 0) { Fail "npm install failed" }
Write-Host "OK  Electron deps installed"

# ── Step 2/5 - Next.js standalone build ───────────────────────────────────────
Write-Host ""
Write-Host "[2/5] Building Next.js (standalone)..."
Set-Location (Join-Path $Root "web")
if (Test-Path "node_modules") { Remove-Item -Recurse -Force "node_modules" }
npm install
if ($LASTEXITCODE -ne 0) { Fail "web npm install failed" }
npm run build
if ($LASTEXITCODE -ne 0) { Fail "Next.js build failed" }

# Copy static assets into standalone output.
# Next.js nests under "web\" when a parent node_modules exists; detect the layout.
$nestedStandalone = Test-Path ".next\standalone\web"
if ($nestedStandalone) {
    Copy-Item ".next\static" ".next\standalone\web\.next\static" -Recurse -Force
    if (Test-Path "public") { Copy-Item "public" ".next\standalone\web\public" -Recurse -Force }
} else {
    Copy-Item ".next\static" ".next\standalone\.next\static" -Recurse -Force
    if (Test-Path "public") { Copy-Item "public" ".next\standalone\public" -Recurse -Force }
}

# Stage into .next-standalone\ (flat, regardless of Next.js nesting layout)
Set-Location $Root
if (Test-Path ".next-standalone") { Remove-Item -Recurse -Force ".next-standalone" }
$standaloneSrc = if (Test-Path "web\.next\standalone\web") { "web\.next\standalone\web" } else { "web\.next\standalone" }
Copy-Item $standaloneSrc ".next-standalone" -Recurse -Force
Copy-Item "web\server-wrapper.js" ".next-standalone\server-wrapper.js" -Force
Write-Host "OK  Next.js standalone staged -> .next-standalone\"

# ── Step 3/5 - FastAPI backend (PyInstaller via uv or pip) ───────────────────
Write-Host ""
Write-Host "[3/5] Building FastAPI backend with PyInstaller..."
Set-Location (Join-Path $Root "api")

$uv = Get-Command uv -ErrorAction SilentlyContinue
if (-not $uv) {
    foreach ($p in @("$env:USERPROFILE\.local\bin\uv.exe", "$env:USERPROFILE\.cargo\bin\uv.exe")) {
        if (Test-Path $p) { $uv = Get-Item $p; break }
    }
}
if (-not $uv) {
    Write-Host "  uv not found - installing..."
    Invoke-RestMethod 'https://astral.sh/uv/install.ps1' | Invoke-Expression
    $env:PATH = "$env:USERPROFILE\.local\bin;$env:PATH"
    $uv = Get-Command uv -ErrorAction SilentlyContinue
}

$distPath = Join-Path $Root "api-dist-tmp"
$workPath = Join-Path $Root ".pyinstaller-work"

if ($uv) {
    Write-Host "  Using uv: $($uv.Source)"
    & $uv.Source sync
    if ($LASTEXITCODE -ne 0) { Fail "uv sync failed" }
    & $uv.Source pip install pyinstaller
    if ($LASTEXITCODE -ne 0) { Fail "uv pip install pyinstaller failed" }
    & $uv.Source run pyinstaller foliantica.spec --distpath $distPath --workpath $workPath --clean --noconfirm
    if ($LASTEXITCODE -ne 0) { Fail "PyInstaller failed" }
} else {
    Write-Host "  uv not available - falling back to pip"
    python -m pip install .
    if ($LASTEXITCODE -ne 0) { Fail "pip install failed" }
    python -m pip install pyinstaller
    if ($LASTEXITCODE -ne 0) { Fail "pip install pyinstaller failed" }
    python -m PyInstaller foliantica.spec --distpath $distPath --workpath $workPath --clean --noconfirm
    if ($LASTEXITCODE -ne 0) { Fail "PyInstaller failed" }
}

# Stage flat api-dist\
Set-Location $Root
if (Test-Path "api-dist") { Remove-Item -Recurse -Force "api-dist" }
Move-Item "api-dist-tmp\foliantica-api" "api-dist"
Remove-Item -Recurse -Force "api-dist-tmp"
Write-Host "OK  API binary staged -> api-dist\"

# ── Step 4/5 - Local (unpacked) Electron app ──────────────────────────────────
# Builds an unpackaged copy you can run and test before creating the
# installer. Output goes to dist\win-unpacked\Foliantica.exe
Write-Host ""
Write-Host "[4/5] Building Electron app locally (unpacked, no installer)..."
Set-Location $Root
npx electron-builder --win --dir --publish never
if ($LASTEXITCODE -ne 0) { Fail "Local Electron build failed" }
Write-Host "OK  Local app built"
Write-Host ""
Write-Host "  > dist\win-unpacked\Foliantica.exe"
Write-Host ""

if ($env:CI) {
    Write-Host "[CI] Skipping interactive test step."
} else {
    $test = Read-Host "Test the app now, then press Enter to continue with installer - or type N to stop"
    if ($test -match '^[Nn]$') {
        Write-Host ""
        Write-Host "Stopped after local build. Installer was not created."
        Write-Host "Local app:  $Root\dist\win-unpacked\Foliantica.exe"
        Write-Host ""
        if (-not $env:CI) { Read-Host "Press Enter to exit" }
        exit 0
    }
}

# ── Step 5/5 - Windows installer (.exe via NSIS) ──────────────────────────────
Write-Host ""
Write-Host "[5/5] Packaging Windows installer..."
Set-Location $Root
npm run dist:win -- --publish never
if ($LASTEXITCODE -ne 0) { Fail "electron-builder installer failed" }

Write-Host ""
Write-Host "========================================================================"
Write-Host "  Build complete!"
Write-Host ""
Write-Host "  Local app  :  dist\win-unpacked\Foliantica.exe"
Write-Host "  Installer  :  dist\*.exe   (NSIS)"
Write-Host "========================================================================"
Write-Host ""
if (-not $env:CI) { Read-Host "Press Enter to exit" }
