<#
  Test stack stopper — kills the isolated smoke-testing processes.

  Terminates whatever listens on the test ports (API 8799, web dev 3100),
  including child processes. The productive ports (8765, 3000) are left
  untouched unless explicitly passed via -Ports.

  Usage:
    .\scripts\test-stack-stop.ps1                 # stop test API + test web
    .\scripts\test-stack-stop.ps1 -Ports 8799     # stop only the test API
#>
param(
    [int[]]$Ports = @(8799, 3100)
)

$stopped = 0
foreach ($port in $Ports) {
    $conns = Get-NetTCPConnection -LocalPort $port -State Listen -ErrorAction SilentlyContinue
    $pids = $conns | Select-Object -ExpandProperty OwningProcess -Unique
    foreach ($procId in $pids) {
        try {
            $name = (Get-Process -Id $procId -ErrorAction Stop).ProcessName
            # /T also kills child processes (dev-server workers)
            taskkill /PID $procId /T /F | Out-Null
            Write-Host "Stopped $name (pid $procId) on port $port"
            $stopped++
        } catch {
            Write-Host "Could not stop pid $procId on port ${port}: $($_.Exception.Message)" -ForegroundColor Yellow
        }
    }
    if (-not $pids) { Write-Host "Nothing listening on port $port" }
}
Write-Host "$stopped process(es) stopped."
