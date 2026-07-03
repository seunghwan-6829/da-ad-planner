@echo off
setlocal
cd /d "%~dp0"
set REPO=seunghwan-6829/da-ad-planner

echo ==========================================
echo   Google Ads - crawl advertisers added in last 24h
echo   (Transparency Center / image + video / no dupes)
echo ==========================================
echo.

where gh >nul 2>nul
if errorlevel 1 goto NOGH

echo Triggering cloud crawl (last 24h only)...
gh workflow run google-ads-crawl.yml -R %REPO% --ref main -f since_hours=24
if errorlevel 1 goto FAILRUN

echo.
echo Dispatched. Checking status shortly...
timeout /t 9 /nobreak >nul
gh run list -R %REPO% --workflow=google-ads-crawl.yml --limit 1

echo.
echo ==========================================
echo  Crawl is running on GitHub Actions (cloud).
echo  - Refresh the [Google Ads Crawler] page in a few minutes.
echo  - Progress: GitHub repo - Actions tab.
echo  - Advertisers added over 24h ago / already-saved ads are skipped.
echo ==========================================
pause
exit /b 0

:NOGH
echo [ERROR] GitHub CLI "gh" is not installed or not on PATH.
echo   Install from https://cli.github.com  then run:  gh auth login
pause
exit /b 1

:FAILRUN
echo.
echo [ERROR] Failed to dispatch the workflow. Check:  gh auth status
pause
exit /b 1
