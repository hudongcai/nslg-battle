@echo off
chcp 65001 >nul
echo ========================================
echo Stop OCR Service
echo ========================================
echo.

REM Find and kill Python OCR process
echo [1] Checking Python OCR process...
for /f "tokens=2" %%i in ('tasklist /FI "IMAGENAME eq python.exe" /NH 2^>nul ^| findstr python') do (
    echo Found Python process: %%i
    taskkill /F /PID %%i >nul 2>&1
    if !errorlevel! equ 0 (
        echo    Killed PID %%i
    )
)

REM Check port 8003 and kill process using it
echo.
echo [2] Checking port 8003...
powershell -Command "$conn = Get-NetTCPConnection -LocalPort 8003 -ErrorAction SilentlyContinue; if ($conn) { $pid = $conn.OwningProcess; Write-Host ('Port 8003 occupied by PID: ' + $pid); Stop-Process -Id $pid -Force -ErrorAction SilentlyContinue; Start-Sleep -Seconds 1; Write-Host 'Process stopped' } else { Write-Host 'Port 8003 is free' }"

REM Clean up PID file
echo.
echo [3] Cleaning up PID file...
if exist "ocr_paddle.pid" (
    del /F /Q "ocr_paddle.pid" >nul 2>&1
    echo    ocr_paddle.pid deleted
) else (
    echo    No PID file found
)

echo.
echo ========================================
echo OCR service stopped
echo ========================================
