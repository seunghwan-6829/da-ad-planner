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
set CRAWL_HEADFUL=1
set CRAWL_MAX_SCROLLS=400
set PYTHONUTF8=1
set PYTHONIOENCODING=utf-8
chcp 65001 >nul
set "CRAWL_BROWSER_PATH=C:\Program Files\Naver\Naver Whale\Application\whale.exe"
set CRAWL_MAX_COUNT=35
echo ==========================================
echo   Crawl UNDER-FILLED brands (<=35 ads)
echo   Skips already-filled brands. Duplicates auto-skipped.
echo   Home IP + visible browser. Do NOT close Chrome.
echo ==========================================
echo.
".venv\Scripts\python.exe" -m src.run_cloud
echo.
echo === Done. Refresh the web gallery to see results. ===
pause
