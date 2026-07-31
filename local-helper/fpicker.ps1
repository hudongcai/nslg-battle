# Folder Picker Script
# Usage: fpicker.ps1 -ResultPath "result.txt" [-InitialPath "C:\initial\path"]

param(
    [Parameter(Mandatory=$true)]
    [string]$ResultPath,

    [Parameter(Mandatory=$false)]
    [string]$InitialPath = ""
)

Add-Type -AssemblyName System.Windows.Forms

try {
    $folderBrowser = New-Object System.Windows.Forms.FolderBrowserDialog
    $folderBrowser.Description = "Select folder to monitor"
    $folderBrowser.ShowNewFolderButton = $false

    # Set initial path
    if ($InitialPath -and (Test-Path $InitialPath)) {
        $folderBrowser.SelectedPath = $InitialPath
    }

    # Create a form to make the dialog topmost
    $form = New-Object System.Windows.Forms.Form
    $form.TopMost = $true
    $form.WindowState = 'Minimized'
    $form.ShowInTaskbar = $false

    $result = $folderBrowser.ShowDialog($form)

    $form.Dispose()

    if ($result -eq [System.Windows.Forms.DialogResult]::OK) {
        # User selected a folder
        $selectedPath = $folderBrowser.SelectedPath
        Set-Content -Path $ResultPath -Value $selectedPath -Encoding UTF8
        exit 0
    } else {
        # User cancelled
        Set-Content -Path $ResultPath -Value "CANCELLED" -Encoding UTF8
        exit 0
    }
} catch {
    # Error occurred
    $errorMsg = "ERROR: " + $_.Exception.Message
    Set-Content -Path $ResultPath -Value $errorMsg -Encoding UTF8
    exit 1
}
