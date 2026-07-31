@echo off
chcp 65001 >nul
echo 正在打开 WebSocket 监控页面...
start http://localhost:3000/websocket-monitor.html
echo 监控页面已在浏览器中打开
timeout /t 2 >nul
