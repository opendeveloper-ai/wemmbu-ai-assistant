param(
  [switch]$Follow,
  [int]$Tail = 250
)
$ErrorActionPreference = 'Stop'
$candidates = @(
  (Join-Path $env:APPDATA 'com.wemmbu.assistant\logs\desktop-startup.log'),
  (Join-Path $env:LOCALAPPDATA 'com.wemmbu.assistant\logs\desktop-startup.log'),
  (Join-Path $env:TEMP 'WemmbuAssistant\logs\desktop-startup.log')
)
$found = $candidates | Where-Object { Test-Path -LiteralPath $_ -PathType Leaf } | Select-Object -First 1
if (-not $found) {
  Write-Host 'No Wemmbu diagnostic log was found. Launch the desktop app once, then run this script again.' -ForegroundColor Yellow
  Write-Host 'Searched:'
  $candidates | ForEach-Object { Write-Host "  $_" }
  exit 2
}
Write-Host "Wemmbu diagnostic log: $found" -ForegroundColor Green
Write-Host 'API keys and request bodies are intentionally not written to this log.' -ForegroundColor DarkGray
if ($Follow) {
  Get-Content -LiteralPath $found -Tail $Tail -Wait
} else {
  Get-Content -LiteralPath $found -Tail $Tail
}
