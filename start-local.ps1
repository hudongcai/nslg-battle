# nslg-battle local startup
# Usage: .\start-local.ps1 [-NoTunnel] [-NoOcr] [-NoScreenshot]
param(
    [switch]$NoTunnel,
    [switch]$NoOcr,
    [switch]$NoScreenshot
)

# 设置控制台输出编码为 GBK，避免中文乱码
[Console]::OutputEncoding = [System.Text.Encoding]::GetEncoding("gbk")
$OutputEncoding = [System.Text.Encoding]::GetEncoding("gbk")

$projectDir    = "C:\nslg-battle"
$screenshotDir = "C:\AutoScreenshotTool2"
$pythonPath    = "C:\Users\Administrator\AppData\Local\Programs\Python\Python312\python.exe"
$cfExe         = "C:\Users\Administrator\AppData\Local\Microsoft\WinGet\Links\cloudflared.exe"
$cfConfig      = "C:\Users\Administrator\.cloudflared\config.yml"

function Test-Port($port) {
    return $null -ne (Get-NetTCPConnection -LocalPort $port -State Listen -ErrorAction SilentlyContinue)
}

function Kill-Port($port) {
    $listenPids = Get-NetTCPConnection -LocalPort $port -State Listen -ErrorAction SilentlyContinue |
      Select-Object -ExpandProperty OwningProcess -Unique
    foreach ($listenPid in $listenPids) {
        if ($listenPid) {
            Stop-Process -Id $listenPid -Force -ErrorAction SilentlyContinue
        }
    }
    if ($listenPids) { Start-Sleep -Seconds 1 }
}

Write-Host "========================================"
Write-Host "  nslg-battle startup"
Write-Host "========================================"

# -- 1. Node backend --
if (Test-Port 3000) { Kill-Port 3000 }
Write-Host "[1/5] Starting backend (port 3000)..."
Start-Process -FilePath "node" -ArgumentList "nslg-backend.js" -WorkingDirectory $projectDir -WindowStyle Normal
Start-Sleep -Seconds 4
if (Test-Port 3000) { Write-Host "      OK  http://localhost:3000" }
else { Write-Host "      WARNING: port 3000 not listening" }

# -- 2. 本地助手（战报自动监听） --
if (-not $NoOcr) {
    $helperPidFile = Join-Path $projectDir "local-helper.pid"
    $helperRunning = $false
    if (Test-Path $helperPidFile) {
        try {
            $oldPid = [int](Get-Content $helperPidFile -Raw).Trim()
            if ($oldPid) {
                $p = Get-Process -Id $oldPid -ErrorAction SilentlyContinue
                if ($p) { $helperRunning = $true; Write-Host "[2/5] 本地助手 already running (PID $oldPid)" }
            }
        } catch {}
    }
    if (-not $helperRunning) {
        Write-Host "[2/5] Starting 本地助手 (local-helper)..."
        Start-Process -FilePath "node" -ArgumentList "local-helper.minimal.js" -WorkingDirectory $projectDir -WindowStyle Minimized
        Start-Sleep -Seconds 2
        Write-Host "      本地助手已启动"
    }
} else { Write-Host "[2/5] Skipping local helper" }

# -- 3. PaddleOCR watchdog --
if (-not $NoOcr) {
    if (Test-Port 8003) {
        Write-Host "[3/5] PaddleOCR already running (port 8003)"
    } else {
        Write-Host "[3/5] Starting PaddleOCR watchdog (port 8003)..."
        $psExe = "$env:SystemRoot\System32\WindowsPowerShell\v1.0\powershell.exe"
        Start-Process -FilePath $psExe -ArgumentList "-NoProfile", "-ExecutionPolicy", "Bypass", "-File", "$projectDir\watchdog-ocr.ps1" -WorkingDirectory $projectDir -WindowStyle Minimized
        Write-Host "      Model loading (~30-60s)..."
    }
} else { Write-Host "[3/5] Skipping PaddleOCR" }

# -- 4. Cloudflare tunnel --
if (-not $NoTunnel) {
    if (Get-Process cloudflared -ErrorAction SilentlyContinue) {
        Write-Host "[4/5] Cloudflare tunnel already running"
    } elseif (Test-Path $cfExe) {
        Write-Host "[4/5] Starting Cloudflare tunnel..."
        Start-Process -FilePath $cfExe -ArgumentList "tunnel", "--config", $cfConfig, "run" -WindowStyle Hidden
        Start-Sleep -Seconds 4
        if (Get-Process cloudflared -ErrorAction SilentlyContinue) {
            Write-Host "      OK  api.zhenwu.fun -> localhost:3000"
        } else { Write-Host "      WARNING: cloudflared not detected" }
    } else { Write-Host "      WARNING: cloudflared not found: $cfExe" }
} else { Write-Host "[4/5] Skipping Cloudflare tunnel" }

# -- 5. AutoScreenshotTool2 backend server --
if (-not $NoScreenshot) {
    if (Test-Port 8001) {
        Write-Host "[5/5] Screenshot server already running (port 8001)"
    } else {
        Write-Host "[5/5] Starting screenshot server (port 8001)..."
        Start-Process -FilePath $pythonPath -ArgumentList "-m", "uvicorn", "main:app", "--host", "127.0.0.1", "--port", "8001" -WorkingDirectory "$screenshotDir\server" -WindowStyle Hidden
        Start-Sleep -Seconds 3
        if (Test-Port 8001) { Write-Host "      OK  http://127.0.0.1:8001/admin" }
        else { Write-Host "      WARNING: port 8001 not listening" }
    }
} else { Write-Host "[5/5] Skipping screenshot server" }

Write-Host ""
Write-Host "========================================"
Write-Host "  Backend : http://localhost:3000"
Write-Host "  Prod    : https://api.zhenwu.fun/api"
Write-Host "  Frontend: https://www.zhenwu.fun"
Write-Host "  Auth srv: http://127.0.0.1:8001/admin"
Write-Host "  OCR     : http://127.0.0.1:8003/health"
Write-Host "========================================"
Write-Host "  Flags: -NoTunnel  -NoOcr  -NoScreenshot"
Write-Host ""
