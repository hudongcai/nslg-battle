param(
    [string]$Scheme = 'zhenwu-helper'
)

Add-Type -AssemblyName Microsoft.Win32.Registry

$helperPath = Join-Path $PSScriptRoot 'start-local-helper.vbs'
if (-not (Test-Path $helperPath)) {
    throw 'Cannot find start-local-helper.vbs'
}

$root = [Microsoft.Win32.Registry]::CurrentUser.CreateSubKey("Software\Classes\$Scheme")
$root.SetValue('', 'URL:Zhenwu Local Helper Protocol')
$root.SetValue('URL Protocol', '')
$iconKey = $root.CreateSubKey('DefaultIcon')
$iconKey.SetValue('', 'wscript.exe,0')
$cmdKey = $root.CreateSubKey('shell\open\command')
$cmdKey.SetValue('', ('wscript.exe "' + $helperPath + '" "%1"'))
$cmdKey.Close()
$iconKey.Close()
$root.Close()
Write-Host "Registered protocol $Scheme -> $helperPath"
