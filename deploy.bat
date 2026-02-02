@echo off
chcp 65001 >nul
echo ========================================
echo   DA 광고 플래너 - 원클릭 배포
echo ========================================
echo.

cd /d "%~dp0"

echo [1/3] 변경 파일 추가 중...
git add .
if errorlevel 1 (
  echo 오류: git add 실패
  pause
  exit /b 1
)

echo [2/3] 커밋 중...
git commit -m "Deploy: %date% %time%" --allow-empty
if errorlevel 1 (
  echo 커밋할 변경이 없거나 오류가 발생했습니다.
)

echo [3/3] GitHub에 push 중... (Vercel 자동 배포 트리거)
git push origin main
if errorlevel 1 (
  echo.
  echo 오류: push 실패. 원격 저장소(origin)와 브랜치(main)를 확인하세요.
  pause
  exit /b 1
)

echo.
echo ========================================
echo   배포 요청 완료. Vercel에서 빌드가 진행됩니다.
echo ========================================
pause
