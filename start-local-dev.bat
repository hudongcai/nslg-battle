@echo off
cd /d "C:\Users\hudc\WorkBuddy\20260502131519\nslg-battle-publish"
set PATH=C:\Program Files\nodejs\;%PATH%
echo ================================
echo 启动本地 Worker 开发服务...
echo 访问地址: http://localhost:8787
echo 按 Ctrl+C 停止服务
echo ================================
npx wrangler dev --local --port 8787
pause
