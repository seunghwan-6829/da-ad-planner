@echo off
setlocal
cd /d "%~dp0"

echo ==========================================
echo   Google Ad video - LOCAL fast server
echo   Keep this window open: the play button becomes ~5s (instead of 20-60s).
echo   Close this window to stop (page falls back to Apify automatically).
echo ==========================================
echo.

if exist node_modules goto RUN
call npm install

:RUN
node serve-videos.mjs
echo.
echo (server stopped)
pause
