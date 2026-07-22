@echo off
setlocal
cd /d "%~dp0"
chcp 65001 >nul
title Naver Cafe Agent - Update now

REM ASCII only. Pulls the latest publish script from GitHub and updates dependencies.
REM Use this on the publishing laptop when told "there's a publish-script update".
REM (Server/website changes deploy automatically via Vercel and need nothing here.)

where git >nul 2>nul
if errorlevel 1 goto NOGIT
if not exist ..\.git goto NOREPO

echo Pulling latest publish script...
git -C .. pull --ff-only
if errorlevel 1 goto PULLFAIL

echo Updating dependencies...
call npm install

echo.
echo [OK] Updated. Restart the agent:
echo   - if you use install-autostart.bat: log off and back on, or run run-agent-hidden.vbs
echo   - otherwise: close publish-agent.bat and open it again
echo.
pause
exit /b 0

:NOGIT
echo [ERROR] git is not installed. Install from https://git-scm.com , or copy the updated
echo         naver-cafe-agent folder from the main PC manually.
pause
exit /b 1

:NOREPO
echo This folder was copied (not git-cloned), so auto-update is unavailable.
echo To enable one-click updates, set the laptop up with:  git clone ^<repo-url^>
echo For now, copy the updated naver-cafe-agent\agent.mjs from the main PC.
pause
exit /b 1

:PULLFAIL
echo [ERROR] git pull failed (local changes or offline). Check the window above.
pause
exit /b 1
