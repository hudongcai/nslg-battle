Add-Type -AssemblyName System.Windows.Forms

$installDir = Join-Path $env:LOCALAPPDATA 'ZhenwuLocalHelper'

if (-not (Test-Path $installDir)) {
    [System.Windows.Forms.MessageBox]::Show(
        'Zhenwu Local Helper is not installed on this computer.',
        'Uninstall',
        [System.Windows.Forms.MessageBoxButtons]::OK,
        [System.Windows.Forms.MessageBoxIcon]::Information
    ) | Out-Null
    return
}

& powershell -NoProfile -ExecutionPolicy Bypass -File (Join-Path $installDir 'close-local-helper.ps1') -Quiet
& powershell -NoProfile -ExecutionPolicy Bypass -File (Join-Path $installDir 'unregister-protocol.ps1')
& powershell -NoProfile -ExecutionPolicy Bypass -File (Join-Path $installDir 'remove-shortcuts.ps1')

Remove-Item -LiteralPath $installDir -Recurse -Force

[System.Windows.Forms.MessageBox]::Show(
    'Zhenwu Local Helper has been removed.',
    'Uninstall Complete',
    [System.Windows.Forms.MessageBoxButtons]::OK,
    [System.Windows.Forms.MessageBoxIcon]::Information
) | Out-Null
