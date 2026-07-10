@echo off
setlocal
cd /d "%~dp0"
chcp 65001 >nul

echo ==========================================
echo   Owned Media - FULL crawl on THIS PC (live progress)
echo   YouTube Shorts: all (embed, free) / Instagram Reels: ALL (per-creator, Apify)
echo ==========================================
echo.

where node >nul 2>nul
if errorlevel 1 goto NONODE

if exist node_modules goto YTDLP
echo Installing dependencies (first run only)...
call npm install
if errorlevel 1 goto FAILDEP

:YTDLP
if exist yt-dlp.exe goto RUN
echo Downloading yt-dlp (first run only)...
powershell -NoProfile -Command "Invoke-WebRequest -Uri https://github.com/yt-dlp/yt-dlp/releases/latest/download/yt-dlp.exe -OutFile yt-dlp.exe"

:RUN
set "PATH=%~dp0;%PATH%"
set IG_RESULTS_LIMIT=0
echo Starting crawl... (progress shows below, per creator)
echo.
node crawl.mjs
echo.
echo ==========================================
echo   ALL DONE. Refresh the [Owned Media Crawler] page.
echo   Press any key to close this window.
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
