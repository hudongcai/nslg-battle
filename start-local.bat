@echo off
echo Starting services...

set "DIR=C:\nslg-battle"
set "PY=C:\Users\Administrator\AppData\Local\Programs\Python\Python312\python.exe"

echo Starting backend (port 3000)...
start /d "%DIR%" "Backend :3000" cmd /k node nslg-backend.js

echo Starting PaddleOCR service (port 8003)...
start /d "%DIR%" "PaddleOCR :8003" cmd /k "%PY%" ocr_paddle_service.py

echo Starting frontend (port 8002)...
start /d "%DIR%" "Frontend :8002" cmd /k "%PY%" -m http.server 8002

echo Starting cloudflare...
start "Cloudflare" cmd /k ""C:\Users\Administrator\AppData\Local\Microsoft\WinGet\Links\cloudflared.exe" tunnel --config "C:\Users\Administrator\.cloudflared\config.yml" run"

echo Done. PaddleOCR service needs ~30s to initialize on first run.
pause
