@echo off
title 三谋战报本地助手
echo 正在启动本地助手...
cd /d "%~dp0"
node local-helper.minimal.js
pause
