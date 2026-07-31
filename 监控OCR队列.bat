@echo off
chcp 65001 >nul
cd /d %~dp0
echo ====================================
echo     OCR队列实时监控
echo     每10秒刷新一次
echo     按Ctrl+C停止监控
echo ====================================
echo.
node monitor-queue.js
