@echo off
chcp 65001 >nul
cd /d %~dp0
echo ====================================
echo     OCR队列状态查询工具
echo ====================================
echo.
node check-ocr-queue.js
echo.
echo ====================================
echo 按任意键退出...
pause >nul
