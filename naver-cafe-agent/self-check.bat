@echo off
setlocal
cd /d "%~dp0"
chcp 65001 >nul

echo ==========================================
echo   네이버 카페 자동화 - 자가검사
echo.
echo   발행에 필요한 조건을 하나씩 점검합니다.
echo   ** 글은 절대 등록하지 않습니다 (안전) **
echo.
echo   - 서버 연결 / 인증
echo   - 네이버 로그인 세션
echo   - 카페별 글쓰기 화면(제목/본문/등록버튼) 인식
echo ==========================================
echo.

where node >nul 2>nul
if errorlevel 1 goto NONODE

if exist node_modules goto RUN
echo 처음 실행이라 필요한 파일을 설치합니다...
call npm install
if errorlevel 1 goto FAILDEP

:RUN
node agent.mjs --check
echo.
echo 화면 캡처는 logs 폴더에 저장됐습니다.
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
