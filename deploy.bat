@echo off
chcp 65001 >nul
title Deploy - da-ad-planner

REM ASCII only. cmd.exe reads .bat with the OEM codepage (CP949 on Korean
REM Windows), so UTF-8 Korean here becomes mojibake and can even break
REM command parsing (broken bytes may contain & or |).

echo ========================================
echo   da-ad-planner - one click deploy
echo ========================================
echo.

cd /d "%~dp0"

echo [1/3] git add ...
git add .
if errorlevel 1 (
  echo ERROR: git add failed
  pause
  exit /b 1
)

echo [2/3] git commit ...
git commit -m "Deploy: %date% %time%" --allow-empty
if errorlevel 1 (
  echo Nothing to commit, or commit failed. Continuing.
)

echo [3/3] git push origin main ... (triggers Vercel deploy)
git push origin main
if errorlevel 1 (
  echo.
  echo ERROR: push failed. Check remote "origin" and branch "main".
  pause
  exit /b 1
)

echo.
echo ========================================
echo   Pushed. Vercel is building now.
echo ========================================
pause
