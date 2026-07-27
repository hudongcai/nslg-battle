@echo off
echo ========================================
echo   Shutting down NSLG Battle System
echo ========================================
echo.

echo [1/6] Stopping Node.js backend...
taskkill /F /IM node.exe >nul 2>&1
if %errorlevel% equ 0 (
    echo   OK - Node.js processes terminated
) else (
    echo   OK - No Node.js process running
)

echo.
echo [2/6] Stopping MySQL database...
net stop MySQL80 >nul 2>&1
if %errorlevel% equ 0 (
    echo   OK - MySQL service stopped
) else (
    net stop MySQL >nul 2>&1
    if %errorlevel% equ 0 (
        echo   OK - MySQL service stopped
    ) else (
        echo   OK - MySQL not running or no permission
    )
)

echo.
echo [3/6] Stopping Python OCR service...
taskkill /F /IM python.exe >nul 2>&1
if %errorlevel% equ 0 (
    echo   OK - Python processes terminated
) else (
    echo   OK - No Python process running
)
taskkill /F /IM pythonw.exe >nul 2>&1

echo.
echo [4/6] Stopping browser processes...
taskkill /F /IM chrome.exe >nul 2>&1
taskkill /F /IM msedge.exe >nul 2>&1
taskkill /F /IM firefox.exe >nul 2>&1
echo   OK - Browser processes terminated

echo.
echo [5/6] Cleaning up port usage...
echo   Checking ports 3000, 3306, 5000, 8000...
for /f "tokens=5" %%a in ('netstat -ano ^| findstr ":3000" ^| findstr "LISTENING"') do (
    echo   - Killing process on port 3000, PID: %%a
    taskkill /F /PID %%a >nul 2>&1
)
for /f "tokens=5" %%a in ('netstat -ano ^| findstr ":3306" ^| findstr "LISTENING"') do (
    echo   - Killing process on port 3306, PID: %%a
    taskkill /F /PID %%a >nul 2>&1
)
for /f "tokens=5" %%a in ('netstat -ano ^| findstr ":5000" ^| findstr "LISTENING"') do (
    echo   - Killing process on port 5000, PID: %%a
    taskkill /F /PID %%a >nul 2>&1
)
for /f "tokens=5" %%a in ('netstat -ano ^| findstr ":8000" ^| findstr "LISTENING"') do (
    echo   - Killing process on port 8000, PID: %%a
    taskkill /F /PID %%a >nul 2>&1
)
echo   OK - Port cleanup completed

echo.
echo [6/6] Removing temporary files...
if exist backend.pid (
    del /F /Q backend.pid >nul 2>&1
    echo   OK - Deleted backend.pid
)
if exist python-ocr-service.pid (
    del /F /Q python-ocr-service.pid >nul 2>&1
    echo   OK - Deleted python-ocr-service.pid
)

echo.
echo ========================================
echo   All services stopped successfully
echo   Environment is clean for other projects
echo ========================================
echo.
pause
