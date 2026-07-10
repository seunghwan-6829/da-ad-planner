@echo off
setlocal
cd /d "%~dp0"
chcp 65001 >nul

echo ==========================================
echo   Naver Cafe Publish Agent
echo   Publishes queued posts from the website
echo   using YOUR logged-in Whale profile.
echo   Keep this window open. Close = stop.
echo ==========================================
echo.

where node >nul 2>nul
if errorlevel 1 goto NONODE

if exist node_modules goto RUN
echo Installing dependencies (first run only)...
call npm install
if errorlevel 1 goto FAILDEP

:RUN
node agent.mjs
echo.
echo Agent stopped. Press any key to close.
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
