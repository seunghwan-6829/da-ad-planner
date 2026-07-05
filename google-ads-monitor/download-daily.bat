@echo off
setlocal
cd /d "%~dp0"

rem Daily auto-download of embed-blocked Google ad videos (~500/day, rate-limit safe).
rem Run by Windows Task Scheduler. Resumable; already-saved and dead videos are skipped.
set MAX_VIDEOS=500
set CONCURRENCY=4
set YT_HEIGHT=720

if exist node_modules goto RUN
call npm install

:RUN
echo ---------------------------------------->> daily-download.log
echo [%date% %time%] daily run start>> daily-download.log
node download-local.mjs>> daily-download.log 2>&1
echo [%date% %time%] daily run end>> daily-download.log
exit /b 0
