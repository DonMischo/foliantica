<#
  Foliantica build / release entry point.

  build.bat itself stays a plain, non-interactive build script (CI calls it
  directly on every tag push - see .github\workflows\build.yml), so it can't
  gain a prompt of its own. This script is the one place a developer chooses
  between "build only" (delegates straight to build.bat) and "release"
  (bump version, validate build, commit, tag, push - CI does the real
  packaging once the tag lands).

  Called by release.bat (thin wrapper).
#>

$Root = Split-Path -Parent $PSScriptRoot

Write-Host ""
Write-Host "============================================================"
Write-Host "  Foliantica Build / Release"
Write-Host "============================================================"
Write-Host ""
Write-Host "  [1] Build only   -> local installer, no version bump or git push"
Write-Host "  [2] Release      -> bump version, validate build, commit, tag, push"
Write-Host "  [Q] Quit"
Write-Host ""
$choice = Read-Host "Choose [1/2/Q]"

if ($choice -eq "Q" -or $choice -eq "q") { exit 0 }

if ($choice -eq "1") {
    & "$PSScriptRoot\build.ps1"
    exit $LASTEXITCODE
}

if ($choice -ne "2") {
    Write-Host "Invalid choice."
    exit 1
}

# -- Node.js check ---------------------------------------------------------
if (-not (Get-Command node -ErrorAction SilentlyContinue)) {
    Write-Host "[ERROR] Node.js not found. Install from https://nodejs.org/"
    Write-Host "        (build.bat's 'Build only' option can auto-install it via winget if you'd rather use that.)"
    exit 1
}
Write-Host "Using $(node --version) at $((Get-Command node).Source)"
Write-Host ""

# -- Read current version from root package.json ---------------------------
$pkgPath = Join-Path $Root "package.json"
$pkg = Get-Content -LiteralPath $pkgPath -Raw | ConvertFrom-Json
$currentVersion = $pkg.version
$parts = $currentVersion -split '\.'
[int]$major = $parts[0]; [int]$minor = $parts[1]; [int]$patch = $parts[2]

Write-Host ""
Write-Host "============================================================"
Write-Host "  Foliantica Release Script"
Write-Host "  Current version: v$currentVersion"
Write-Host "============================================================"
Write-Host ""
Write-Host "  [1] Patch  (bug fixes)         -> v$major.$minor.$($patch + 1)"
Write-Host "  [2] Minor  (new features)      -> v$major.$($minor + 1).0"
Write-Host "  [3] Major  (breaking changes)  -> v$($major + 1).0.0"
Write-Host "  [Q] Quit"
Write-Host ""
$bumpChoice = Read-Host "Choose bump type [1/2/3/Q]"

switch ($bumpChoice) {
    "Q" { exit 0 }
    "q" { exit 0 }
    "1" { $patch++ }
    "2" { $minor++; $patch = 0 }
    "3" { $major++; $minor = 0; $patch = 0 }
    default { Write-Host "Invalid choice."; exit 1 }
}
$newVersion = "$major.$minor.$patch"

Write-Host ""
Write-Host " New version: v$newVersion"
Write-Host ""
$confirm = Read-Host "Continue? [Y/N]"
if ($confirm -notmatch '^[Yy]$') { exit 0 }

$msg = Read-Host "Commit message (leave blank for default)"
if ([string]::IsNullOrWhiteSpace($msg)) { $msg = "Release v$newVersion" }

# -- Sanity check: clean working tree ---------------------------------------
Push-Location $Root
$dirty = git status --porcelain
if ($dirty) {
    Write-Host ""
    Write-Host "[ERROR] Working tree is dirty -- commit or stash changes first:"
    Write-Host $dirty
    Pop-Location
    exit 1
}

# -- Bump version numbers -----------------------------------------------------
Write-Host ""
Write-Host "[1/4] Bumping version numbers..."
$pkg.version = $newVersion
$pkg | ConvertTo-Json -Depth 10 | Set-Content -LiteralPath $pkgPath
$webPkgPath = Join-Path $Root "web\package.json"
$webPkg = Get-Content -LiteralPath $webPkgPath -Raw | ConvertFrom-Json
$webPkg.version = $newVersion
$webPkg | ConvertTo-Json -Depth 10 | Set-Content -LiteralPath $webPkgPath
Set-Content -LiteralPath (Join-Path $Root "VERSION") -Value $newVersion

# -- Install npm deps if needed, then build (release validation) ------------
Write-Host "[2/4] Building frontend (release validation)..."
Push-Location (Join-Path $Root "web")
$nodeModules = Join-Path (Get-Location) "node_modules"
if (-not (Test-Path $nodeModules)) {
    Write-Host "  Installing npm dependencies (first run)..."
    npm install
    if ($LASTEXITCODE -ne 0) { Write-Host "[ERROR] npm install failed"; Pop-Location; Pop-Location; exit 1 }
} elseif ((Get-Item "package.json").LastWriteTime -gt (Get-Item $nodeModules).LastWriteTime) {
    Write-Host "  package.json updated - running npm install..."
    npm install
    if ($LASTEXITCODE -ne 0) { Write-Host "[ERROR] npm install failed"; Pop-Location; Pop-Location; exit 1 }
}
npm run build
if ($LASTEXITCODE -ne 0) { Write-Host "[ERROR] Build failed"; Pop-Location; Pop-Location; exit 1 }
Pop-Location

# -- Commit + tag --------------------------------------------------------------
Write-Host "[3/4] Committing..."
git add package.json web/package.json VERSION
git commit -m $msg
if ($LASTEXITCODE -ne 0) { Write-Host "[ERROR] Nothing to commit"; Pop-Location; exit 1 }
git tag -a "v$newVersion" -m "v$newVersion"

# -- Push ------------------------------------------------------------------------
Write-Host "[4/4] Pushing to GitHub..."
$branch = git rev-parse --abbrev-ref HEAD
git push origin $branch
git push origin --tags
Pop-Location

Write-Host ""
Write-Host "============================================================"
Write-Host "  Released v$newVersion -- GitHub Actions is now building the installers."
Write-Host "  Check: https://github.com/DonMischo/foliantica/actions"
Write-Host "============================================================"
Write-Host ""
