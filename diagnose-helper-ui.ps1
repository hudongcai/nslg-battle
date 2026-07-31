# 诊断本地助手UI日志路径问题
# 请让客户在本地助手安装目录运行此脚本

Write-Host "========== 本地助手日志诊断 ==========" -ForegroundColor Cyan
Write-Host ""

# 1. 当前脚本所在目录
$scriptDir = $PSScriptRoot
Write-Host "1. 脚本所在目录 (\$PSScriptRoot):" -ForegroundColor Yellow
Write-Host "   $scriptDir" -ForegroundColor White
Write-Host ""

# 2. 检查关键文件
Write-Host "2. 检查关键文件:" -ForegroundColor Yellow
$files = @(
    'local-helper.log.json',
    'helper-ui.ps1',
    'local-helper.js',
    'local-helper.config.json',
    'local-helper.pid'
)

foreach ($file in $files) {
    $fullPath = Join-Path $scriptDir $file
    $exists = Test-Path $fullPath
    $status = if ($exists) { "✅ 存在" } else { "❌ 不存在" }
    $color = if ($exists) { "Green" } else { "Red" }

    Write-Host "   $status $file" -ForegroundColor $color
    if ($exists) {
        $size = (Get-Item $fullPath).Length
        Write-Host "      路径: $fullPath" -ForegroundColor Gray
        Write-Host "      大小: $size 字节" -ForegroundColor Gray
    }
}
Write-Host ""

# 3. 检查运行中的进程
Write-Host "3. 检查运行中的进程:" -ForegroundColor Yellow
$nodeProcesses = Get-Process -Name node -ErrorAction SilentlyContinue
if ($nodeProcesses) {
    Write-Host "   ✅ 找到 $($nodeProcesses.Count) 个 node.exe 进程" -ForegroundColor Green
    foreach ($proc in $nodeProcesses) {
        Write-Host "      PID: $($proc.Id), 工作目录: $($proc.Path)" -ForegroundColor Gray
    }
} else {
    Write-Host "   ❌ 未找到 node.exe 进程" -ForegroundColor Red
}
Write-Host ""

# 4. 读取日志文件内容（如果存在）
$logPath = Join-Path $scriptDir 'local-helper.log.json'
if (Test-Path $logPath) {
    Write-Host "4. 日志文件内容（最后5条）:" -ForegroundColor Yellow
    try {
        $logContent = Get-Content -Path $logPath -Raw -Encoding UTF8
        $logs = $logContent | ConvertFrom-Json
        $recentLogs = $logs | Select-Object -Last 5

        foreach ($log in $recentLogs) {
            Write-Host "   [$($log.time)] $($log.level): $($log.message)" -ForegroundColor Cyan
        }
        Write-Host ""
        Write-Host "   ✅ 日志文件可以正常读取，共 $($logs.Count) 条记录" -ForegroundColor Green
    } catch {
        Write-Host "   ❌ 读取日志文件失败: $($_.Exception.Message)" -ForegroundColor Red
    }
} else {
    Write-Host "4. 日志文件:" -ForegroundColor Yellow
    Write-Host "   ❌ local-helper.log.json 不存在于 $scriptDir" -ForegroundColor Red
}
Write-Host ""

# 5. 检查可能的安装位置
Write-Host "5. 检查可能的安装位置:" -ForegroundColor Yellow
$possiblePaths = @(
    "$env:LOCALAPPDATA\ZhenwuLocalHelper",
    "$env:PROGRAMFILES\zhenwu-local-helper",
    "${env:PROGRAMFILES(x86)}\zhenwu-local-helper",
    "$env:APPDATA\ZhenwuLocalHelper"
)

foreach ($path in $possiblePaths) {
    if (Test-Path $path) {
        Write-Host "   ✅ 找到: $path" -ForegroundColor Green
        $logInPath = Join-Path $path 'local-helper.log.json'
        if (Test-Path $logInPath) {
            Write-Host "      ✅ 该目录下有日志文件" -ForegroundColor Green
        } else {
            Write-Host "      ⚠️  该目录下无日志文件" -ForegroundColor Yellow
        }
    }
}
Write-Host ""

Write-Host "========== 诊断完成 ==========" -ForegroundColor Cyan
Write-Host ""
Write-Host "请将以上输出截图发给开发人员" -ForegroundColor Yellow
Write-Host ""
Read-Host "按回车键退出"
