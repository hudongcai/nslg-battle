param(
    [switch]$Silent
)

Add-Type -AssemblyName System.Windows.Forms

$sourceDir = Split-Path -Parent $MyInvocation.MyCommand.Path
$installDir = Join-Path $env:LOCALAPPDATA 'ZhenwuLocalHelper'

function Invoke-Step([scriptblock]$Action, [string]$ErrorMessage) {
    try {
        & $Action
    } catch {
        throw ($ErrorMessage + ' ' + $_.Exception.Message)
    }
}

if (-not (Test-Path $installDir)) {
    New-Item -ItemType Directory -Path $installDir -Force | Out-Null
}

$payloadFiles = @(
    'README.md',
    'START_HERE.txt',
    'start-local-helper.vbs',
    'start-local-helper.bat',
    'helper-ui.ps1',
    'local-helper.js',
    'version.json',
    'fpicker.exe',
    'ensure-app-icon.ps1',
    'register-protocol.ps1',
    'unregister-protocol.ps1',
    'install-helper-protocol.bat',
    'uninstall-helper-protocol.bat',
    'install-local-helper.bat',
    'install-local-helper.ps1',
    'uninstall-local-helper.bat',
    'uninstall-local-helper.ps1',
    'create-shortcuts.ps1',
    'remove-shortcuts.ps1',
    'close-local-helper.ps1',
    'close-local-helper.bat',
    'close-and-remove-local-helper.bat',
    'node.exe'
)

foreach ($file in $payloadFiles) {
    $sourcePath = Join-Path $sourceDir $file
    if (-not (Test-Path $sourcePath)) {
        throw "Missing installer file: $file"
    }
    Copy-Item -LiteralPath $sourcePath -Destination (Join-Path $installDir $file) -Force
}

Invoke-Step { & powershell -NoProfile -ExecutionPolicy Bypass -File (Join-Path $installDir 'ensure-app-icon.ps1') -OutputPath (Join-Path $installDir 'helper-app.ico') } 'Failed to create the helper icon.'

Invoke-Step { & powershell -NoProfile -ExecutionPolicy Bypass -File (Join-Path $installDir 'register-protocol.ps1') } 'Failed to register the local helper protocol.'
Invoke-Step { & powershell -NoProfile -ExecutionPolicy Bypass -File (Join-Path $installDir 'create-shortcuts.ps1') } 'Failed to create the desktop shortcut.'

if (-not $Silent) {
    [System.Windows.Forms.MessageBox]::Show(
        "已经安装完成",
        '真武本地助手',
        [System.Windows.Forms.MessageBoxButtons]::OK,
        [System.Windows.Forms.MessageBoxIcon]::Information
    ) | Out-Null
}
