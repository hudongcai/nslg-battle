# 检查本地助手版本和运行状态

Write-Host "=== 真武本地助手诊断工具 ===" -ForegroundColor Cyan
Write-Host ""

# 1. 检查进程
Write-Host "1. 检查 node.exe 进程：" -ForegroundColor Yellow
$nodeProcs = Get-Process -Name "node" -ErrorAction SilentlyContinue
if ($nodeProcs) {
    foreach ($proc in $nodeProcs) {
        Write-Host "   找到进程 PID: $($proc.Id)" -ForegroundColor Green
        Write-Host "   启动时间: $($proc.StartTime)" -ForegroundColor Gray
        Write-Host "   工作目录: $($proc.Path)" -ForegroundColor Gray
    }
} else {
    Write-Host "   未找到 node.exe 进程" -ForegroundColor Red
}
Write-Host ""

# 2. 检查端口
Write-Host "2. 检查 9999 端口监听：" -ForegroundColor Yellow
$port9999 = Get-NetTCPConnection -LocalPort 9999 -ErrorAction SilentlyContinue
if ($port9999) {
    Write-Host "   端口 9999 正在监听" -ForegroundColor Green
    Write-Host "   进程 PID: $($port9999.OwningProcess)" -ForegroundColor Gray
} else {
    Write-Host "   端口 9999 未监听" -ForegroundColor Red
}
Write-Host ""

# 3. 测试连接
Write-Host "3. 测试 HTTP 连接：" -ForegroundColor Yellow
try {
    $response = Invoke-WebRequest -Uri "http://127.0.0.1:9999/ping" -TimeoutSec 3 -UseBasicParsing
    Write-Host "   连接成功！" -ForegroundColor Green
    Write-Host "   响应: $($response.Content)" -ForegroundColor Gray
} catch {
    Write-Host "   连接失败: $($_.Exception.Message)" -ForegroundColor Red
}
Write-Host ""

# 4. 检查安装路径
Write-Host "4. 检查安装位置：" -ForegroundColor Yellow
$possiblePaths = @(
    "$env:LOCALAPPDATA\Programs\zhenwu-local-helper",
    "$env:APPDATA\zhenwu-local-helper",
    "$env:ProgramFiles\zhenwu-local-helper",
    "${env:ProgramFiles(x86)}\zhenwu-local-helper"
)

$foundInstall = $false
foreach ($path in $possiblePaths) {
    if (Test-Path $path) {
        $foundInstall = $true
        Write-Host "   找到安装目录: $path" -ForegroundColor Green
        $helperJs = Join-Path $path "local-helper.js"
        if (Test-Path $helperJs) {
            $content = Get-Content $helperJs -Raw
            if ($content -match "createServer|http\.createServer") {
                Write-Host "   [OK] 包含 HTTP 服务器代码 (新版本)" -ForegroundColor Green
            } else {
                Write-Host "   [!!] 不包含 HTTP 服务器代码 (旧版本)" -ForegroundColor Red
            }
            $fileSize = (Get-Item $helperJs).Length / 1KB
            Write-Host "   文件大小: $([math]::Round($fileSize, 2)) KB" -ForegroundColor Gray
        }
    }
}

if (-not $foundInstall) {
    Write-Host "   未找到安装目录" -ForegroundColor Red
}
Write-Host ""

# 5. 桌面快捷方式
Write-Host "5. 检查桌面快捷方式：" -ForegroundColor Yellow
$shortcut = Join-Path $env:USERPROFILE "Desktop\Zhenwu Local Helper.lnk"
if (Test-Path $shortcut) {
    Write-Host "   [OK] 快捷方式存在" -ForegroundColor Green
} else {
    Write-Host "   [!!] 快捷方式不存在" -ForegroundColor Red
}
Write-Host ""

Write-Host "=== 诊断完成 ===" -ForegroundColor Cyan
