@echo off
setlocal
cd /d "%~dp0"
set REPO=seunghwan-6829/da-ad-planner

echo ==========================================
echo   Google Ads - fetch embed-blocked ad videos
echo   (download unlisted/no-embed YouTube ads to storage)
echo ==========================================
echo.

where gh >nul 2>nul
if errorlevel 1 goto NOGH

echo Triggering video fetch on the cloud...
gh workflow run google-ads-fetch-videos.yml -R %REPO% --ref main -f max_videos=0
if errorlevel 1 goto FAILRUN

echo.
echo Dispatched. Checking status shortly...
timeout /t 9 /nobreak >nul
gh run list -R %REPO% --workflow=google-ads-fetch-videos.yml --limit 1

echo.
echo ==========================================
echo  Downloading on GitHub Actions (cloud). Resumable.
echo  - Already-saved videos are skipped; re-run to continue if needed.
echo  - Refresh the [Google Ads Crawler] page in a few minutes.
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
