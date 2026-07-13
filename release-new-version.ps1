param(
    [string]$CommitMessage = "Release new version"
)

$ErrorActionPreference = "Stop"

$now = Get-Date
$versionTime = $now.ToString('MMddHHmm')
$displayTime = $now.ToString('yyyy.MM.dd HH:mm')
$installerName = "zhenwu-local-helper-setup-$versionTime.exe"
$installerUrl = "https://www.zhenwu.fun/downloads/$installerName"

Write-Host "========================================" -ForegroundColor Cyan
Write-Host "Release new version" -ForegroundColor Cyan
Write-Host "========================================" -ForegroundColor Cyan
Write-Host ""
Write-Host "[1/7] Version: $versionTime" -ForegroundColor Yellow
Write-Host "[1/7] Publish time: $displayTime" -ForegroundColor Yellow
Write-Host ""

Write-Host "[2/7] Build local helper package..." -ForegroundColor Yellow
Set-Location "$PSScriptRoot\local-helper"
$env:ZHENWU_HELPER_VERSION_SUFFIX = $versionTime
try {
    & .\build-local-helper-package.ps1
}
finally {
    Remove-Item Env:\ZHENWU_HELPER_VERSION_SUFFIX -ErrorAction SilentlyContinue
}
if ($LASTEXITCODE -ne 0) {
    Write-Host "Build failed" -ForegroundColor Red
    exit 1
}
Write-Host "Build completed" -ForegroundColor Green
Write-Host ""

Write-Host "[3/7] Update backend download filename..." -ForegroundColor Yellow
$backendFile = "$PSScriptRoot\nslg-backend.js"
$backendContent = Get-Content $backendFile -Raw -Encoding UTF8
$backendContent = $backendContent -replace 'zhenwu-local-helper-setup(?:-\d+)?\.exe', $installerName
$backendContent | Set-Content $backendFile -Encoding UTF8 -NoNewline
Write-Host "Backend download filename updated: $installerName" -ForegroundColor Green
Write-Host ""

Write-Host "[4/7] Update frontend publish time and helper download URLs..." -ForegroundColor Yellow
$indexFile = "$PSScriptRoot\index.html"
$indexContent = Get-Content $indexFile -Raw -Encoding UTF8
$indexContent = $indexContent -replace '最新发布\s*\d{4}\.\d{2}\.\d{2} \d{2}:\d{2}', "最新发布 $displayTime"
$indexContent | Set-Content $indexFile -Encoding UTF8 -NoNewline

$ocrWatchFile = "$PSScriptRoot\ocr-watch-v2.js"
$ocrWatchContent = Get-Content $ocrWatchFile -Raw -Encoding UTF8
$ocrWatchContent = $ocrWatchContent -replace 'zhenwu-local-helper-setup(?:-\d+)?\.exe', $installerName
$ocrWatchContent | Set-Content $ocrWatchFile -Encoding UTF8 -NoNewline

$ocrSystemFile = "$PSScriptRoot\ocr-system.js"
$ocrSystemContent = Get-Content $ocrSystemFile -Raw -Encoding UTF8
$ocrSystemContent = $ocrSystemContent -replace 'zhenwu-local-helper-setup(?:-\d+)?\.exe', $installerName
$ocrSystemContent = $ocrSystemContent -replace "const downloadUrl = 'https://api\.zhenwu\.fun/download/local-helper';", "const downloadUrl = window.location.origin + '/downloads/$installerName';"
$ocrSystemContent = $ocrSystemContent -replace 'const downloadUrl = "https://api\.zhenwu\.fun/download/local-helper";', "const downloadUrl = window.location.origin + '/downloads/$installerName';"
$ocrSystemContent | Set-Content $ocrSystemFile -Encoding UTF8 -NoNewline

Write-Host "Frontend publish time and helper download URLs updated" -ForegroundColor Green
Write-Host ""

Write-Host "[5/7] Commit changes..." -ForegroundColor Yellow
Set-Location $PSScriptRoot
git add local-helper/helper-ui.ps1 local-helper/build-local-helper-package.ps1 nslg-backend.js ocr-watch-v2.js ocr-system.js "downloads/$installerName" index.html
$fullCommitMessage = "$CommitMessage (v$versionTime)"
git commit -m $fullCommitMessage
if ($LASTEXITCODE -ne 0) {
    Write-Host "Commit failed" -ForegroundColor Red
    exit 1
}
Write-Host "Commit completed: $fullCommitMessage" -ForegroundColor Green
Write-Host ""

Write-Host "[6/7] Push changes..." -ForegroundColor Yellow
git push
if ($LASTEXITCODE -ne 0) {
    Write-Host "Push failed" -ForegroundColor Red
    exit 1
}
Write-Host "Push completed" -ForegroundColor Green
Write-Host ""

Write-Host "[7/7] Restart local backend..." -ForegroundColor Yellow
$backendPid = Get-Content "$PSScriptRoot\backend.pid" -ErrorAction SilentlyContinue
if ($backendPid) {
    Stop-Process -Id $backendPid -Force -ErrorAction SilentlyContinue
}
Start-Sleep -Seconds 2
$proc = Start-Process -FilePath 'node' -ArgumentList "$PSScriptRoot\nslg-backend.js" -WorkingDirectory $PSScriptRoot -WindowStyle Hidden -PassThru
$proc.Id | Out-File "$PSScriptRoot\backend.pid" -Force
Write-Host "Backend restarted, PID: $($proc.Id)" -ForegroundColor Green
Write-Host ""

Write-Host "========================================" -ForegroundColor Cyan
Write-Host "Release completed" -ForegroundColor Green
Write-Host "========================================" -ForegroundColor Cyan
Write-Host ""
Write-Host "Version: v$versionTime" -ForegroundColor Gray
Write-Host "Published: $displayTime" -ForegroundColor Gray
Write-Host "Installer: $installerName" -ForegroundColor Gray
Write-Host "Download: $installerUrl" -ForegroundColor Cyan
Write-Host "GitHub Pages deployment usually takes 1-3 minutes" -ForegroundColor Gray
Write-Host ""
