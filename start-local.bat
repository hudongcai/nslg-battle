@echo off
echo ========================================
echo   nslg-battle + AutoScreenshotTool2
echo ========================================

set "DIR=C:\nslg-battle"
set "SHOT=C:\AutoScreenshotTool2"
set "PY=C:\Users\Administrator\AppData\Local\Programs\Python\Python312\python.exe"
set "CF=C:\Users\Administrator\AppData\Local\Microsoft\WinGet\Links\cloudflared.exe"
set "CFCFG=C:\Users\Administrator\.cloudflared\config.yml"

:: Kill any stale processes on ports we need
echo Cleaning up stale processes...
for /f "tokens=5" %%p in ('netstat -ano ^| findstr ":8003 " ^| findstr LISTENING') do taskkill /PID %%p /F >nul 2>&1
for /f "tokens=5" %%p in ('netstat -ano ^| findstr ":8001 " ^| findstr LISTENING') do taskkill /PID %%p /F >nul 2>&1

echo [1/6] Backend (port 3000)...
start /d "%DIR%" "Backend :3000" cmd /k node nslg-backend.js

echo [2/6] PaddleOCR (port 8003)...
start /d "%DIR%" "PaddleOCR :8003" cmd /k "%PY%" ocr_paddle_service.py

echo [3/6] Frontend (port 8002)...
start /d "%DIR%" "Frontend :8002" cmd /k "%PY%" -m http.server 8002

echo [4/6] Cloudflare tunnel...
start "Cloudflare" cmd /k ""%CF%" tunnel --config "%CFCFG%" run"

echo [5/6] AutoScreenshot auth server (port 8001)...
start /d "%SHOT%\server" "Screenshot-Auth :8001" cmd /k "%PY%" -m uvicorn main:app --host 127.0.0.1 --port 8001

echo [6/6] AutoScreenshotTool2 client...
start /d "%SHOT%" "AutoScreenshot" cmd /k "%PY%" main.py --setup

echo.
echo ========================================
echo   Frontend : http://localhost:8002
echo   Backend  : http://localhost:3000
echo   Auth srv : http://localhost:8001/admin
echo   Production: https://api.zhenwu.fun/api
echo   NOTE: PaddleOCR needs ~30s on first run
echo ========================================
pause
