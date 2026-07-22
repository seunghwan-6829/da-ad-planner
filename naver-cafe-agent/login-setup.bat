@echo off
setlocal
cd /d "%~dp0"
chcp 65001 >nul
title Naver Cafe - Login Setup

REM ============================================================
REM  ASCII only.  Do NOT put Korean text in this file.
REM  cmd.exe reads .bat with the OEM codepage (CP949 on Korean
REM  Windows), so UTF-8 Korean turns into mojibake -- and the
REM  broken bytes can contain & or | which splits commands and
REM  produces "not recognized as an internal or external command".
REM  All Korean guidance is printed by agent.mjs instead.
REM ============================================================

where node >nul 2>nul
if errorlevel 1 goto NONODE

if exist node_modules goto RUN
echo Installing dependencies (first run only)...
call npm install
if errorlevel 1 goto FAILDEP

:RUN
node agent.mjs --login
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
