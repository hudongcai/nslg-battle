@echo off
chcp 65001 >nul
echo ========================================
echo    WebSocket OCR 监控测试工具
echo ========================================
echo.
echo 1. 打开监控页面
echo    http://localhost:3000/websocket-monitor.html
echo.
echo 2. 提交OCR测试任务并观察WebSocket推送
echo.
pause

echo.
echo [提交OCR任务...]
node trigger-websocket-with-helper.js

echo.
echo ========================================
echo 测试完成！检查监控页面是否收到了消息
echo ========================================
pause
