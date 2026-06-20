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

REM 클라우드 30개 제한에 걸려 "아직 다 못 가져온" 브랜드만 골라 집 IP로 전량 보충.
REM  - CRAWL_MAX_COUNT=35  → 현재 광고 35개 이하인 브랜드만(=30개에서 막힌 것들). 이미 많이 쌓인 브랜드는 자동 제외.
REM  - 같은 Library ID(중복 소재)는 자동으로 건너뛰고, 새 광고만 추가됩니다.
set CRAWL_HEADFUL=1
set CRAWL_MAX_COUNT=35
set CRAWL_MAX_SCROLLS=150

echo ============================================
echo   미완(30개 제한) 브랜드만 전량 보충 크롤
echo   * 광고 35개 이하 브랜드만 대상. 중복 소재는 자동 스킵.
echo   * 크롬 창이 떴다 스스로 스크롤합니다. 닫지 마세요.
echo ============================================
echo.
.venv\Scripts\python.exe -m src.run_cloud

echo.
echo === 끝났습니다. 갤러리에서 새로고침하면 반영됩니다. ===
pause
