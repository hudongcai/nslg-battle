@echo off
cd /d "%~dp0"
echo ==========================================================
echo   三谋战报系统 - 本地服务器
echo   访问地址: http://localhost:8765
echo   按 Ctrl+C 停止服务器
echo ==========================================================
"C:\Users\hudc\.workbuddy\binaries\python\versions\3.13.12\python.exe" -m http.server 8765
pause
