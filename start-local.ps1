# nslg-battle local startup
# Usage: .\start-local.ps1 [-NoTunnel] [-NoOcr] [-NoScreenshot]
param(
    [switch]$NoTunnel,
    [switch]$NoOcr,
    [switch]$NoScreenshot
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
    $p = Get-NetTCPConnection -LocalPort $port -ErrorAction SilentlyContinue |
         Select-Object -ExpandProperty OwningProcess -First 1
    if ($p) { Stop-Process -Id $p -Force -ErrorAction SilentlyContinue; Start-Sleep -Seconds 1 }
}

Write-Host "========================================"
Write-Host "  nslg-battle startup"
Write-Host "========================================"

# -- 1. Node backend --
if (Test-Port 3000) { Kill-Port 3000 }
Write-Host "[1/4] Starting backend (port 3000)..."
Start-Process -FilePath "node" -ArgumentList "nslg-backend.js" -WorkingDirectory $projectDir -WindowStyle Normal
Start-Sleep -Seconds 4
if (Test-Port 3000) { Write-Host "      OK  http://localhost:3000" }
else { Write-Host "      WARNING: port 3000 not listening" }

# -- 2. PaddleOCR watchdog --
if (-not $NoOcr) {
    if (Test-Port 8003) {
        Write-Host "[2/4] PaddleOCR already running (port 8003)"
    } else {
        Write-Host "[2/4] Starting PaddleOCR watchdog (port 8003)..."
        $psExe = "$env:SystemRoot\System32\WindowsPowerShell\v1.0\powershell.exe"
        Start-Process -FilePath $psExe -ArgumentList "-NoProfile", "-ExecutionPolicy", "Bypass", "-File", "$projectDir\watchdog-ocr.ps1" -WorkingDirectory $projectDir -WindowStyle Minimized
        Write-Host "      Model loading (~30-60s)..."
    }
} else { Write-Host "[2/4] Skipping PaddleOCR" }

# -- 3. Cloudflare tunnel --
if (-not $NoTunnel) {
    if (Get-Process cloudflared -ErrorAction SilentlyContinue) {
        Write-Host "[3/4] Cloudflare tunnel already running"
    } elseif (Test-Path $cfExe) {
        Write-Host "[3/4] Starting Cloudflare tunnel..."
        Start-Process -FilePath $cfExe -ArgumentList "tunnel", "--config", $cfConfig, "run" -WindowStyle Hidden
        Start-Sleep -Seconds 4
        if (Get-Process cloudflared -ErrorAction SilentlyContinue) {
            Write-Host "      OK  api.zhenwu.fun -> localhost:3000"
        } else { Write-Host "      WARNING: cloudflared not detected" }
    } else { Write-Host "      WARNING: cloudflared not found: $cfExe" }
} else { Write-Host "[3/4] Skipping Cloudflare tunnel" }

# -- 4. AutoScreenshotTool2 backend server --
if (-not $NoScreenshot) {
    if (Test-Port 8001) {
        Write-Host "[4/4] Screenshot server already running (port 8001)"
    } else {
        Write-Host "[4/4] Starting screenshot server (port 8001)..."
        Start-Process -FilePath $pythonPath -ArgumentList "-m", "uvicorn", "main:app", "--host", "127.0.0.1", "--port", "8001" -WorkingDirectory "$screenshotDir\server" -WindowStyle Hidden
        Start-Sleep -Seconds 3
        if (Test-Port 8001) { Write-Host "      OK  http://127.0.0.1:8001/admin" }
        else { Write-Host "      WARNING: port 8001 not listening" }
    }
} else { Write-Host "[4/4] Skipping screenshot server" }

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
