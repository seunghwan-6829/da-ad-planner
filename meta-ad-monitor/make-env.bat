@echo off
setlocal
cd /d "%~dp0"
if exist ".env" (
  echo .env already exists - opening it in Notepad...
) else (
  copy ".env.example" ".env" >nul
  echo Created .env from template - opening it in Notepad...
)
echo.
echo Fill these two lines, then SAVE and close Notepad:
echo    SUPABASE_URL=https://....supabase.co
echo    SUPABASE_SERVICE_KEY=eyJ...
echo (Get them from Supabase - Project Settings - API)
echo.
notepad ".env"
echo Done. Now run crawl-new.bat
pause
