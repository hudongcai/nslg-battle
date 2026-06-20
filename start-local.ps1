# 启动三谋项目开发环境
param(
    [switch]$FrontendOnly,
    [switch]$BackendOnly,
    [switch]$NoTunnel,
    [switch]$NoScreenshot
)

$projectDir = "C:\nslg-battle"
$screenshotDir = "C:\AutoScreenshotTool2"
$pythonPath = "C:\Users\Administrator\AppData\Local\Programs\Python\Python312\python.exe"
$cloudflaredConfig = "C:\Users\Administrator\.cloudflared\config.yml"

Set-Location $projectDir

function Test-Port($port) {
    return $null -ne (Get-NetTCPConnection -LocalPort $port -ErrorAction SilentlyContinue)
}

function Stop-PortProcess($port) {
    $proc = Get-NetTCPConnection -LocalPort $port -ErrorAction SilentlyContinue |
            Select-Object -ExpandProperty OwningProcess -First 1
    if ($proc) {
        Write-Host "停止端口 $port 的进程 PID: $proc" -ForegroundColor Yellow
        Stop-Process -Id $proc -Force -ErrorAction SilentlyContinue
        Start-Sleep -Seconds 1
    }
}

Write-Host "========================================" -ForegroundColor Cyan
Write-Host "  三谋战报系统 + 截图工具 - 启动" -ForegroundColor Cyan
Write-Host "========================================" -ForegroundColor Cyan
Write-Host ""

# ── 1. 后端 ──────────────────────────────────
if (-not $FrontendOnly) {
    if (Test-Port 3000) { Stop-PortProcess 3000 }

    Write-Host "[1/3] 启动后端 API 服务 (端口 3000)..." -ForegroundColor Green
    Start-Process powershell -ArgumentList "-NoExit", "-Command", "cd '$projectDir'; node nslg-backend.js" -WindowStyle Normal
    Start-Sleep -Seconds 3

    if (Test-Port 3000) {
        Write-Host "[后端] OK  http://localhost:3000" -ForegroundColor Green
    } else {
        Write-Host "[后端] 警告：端口 3000 未监听，请检查窗口日志" -ForegroundColor Yellow
    }
}

# ── 2. 前端 ──────────────────────────────────
if (-not $BackendOnly) {
    if (Test-Port 8080) { Stop-PortProcess 8080 }

    Write-Host "[2/3] 启动前端静态服务 (端口 8080)..." -ForegroundColor Green
    if (Test-Path $pythonPath) {
        Start-Process powershell -ArgumentList "-NoExit", "-Command", "cd '$projectDir'; & '$pythonPath' -m http.server 8080" -WindowStyle Normal
    } else {
        Start-Process powershell -ArgumentList "-NoExit", "-Command", "cd '$projectDir'; npx serve -l 8080 -s ." -WindowStyle Normal
    }
    Start-Sleep -Seconds 3

    if (Test-Port 8080) {
        Write-Host "[前端] OK  http://localhost:8080" -ForegroundColor Green
    } else {
        Write-Host "[前端] 警告：端口 8080 未监听" -ForegroundColor Yellow
    }
}

# ── 3. Cloudflare 隧道 ────────────────────────
if (-not $FrontendOnly -and -not $NoTunnel) {
    $cfRunning = Get-Process cloudflared -ErrorAction SilentlyContinue
    if ($cfRunning) {
        Write-Host "[3/3] Cloudflare 隧道已在运行 (PID: $($cfRunning.Id))" -ForegroundColor Green
    } elseif (Test-Path $cloudflaredConfig) {
        Write-Host "[3/3] 启动 Cloudflare 隧道..." -ForegroundColor Green
        Start-Process powershell -ArgumentList "-NoExit", "-Command", "cloudflared tunnel --config '$cloudflaredConfig' run" -WindowStyle Normal
        Start-Sleep -Seconds 4

        if (Get-Process cloudflared -ErrorAction SilentlyContinue) {
            Write-Host "[隧道] OK  api.zhenwu.fun -> localhost:3000" -ForegroundColor Green
        } else {
            Write-Host "[隧道] 警告：cloudflared 未检测到" -ForegroundColor Yellow
        }
    } else {
        Write-Host "[3/3] 跳过隧道：配置文件不存在 ($cloudflaredConfig)" -ForegroundColor DarkGray
    }
}

# ── 4. AutoScreenshotTool2 ───────────────────
if (-not $NoScreenshot) {
    if (Test-Path $screenshotDir) {
        Write-Host "[4/4] 启动 AutoScreenshotTool2..." -ForegroundColor Green
        Start-Process powershell -ArgumentList "-NoExit", "-Command", "cd '$screenshotDir'; & '$pythonPath' main.py --setup" -WindowStyle Normal
        Start-Sleep -Seconds 2
        Write-Host "[截图] OK  截图目录: $screenshotDir\screenshots" -ForegroundColor Green
    } else {
        Write-Host "[4/4] 跳过截图工具：目录不存在 ($screenshotDir)" -ForegroundColor DarkGray
    }
}

Write-Host ""
Write-Host "========================================" -ForegroundColor Cyan
Write-Host "  访问地址" -ForegroundColor Cyan
if (-not $BackendOnly)  { Write-Host "  前端: http://localhost:8080" -ForegroundColor White }
if (-not $FrontendOnly) { Write-Host "  后端: http://localhost:3000" -ForegroundColor White }
if (-not $FrontendOnly -and -not $NoTunnel) {
                          Write-Host "  生产: https://api.zhenwu.fun/api" -ForegroundColor White }
if (-not $NoScreenshot) { Write-Host "  截图: $screenshotDir\screenshots" -ForegroundColor White }
Write-Host ""
Write-Host "  参数说明:" -ForegroundColor DarkGray
Write-Host "    -FrontendOnly   仅启动前端" -ForegroundColor DarkGray
Write-Host "    -BackendOnly    仅启动后端+隧道" -ForegroundColor DarkGray
Write-Host "    -NoTunnel       跳过 Cloudflare 隧道" -ForegroundColor DarkGray
Write-Host "    -NoScreenshot   跳过 AutoScreenshotTool2" -ForegroundColor DarkGray
Write-Host "========================================" -ForegroundColor Cyan
