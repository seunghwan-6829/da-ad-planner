@echo off
setlocal
cd /d "%~dp0"
chcp 65001 >nul

echo ==========================================
echo   네이버 카페 자동화 - 모의 발행
echo.
echo   ** 글을 등록하지 않습니다 **
echo   ** 데이터도 전혀 바꾸지 않습니다 **
echo.
echo   지금 발행한다면 어떤 글이 어느 카페 어디로
echo   나가는지만 계산해서 보여줍니다.
echo   (네이버 로그인 전에도 확인 가능)
echo ==========================================
echo.

where node >nul 2>nul
if errorlevel 1 goto NONODE

if exist node_modules goto RUN
echo 처음 실행이라 필요한 파일을 설치합니다...
call npm install
if errorlevel 1 goto FAILDEP

:RUN
node agent.mjs --dry-run
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
