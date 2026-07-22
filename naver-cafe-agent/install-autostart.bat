@echo off
setlocal
cd /d "%~dp0"
chcp 65001 >nul
title Naver Cafe Agent - Auto start setup

REM ASCII only (cmd.exe reads .bat in the OEM codepage; Korean here would break parsing).
REM Registers a logon task so the publish agent starts automatically after every reboot,
REM running hidden in the background. No admin rights needed (per-user task).

set TASK=DA-NaverCafeAgent

echo ==========================================
echo   Naver Cafe Publish Agent - auto start
echo ==========================================
echo.
echo This registers a Windows task named "%TASK%".
echo The agent will start hidden at every logon, so you do NOT
echo have to run publish-agent.bat after restarting the PC.
echo.

schtasks /query /tn "%TASK%" >nul 2>nul
if not errorlevel 1 (
  echo Task already exists. Re-creating it...
  schtasks /delete /tn "%TASK%" /f >nul 2>nul
)

schtasks /create /tn "%TASK%" /tr "wscript.exe \"%~dp0run-agent-hidden.vbs\"" /sc onlogon /rl limited /f
if errorlevel 1 goto FAIL

echo.
echo [OK] Registered. It will start automatically from the next logon.
echo.
echo Start it right now without rebooting?  (Y/N)
set /p ANSWER=
if /i "%ANSWER%"=="Y" (
  wscript.exe "%~dp0run-agent-hidden.vbs"
  echo Started in background. Log: %~dp0agent.log
)
echo.
echo To remove later:  schtasks /delete /tn "%TASK%" /f
echo To see the log:   notepad "%~dp0agent.log"
pause
exit /b 0

:FAIL
echo.
echo [ERROR] Could not register the task.
echo Try running this file as administrator.
pause
exit /b 1
