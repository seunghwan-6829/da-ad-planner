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
  echo .env not found. Copy .env.example to .env and fill SUPABASE + APIFY keys.
  pause
  exit /b 1
)
set PYTHONUTF8=1
set PYTHONIOENCODING=utf-8
chcp 65001 >nul
rem Only brands added in the last N HOURS (default 6). Pass a number to override, e.g.  apify-import-recent.bat 2
set HOURS=%1
if "%HOURS%"=="" set HOURS=6
set CRAWL_SINCE_HOURS=%HOURS%
echo ==========================================
echo   Apify import - brands added in last %HOURS% hour(s) ONLY
echo   (Just-added brands only. Older brands are NOT re-crawled = no wasted credits.)
echo ==========================================
echo.
".venv\Scripts\python.exe" -m src.apify_import
echo.
echo === Done. Refresh the web gallery. ===
pause
