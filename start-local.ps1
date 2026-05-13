# 启动三谋项目开发环境
param(
    [switch]$FrontendOnly,
    [switch]$BackendOnly
)

$projectDir = "E:\nslg-battle4"
Set-Location $projectDir

# 检查端口占用
function Test-Port($port) {
    $connection = Get-NetTCPConnection -LocalPort $port -ErrorAction SilentlyContinue
    return $connection -ne $null
}

# 停止占用端口的进程
function Stop-PortProcess($port) {
    $proc = Get-NetTCPConnection -LocalPort $port -ErrorAction SilentlyContinue | 
            Select-Object -ExpandProperty OwningProcess
    if ($proc) {
        Write-Host "停止端口 $port 的进程 PID: $proc" -ForegroundColor Yellow
        Stop-Process -Id $proc -Force -ErrorAction SilentlyContinue
        Start-Sleep -Seconds 1
    }
}

Write-Host "========================================" -ForegroundColor Cyan
Write-Host "  三谋队伍克制分析工具 - 开发环境启动" -ForegroundColor Cyan
Write-Host "========================================" -ForegroundColor Cyan
Write-Host ""

# 启动后端
if (-not $FrontendOnly) {
    if (Test-Port 3000) {
        Stop-PortProcess 3000
    }
    
    Write-Host "[后端] 启动 API 服务 (端口 3000)..." -ForegroundColor Green
    Start-Process -FilePath "powershell" -ArgumentList "-Command", "cd '$projectDir'; node nslg-backend.js" -WindowStyle Hidden
    Start-Sleep -Seconds 2
    
    # 验证后端
    try {
        $response = Invoke-WebRequest -Uri "http://localhost:3000" -Method GET -TimeoutSec 3 -ErrorAction SilentlyContinue
        Write-Host "[后端] ✅ 服务运行正常" -ForegroundColor Green
    } catch {
        Write-Host "[后端] ⚠️ 服务可能未完全启动，请检查日志" -ForegroundColor Yellow
    }
}

# 启动前端
if (-not $BackendOnly) {
    if (Test-Port 8080) {
        Stop-PortProcess 8080
    }
    
    Write-Host "[前端] 启动页面服务 (端口 8080)..." -ForegroundColor Green
    Start-Process -FilePath "powershell" -ArgumentList "-Command", "cd '$projectDir'; npx serve -l 8080 -s ." -WindowStyle Hidden
    Start-Sleep -Seconds 2
    
    # 验证前端
    try {
        $response = Invoke-WebRequest -Uri "http://localhost:8080" -Method GET -TimeoutSec 3 -ErrorAction SilentlyContinue
        Write-Host "[前端] ✅ 服务运行正常" -ForegroundColor Green
    } catch {
        Write-Host "[前端] ⚠️ 服务可能未完全启动" -ForegroundColor Yellow
    }
}

Write-Host ""
Write-Host "========================================" -ForegroundColor Cyan
Write-Host "  访问地址" -ForegroundColor Cyan
if (-not $BackendOnly) { Write-Host "  前端: http://localhost:8080" -ForegroundColor White }
if (-not $FrontendOnly) { Write-Host "  后端: http://localhost:3000" -ForegroundColor White }
Write-Host "========================================" -ForegroundColor Cyan
