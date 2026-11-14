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
where npm >nul 2>nul
if errorlevel 1 (
  echo npm is not available. Reinstall Node.js with npm, then rerun this file.
  pause
  exit /b 1
)
echo [1/5] Installing platform-correct dependencies from package-lock.json...
call npm ci --no-audit --no-fund
if errorlevel 1 goto failed
echo.
echo [2/5] Running memory reliability, migration and chat integration tests...
call npm run test:memory
if errorlevel 1 goto failed
echo.
echo [3/5] Benchmarking memory operations with 9,900 records...
call npm run benchmark:memory
if errorlevel 1 goto failed
echo.
echo [4/5] Running optimized production build...
call npm run build
if errorlevel 1 goto failed
echo.
echo [5/5] Verifying lazy-loaded and vendor JavaScript chunks...
call npm run check:build-chunks
if errorlevel 1 goto failed
echo.
echo Stage 6 verification PASSED: tests, benchmark, production build and code-splitting checks completed.
pause
exit /b 0
:failed
echo.
echo Stage 6 verification FAILED. Review the error above. Your memory database and settings are not intentionally changed by this script.
pause
exit /b 1
