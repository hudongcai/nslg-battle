# nslg-battle restart all services
# Usage: .\restart-all.ps1 [-NoTunnel] [-NoOcr] [-NoScreenshot]
param(
    [switch]$NoTunnel,
    [switch]$NoOcr,
    [switch]$NoScreenshot
)

# 设置控制台输出编码为 GBK，避免中文乱码
[Console]::OutputEncoding = [System.Text.Encoding]::GetEncoding("gbk")
$OutputEncoding = [System.Text.Encoding]::GetEncoding("gbk")

$projectDir = "C:\nslg-battle"

Write-Host "========================================"
Write-Host "  Stopping all services..."
Write-Host "========================================"

# -- 1. Stop backend (port 3000) --
Write-Host "[1/5] Stopping backend service (port 3000)..."
$backend = Get-NetTCPConnection -LocalPort 3000 -State Listen -ErrorAction SilentlyContinue |
    Select-Object -ExpandProperty OwningProcess -Unique
foreach ($procId in $backend) {
    if ($procId) {
        Stop-Process -Id $procId -Force -ErrorAction SilentlyContinue
        Write-Host "      Stopped PID $procId"
    }
}

# -- 2. Stop local helper --
Write-Host "[2/5] Stopping local helper..."
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
    Write-Host "      Stopped PID $procId"
}

# -- 3. Stop OCR service (port 8003) --
Write-Host "[3/5] Stopping OCR service (port 8003)..."
$ocrPids = Get-NetTCPConnection -LocalPort 8003 -State Listen -ErrorAction SilentlyContinue |
    Select-Object -ExpandProperty OwningProcess -Unique
foreach ($procId in $ocrPids) {
    if ($procId) {
        Stop-Process -Id $procId -Force -ErrorAction SilentlyContinue
        Write-Host "      Stopped PID $procId"
    }
}
# Stop watchdog
Get-Process -Name powershell -ErrorAction SilentlyContinue | Where-Object {
    $_.CommandLine -like "*watchdog-ocr*"
} | ForEach-Object {
    Stop-Process -Id $_.Id -Force -ErrorAction SilentlyContinue
    Write-Host "      Stopped watchdog PID $($_.Id)"
}

# -- 4. Stop Cloudflare tunnel --
Write-Host "[4/5] Stopping Cloudflare tunnel..."
$cf = Get-Process cloudflared -ErrorAction SilentlyContinue
if ($cf) {
    Stop-Process -Name cloudflared -Force -ErrorAction SilentlyContinue
    Write-Host "      Stopped cloudflared"
}

# -- 5. Stop screenshot service (port 8001) --
Write-Host "[5/5] Stopping screenshot service (port 8001)..."
$screenshot = Get-NetTCPConnection -LocalPort 8001 -State Listen -ErrorAction SilentlyContinue |
    Select-Object -ExpandProperty OwningProcess -Unique
foreach ($procId in $screenshot) {
    if ($procId) {
        Stop-Process -Id $procId -Force -ErrorAction SilentlyContinue
        Write-Host "      Stopped PID $procId"
    }
}

Write-Host ""
Write-Host "Waiting for processes to exit..."
Start-Sleep -Seconds 2

Write-Host ""
Write-Host "========================================"
Write-Host "  Starting all services..."
Write-Host "========================================"
Write-Host ""

# 调用启动脚本
$startArgs = @()
if ($NoTunnel) { $startArgs += "-NoTunnel" }
if ($NoOcr) { $startArgs += "-NoOcr" }
if ($NoScreenshot) { $startArgs += "-NoScreenshot" }

& "$projectDir\start-local.ps1" @startArgs
