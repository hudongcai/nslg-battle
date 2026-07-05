@echo off
set "INSTALL_DIR=%LOCALAPPDATA%\ZhenwuLocalHelper"

call "%~dp0close-local-helper.bat"

echo.
echo Trying to remove install folder:
echo %INSTALL_DIR%

if not exist "%INSTALL_DIR%" (
  echo Install folder does not exist.
  pause
  exit /b 0
)

rmdir /s /q "%INSTALL_DIR%"

if exist "%INSTALL_DIR%" (
  echo Remove failed. Folder is still locked.
) else (
  echo Remove success. Install folder is cleared.
)

pause
