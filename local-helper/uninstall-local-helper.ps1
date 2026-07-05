Add-Type -AssemblyName System.Windows.Forms

$installDir = Join-Path $env:LOCALAPPDATA 'ZhenwuLocalHelper'

function Start-DeferredRemoveInstallDir {
    param(
        [Parameter(Mandatory = $true)]
        [string]$TargetDir
    )

    $cleanupScript = Join-Path $env:TEMP ('zhenwu-helper-cleanup-' + [guid]::NewGuid().ToString('N') + '.ps1')
    $cleanupBody = @"
`$targetDir = '$($TargetDir.Replace("'", "''"))'
for (`$i = 0; `$i -lt 20; `$i++) {
    Start-Sleep -Milliseconds 500
    if (-not (Test-Path `$targetDir)) {
        break
    }
    try {
        Remove-Item -LiteralPath `$targetDir -Recurse -Force -ErrorAction Stop
        break
    } catch {}
}
try { Remove-Item -LiteralPath `$PSCommandPath -Force -ErrorAction SilentlyContinue } catch {}
"@

    Set-Content -LiteralPath $cleanupScript -Value $cleanupBody -Encoding UTF8
    Start-Process -FilePath 'powershell.exe' -ArgumentList @(
        '-NoProfile',
        '-ExecutionPolicy', 'Bypass',
        '-WindowStyle', 'Hidden',
        '-File', $cleanupScript
    ) -WindowStyle Hidden | Out-Null
}

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

Start-DeferredRemoveInstallDir -TargetDir $installDir

[System.Windows.Forms.MessageBox]::Show(
    'Zhenwu Local Helper is closing and will be removed in a moment.',
    'Uninstall Complete',
    [System.Windows.Forms.MessageBoxButtons]::OK,
    [System.Windows.Forms.MessageBoxIcon]::Information
) | Out-Null
