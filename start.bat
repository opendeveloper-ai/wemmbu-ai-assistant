@echo off
setlocal
cd /d "%~dp0"
where node >nul 2>nul
if errorlevel 1 (
  echo Node.js is not installed. Install Node.js 24.15 or newer from https://nodejs.org/ and rerun this file.
  pause
  exit /b 1
)
node -e "const v=process.versions.node.split('.').map(Number);if(v[0]<24||(v[0]===24&&v[1]<15))process.exit(1)"
if errorlevel 1 (
  echo This version uses Node built-in SQLite. Install Node.js 24.15 or newer from https://nodejs.org/.
  pause
  exit /b 1
)
if not exist node_modules (
  echo Installing dependencies for the first run...
  call npm install --no-audit --no-fund
  if errorlevel 1 (
    echo Dependency installation failed. Check your internet connection and npm output above.
    pause
    exit /b 1
  )
)
if not exist "node_modules\concurrently\dist\bin\concurrently.js" (
  echo Updating dependencies required by this version...
  call npm install --no-audit --no-fund
  if errorlevel 1 (
    echo Dependency update failed. Check your internet connection and npm output above.
    pause
    exit /b 1
  )
)
if not defined AQIRON_WEMMBU_API_PORT set "AQIRON_WEMMBU_API_PORT=8787"
set "WEMMBU_START_MODE="
for /f "usebackq delims=" %%A in (`powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0scripts\prepare-api-port.ps1" -Port %AQIRON_WEMMBU_API_PORT%`) do set "WEMMBU_START_MODE=%%A"

if /i "%WEMMBU_START_MODE%"=="HEALTHY" (
  echo An existing Wemmbu API is already running on port %AQIRON_WEMMBU_API_PORT%.
  echo Reusing that API and starting the UI only, to avoid EADDRINUSE.
  call npm run dev:ui
  if errorlevel 1 pause
  exit /b
)

if /i "%WEMMBU_START_MODE%"=="NO_PORT" (
  echo Port %AQIRON_WEMMBU_API_PORT% is occupied, and no free fallback port was found in 8788-8827.
  echo Close the other service or stop the previous Wemmbu API, then try again.
  pause
  exit /b 1
)

if /i "%WEMMBU_START_MODE:~0,5%"=="PORT=" (
  set "AQIRON_WEMMBU_API_PORT=%WEMMBU_START_MODE:~5%"
  echo Port %AQIRON_WEMMBU_API_PORT% is occupied by another service. Starting this Wemmbu API on fallback port %WEMMBU_START_MODE:~5%.
)

call npm run dev
if errorlevel 1 pause
