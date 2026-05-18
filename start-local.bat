@echo off
chcp 65001 >nul
title 三谋战报系统 - 启动中

set PROJECT_DIR=E:\nslg-battle4
set PYTHON_PATH=C:\Users\Administrator\.workbuddy\binaries\python\versions\3.13.12\python.exe
set CF_CONFIG=C:\Users\Administrator\.cloudflared\config.yml

echo ========================================
echo   三谋战报系统 - 开发环境启动
echo ========================================
echo.

:: ── 1. 后端 ──────────────────────────────────
echo [1/3] 启动后端 API 服务 (端口 3000)...
netstat -ano | findstr ":3000 " | findstr "LISTENING" >nul 2>&1
if %errorlevel%==0 (
    for /f "tokens=5" %%p in ('netstat -ano ^| findstr ":3000 " ^| findstr "LISTENING"') do (
        echo 停止端口 3000 的进程 PID: %%p
        taskkill /PID %%p /F >nul 2>&1
    )
    timeout /t 1 /nobreak >nul
)
start "后端 API :3000" cmd /k "cd /d %PROJECT_DIR% && node nslg-backend.js"
timeout /t 3 /nobreak >nul
netstat -ano | findstr ":3000 " | findstr "LISTENING" >nul 2>&1
if %errorlevel%==0 (
    echo [后端] OK  http://localhost:3000
) else (
    echo [后端] 警告：端口 3000 未监听，请检查窗口日志
)

:: ── 2. 前端 ──────────────────────────────────
echo [2/3] 启动前端静态服务 (端口 8080)...
netstat -ano | findstr ":8080 " | findstr "LISTENING" >nul 2>&1
if %errorlevel%==0 (
    for /f "tokens=5" %%p in ('netstat -ano ^| findstr ":8080 " ^| findstr "LISTENING"') do (
        echo 停止端口 8080 的进程 PID: %%p
        taskkill /PID %%p /F >nul 2>&1
    )
    timeout /t 1 /nobreak >nul
)
if exist "%PYTHON_PATH%" (
    start "前端静态 :8080" cmd /k "cd /d %PROJECT_DIR% && "%PYTHON_PATH%" -m http.server 8080"
) else (
    start "前端静态 :8080" cmd /k "cd /d %PROJECT_DIR% && npx serve -l 8080 -s ."
)
timeout /t 3 /nobreak >nul
netstat -ano | findstr ":8080 " | findstr "LISTENING" >nul 2>&1
if %errorlevel%==0 (
    echo [前端] OK  http://localhost:8080
) else (
    echo [前端] 警告：端口 8080 未监听
)

:: ── 3. Cloudflare 隧道 ────────────────────────
echo [3/3] 启动 Cloudflare 隧道...
tasklist | findstr /i "cloudflared.exe" >nul 2>&1
if %errorlevel%==0 (
    echo [隧道] 已在运行，跳过启动
) else if exist "%CF_CONFIG%" (
    start "Cloudflare 隧道" cmd /k "cloudflared tunnel --config "%CF_CONFIG%" run"
    timeout /t 4 /nobreak >nul
    tasklist | findstr /i "cloudflared.exe" >nul 2>&1
    if %errorlevel%==0 (
        echo [隧道] OK  api.zhenwu.fun -^> localhost:3000
    ) else (
        echo [隧道] 警告：cloudflared 未检测到
    )
) else (
    echo [隧道] 跳过：配置文件不存在
)

echo.
echo ========================================
echo   访问地址
echo   前端: http://localhost:8080
echo   后端: http://localhost:3000
echo   生产: https://api.zhenwu.fun/api
echo ========================================
echo.
pause
