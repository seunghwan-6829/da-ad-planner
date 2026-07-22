@echo off
setlocal
cd /d "%~dp0"
chcp 65001 >nul
title Naver Cafe - Dry Run (no posting, no data change)

REM ASCII only -- see login-setup.bat for why. Korean output comes from agent.mjs.

where node >nul 2>nul
if errorlevel 1 goto NONODE

if exist node_modules goto RUN
echo Installing dependencies (first run only)...
call npm install
if errorlevel 1 goto FAILDEP

:RUN
node agent.mjs --dry-run
echo.
pause
exit /b 0

:NONODE
echo [ERROR] Node.js not found. Install it from https://nodejs.org and try again.
pause
exit /b 1

:FAILDEP
echo [ERROR] npm install failed. Check your internet connection.
pause
exit /b 1
