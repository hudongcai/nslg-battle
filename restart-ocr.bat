@echo off
chcp 65001 >nul
echo ========================================
echo Restart OCR Service
echo ========================================
echo.

REM Stop OCR first
echo Step 1: Stopping OCR service...
call stop-ocr.bat

echo.
echo Step 2: Waiting for cleanup...
ping 127.0.0.1 -n 4 >nul

echo.
echo Step 3: Starting OCR service...
echo ----------------------------------------

REM Check if watchdog script exists
if not exist "watchdog-ocr.ps1" (
    echo ERROR: watchdog-ocr.ps1 not found
    echo ========================================
    pause
    exit /b 1
)

REM Start OCR watchdog
echo Starting PaddleOCR watchdog...
powershell -NoProfile -ExecutionPolicy Bypass -File "watchdog-ocr.ps1" -WindowStyle Minimized

echo.
echo ========================================
echo OCR service restarted
echo ========================================
echo.
echo Please wait 30-60 seconds for model loading...
echo You can run check-ocr-status.bat to verify
echo ========================================
