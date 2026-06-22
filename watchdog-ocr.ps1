# OCR 进程守护 — 崩溃自动拉起，保障长时间稳定运行
# 用法: .\watchdog-ocr.ps1 [-MaxRestarts 100] [-RapidFailLimit 5]
param(
    [int]$MaxRestarts = 100,      # 总重启上限
    [int]$RapidFailLimit = 5      # 连续快速失败上限（<60秒内崩溃）
)

$projectDir = "C:\nslg-battle"
$pythonPath = "C:\Users\Administrator\AppData\Local\Programs\Python\Python312\python.exe"
$logFile = Join-Path $projectDir "watchdog-ocr.log"
$ocrScript = Join-Path $projectDir "ocr_paddle_service.py"

# ── 日志函数 ──
function Write-WatchLog($msg) {
    $ts = Get-Date -Format "yyyy-MM-dd HH:mm:ss"
    $line = "[$ts] $msg"
    Write-Host $line
    try { Add-Content -Path $logFile -Value $line -Encoding UTF8 } catch {}
}

# ── 检查前置条件 ──
if (-not (Test-Path $pythonPath)) {
    Write-WatchLog "ERROR: Python 路径不存在: $pythonPath"
    exit 1
}
if (-not (Test-Path $ocrScript)) {
    Write-WatchLog "ERROR: OCR 脚本不存在: $ocrScript"
    exit 1
}

# ── 检查是否已有实例在运行 ──
$existing = Get-NetTCPConnection -LocalPort 8003 -ErrorAction SilentlyContinue
if ($existing) {
    Write-WatchLog "WARN: 端口 8003 已被占用，尝试停止现有进程..."
    $pid = $existing | Select-Object -ExpandProperty OwningProcess -First 1
    if ($pid) {
        try { Stop-Process -Id $pid -Force; Start-Sleep -Seconds 2 } catch {}
    }
}

# ── 日志轮转（保留最近 3 份，不覆盖历史）──
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

# ── 主循环 ──
$restartCount = 0
$rapidFailCount = 0
$lastStartTime = Get-Date

Write-WatchLog "========================================"
Write-WatchLog "OCR 进程守护启动"
Write-WatchLog "  脚本: $ocrScript"
Write-WatchLog "  最大重启: $MaxRestarts  快速失败上限: $RapidFailLimit"
Write-WatchLog "========================================"

while ($restartCount -lt $MaxRestarts) {
    if ($restartCount -gt 0) {
        # 退避延迟：连续快速失败时延长等待
        if ($rapidFailCount -ge 3) {
            $waitSec = [Math]::Min(60, 10 * [Math]::Pow(2, $rapidFailCount - 3))
            Write-WatchLog "连续快速失败 $rapidFailCount 次，等待 ${waitSec}s 后重试..."
            Start-Sleep -Seconds $waitSec
        } else {
            Write-WatchLog "等待 5s 后重启..."
            Start-Sleep -Seconds 5
        }
    }

    # 检查是否超过快速失败上限
    if ($rapidFailCount -ge $RapidFailLimit) {
        Write-WatchLog "FATAL: 连续快速失败 $rapidFailCount 次（上限 $RapidFailLimit），退出守护"
        exit 2
    }

    $restartCount++
    Write-WatchLog "[启动 #$restartCount] 启动 PaddleOCR 服务..."
    $lastStartTime = Get-Date

    # 轮转日志，防止每次重启覆盖上次日志
    Rotate-ProcLog (Join-Path $projectDir "ocr_stdout.log")
    Rotate-ProcLog (Join-Path $projectDir "ocr_stderr.log")

    $proc = Start-Process -FilePath $pythonPath `
        -ArgumentList $ocrScript `
        -PassThru `
        -NoNewWindow `
        -RedirectStandardError (Join-Path $projectDir "ocr_stderr.log") `
        -RedirectStandardOutput (Join-Path $projectDir "ocr_stdout.log")

    # 等待进程退出
    try {
        $proc.WaitForExit()
    } catch {
        Write-WatchLog "WARN: 等待进程退出时出错: $_"
    }

    $exitCode = $proc.ExitCode
    $uptime = (Get-Date) - $lastStartTime
    $uptimeStr = "$($uptime.Hours)h$($uptime.Minutes)m$($uptime.Seconds)s"

    Write-WatchLog "[退出 #$restartCount] 进程 PID=$($proc.Id) ExitCode=$exitCode 运行时长=$uptimeStr"

    # 判断是否为快速失败（运行不到 60 秒就崩溃）
    if ($uptime.TotalSeconds -lt 60) {
        $rapidFailCount++
        Write-WatchLog "WARN: 快速失败 ($rapidFailCount/$RapidFailLimit) — 运行不足 60 秒"
    } else {
        # 正常运行超过 60 秒后崩溃 → 重置快速失败计数
        $rapidFailCount = [Math]::Max(0, $rapidFailCount - 2)
    }

    # 正常退出 (exit 0) → 不重启
    if ($exitCode -eq 0) {
        Write-WatchLog "INFO: 进程正常退出，守护结束"
        exit 0
    }
}

Write-WatchLog "INFO: 达到最大重启次数 ($MaxRestarts)，守护结束"
exit 3
