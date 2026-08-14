$ErrorActionPreference = 'Stop'
foreach ($port in @(3000, 5173)) {
  $connections = Get-NetTCPConnection -LocalPort $port -State Listen -ErrorAction SilentlyContinue
  foreach ($connection in $connections) {
    $process = Get-Process -Id $connection.OwningProcess -ErrorAction SilentlyContinue
    if ($process -and $process.Path -like '*node.exe') {
      Write-Host "Stopping $($process.ProcessName) (PID $($process.Id)) on port $port"
      Stop-Process -Id $process.Id -Force
    }
  }
}
Write-Host 'Local NSSMS services stopped where found.'
