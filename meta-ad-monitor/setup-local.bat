@echo off
setlocal
cd /d "%~dp0"
echo ==========================================
echo   Meta Ad Local Crawler - First-time Setup
echo ==========================================
echo.
where python >nul 2>nul
if errorlevel 1 (
  echo [ERROR] Python not found.
  echo   Install Python: https://www.python.org/downloads/
  echo   IMPORTANT: check "Add Python to PATH", then run this again.
  pause
  exit /b 1
)
if not exist ".venv\Scripts\python.exe" (
  echo [1/3] Creating virtual environment...
  python -m venv .venv
) else (
  echo [1/3] venv exists - skip
)
echo [2/3] Installing Python libraries...
".venv\Scripts\python.exe" -m pip install --upgrade pip
".venv\Scripts\python.exe" -m pip install -r requirements.txt
if errorlevel 1 (
  echo [ERROR] pip install failed.
  pause
  exit /b 1
)
echo [3/3] Installing Chromium engine (Playwright)...
".venv\Scripts\python.exe" -m playwright install chromium
echo.
echo ==========================================
echo   Setup complete!
echo   1) Copy .env.example to .env, then fill:
echo        SUPABASE_URL and SUPABASE_SERVICE_KEY
echo   2) Run crawl-new.bat / crawl-capped.bat / crawl-all.bat
echo ==========================================
pause
