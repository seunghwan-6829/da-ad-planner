@echo off
setlocal
cd /d "%~dp0"
chcp 65001 >nul

echo ==========================================
echo   네이버 카페 자동화 - 로그인 설정 (최초 1회)
echo.
echo   웨일 창이 열리면 네이버에 직접 로그인해 주세요.
echo   로그인이 확인되면 자동으로 저장되고 끝납니다.
echo   (아이디/비밀번호는 이 프로그램이 저장하거나 읽지 않습니다)
echo ==========================================
echo.

where node >nul 2>nul
if errorlevel 1 goto NONODE

if exist node_modules goto RUN
echo 처음 실행이라 필요한 파일을 설치합니다...
call npm install
if errorlevel 1 goto FAILDEP

:RUN
node agent.mjs --login
echo.
pause
exit /b 0

:NONODE
echo [오류] Node.js 가 설치돼 있지 않습니다. https://nodejs.org 에서 설치해 주세요.
pause
exit /b 1

:FAILDEP
echo [오류] npm install 실패. 인터넷 연결을 확인해 주세요.
pause
exit /b 1
