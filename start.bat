@echo off
setlocal
cd /d "%~dp0"

where node >nul 2>nul
if errorlevel 1 (
  echo Node.js 24.15.0 or newer is required. Install it from https://nodejs.org/ and rerun start.bat.
  pause
  exit /b 1
)

where npm >nul 2>nul
if errorlevel 1 (
  echo npm was not found. Reinstall Node.js 24.15.0 or newer with npm included.
  pause
  exit /b 1
)

node scripts\start-dev.mjs
set "START_EXIT_CODE=%ERRORLEVEL%"
if not "%START_EXIT_CODE%"=="0" pause
exit /b %START_EXIT_CODE%
