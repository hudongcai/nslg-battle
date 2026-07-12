$desktop = [Environment]::GetFolderPath('Desktop')
$startup = [Environment]::GetFolderPath('Startup')
$shortcutPath = Join-Path $desktop 'Zhenwu Local Helper.lnk'
$startupShortcutPath = Join-Path $startup 'Zhenwu Local Helper.lnk'
if (Test-Path $shortcutPath) {
    Remove-Item -LiteralPath $shortcutPath -Force
    Write-Host "Removed desktop shortcut: $shortcutPath"
} else {
    Write-Host 'Desktop shortcut was not found.'
}

if (Test-Path $startupShortcutPath) {
    Remove-Item -LiteralPath $startupShortcutPath -Force
    Write-Host "Removed startup shortcut: $startupShortcutPath"
} else {
    Write-Host 'Startup shortcut was not found.'
}
