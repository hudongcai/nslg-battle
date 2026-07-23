# nslg-battle restart all services
# Usage: .\restart-all.ps1 [-NoTunnel] [-NoOcr] [-NoScreenshot]
param(
    [switch]$NoTunnel,
    [switch]$NoOcr,
    [switch]$NoScreenshot
)

$projectDir = "C:\nslg-battle"

Write-Host "========================================"
Write-Host "  关闭所有服务..."
Write-Host "========================================"

# -- 1. 关闭后端 (port 3000) --
Write-Host "[1/5] 关闭后端服务 (port 3000)..."
$backend = Get-NetTCPConnection -LocalPort 3000 -State Listen -ErrorAction SilentlyContinue |
    Select-Object -ExpandProperty OwningProcess -Unique
foreach ($procId in $backend) {
    if ($procId) {
        Stop-Process -Id $procId -Force -ErrorAction SilentlyContinue
        Write-Host "      已关闭 PID $procId"
    }
}

# -- 2. 关闭本地助手 --
Write-Host "[2/5] 关闭本地助手..."
$helperPids = @()
$helperPidFile = Join-Path $projectDir "local-helper.pid"
if (Test-Path $helperPidFile) {
    try {
        $procId = [int](Get-Content $helperPidFile -Raw).Trim()
        if ($procId) { $helperPids += $procId }
    } catch {}
}
# 查找所有 local-helper 相关进程
Get-Process -Name node -ErrorAction SilentlyContinue | Where-Object {
    $_.CommandLine -like "*local-helper*"
} | ForEach-Object {
    $helperPids += $_.Id
}
$helperPids = $helperPids | Select-Object -Unique
foreach ($procId in $helperPids) {
    Stop-Process -Id $procId -Force -ErrorAction SilentlyContinue
    Write-Host "      已关闭 PID $procId"
}

# -- 3. 关闭 OCR 服务 (port 8003) --
Write-Host "[3/5] 关闭 OCR 服务 (port 8003)..."
$ocrPids = Get-NetTCPConnection -LocalPort 8003 -State Listen -ErrorAction SilentlyContinue |
    Select-Object -ExpandProperty OwningProcess -Unique
foreach ($procId in $ocrPids) {
    if ($procId) {
        Stop-Process -Id $procId -Force -ErrorAction SilentlyContinue
        Write-Host "      已关闭 PID $procId"
    }
}
# 关闭 watchdog
Get-Process -Name powershell -ErrorAction SilentlyContinue | Where-Object {
    $_.CommandLine -like "*watchdog-ocr*"
} | ForEach-Object {
    Stop-Process -Id $_.Id -Force -ErrorAction SilentlyContinue
    Write-Host "      已关闭 watchdog PID $($_.Id)"
}

# -- 4. 关闭 Cloudflare tunnel --
Write-Host "[4/5] 关闭 Cloudflare tunnel..."
$cf = Get-Process cloudflared -ErrorAction SilentlyContinue
if ($cf) {
    Stop-Process -Name cloudflared -Force -ErrorAction SilentlyContinue
    Write-Host "      已关闭 cloudflared"
}

# -- 5. 关闭截图服务 (port 8001) --
Write-Host "[5/5] 关闭截图服务 (port 8001)..."
$screenshot = Get-NetTCPConnection -LocalPort 8001 -State Listen -ErrorAction SilentlyContinue |
    Select-Object -ExpandProperty OwningProcess -Unique
foreach ($procId in $screenshot) {
    if ($procId) {
        Stop-Process -Id $procId -Force -ErrorAction SilentlyContinue
        Write-Host "      已关闭 PID $procId"
    }
}

Write-Host ""
Write-Host "等待进程完全退出..."
Start-Sleep -Seconds 2

Write-Host ""
Write-Host "========================================"
Write-Host "  启动所有服务..."
Write-Host "========================================"
Write-Host ""

# 调用启动脚本
$startArgs = @()
if ($NoTunnel) { $startArgs += "-NoTunnel" }
if ($NoOcr) { $startArgs += "-NoOcr" }
if ($NoScreenshot) { $startArgs += "-NoScreenshot" }

& "$projectDir\start-local.ps1" @startArgs
