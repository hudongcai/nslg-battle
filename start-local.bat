@echo off
echo Starting services...

set "DIR=C:\nslg-battle"

echo Starting backend...
start /d "%DIR%" "Backend :3000" cmd /k node nslg-backend.js

echo Starting frontend...
start /d "%DIR%" "Frontend :8002" cmd /k "C:\Users\Administrator\AppData\Local\Programs\Python\Python312\python.exe" -m http.server 8002

echo Starting cloudflare...
start "Cloudflare" cmd /k ""C:\Users\Administrator\AppData\Local\Microsoft\WinGet\Links\cloudflared.exe" tunnel --config "C:\Users\Administrator\.cloudflared\config.yml" run"

echo Done.
pause
