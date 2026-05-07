$ErrorActionPreference = "Stop"
try {
    $r = Invoke-RestMethod -Uri "https://api.zhenwu.fun/health" -TimeoutSec 10
    Write-Output "API OK: $r"
} catch {
    Write-Output "API FAIL: $($_.Exception.Message)"
}
