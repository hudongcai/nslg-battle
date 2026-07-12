@echo off
chcp 65001 >nul
echo ========================================
echo 完全重装本地助手 v2.0.7
echo ========================================
echo.

echo [1/4] 停止现有助手进程...
taskkill /F /IM powershell.exe /FI "WINDOWTITLE eq 真武本地助手*" >nul 2>&1
taskkill /F /IM node.exe /FI "COMMANDLINE eq *local-helper*" >nul 2>&1
timeout /t 2 /nobreak >nul

echo [2/4] 删除旧的安装目录...
set "TARGET_DIR=%LOCALAPPDATA%\ZhenwuLocalHelper"
if exist "%TARGET_DIR%" (
    echo 删除: %TARGET_DIR%
    rmdir /S /Q "%TARGET_DIR%"
) else (
    echo 目录不存在，跳过删除
)

echo [3/4] 运行新版本安装程序...
echo 请在安装程序中选择安装路径...
start /wait "" "%~dp0downloads\zhenwu-local-helper-setup.exe"

echo [4/4] 启动助手...
timeout /t 2 /nobreak >nul
start "" "%TARGET_DIR%\start-local-helper.vbs"

echo.
echo ========================================
echo 重装完成！
echo ========================================
echo.
echo 双击托盘图标或右键选择"显示窗口"打开界面
echo.
pause
