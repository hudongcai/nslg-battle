@echo off
chcp 65001 > nul
title 本地助手 WebSocket 日志
color 0A
echo ══════════════════════════════════════════════════
echo   本地助手 - WebSocket 连接日志
echo ══════════════════════════════════════════════════
echo.
cd /d "%~dp0"
node local-helper.js --no-prompt
pause
