@echo off
setlocal
cd /d "%~dp0"
chcp 65001 >nul
echo ==========================================
echo   재생불가(dead)로 잘못 표시된 광고 복구
echo   유튜브에 한 건씩 확인해서 멀쩡한 것만 되살립니다.
echo ==========================================
echo.
node revive-dead.mjs
echo.
pause
