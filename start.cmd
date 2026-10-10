@echo off
REM Casement — double-click launcher.
REM Installs dependencies on first run, then starts the Vite dev server
REM and opens the app in your browser. Delegates to `npm run dev` (the one
REM canonical start command in package.json) — this file only wraps it.

cd /d "%~dp0"

if not exist "node_modules" (
  echo Installing dependencies ^(first run^)...
  call npm install
  if errorlevel 1 (
    echo.
    echo npm install failed. Fix the error above and try again.
    pause
    exit /b 1
  )
)

echo Starting Casement...
call npm run dev -- --open

REM If the server exits/errors, keep the window open so you can read why.
pause
