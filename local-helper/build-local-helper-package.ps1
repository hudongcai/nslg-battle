$packageDir = Join-Path $PSScriptRoot '..\release\zhenwu-local-helper'
$zipPath = Join-Path $PSScriptRoot '..\release\zhenwu-local-helper.zip'
$publicDownloadDir = Join-Path $PSScriptRoot '..\downloads'
$versionSuffix = if ($env:ZHENWU_HELPER_VERSION_SUFFIX) { $env:ZHENWU_HELPER_VERSION_SUFFIX } else { (Get-Date).ToString('MMddHHmm') }
$installerName = "zhenwu-local-helper-setup-$versionSuffix.exe"
$installerPath = Join-Path $publicDownloadDir $installerName
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

# 复制最新版本的 local-helper.js（包含日志功能）
Copy-Item -LiteralPath (Join-Path $PSScriptRoot 'local-helper.js') -Destination (Join-Path $packageDir 'local-helper.js') -Force

# 复制必要的 node_modules 依赖（只复制 socket.io-client 及其依赖）
$nodeModulesSource = Join-Path $PSScriptRoot '..\node_modules'
$nodeModulesDest = Join-Path $packageDir 'node_modules'
if (Test-Path $nodeModulesSource) {
    Write-Host "正在复制必要的依赖模块..."
    New-Item -ItemType Directory -Path $nodeModulesDest -Force | Out-Null

    # socket.io-client 及其必要依赖
    $requiredModules = @(
        'socket.io-client',
        'socket.io-parser',
        '@socket.io',
        'engine.io-client',
        'engine.io-parser',
        'xmlhttprequest-ssl',
        'ws',
        'debug',
        'ms'
    )

    foreach ($module in $requiredModules) {
        $srcPath = Join-Path $nodeModulesSource $module
        if (Test-Path $srcPath) {
            $destPath = Join-Path $nodeModulesDest $module
            Copy-Item -LiteralPath $srcPath -Destination $destPath -Recurse -Force
            Write-Host "  ✅ 已复制: $module"
        } else {
            Write-Warning "  ⚠️  未找到: $module"
        }
    }

    Write-Host "✅ 依赖模块复制完成"
} else {
    Write-Error "❌ 未找到 node_modules，请先运行 npm install"
    exit 1
}

# 写入版本信息文件（打包时间）
$versionInfo = @{
    buildTime = (Get-Date).ToString('yyyy-MM-dd HH:mm')
    buildTimestamp = [int][double]::Parse((Get-Date -UFormat %s))
} | ConvertTo-Json
$versionInfo | Set-Content -Path (Join-Path $packageDir 'version.json') -Encoding UTF8

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
        string installDir = Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.LocalApplicationData), "ZhenwuLocalHelper");

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

            // 在用户点击"确定"后启动本地助手
            string vbsPath = Path.Combine(installDir, "start-local-helper.vbs");
            if (File.Exists(vbsPath))
            {
                var startPsi = new ProcessStartInfo
                {
                    FileName = "cscript.exe",
                    Arguments = "\"" + vbsPath + "\"",
                    UseShellExecute = false,
                    CreateNoWindow = true,
                    WorkingDirectory = installDir
                };
                Process.Start(startPsi);
            }
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
    throw "Failed to build $installerName"
}

Get-Item $zipPath, $installerPath | Select-Object FullName,Length
