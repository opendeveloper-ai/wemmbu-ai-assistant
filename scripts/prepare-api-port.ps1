param(
  [Parameter(Mandatory = $true)]
  [ValidateRange(1, 65535)]
  [int]$Port
)

$ErrorActionPreference = 'SilentlyContinue'

# Reuse a running Wemmbu API if it answers the project's health endpoint.
try {
  $health = Invoke-RestMethod -Uri ("http://127.0.0.1:{0}/api/health" -f $Port) -TimeoutSec 2
  if ($health.ok -eq $true) {
    Write-Output 'HEALTHY'
    exit 0
  }
} catch {
  # An occupied port may belong to another program. Check it below.
}

$occupied = $false
$client = New-Object System.Net.Sockets.TcpClient
try {
  $pending = $client.BeginConnect('127.0.0.1', $Port, $null, $null)
  if ($pending.AsyncWaitHandle.WaitOne(600) -and $client.Connected) {
    $occupied = $true
  }
} catch {
  $occupied = $false
} finally {
  $client.Close()
}

if (-not $occupied) {
  Write-Output 'FREE'
  exit 0
}

# Do not terminate an unrelated process. Select an unused local fallback port.
foreach ($candidate in 8788..8827) {
  $listener = $null
  try {
    $listener = [System.Net.Sockets.TcpListener]::new([System.Net.IPAddress]::Loopback, $candidate)
    $listener.Start()
    $listener.Stop()
    Write-Output ("PORT={0}" -f $candidate)
    exit 0
  } catch {
    if ($listener) {
      try { $listener.Stop() } catch {}
    }
  }
}

Write-Output 'NO_PORT'
exit 1
