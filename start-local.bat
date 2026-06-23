@echo off
chcp 65001 >nul
title 三谋战报系统 - 启动
powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0start-local.ps1" %*
pause
