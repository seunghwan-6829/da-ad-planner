@echo off
setlocal
cd /d "%~dp0"
if not exist ".venv\Scripts\python.exe" (
  echo First run on this PC - running setup first...
  call "%~dp0setup-local.bat"
)
if not exist ".venv\Scripts\python.exe" (
  echo Setup failed. Please run setup-local.bat directly.
  pause
  exit /b 1
)
if not exist ".env" (
  echo .env not found. Copy .env.example to .env and fill Supabase keys.
  pause
  exit /b 1
)
set "WHALE=C:\Program Files\Naver\Naver Whale\Application\whale.exe"
if not exist "%WHALE%" (
  echo [ERROR] Whale not found: %WHALE%
  pause
  exit /b 1
)
REM Launch Whale with remote debugging on a separate profile (coexists with your normal Whale)
start "" "%WHALE%" --remote-debugging-port=9222 --user-data-dir="%TEMP%\whale-crawl" --no-first-run --no-default-browser-check "about:blank"
echo Waiting 6s for Whale (debug) to start...
timeout /t 6 /nobreak >nul
set CRAWL_CDP_URL=http://localhost:9222
set CRAWL_SINCE_DAYS=1
set CRAWL_MAX_SCROLLS=400
set PYTHONUTF8=1
set PYTHONIOENCODING=utf-8
chcp 65001 >nul
echo ==========================================
echo   Crawl NEW brands via WHALE (CDP) - last 1 day
echo   A Whale window opens and scrolls. Do NOT close it.
echo ==========================================
echo.
".venv\Scripts\python.exe" -m src.run_cloud
echo.
echo === Done. Refresh the web gallery to see results. ===
pause
