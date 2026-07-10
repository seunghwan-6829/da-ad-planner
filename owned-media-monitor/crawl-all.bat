@echo off
setlocal
cd /d "%~dp0"
set REPO=seunghwan-6829/da-ad-planner

echo ==========================================
echo   Owned Media - FULL crawl (ALL creators)
echo   YouTube Shorts: all (embed) / Instagram Reels: ALL (per-creator, ig_limit=0)
echo   Instagram uses Apify (paid per result). YouTube is free.
echo ==========================================
echo.

where gh >nul 2>nul
if errorlevel 1 goto NOGH

echo Triggering cloud crawl (all creators, Instagram unlimited)...
gh workflow run owned-media-crawl.yml -R %REPO% --ref main -f ig_limit=0
if errorlevel 1 goto FAILRUN

echo.
echo Dispatched. Checking status shortly...
timeout /t 9 /nobreak >nul
gh run list -R %REPO% --workflow=owned-media-crawl.yml --limit 1

echo.
echo ==========================================
echo  Crawl is running on GitHub Actions (cloud). Instagram runs per creator now.
echo  - Refresh the [Owned Media Crawler] page after it finishes.
echo  - Progress: GitHub repo - Actions tab.
echo  - Already-saved posts are skipped (only views updated).
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
