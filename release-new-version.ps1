# 发布新版本 - 自动更新所有时间戳
param(
    [string]$CommitMessage = "发布新版本"
)

Write-Host "========================================" -ForegroundColor Cyan
Write-Host "发布新版本 - 自动化脚本" -ForegroundColor Cyan
Write-Host "========================================" -ForegroundColor Cyan
Write-Host ""

# 1. 生成时间戳
$now = Get-Date
$versionTime = $now.ToString('MMddHHmm')  # 07132253
$displayTime = $now.ToString('yyyy.MM.dd HH:mm')  # 2026.07.12 15:30

Write-Host "[1/6] 生成时间戳" -ForegroundColor Yellow
Write-Host "  版本号: $versionTime" -ForegroundColor Gray
Write-Host "  显示时间: $displayTime" -ForegroundColor Gray
Write-Host ""

# 2. 构建本地助手安装包
Write-Host "[2/6] 构建本地助手安装包..." -ForegroundColor Yellow
Set-Location "$PSScriptRoot\local-helper"
$env:ZHENWU_HELPER_VERSION_SUFFIX = $versionTime
& .\build-local-helper-package.ps1
$env:ZHENWU_HELPER_VERSION_SUFFIX = $null
if ($LASTEXITCODE -ne 0) {
    Write-Host "  ❌ 构建失败" -ForegroundColor Red
    exit 1
}
Write-Host "  ✅ 构建完成" -ForegroundColor Green
Write-Host ""

# 3. 更新后端下载文件名
Write-Host "[3/6] 更新后端下载文件名..." -ForegroundColor Yellow
$backendFile = "$PSScriptRoot\nslg-backend.js"
$backendContent = Get-Content $backendFile -Raw -Encoding UTF8
$backendContent = $backendContent -replace 'zhenwu-local-helper-setup(?:-\d+)?\.exe', "zhenwu-local-helper-setup-$versionTime.exe"
$backendContent | Set-Content $backendFile -Encoding UTF8 -NoNewline
Write-Host "  ✅ 更新为: zhenwu-local-helper-setup-$versionTime.exe" -ForegroundColor Green
Write-Host ""

# 4. 更新前端发布时间
Write-Host "[4/6] 更新前端发布时间..." -ForegroundColor Yellow
$indexFile = "$PSScriptRoot\index.html"
$indexContent = Get-Content $indexFile -Raw -Encoding UTF8
$indexContent = $indexContent -replace '最新发布 \d{4}\.\d{2}\.\d{2} \d{2}:\d{2}', "最新发布 $displayTime"
$indexContent | Set-Content $indexFile -Encoding UTF8 -NoNewline
Write-Host "  ✅ 更新为: $displayTime" -ForegroundColor Green
Write-Host ""

# 5. 提交到 Git
Write-Host "[5/6] 提交到 Git..." -ForegroundColor Yellow
Set-Location $PSScriptRoot
$ocrWatchFile = "$PSScriptRoot\ocr-watch-v2.js"
$ocrWatchContent = Get-Content $ocrWatchFile -Raw -Encoding UTF8
$ocrWatchContent = $ocrWatchContent -replace 'zhenwu-local-helper-setup(?:-\d+)?\.exe', "zhenwu-local-helper-setup-$versionTime.exe"
$ocrWatchContent | Set-Content $ocrWatchFile -Encoding UTF8 -NoNewline

git add local-helper/helper-ui.ps1 local-helper/build-local-helper-package.ps1 nslg-backend.js ocr-watch-v2.js "downloads/zhenwu-local-helper-setup-$versionTime.exe" index.html
$fullCommitMessage = "$CommitMessage (v$versionTime)"
git commit -m $fullCommitMessage
if ($LASTEXITCODE -ne 0) {
    Write-Host "  ❌ 提交失败" -ForegroundColor Red
    exit 1
}
Write-Host "  ✅ 提交完成: $fullCommitMessage" -ForegroundColor Green
Write-Host ""

# 6. 推送到远程
Write-Host "[6/6] 推送到远程仓库..." -ForegroundColor Yellow
git push
if ($LASTEXITCODE -ne 0) {
    Write-Host "  ❌ 推送失败" -ForegroundColor Red
    exit 1
}
Write-Host "  ✅ 推送完成" -ForegroundColor Green
Write-Host ""

# 7. 重启后端
Write-Host "[7/7] 重启后端服务..." -ForegroundColor Yellow
$backendPid = Get-Content "$PSScriptRoot\backend.pid" -ErrorAction SilentlyContinue
if ($backendPid) {
    Stop-Process -Id $backendPid -Force -ErrorAction SilentlyContinue
}
Start-Sleep -Seconds 2
$proc = Start-Process -FilePath 'node' -ArgumentList "$PSScriptRoot\nslg-backend.js" -WorkingDirectory $PSScriptRoot -WindowStyle Hidden -PassThru
$proc.Id | Out-File "$PSScriptRoot\backend.pid" -Force
Write-Host "  ✅ 后端已重启，PID: $($proc.Id)" -ForegroundColor Green
Write-Host ""

Write-Host "========================================" -ForegroundColor Cyan
Write-Host "✅ 发布完成！" -ForegroundColor Green
Write-Host "========================================" -ForegroundColor Cyan
Write-Host ""
Write-Host "版本信息:" -ForegroundColor White
Write-Host "  版本号: v$versionTime" -ForegroundColor Gray
Write-Host "  发布时间: $displayTime" -ForegroundColor Gray
Write-Host "  下载文件: zhenwu-local-helper-setup-$versionTime.exe" -ForegroundColor Gray
Write-Host ""
Write-Host "下载地址: https://api.zhenwu.fun/download/local-helper" -ForegroundColor Cyan
Write-Host "GitHub Pages 部署预计 1-3 分钟完成" -ForegroundColor Gray
Write-Host ""
