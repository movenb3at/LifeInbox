@echo off
setlocal
cd /d "%~dp0"
"%SystemRoot%\System32\WindowsPowerShell\v1.0\powershell.exe" -NoProfile -ExecutionPolicy Bypass -File "%~dp0scripts\start-dev.ps1"
set "launchResult=%errorlevel%"
if not "%launchResult%"=="0" (
    echo.
    echo LifeInbox could not start. Please check the message above.
    echo If the server is already running, open http://localhost:3000
    pause
)
exit /b %launchResult%
