@echo off
echo Restarting NSLG Battle Backend...

REM Stop all node processes
taskkill /F /IM node.exe 2>nul

REM Wait 2 seconds
timeout /t 2 /nobreak >nul

REM Start backend in new window
start "NSLG Backend" cmd /k "cd /d C:\nslg-battle && node nslg-backend.js"

echo Backend restarted!
timeout /t 3
