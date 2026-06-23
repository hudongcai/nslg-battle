# 三谋战报系统 — 本地开发一键启动
# 用法: .\start-local.ps1 [-NoTunnel] [-NoOcr] [-NoScreenshot]
param(
    [switch]$NoTunnel,      # 跳过 Cloudflare 隧道
    [switch]$NoOcr,         # 跳过 PaddleOCR watchdog
    [switch]$NoScreenshot   # 跳过截图工具后台服务
)

$projectDir    = "C:\nslg-battle"
$screenshotDir = "C:\AutoScreenshotTool2"
$pythonPath    = "C:\Users\Administrator\AppData\Local\Programs\Python\Python312\python.exe"
$cfExe         = "C:\Users\Administrator\AppData\Local\Microsoft\WinGet\Links\cloudflared.exe"
$cfConfig      = "C:\Users\Administrator\.cloudflared\config.yml"

function Test-Port($port) {
    return $null -ne (Get-NetTCPConnection -LocalPort $port -ErrorAction SilentlyContinue)
}

function Kill-Port($port) {
    $pid = (Get-NetTCPConnection -LocalPort $port -ErrorAction SilentlyContinue |
            Select-Object -ExpandProperty OwningProcess -First 1)
    if ($pid) { Stop-Process -Id $pid -Force -ErrorAction SilentlyContinue; Start-Sleep -Seconds 1 }
}

Write-Host "========================================" -ForegroundColor Cyan
Write-Host "  三谋战报系统 - 启动" -ForegroundColor Cyan
Write-Host "========================================" -ForegroundColor Cyan

# -- 1. Node 后端 --
if (Test-Port 3000) { Kill-Port 3000 }
Write-Host "[1/4] 启动后端 API (port 3000)..." -ForegroundColor Green
Start-Process powershell -ArgumentList "-NoExit", "-Command", "Set-Location '$projectDir'; node nslg-backend.js" -WindowStyle Normal
Start-Sleep -Seconds 4
if (Test-Port 3000) { Write-Host "      OK  http://localhost:3000" -ForegroundColor Green }
else { Write-Host "      WARNING: port 3000 未监听，请检查窗口日志" -ForegroundColor Yellow }

# -- 2. PaddleOCR watchdog --
if (-not $NoOcr) {
    if (Test-Port 8003) {
        Write-Host "[2/4] PaddleOCR 已在运行 (port 8003)" -ForegroundColor Green
    } else {
        Write-Host "[2/4] 启动 PaddleOCR watchdog (port 8003)..." -ForegroundColor Green
        Start-Process powershell -ArgumentList "-NoExit", "-Command", "Set-Location '$projectDir'; .\watchdog-ocr.ps1" -WindowStyle Minimized
        Write-Host "      等待模型加载（约 30-60 秒）..." -ForegroundColor DarkGray
    }
} else { Write-Host "[2/4] 跳过 PaddleOCR" -ForegroundColor DarkGray }

# -- 3. Cloudflare 隧道 --
if (-not $NoTunnel) {
    if (Get-Process cloudflared -ErrorAction SilentlyContinue) {
        Write-Host "[3/4] Cloudflare 隧道已在运行" -ForegroundColor Green
    } elseif (Test-Path $cfExe) {
        Write-Host "[3/4] 启动 Cloudflare 隧道..." -ForegroundColor Green
        Start-Process powershell -ArgumentList "-NoExit", "-Command", "& '$cfExe' tunnel --config '$cfConfig' run" -WindowStyle Minimized
        Start-Sleep -Seconds 4
        if (Get-Process cloudflared -ErrorAction SilentlyContinue) {
            Write-Host "      OK  api.zhenwu.fun -> localhost:3000" -ForegroundColor Green
        } else { Write-Host "      WARNING: cloudflared 未检测到" -ForegroundColor Yellow }
    } else { Write-Host "[3/4] WARNING: cloudflared 不存在: $cfExe" -ForegroundColor Yellow }
} else { Write-Host "[3/4] 跳过 Cloudflare 隧道" -ForegroundColor DarkGray }

# -- 4. AutoScreenshotTool2 后台授权服务 --
if (-not $NoScreenshot) {
    if (Test-Port 8001) {
        Write-Host "[4/4] 截图工具授权服务已在运行 (port 8001)" -ForegroundColor Green
    } else {
        Write-Host "[4/4] 启动截图工具后台服务 (port 8001)..." -ForegroundColor Green
        Start-Process powershell -ArgumentList "-NoExit", "-Command",
            "Set-Location '$screenshotDir\server'; & '$pythonPath' -m uvicorn main:app --host 127.0.0.1 --port 8001" `
            -WindowStyle Minimized
        Start-Sleep -Seconds 3
        if (Test-Port 8001) { Write-Host "      OK  http://127.0.0.1:8001/admin" -ForegroundColor Green }
        else { Write-Host "      WARNING: port 8001 未监听" -ForegroundColor Yellow }
    }
} else { Write-Host "[4/4] 跳过截图工具服务" -ForegroundColor DarkGray }

Write-Host ""
Write-Host "========================================" -ForegroundColor Cyan
Write-Host "  后端  : http://localhost:3000" -ForegroundColor White
Write-Host "  生产  : https://api.zhenwu.fun/api" -ForegroundColor White
Write-Host "  前端  : https://www.zhenwu.fun" -ForegroundColor White
Write-Host "  截图  : http://127.0.0.1:8001/admin" -ForegroundColor White
Write-Host "  OCR   : http://127.0.0.1:8003/health  (约30s后就绪)" -ForegroundColor White
Write-Host "========================================" -ForegroundColor Cyan
Write-Host "  参数: -NoTunnel  -NoOcr  -NoScreenshot" -ForegroundColor DarkGray
Write-Host ""
