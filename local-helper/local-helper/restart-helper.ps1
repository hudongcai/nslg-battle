# ========================================
# 本地助手重启脚本
# 功能：彻底停止并重新启动本地助手
# ========================================

Write-Host "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━" -ForegroundColor Cyan
Write-Host "  本地助手重启脚本" -ForegroundColor Green
Write-Host "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━" -ForegroundColor Cyan
Write-Host ""

$scriptDir = $PSScriptRoot

# ========== 1. 停止所有进程 ==========
Write-Host "1. 停止所有本地助手进程..." -ForegroundColor Yellow

# 停止 UI 进程
$uiStopped = 0
Get-Process powershell -ErrorAction SilentlyContinue | ForEach-Object {
    try {
        $cmd = (Get-CimInstance Win32_Process -Filter "ProcessId=$($_.Id)" -ErrorAction SilentlyContinue).CommandLine
        if ($cmd -like "*helper-ui.ps1*") {
            Stop-Process -Id $_.Id -Force -ErrorAction SilentlyContinue
            Write-Host "   ✅ 停止 UI: PID=$($_.Id)" -ForegroundColor Green
            $uiStopped++
        }
    } catch {}
}

if ($uiStopped -eq 0) {
    Write-Host "   ℹ️  没有运行中的 UI 进程" -ForegroundColor Gray
}

# 停止 Worker 进程
$workerStopped = 0
Get-Process node -ErrorAction SilentlyContinue | ForEach-Object {
    try {
        $cmd = (Get-CimInstance Win32_Process -Filter "ProcessId=$($_.Id)" -ErrorAction SilentlyContinue).CommandLine
        if ($cmd -like "*local-helper.js*") {
            Stop-Process -Id $_.Id -Force -ErrorAction SilentlyContinue
            Write-Host "   ✅ 停止 Worker: PID=$($_.Id)" -ForegroundColor Green
            $workerStopped++
        }
    } catch {}
}

if ($workerStopped -eq 0) {
    Write-Host "   ℹ️  没有运行中的 Worker 进程" -ForegroundColor Gray
}

# 删除 PID 文件
$pidPath = Join-Path $scriptDir 'local-helper.pid'
if (Test-Path $pidPath) {
    Remove-Item $pidPath -Force -ErrorAction SilentlyContinue
    Write-Host "   ✅ 已删除 PID 文件" -ForegroundColor Green
}

Start-Sleep -Seconds 3

# ========== 2. 验证停止 ==========
Write-Host "`n2. 验证停止..." -ForegroundColor Yellow

$remainingUi = Get-Process powershell -ErrorAction SilentlyContinue | Where-Object {
    try {
        $cmd = (Get-CimInstance Win32_Process -Filter "ProcessId=$($_.Id)" -ErrorAction SilentlyContinue).CommandLine
        $cmd -like "*helper-ui.ps1*"
    } catch { $false }
}

$remainingWorker = Get-Process node -ErrorAction SilentlyContinue | Where-Object {
    try {
        $cmd = (Get-CimInstance Win32_Process -Filter "ProcessId=$($_.Id)" -ErrorAction SilentlyContinue).CommandLine
        $cmd -like "*local-helper.js*"
    } catch { $false }
}

if ($remainingUi -or $remainingWorker) {
    Write-Host "   ⚠️  还有残留进程，强制停止..." -ForegroundColor Red
    if ($remainingUi) {
        $remainingUi | ForEach-Object { Stop-Process -Id $_.Id -Force -ErrorAction SilentlyContinue }
    }
    if ($remainingWorker) {
        $remainingWorker | ForEach-Object { Stop-Process -Id $_.Id -Force -ErrorAction SilentlyContinue }
    }
    Start-Sleep -Seconds 2
}

Write-Host "   ✅ 所有进程已停止" -ForegroundColor Green

# ========== 3. 启动新进程 ==========
Write-Host "`n3. 启动本地助手..." -ForegroundColor Yellow

$uiScript = Join-Path $scriptDir 'helper-ui.ps1'

if (-not (Test-Path $uiScript)) {
    Write-Host "   ❌ 找不到 helper-ui.ps1" -ForegroundColor Red
    Write-Host "   路径: $uiScript" -ForegroundColor Red
    exit 1
}

try {
    Start-Process powershell -ArgumentList "-NoProfile", "-ExecutionPolicy", "Bypass", "-File", $uiScript -WindowStyle Hidden
    Write-Host "   ✅ 本地助手已启动" -ForegroundColor Green
} catch {
    Write-Host "   ❌ 启动失败: $($_.Exception.Message)" -ForegroundColor Red
    exit 1
}

Start-Sleep -Seconds 8

# ========== 4. 验证启动 ==========
Write-Host "`n4. 验证启动..." -ForegroundColor Yellow

$newUi = Get-Process powershell -ErrorAction SilentlyContinue | Where-Object {
    try {
        $cmd = (Get-CimInstance Win32_Process -Filter "ProcessId=$($_.Id)" -ErrorAction SilentlyContinue).CommandLine
        $cmd -like "*helper-ui.ps1*"
    } catch { $false }
}

$newWorker = Get-Process node -ErrorAction SilentlyContinue | Where-Object {
    try {
        $cmd = (Get-CimInstance Win32_Process -Filter "ProcessId=$($_.Id)" -ErrorAction SilentlyContinue).CommandLine
        $cmd -like "*local-helper.js*"
    } catch { $false }
}

if ($newUi) {
    Write-Host "   ✅ UI 进程运行中: PID=$($newUi.Id)" -ForegroundColor Green
} else {
    Write-Host "   ⚠️  UI 进程未启动" -ForegroundColor Red
}

if ($newWorker) {
    Write-Host "   ✅ Worker 进程运行中: PID=$($newWorker.Id)" -ForegroundColor Green
} else {
    Write-Host "   ⚠️  Worker 进程未启动（可能正在启动中）" -ForegroundColor Yellow
}

# ========== 5. 检查日志 ==========
Write-Host "`n5. 检查日志..." -ForegroundColor Yellow

Start-Sleep -Seconds 3

$logFile = Join-Path $scriptDir 'local-helper.log.json'
if (Test-Path $logFile) {
    try {
        $logs = Get-Content $logFile -Raw -Encoding UTF8 | ConvertFrom-Json
        Write-Host "   ✅ 日志文件正常: $($logs.Count) 条日志" -ForegroundColor Green

        # 显示最新3条
        $logs | Select-Object -Last 3 | ForEach-Object {
            $time = ([DateTime]$_.timestamp).ToString("HH:mm:ss")
            Write-Host "      [$time] $($_.message)" -ForegroundColor Gray
        }
    } catch {
        Write-Host "   ⚠️  日志文件解析失败" -ForegroundColor Yellow
    }
} else {
    Write-Host "   ℹ️  日志文件尚未生成（等待 Worker 启动）" -ForegroundColor Gray
}

# ========== 完成 ==========
Write-Host "`n━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━" -ForegroundColor Cyan
Write-Host "  ✅ 重启完成！" -ForegroundColor Green
Write-Host "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━" -ForegroundColor Cyan
Write-Host ""
Write-Host "提示：" -ForegroundColor Yellow
Write-Host "  - 托盘图标可能需要几秒钟才会出现" -ForegroundColor White
Write-Host "  - 点击托盘图标可以打开本地助手界面" -ForegroundColor White
Write-Host "  - 日志会自动每3秒刷新一次" -ForegroundColor White
Write-Host ""
