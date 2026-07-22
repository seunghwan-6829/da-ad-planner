@echo off
setlocal
cd /d "%~dp0"
chcp 65001 >nul
title Naver Cafe Publish Agent (keep this window open)

REM ASCII only -- cmd.exe reads .bat in the OEM codepage. Korean output comes from agent.mjs.

echo ==========================================
echo   Naver Cafe Publish Agent
echo   Publishes approved posts from the website.
echo   Keep this window open. Close = stop.
echo ==========================================
echo.

where node >nul 2>nul
if errorlevel 1 goto NONODE

REM --- Auto-update the publish script from GitHub (only if this is a git clone) ---
REM   Server changes deploy automatically via Vercel. The publish SCRIPT (agent.mjs) lives
REM   here, so we pull the latest on each start. Skipped gracefully if git is missing/offline.
where git >nul 2>nul
if errorlevel 1 goto SKIPUPDATE
if not exist ..\.git goto SKIPUPDATE
echo Checking for publish-script updates...
git -C .. pull --ff-only
echo.
:SKIPUPDATE

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
