@echo off
setlocal
cd /d "%~dp0"

rem Daily auto-download of embed-blocked Google ad videos (~500/day, rate-limit safe).
rem Runs once per day (guard below), whenever the PC is on. Resumable; dead videos skipped.

rem --- run-once-per-day guard (so logon + daily triggers don't double-run) ---
for /f %%i in ('powershell -NoProfile -Command "Get-Date -Format yyyyMMdd"') do set TODAY=%%i
set LAST=
if exist .last-daily-run set /p LAST=<.last-daily-run
if "%LAST%"=="%TODAY%" goto SKIP

set MAX_VIDEOS=500
set CONCURRENCY=4
set YT_HEIGHT=720

if exist node_modules goto RUN
call npm install

:RUN
echo %TODAY%> .last-daily-run
echo ---------------------------------------->> daily-download.log
echo [%date% %time%] daily run start>> daily-download.log
node download-local.mjs>> daily-download.log 2>&1
echo [%date% %time%] daily run end>> daily-download.log
exit /b 0

:SKIP
exit /b 0
