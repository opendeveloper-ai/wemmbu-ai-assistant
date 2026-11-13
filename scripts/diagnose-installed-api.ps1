param(
  [string]$InstallDir = ''
)
$ErrorActionPreference = 'Stop'

if ([string]::IsNullOrWhiteSpace($InstallDir)) {
  $candidates = @(
    (Join-Path $env:LOCALAPPDATA 'Wemmbu AI Assistant'),
    (Join-Path $env:LOCALAPPDATA 'Programs\Wemmbu AI Assistant'),
    (Join-Path $env:ProgramFiles 'Wemmbu AI Assistant')
  ) | Where-Object { $_ -and (Test-Path -LiteralPath $_ -PathType Container) }
  foreach ($candidate in $candidates) {
    $hasNode = Get-ChildItem -LiteralPath $candidate -Filter 'node.exe' -File -Recurse -ErrorAction SilentlyContinue | Select-Object -First 1
    if ($hasNode) { $InstallDir = $candidate; break }
  }
}

if ([string]::IsNullOrWhiteSpace($InstallDir) -or -not (Test-Path -LiteralPath $InstallDir -PathType Container)) {
  Write-Host 'Could not locate the installed Wemmbu folder.' -ForegroundColor Red
  Write-Host 'Run this script with -InstallDir "C:\full\path\to\Wemmbu AI Assistant".'
  exit 2
}

$node = Get-ChildItem -LiteralPath $InstallDir -Filter 'node.exe' -File -Recurse -ErrorAction SilentlyContinue |
  Where-Object { $_.FullName -match '[\\/]runtime[\\/]node\.exe$' } | Select-Object -First 1
$server = Get-ChildItem -LiteralPath $InstallDir -Filter 'index.js' -File -Recurse -ErrorAction SilentlyContinue |
  Where-Object { $_.FullName -match '[\\/]server[\\/]index\.js$' } | Select-Object -First 1

if (-not $node -or -not $server) {
  Write-Host 'The installed Node runtime or server/index.js resource is missing.' -ForegroundColor Red
  Write-Host "Install folder: $InstallDir"
  Write-Host "Node found: $([bool]$node); API entry found: $([bool]$server)"
  exit 3
}

$diagRoot = Join-Path $env:TEMP 'WemmbuAssistant-Api-Diagnostic'
$dataDir = Join-Path $diagRoot 'data'
$memoryDir = Join-Path $dataDir 'memory'
New-Item -ItemType Directory -Force -Path $memoryDir | Out-Null
$env:AQIRON_WEMMBU_API_PORT = '18788'
$env:AQIRON_WEMMBU_DATA_DIR = $dataDir
$env:AQIRON_WEMMBU_MEMORY_DIR = $memoryDir

Write-Host "Node runtime: $($node.FullName)" -ForegroundColor Cyan
Write-Host "API entry:    $($server.FullName)" -ForegroundColor Cyan
Write-Host 'Launching the bundled API on diagnostic-only port 18788.' -ForegroundColor Yellow
Write-Host 'If the API starts successfully, leave this window running and try the desktop app. Press Ctrl+C here to stop the test API first.' -ForegroundColor Yellow
& $node.FullName $server.FullName
$exitCode = $LASTEXITCODE
if ($exitCode -ne 0) {
  Write-Host "Bundled API exited with code $exitCode." -ForegroundColor Red
  exit $exitCode
}
