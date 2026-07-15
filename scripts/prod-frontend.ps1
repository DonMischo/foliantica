<#
  Frontend production launcher - builds the Next.js app and runs the
  standalone server output (next.config.mjs sets output: "standalone",
  so `next start` does not work here - the standalone server.js must be
  used instead, with public/ and .next/static copied alongside it).
  server-wrapper.js wraps server.js to also proxy the collab WebSocket
  upgrade through to FastAPI over loopback and to expose the verified
  TCP peer address to route.ts (see COWORKING_NETWORK_SECURITY_SUMMARY.md).
  Called by LaunchFoliantica.bat.
#>
param([string]$WebDir, [switch]$SkipBuild, [int]$Port = 3000)

$host.UI.RawUI.WindowTitle = 'Foliantica [frontend]'
Set-Location $WebDir
$env:LW_API_PORT = '8765'

$standalone = Join-Path $WebDir ".next\standalone"

if ($SkipBuild) {
    if (-not (Test-Path (Join-Path $standalone "server.js"))) {
        Write-Host "[ERROR] No build found. Run LaunchFoliantica.bat first."
        Read-Host "Press Enter to close"
        exit 1
    }
} else {
    npm run build
    if ($LASTEXITCODE -ne 0) {
        Read-Host "Build failed - press Enter to close"
        exit 1
    }
}

Copy-Item -Path (Join-Path $WebDir "public") -Destination $standalone -Recurse -Force
Copy-Item -Path (Join-Path $WebDir ".next\static") -Destination (Join-Path $standalone ".next\static") -Recurse -Force
Copy-Item -Path (Join-Path $WebDir "server-wrapper.js") -Destination $standalone -Force

$env:PORT = [string]$Port
$env:HOSTNAME = '0.0.0.0'
node (Join-Path $standalone "server-wrapper.js")

Read-Host "Stopped - press Enter to close"
