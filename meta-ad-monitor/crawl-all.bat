@echo off
chcp 65001 >nul
setlocal
cd /d "%~dp0"

if not exist .venv\Scripts\python.exe (
  echo 이 PC에서 처음 실행 - 설치를 먼저 진행합니다...
  call "%~dp0setup-local.bat"
)
if not exist .venv\Scripts\python.exe (
  echo 설치에 실패했습니다. setup-local.bat 을 직접 실행해 확인해 주세요.
  pause
  exit /b 1
)
if not exist .env (
  echo .env 파일이 없습니다. .env.example 을 복사해 .env 로 만들고 Supabase 키를 채워주세요.
  pause
  exit /b 1
)

REM 모든 등록 브랜드를 집 IP + headful 로 다시 크롤(기존 30개 제한 브랜드도 전량으로 채워짐).
REM 브랜드가 많으면 시간이 꽤 걸립니다(브랜드당 1~3분).
set CRAWL_HEADFUL=1
set CRAWL_MAX_SCROLLS=150

echo ============================================
echo   전체 브랜드 크롤 (집 IP, 화면 표시)
echo   * 브랜드 수가 많으면 오래 걸립니다. 크롬 창 닫지 마세요.
echo ============================================
echo.
.venv\Scripts\python.exe -m src.run_cloud

echo.
echo === 끝났습니다. 갤러리에서 새로고침하면 반영됩니다. ===
pause
