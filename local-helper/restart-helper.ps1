# ========================================
# 本地助手重启脚本
# 功能：彻底停止并重新启动本地助手
# ========================================

Write-Host "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━" -ForegroundColor Cyan
Write-Host "  本地助手重启脚本" -ForegroundColor Green
Write-Host "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━" -ForegroundColor Cyan
Write-Host ""

$scriptDir = $PSScriptRoot

# 1. 停止所有进程
Write-Host "1. 停止所有本地助手进程..." -ForegroundColor Yellow

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

$pidPath = Join-Path $scriptDir 'local-helper.pid'
if (Test-Path $pidPath) {
    Remove-Item $pidPath -Force -ErrorAction SilentlyContinue
    Write-Host "   ✅ 已删除 PID 文件" -ForegroundColor Green
}

Write-Host "   已停止 $uiStopped 个 UI, $workerStopped 个 Worker" -ForegroundColor Gray

Start-Sleep -Seconds 3

# 2. 启动新进程
Write-Host "`n2. 启动本地助手..." -ForegroundColor Yellow

$uiScript = Join-Path $scriptDir 'helper-ui.ps1'
Start-Process powershell -ArgumentList "-NoProfile", "-ExecutionPolicy", "Bypass", "-File", $uiScript -WindowStyle Hidden
Write-Host "   ✅ 本地助手已启动" -ForegroundColor Green

Start-Sleep -Seconds 10

# 3. 验证
Write-Host "`n3. 验证启动..." -ForegroundColor Yellow

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
    Write-Host "   ✅ UI 运行中: PID=$($newUi.Id)" -ForegroundColor Green
} else {
    Write-Host "   ❌ UI 未运行" -ForegroundColor Red
}

if ($newWorker) {
    Write-Host "   ✅ Worker 运行中: PID=$($newWorker.Id)" -ForegroundColor Green
} else {
    Write-Host "   ⚠️  Worker 未运行（可能正在启动）" -ForegroundColor Yellow
}

# 4. 检查日志
Start-Sleep -Seconds 3

$logFile = Join-Path $scriptDir 'local-helper.log.json'
if (Test-Path $logFile) {
    try {
        $logs = Get-Content $logFile -Raw -Encoding UTF8 | ConvertFrom-Json
        Write-Host "`n   ✅ 日志: $($logs.Count) 条" -ForegroundColor Green
    } catch {}
}

Write-Host "`n━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━" -ForegroundColor Cyan
Write-Host "  ✅ 重启完成！" -ForegroundColor Green
Write-Host "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━" -ForegroundColor Cyan
Write-Host ""
Write-Host "提示：" -ForegroundColor Yellow
Write-Host "  - 托盘图标可能需要几秒钟才会出现" -ForegroundColor White
Write-Host "  - 点击托盘图标可以打开本地助手界面" -ForegroundColor White
Write-Host ""
