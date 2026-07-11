$packageDir = Join-Path $PSScriptRoot '..\release\zhenwu-local-helper'
$zipPath = Join-Path $PSScriptRoot '..\release\zhenwu-local-helper.zip'
$publicDownloadDir = Join-Path $PSScriptRoot '..\downloads'
$installerPath = Join-Path $publicDownloadDir 'zhenwu-local-helper-setup.exe'
$nodePath = (Get-Command node -ErrorAction Stop).Source
$cscPath = 'C:\Windows\Microsoft.NET\Framework64\v4.0.30319\csc.exe'
$installerSourcePath = Join-Path $PSScriptRoot '..\release\zhenwu-local-helper-installer.cs'

if (-not (Test-Path $publicDownloadDir)) {
    New-Item -ItemType Directory -Path $publicDownloadDir | Out-Null
}

if (Test-Path $packageDir) {
    Remove-Item -LiteralPath $packageDir -Recurse -Force
}
New-Item -ItemType Directory -Path $packageDir | Out-Null

$files = @(
    'README.md',
    'START_HERE.txt',
    'start-local-helper.vbs',
    'start-local-helper.bat',
    'helper-ui.ps1',
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
    'close-and-remove-local-helper.bat'
)

foreach ($file in $files) {
    Copy-Item -LiteralPath (Join-Path $PSScriptRoot $file) -Destination (Join-Path $packageDir $file) -Force
}

# 复制新版本的 local-helper.minimal.js 作为 local-helper.js
Copy-Item -LiteralPath (Join-Path $PSScriptRoot '..\local-helper.minimal.js') -Destination (Join-Path $packageDir 'local-helper.js') -Force

# 复制 fpicker.exe（文件夹选择器）
Copy-Item -LiteralPath (Join-Path $PSScriptRoot '..\fpicker.exe') -Destination (Join-Path $packageDir 'fpicker.exe') -Force

# 复制 helper-app.ico（应用图标）
$iconPath = Join-Path $PSScriptRoot 'helper-app.ico'
if (Test-Path $iconPath) {
    Copy-Item -LiteralPath $iconPath -Destination (Join-Path $packageDir 'helper-app.ico') -Force
}

Copy-Item -LiteralPath $nodePath -Destination (Join-Path $packageDir 'node.exe') -Force

if (Test-Path $zipPath) {
    Remove-Item -LiteralPath $zipPath -Force
}
Compress-Archive -Path (Join-Path $packageDir '*') -DestinationPath $zipPath -Force

if (Test-Path $installerPath) {
    Remove-Item -LiteralPath $installerPath -Force
}

$installerSource = @"
using System;
using System.Diagnostics;
using System.IO;
using System.IO.Compression;
using System.Reflection;
using System.Windows.Forms;

internal static class Program
{
    [STAThread]
    private static void Main()
    {
        Application.EnableVisualStyles();
        Application.SetCompatibleTextRenderingDefault(false);

        string tempDir = Path.Combine(Path.GetTempPath(), "ZhenwuLocalHelperSetup_" + Guid.NewGuid().ToString("N"));

        try
        {
            Directory.CreateDirectory(tempDir);
            using (Stream resource = Assembly.GetExecutingAssembly().GetManifestResourceStream("PayloadZip"))
            {
                if (resource == null)
                {
                    throw new InvalidOperationException("Installer payload is missing.");
                }

                using (var archive = new ZipArchive(resource, ZipArchiveMode.Read))
                {
                    foreach (var entry in archive.Entries)
                    {
                        string destinationPath = Path.Combine(tempDir, entry.FullName);
                        string destinationDir = Path.GetDirectoryName(destinationPath);
                        if (!string.IsNullOrEmpty(destinationDir))
                        {
                            Directory.CreateDirectory(destinationDir);
                        }

                        if (string.IsNullOrEmpty(entry.Name))
                        {
                            continue;
                        }

                        entry.ExtractToFile(destinationPath, true);
                    }
                }
            }

            string installScript = Path.Combine(tempDir, "install-local-helper.ps1");
            if (!File.Exists(installScript))
            {
                throw new FileNotFoundException("Cannot find install-local-helper.ps1 in the installer payload.");
            }

            var psi = new ProcessStartInfo
            {
                FileName = "powershell.exe",
                Arguments = "-NoProfile -ExecutionPolicy Bypass -File \"" + installScript + "\" -Silent",
                UseShellExecute = false,
                CreateNoWindow = true
            };

            using (var process = Process.Start(psi))
            {
                process.WaitForExit();
                if (process.ExitCode != 0)
                {
                    throw new InvalidOperationException("The helper installer could not finish automatically.");
                }
            }

            MessageBox.Show(
                "已经安装完成",
                "安装完成",
                MessageBoxButtons.OK,
                MessageBoxIcon.Information
            );
        }
        catch (Exception ex)
        {
            MessageBox.Show(
                "安装失败：\r\n" + ex.Message,
                "真武本地助手",
                MessageBoxButtons.OK,
                MessageBoxIcon.Error
            );
        }
        finally
        {
            try
            {
                if (Directory.Exists(tempDir))
                {
                    Directory.Delete(tempDir, true);
                }
            }
            catch
            {
            }
        }
    }
}
"@

Set-Content -LiteralPath $installerSourcePath -Value $installerSource -Encoding UTF8

& $cscPath `
    /nologo `
    /target:winexe `
    /out:$installerPath `
    /resource:$zipPath,PayloadZip `
    /reference:System.Windows.Forms.dll `
    /reference:System.Drawing.dll `
    /reference:System.IO.Compression.dll `
    /reference:System.IO.Compression.FileSystem.dll `
    $installerSourcePath

if (-not (Test-Path $installerPath)) {
    throw 'Failed to build zhenwu-local-helper-setup.exe'
}

Get-Item $zipPath, $installerPath | Select-Object FullName,Length

