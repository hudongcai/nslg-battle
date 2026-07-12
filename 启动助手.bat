@echo off
chcp 65001 >nul
title 三谋战报本地助手

echo ========================================
echo   三谋战报本地助手 v2.1
echo ========================================
echo.

REM 检查 Node.js 是否安装
where node >nul 2>nul
if %errorlevel% neq 0 (
    echo [错误] 未检测到 Node.js
    echo 请先安装 Node.js: https://nodejs.org/
    echo.
    pause
    exit /b 1
)

REM 检查配置文件
if not exist "local-helper.config.json" (
    echo [提示] 首次运行，需要进行配置
    echo.
    node local-helper.minimal.js --setup
    if %errorlevel% neq 0 (
        echo.
        echo [错误] 配置失败
        pause
        exit /b 1
    )
)

echo [启动] 正在启动本地助手...
echo.
node local-helper.minimal.js

REM 如果程序异常退出
if %errorlevel% neq 0 (
    echo.
    echo [错误] 本地助手异常退出
    pause
)
