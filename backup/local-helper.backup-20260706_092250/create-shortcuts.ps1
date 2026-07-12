$desktop = [Environment]::GetFolderPath('Desktop')
$startup = [Environment]::GetFolderPath('Startup')
$shortcutPath = Join-Path $desktop 'Zhenwu Local Helper.lnk'
$startupShortcutPath = Join-Path $startup 'Zhenwu Local Helper.lnk'
$targetPath = Join-Path $PSScriptRoot 'start-local-helper.vbs'
$iconPath = Join-Path $PSScriptRoot 'helper-app.ico'

if (-not (Test-Path $iconPath)) {
    & powershell -NoProfile -ExecutionPolicy Bypass -File (Join-Path $PSScriptRoot 'ensure-app-icon.ps1') -OutputPath $iconPath | Out-Null
}

$shell = New-Object -ComObject WScript.Shell
$shortcut = $shell.CreateShortcut($shortcutPath)
$shortcut.TargetPath = $targetPath
$shortcut.WorkingDirectory = $PSScriptRoot
$shortcut.IconLocation = $iconPath
$shortcut.Description = 'Open Zhenwu Local Helper'
$shortcut.Save()

$startupShortcut = $shell.CreateShortcut($startupShortcutPath)
$startupShortcut.TargetPath = $targetPath
$startupShortcut.WorkingDirectory = $PSScriptRoot
$startupShortcut.IconLocation = $iconPath
$startupShortcut.Description = 'Auto start Zhenwu Local Helper'
$startupShortcut.Save()

Write-Host "Created desktop shortcut: $shortcutPath"
Write-Host "Created startup shortcut: $startupShortcutPath"
