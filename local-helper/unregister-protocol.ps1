param(
    [string]$Scheme = 'zhenwu-helper'
)

Add-Type -AssemblyName Microsoft.Win32.Registry

$basePath = "Software\Classes\$Scheme"
[Microsoft.Win32.Registry]::CurrentUser.DeleteSubKeyTree($basePath, $false)
Write-Host "Removed protocol $Scheme"
