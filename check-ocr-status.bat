@echo off
chcp 65001 >nul
echo ========================================
echo OCR Service Status Monitor
echo ========================================
echo.

REM Check OCR process
echo [1] OCR Process Status
echo ----------------------------------------
powershell -Command "Get-Process | Where-Object { $_.ProcessName -match 'python' } | Select-Object @{Name='PID';Expression={$_.Id}}, @{Name='Name';Expression={$_.ProcessName}}, @{Name='CPU_Sec';Expression={[math]::Round($_.CPU,2)}}, @{Name='Memory_MB';Expression={[math]::Round($_.WorkingSet/1MB,2)}}, @{Name='StartTime';Expression={$_.StartTime.ToString('MM-dd HH:mm:ss')}} | Format-Table -AutoSize"
echo.

REM Check port
echo [2] OCR Port Status (8003)
echo ----------------------------------------
powershell -Command "$conn = Get-NetTCPConnection -LocalPort 8003 -ErrorAction SilentlyContinue; if ($conn) { $proc = Get-Process -Id $conn.OwningProcess -ErrorAction SilentlyContinue; Write-Host ('Port: 8003 State: {0} PID: {1} Process: {2}' -f $conn.State, $conn.OwningProcess, $proc.ProcessName) } else { Write-Host 'Port 8003 is not in use - OCR service may not be running' -ForegroundColor Red }"
echo.

REM Show PID file
echo [3] PID File
echo ----------------------------------------
if exist "ocr_paddle.pid" (
    echo ocr_paddle.pid:
    type ocr_paddle.pid
) else (
    echo ocr_paddle.pid not found
)
echo.

REM Show latest OCR logs
echo [4] Latest OCR Logs (last 20 lines)
echo ----------------------------------------
echo --- ocr_stderr.log ---
powershell -Command "if (Test-Path 'ocr_stderr.log') { Get-Content ocr_stderr.log -Tail 20 -Encoding UTF8 | ForEach-Object { $_ } } else { Write-Host 'Log file not found' }"
echo.
echo --- ocr_stdout.log ---
powershell -Command "if (Test-Path 'ocr_stdout.log') { Get-Content ocr_stdout.log -Tail 10 -Encoding UTF8 | ForEach-Object { $_ } } else { Write-Host 'Log file not found' }"
echo.

REM Show recent processing time
echo [5] Recent Processing Records
echo ----------------------------------------
powershell -Command "$files = @('ocr_stderr.log', 'ocr_paddle.log', 'ocr_service.log'); foreach ($f in $files) { if (Test-Path $f) { $item = Get-Item $f; Write-Host ('{0,-20} Last Modified: {1}' -f $f, $item.LastWriteTime.ToString('yyyy-MM-dd HH:mm:ss')) } }"
echo.

REM System resources
echo [6] System Memory Usage
echo ----------------------------------------
powershell -Command "$os = Get-CimInstance Win32_OperatingSystem; $total = [math]::Round($os.TotalVisibleMemorySize/1MB,2); $free = [math]::Round($os.FreePhysicalMemory/1MB,2); $used = $total - $free; $percent = [math]::Round(($used/$total)*100,2); Write-Host ('Total: {0} GB Used: {1} GB ({2}%%) Free: {3} GB' -f $total, $used, $percent, $free)"
echo.

echo ========================================
echo Monitoring Complete - Press any key to exit
pause >nul
