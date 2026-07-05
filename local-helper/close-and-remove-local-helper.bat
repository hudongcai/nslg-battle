@echo off
set "INSTALL_DIR=%LOCALAPPDATA%\ZhenwuLocalHelper"
cd /d %TEMP%
powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0uninstall-local-helper.ps1"
