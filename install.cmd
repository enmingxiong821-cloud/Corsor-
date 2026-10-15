@echo off
chcp 65001 >nul
cd /d "%~dp0"

where node >nul 2>nul
if errorlevel 1 (
  echo.
  echo   [X] Node.js not found.
  echo.
  echo   Please install Node.js 18 or newer from https://nodejs.org/
  echo   then run this file again.
  echo.
  pause
  exit /b 1
)

node "scripts\setup.mjs"
echo.
pause
