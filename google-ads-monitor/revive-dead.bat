@echo off
setlocal
cd /d "%~dp0"
chcp 65001 >nul
title Google Ads - Revive wrongly dead ads

REM ASCII only. cmd.exe reads .bat with the OEM codepage (CP949 on Korean
REM Windows), so UTF-8 Korean here becomes mojibake and can even break
REM command parsing. Korean output is printed by revive-dead.mjs instead.

node revive-dead.mjs
echo.
pause
