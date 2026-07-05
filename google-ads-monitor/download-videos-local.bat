@echo off
setlocal
cd /d "%~dp0"

echo ==========================================
echo   Google Ads - download ad videos on THIS PC (free)
echo   yt-dlp grabs embed-blocked YouTube ads, uploads to Supabase.
echo   Home/residential IP = no bot-block, no Apify cost.
echo ==========================================
echo.

where node >nul 2>nul
if errorlevel 1 goto NONODE

if exist node_modules goto RUN
echo Installing dependencies (first run only)...
call npm install
if errorlevel 1 goto FAILDEP

:RUN
echo Downloading pending videos (resumable; already-saved are skipped)...
node download-local.mjs
if errorlevel 1 goto FAILRUN

echo.
echo ==========================================
echo  Done. Refresh the [Google Ads Crawler] page - videos play instantly.
echo  Re-run anytime to fetch newly crawled videos.
echo ==========================================
pause
exit /b 0

:NONODE
echo [ERROR] Node.js not found on PATH. Install from https://nodejs.org
pause
exit /b 1

:FAILDEP
echo [ERROR] npm install failed. Check internet connection.
pause
exit /b 1

:FAILRUN
echo [ERROR] Download failed. See messages above.
pause
exit /b 1
