@echo off
chcp 65001 >nul
setlocal
cd /d "%~dp0"

if not exist .venv\Scripts\python.exe (
  echo 먼저 setup-local.bat 을 한 번 실행해 주세요.
  pause
  exit /b 1
)
if not exist .env (
  echo .env 파일이 없습니다. .env.example 을 복사해 .env 로 만들고 Supabase 키를 채워주세요.
  pause
  exit /b 1
)

REM 집 IP + 브라우저 창을 띄워(headful) 크롤 → 메타가 봇 차단을 덜 해 광고를 더 많이 내줍니다.
set CRAWL_HEADFUL=1
REM 최근 7일 내 추가한 브랜드만 (방금 추가한 신규 브랜드들)
set CRAWL_SINCE_DAYS=7
REM 스크롤 횟수 (광고 많은 브랜드까지 끝까지 내리도록 크게)
set CRAWL_MAX_SCROLLS=150

echo ============================================
echo   신규 브랜드 전체 크롤 (집 IP, 화면 표시)
echo   * 크롬 창이 떴다 스스로 스크롤합니다. 닫지 마세요.
echo ============================================
echo.
.venv\Scripts\python.exe -m src.run_cloud

echo.
echo === 끝났습니다. 갤러리에서 새로고침하면 반영됩니다. ===
pause
