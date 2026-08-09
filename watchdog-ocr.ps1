# OCR process watchdog - auto-restart on crash for long-term stability
# Usage: .\watchdog-ocr.ps1 [-MaxRestarts 100] [-RapidFailLimit 5]
param(
    [int]$MaxRestarts = 100,
    [int]$RapidFailLimit = 5
)

$projectDir = "C:\nslg-battle"
$pythonPath = "C:\Users\Administrator\AppData\Local\Programs\Python\Python312\python.exe"
$logFile = Join-Path $projectDir "watchdog-ocr.log"
$ocrScript = Join-Path $projectDir "ocr_paddle_service.py"

function Write-WatchLog($msg) {
    $ts = Get-Date -Format "yyyy-MM-dd HH:mm:ss"
    $line = "[$ts] $msg"
    Write-Host $line
    try { Add-Content -Path $logFile -Value $line -Encoding UTF8 } catch {}
}

if (-not (Test-Path $pythonPath)) {
    $ts = Get-Date -Format "yyyy-MM-dd HH:mm:ss"
    "[{0}] ERROR: Python not found: {1}" -f $ts, $pythonPath | Add-Content -Path $logFile -Encoding UTF8
    exit 1
}
if (-not (Test-Path $ocrScript)) {
    $ts = Get-Date -Format "yyyy-MM-dd HH:mm:ss"
    "[{0}] ERROR: OCR script not found: {1}" -f $ts, $ocrScript | Add-Content -Path $logFile -Encoding UTF8
    exit 1
}

$existing = Get-NetTCPConnection -LocalPort 8003 -ErrorAction SilentlyContinue
if ($existing) {
    Write-WatchLog "WARN: port 8003 already in use, stopping existing process..."
    $pid8003 = $existing | Select-Object -ExpandProperty OwningProcess -First 1
    if ($pid8003) {
        try { Stop-Process -Id $pid8003 -Force; Start-Sleep -Seconds 2 } catch {}
    }
}

function Rotate-ProcLog($path) {
    if (-not (Test-Path $path)) { return }
    $base = $path -replace '\.log$', ''
    for ($i = 2; $i -ge 1; $i--) {
        $src = "$base.$i.log"
        $dst = "$base.$($i + 1).log"
        if (Test-Path $src) {
            try { Move-Item $src $dst -Force -ErrorAction Stop } catch {}
        }
    }
    try { Move-Item $path "$base.1.log" -Force -ErrorAction Stop } catch {}
}

$restartCount = 0
$rapidFailCount = 0
$lastStartTime = Get-Date

Write-WatchLog "========================================"
Write-WatchLog "OCR watchdog started"
Write-WatchLog "  script: $ocrScript"
Write-WatchLog "  max restarts: $MaxRestarts  rapid fail limit: $RapidFailLimit"
Write-WatchLog "========================================"

while ($true) {
    if ($restartCount -gt 0) {
        if ($rapidFailCount -ge 3) {
            $waitSec = [Math]::Min(60, 10 * [Math]::Pow(2, $rapidFailCount - 3))
            Write-WatchLog "Rapid fail ${rapidFailCount}x, waiting ${waitSec}s before retry..."
            Start-Sleep -Seconds $waitSec
        } else {
            Write-WatchLog "Waiting 5s before restart..."
            Start-Sleep -Seconds 5
        }
    }

    if ($rapidFailCount -ge $RapidFailLimit) {
        Write-WatchLog "FATAL: rapid fail limit reached ($rapidFailCount/$RapidFailLimit), watchdog exit"
        exit 2
    }

    $restartCount++

    # 每100次重启后重置计数器，避免数字过大，方便日志阅读
    if ($restartCount -gt $MaxRestarts) {
        Write-WatchLog "INFO: restart count reached $MaxRestarts, resetting counter to 1 (watchdog continues)"
        $restartCount = 1
    }

    Write-WatchLog "[start #$restartCount] launching PaddleOCR service..."
    $lastStartTime = Get-Date

    Rotate-ProcLog (Join-Path $projectDir "ocr_stdout.log")
    Rotate-ProcLog (Join-Path $projectDir "ocr_stderr.log")

    $proc = Start-Process -FilePath $pythonPath `
        -ArgumentList $ocrScript `
        -PassThru `
        -NoNewWindow `
        -RedirectStandardError (Join-Path $projectDir "ocr_stderr.log") `
        -RedirectStandardOutput (Join-Path $projectDir "ocr_stdout.log")

    try {
        $proc.WaitForExit()
    } catch {
        Write-WatchLog "WARN: error waiting for process exit: $_"
    }

    $exitCode = $proc.ExitCode
    # PS5.1: Start-Process -NoNewWindow ExitCode sometimes empty; fallback to stderr log
    if ($exitCode -eq $null -or $exitCode -eq '') {
        $stderrPath = Join-Path $projectDir "ocr_stderr.log"
        if (Test-Path $stderrPath) {
            $tail = Get-Content $stderrPath -Tail 5 -ErrorAction SilentlyContinue
            if ($tail -match '主动退出\(42\)') { $exitCode = 42 }
            elseif ($tail -match 'FATAL|Traceback|CUDA_ERROR|out of memory|MemoryError') { $exitCode = 1 }
        }
        if ($exitCode -eq $null -or $exitCode -eq '') { $exitCode = -1 }
    }
    $uptime = (Get-Date) - $lastStartTime
    $uptimeStr = "$($uptime.Hours)h$($uptime.Minutes)m$($uptime.Seconds)s"

    Write-WatchLog "[exit #$restartCount] PID=$($proc.Id) ExitCode=$exitCode uptime=$uptimeStr"

    if ($uptime.TotalSeconds -lt 60 -and $exitCode -ne 42) {
        $rapidFailCount++
        Write-WatchLog "WARN: rapid fail ($rapidFailCount/$RapidFailLimit) - crashed within 60s"
    } elseif ($exitCode -eq 42) {
        # Memory watchdog initiated restart - not a failure
        $rapidFailCount = [Math]::Max(0, $rapidFailCount - 2)
    } else {
        $rapidFailCount = [Math]::Max(0, $rapidFailCount - 2)
    }

    if ($exitCode -eq 0) {
        Write-WatchLog "INFO: process exited normally (code 0), watchdog done"
        exit 0
    }
    if ($exitCode -eq 42) {
        Write-WatchLog "INFO: planned memory-restart (code 42), restarting immediately..."
        continue
    }
}