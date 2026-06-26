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
  echo .env not found. Copy .env.example to .env and fill SUPABASE keys.
  pause
  exit /b 1
)
set PYTHONUTF8=1
set PYTHONIOENCODING=utf-8
chcp 65001 >nul
echo ==========================================
echo   Refill media - re-download missing files (FREE, no Apify)
echo   Heals ads whose upload failed (downloaded=false).
echo ==========================================
echo.
".venv\Scripts\python.exe" -m src.refill_media
echo.
echo === Done. Refresh the web gallery. ===
pause
