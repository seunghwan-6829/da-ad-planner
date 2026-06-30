@echo off
setlocal
chcp 65001 >nul
cd /d "%~dp0"
set REPO=seunghwan-6829/da-ad-planner

echo ==========================================
echo   온드미디어 - 최근 24시간 내 추가된 크리에이터 크롤
echo   (유튜브 + 인스타 / 중복 제외)
echo ==========================================
echo.

where gh >nul 2>nul
if errorlevel 1 (
  echo [오류] GitHub CLI(gh)가 설치되어 있지 않거나 PATH에 없습니다.
  echo   https://cli.github.com 에서 설치 후, 명령창에서 "gh auth login" 으로 로그인하세요.
  echo.
  pause
  exit /b 1
)

echo 클라우드 크롤 작업을 실행합니다 (최근 24시간 추가분만)...
gh workflow run owned-media-crawl.yml -R %REPO% --ref main -f since_hours=24
if errorlevel 1 (
  echo.
  echo [오류] 실행 요청 실패. "gh auth status" 로 로그인 상태를 확인하세요.
  pause
  exit /b 1
)

echo.
echo 실행 요청됨. 잠시 후 진행 상황을 확인합니다...
timeout /t 9 /nobreak >nul
gh run list -R %REPO% --workflow=owned-media-crawl.yml --limit 1

echo.
echo ==========================================
echo  크롤이 클라우드(GitHub Actions)에서 도는 중입니다.
echo  - 몇 분 뒤 웹에서 [온드미디어 크롤러] 새로고침하면 채워져요.
echo  - 자세한 진행: GitHub 저장소 - Actions 탭
echo  - 24시간 이전에 추가된 크리에이터/이미 받은 콘텐츠는 중복 크롤 안 됩니다.
echo ==========================================
pause
