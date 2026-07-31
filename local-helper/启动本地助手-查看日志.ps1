# 本地助手 - WebSocket 连接日志
$Host.UI.RawUI.WindowTitle = "🔍 本地助手 WebSocket 日志"
Clear-Host

Write-Host "══════════════════════════════════════════════════" -ForegroundColor Cyan
Write-Host "  本地助手 - WebSocket 连接日志" -ForegroundColor Green
Write-Host "══════════════════════════════════════════════════" -ForegroundColor Cyan
Write-Host ""
Write-Host "关键日志说明：" -ForegroundColor Yellow
Write-Host "  ✅ [WebSocket] 已连接到服务器  - 连接成功" -ForegroundColor Green
Write-Host "  ✅ [WebSocket] 注册成功        - 注册成功" -ForegroundColor Green
Write-Host "  [首次启动] 打开浏览器          - 自动打开网页" -ForegroundColor Cyan
Write-Host ""
Write-Host "══════════════════════════════════════════════════" -ForegroundColor Cyan
Write-Host ""

Set-Location $PSScriptRoot
node local-helper.js --no-prompt

Write-Host ""
Write-Host "按任意键退出..." -ForegroundColor Yellow
$null = $Host.UI.RawUI.ReadKey("NoEcho,IncludeKeyDown")
