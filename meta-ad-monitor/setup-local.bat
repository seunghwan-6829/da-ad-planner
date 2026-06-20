@echo off
chcp 65001 >nul
setlocal
cd /d "%~dp0"
echo ============================================
echo   메타광고 로컬 크롤러 - 최초 1회 설치
echo ============================================
echo.

where python >nul 2>nul
if errorlevel 1 (
  echo [에러] 파이썬이 설치되어 있지 않습니다.
  echo        https://www.python.org/downloads/ 에서 설치할 때
  echo        "Add Python to PATH" 체크 후, 이 파일을 다시 실행하세요.
  pause
  exit /b 1
)

if not exist .venv\Scripts\python.exe (
  echo [1/3] 가상환경(.venv) 생성...
  python -m venv .venv
) else (
  echo [1/3] 가상환경 이미 있음 - 건너뜀
)

echo [2/3] 라이브러리 설치...
.venv\Scripts\python.exe -m pip install --upgrade pip
.venv\Scripts\python.exe -m pip install -r requirements.txt
if errorlevel 1 ( echo [에러] 라이브러리 설치 실패 & pause & exit /b 1 )

echo [3/3] 크롬 엔진(Playwright Chromium) 설치...
.venv\Scripts\python.exe -m playwright install chromium

echo.
echo ============================================
echo   설치 완료!
echo ============================================
echo   1) 이 폴더의 .env.example 을 복사해 .env 로 만들고
echo      SUPABASE_URL, SUPABASE_SERVICE_KEY 두 줄을 채우세요.
echo   2) 신규 브랜드만 = crawl-new.bat 실행
echo      전체 다시   = crawl-all.bat 실행
echo ============================================
pause
