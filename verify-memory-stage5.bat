@echo off
setlocal
cd /d "%~dp0"
where node >nul 2>nul
if errorlevel 1 (
  echo Node.js is not installed. Install Node.js 20 or newer, then rerun this file.
  pause
  exit /b 1
)
where npm >nul 2>nul
if errorlevel 1 (
  echo npm is not available. Reinstall Node.js with npm, then rerun this file.
  pause
  exit /b 1
)
echo [1/3] Installing platform-correct dependencies from package-lock.json...
call npm ci --no-audit --no-fund
if errorlevel 1 goto failed
echo.
echo [2/3] Running Stage 5 memory hardening tests...
call npm run test:memory
if errorlevel 1 goto failed
echo.
echo [3/3] Running production build...
call npm run build
if errorlevel 1 goto failed
echo.
echo Stage 5 verification PASSED: tests and production build completed.
pause
exit /b 0
:failed
echo.
echo Stage 5 verification FAILED. Review the error above; no memory data files were intentionally changed by this script.
pause
exit /b 1
