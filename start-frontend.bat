@echo off
cd /d "C:\Users\hudc\WorkBuddy\20260502131519\nslg-battle-publish"
set PATH=C:\Program Files\nodejs\;%PATH%
echo ================================
echo 启动前端页面服务...
echo 访问地址: http://localhost:8080
echo ================================
npx serve -l 8080 -s .
pause
