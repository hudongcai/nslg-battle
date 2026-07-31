@echo off
chcp 65001 >nul
echo ====================================
echo   WebSocket OCR 实时监控
echo ====================================
echo.
echo 正在启动浏览器...
echo 监控地址: http://localhost:3000/websocket-monitor.html
echo.
start http://localhost:3000/websocket-monitor.html
echo.
echo 浏览器已打开，请在浏览器中查看实时监控数据
echo.
pause
