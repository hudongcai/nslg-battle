param(
    [string]$LaunchArg = ''
)

Add-Type -AssemblyName System.Windows.Forms
Add-Type -AssemblyName System.Drawing
Add-Type -AssemblyName System.Web

$script:RootDir = Split-Path -Parent $PSScriptRoot
$script:ConfigPath = Join-Path $PSScriptRoot 'local-helper.config.json'
$script:StatePath = Join-Path $PSScriptRoot 'local-helper.state.json'
$script:HelperScript = Join-Path $PSScriptRoot 'local-helper.js'
$script:BundledNodePath = Join-Path $PSScriptRoot 'node.exe'
$script:DefaultApiBase = 'http://127.0.0.1:3000/api'
$script:LaunchLinkCode = ''
$script:MainForm = $null
$script:ExitRequested = $false
$script:NotifyIcon = $null
$script:NotifyMenu = $null
$script:HelperWorkerProc = $null
$script:TrayStatusLabel = $null
$script:LoadingForm = $null
$script:LoadingLabel = $null
$script:LoadingProgress = $null
$script:AppIconPath = Join-Path $PSScriptRoot 'helper-app.ico'
$script:LaunchAction = 'open'
$script:LaunchProjectId = 0
$script:LaunchTaskId = 0
$script:LaunchApiBase = ''
$script:LaunchShouldHide = $false
$script:LaunchShouldPromptBind = $false
$script:ShowMainWindow = $false
$script:StopWorkerOnExit = $false
$script:UiPidPath = Join-Path $PSScriptRoot 'helper-ui.pid'
$script:LaunchCommandPath = Join-Path $PSScriptRoot 'helper-launch-command.json'
$script:LastLaunchCommandStamp = ''

function Read-HelperConfig {
    if (Test-Path $script:ConfigPath) {
        try {
            return Get-Content $script:ConfigPath -Raw | ConvertFrom-Json
        } catch {}
    }

    return [pscustomobject]@{
        apiBase = $script:DefaultApiBase
        helperToken = ''
        clientId = $null
        deviceId = ''
        taskFolders = @{}
    }
}

function Save-HelperConfig($config) {
    $config | ConvertTo-Json -Depth 8 | Set-Content -Path $script:ConfigPath -Encoding UTF8
}

function Read-HelperState {
    if (Test-Path $script:StatePath) {
        try {
            return Get-Content $script:StatePath -Raw | ConvertFrom-Json
        } catch {}
    }

    return [pscustomobject]@{
        processedByTask = @{}
    }
}

function Test-ProcessAlive([int]$PidValue) {
    if ($PidValue -le 0) {
        return $false
    }

    try {
        $proc = Get-Process -Id $PidValue -ErrorAction Stop
        return $null -ne $proc
    } catch {
        return $false
    }
}

function Get-PrimaryUiPid {
    if (-not (Test-Path $script:UiPidPath)) {
        return 0
    }

    try {
        $pidInfo = Get-Content $script:UiPidPath -Raw | ConvertFrom-Json
        $pidValue = [int]$pidInfo.pid
        if (Test-ProcessAlive $pidValue) {
            return $pidValue
        }
    } catch {}

    try { Remove-Item -LiteralPath $script:UiPidPath -Force -ErrorAction SilentlyContinue } catch {}
    return 0
}

function Register-PrimaryUiInstance {
    @{ pid = $PID; startedAt = Get-Date -Format 'yyyy-MM-dd HH:mm:ss' } |
        ConvertTo-Json -Depth 4 |
        Set-Content -Path $script:UiPidPath -Encoding UTF8
}

function Clear-PrimaryUiInstance {
    try {
        $currentPid = Get-PrimaryUiPid
        if ($currentPid -eq $PID -or $currentPid -eq 0) {
            Remove-Item -LiteralPath $script:UiPidPath -Force -ErrorAction SilentlyContinue
        }
    } catch {}
}

function Write-LaunchCommand($command) {
    $command |
        ConvertTo-Json -Depth 6 |
        Set-Content -Path $script:LaunchCommandPath -Encoding UTF8
}

function Read-LaunchCommand {
    if (-not (Test-Path $script:LaunchCommandPath)) {
        return $null
    }

    try {
        return Get-Content $script:LaunchCommandPath -Raw | ConvertFrom-Json
    } catch {
        return $null
    }
}

function Clear-LaunchCommand {
    try {
        if (Test-Path $script:LaunchCommandPath) {
            Remove-Item -LiteralPath $script:LaunchCommandPath -Force -ErrorAction SilentlyContinue
        }
    } catch {}
}

function Get-ApiBase($config) {
    $apiBase = [string]$config.apiBase
    if ([string]::IsNullOrWhiteSpace($apiBase)) {
        $apiBase = $script:DefaultApiBase
    }
    return $apiBase.TrimEnd('/')
}

function Ensure-TaskFolders($config) {
    if (-not $config.PSObject.Properties['taskFolders']) {
        $config | Add-Member -NotePropertyName taskFolders -NotePropertyValue @{} -Force
    }
}

function Get-StatNumber($stats, [string]$name) {
    try {
        if ($null -eq $stats) {
            return 0
        }
        $value = $stats.$name
        if ($null -eq $value -or [string]::IsNullOrWhiteSpace([string]$value)) {
            return 0
        }
        return [int]$value
    } catch {
        return 0
    }
}

function Invoke-HelperApi {
    param(
        [Parameter(Mandatory = $true)][string]$Path,
        [string]$Method = 'GET',
        $Body = $null,
        [switch]$Anonymous
    )

    $config = Read-HelperConfig
    $headers = @{}
    if (-not $Anonymous) {
        $token = [string]$config.helperToken
        if ([string]::IsNullOrWhiteSpace($token)) {
            throw '助手尚未连接，请先粘贴网页中的连接码。'
        }
        $headers['Authorization'] = "Bearer $token"
    }

    $uri = (Get-ApiBase $config) + $Path
    if ($Body -ne $null) {
        $jsonBody = $Body | ConvertTo-Json -Depth 8
        return Invoke-RestMethod -Method $Method -Uri $uri -Headers $headers -ContentType 'application/json' -Body $jsonBody
    }

    return Invoke-RestMethod -Method $Method -Uri $uri -Headers $headers
}

function Ensure-DeviceId($config) {
    if ([string]::IsNullOrWhiteSpace([string]$config.deviceId)) {
        $config.deviceId = [guid]::NewGuid().ToString()
    }
}

function Get-NodeExecutable {
    if (Test-Path $script:BundledNodePath) {
        return $script:BundledNodePath
    }

    $nodeCmd = Get-Command node -ErrorAction SilentlyContinue
    if ($nodeCmd -and $nodeCmd.Source) {
        return $nodeCmd.Source
    }

    throw '未找到 Node 运行环境，请重新安装本地助手。'
}

function Ensure-AppIconFile {
    if (-not (Test-Path $script:AppIconPath)) {
        $iconScript = Join-Path $PSScriptRoot 'ensure-app-icon.ps1'
        if (Test-Path $iconScript) {
            & powershell -NoProfile -ExecutionPolicy Bypass -File $iconScript -OutputPath $script:AppIconPath | Out-Null
        }
    }
    return (Test-Path $script:AppIconPath)
}

function Get-LinkCodeFromLaunchArg([string]$value) {
    if ([string]::IsNullOrWhiteSpace($value)) {
        return ''
    }

    $text = $value.Trim()
    if ($text -like 'zhenwu-helper://*') {
        try {
            $uri = [System.Uri]$text
            $query = [System.Web.HttpUtility]::ParseQueryString($uri.Query)
            return [string]$query['code']
        } catch {
            return ''
        }
    }

    return $text
}

function Convert-ToInt64OrDefault($value, [long]$defaultValue = 0) {
    try {
        if ([string]::IsNullOrWhiteSpace([string]$value)) {
            return $defaultValue
        }
        return [long]([string]$value)
    } catch {
        return $defaultValue
    }
}

function Convert-ToInt32OrDefault($value, [int]$defaultValue = 0) {
    try {
        if ([string]::IsNullOrWhiteSpace([string]$value)) {
            return $defaultValue
        }
        return [int]([string]$value)
    } catch {
        return $defaultValue
    }
}

function Read-LaunchContext([string]$value) {
    $result = @{
        action = 'open'
        code = ''
        apiBase = ''
        projectId = 0L
        taskId = 0
    }

    if ([string]::IsNullOrWhiteSpace($value)) {
        return $result
    }

    $text = $value.Trim()
    if ($text -like 'zhenwu-helper://*') {
        try {
            $uri = [System.Uri]$text
            $query = [System.Web.HttpUtility]::ParseQueryString($uri.Query)
            $hostAction = [string]$uri.Host
            if (-not [string]::IsNullOrWhiteSpace($hostAction)) {
                $result.action = $hostAction
            }
            $result.code = [string]$query['code']
            $result.apiBase = [string]$query['apiBase']
            $result.projectId = Convert-ToInt64OrDefault $query['projectId']
            $result.taskId = Convert-ToInt32OrDefault $query['taskId']
            return $result
        } catch {
            return $result
        }
    }

    $result.code = $text
    $result.action = 'link'
    return $result
}

function Apply-LaunchApiBase {
    if ([string]::IsNullOrWhiteSpace($script:LaunchApiBase)) {
        return
    }

    $config = Read-HelperConfig
    $config.apiBase = $script:LaunchApiBase.TrimEnd('/')
    Save-HelperConfig $config
}

function Invoke-LaunchCommand($command) {
    if ($null -eq $command) {
        return
    }

    $script:LaunchAction = [string]$command.action
    $script:LaunchProjectId = Convert-ToInt64OrDefault $command.projectId
    $script:LaunchTaskId = Convert-ToInt32OrDefault $command.taskId
    $script:LaunchApiBase = [string]$command.apiBase
    $script:LaunchLinkCode = [string]$command.code

    if (-not [string]::IsNullOrWhiteSpace($script:LaunchLinkCode) -and $script:LinkCodeBox) {
        $script:LinkCodeBox.Text = $script:LaunchLinkCode
    }

    if ($script:LaunchAction -eq 'link' -and -not [string]::IsNullOrWhiteSpace($script:LaunchLinkCode)) {
        try {
            Apply-LaunchApiBase
            $result = Connect-Helper $script:LaunchLinkCode
            Set-Status ("连接成功 · 当前设备: " + $result.deviceName) ([System.Drawing.Color]::FromArgb(55, 125, 34))
            Start-HelperWorker -ForceRestart
            Refresh-UiTasks
        } catch {
            Set-Status $_.Exception.Message ([System.Drawing.Color]::Firebrick)
        }
        return
    }

    if ($script:LaunchAction -eq 'bind-folder') {
        try {
            Apply-LaunchApiBase
            Start-HelperWorker
            Refresh-UiTasks
            Prompt-BindFolderFromLaunch
        } catch {
            Set-Status $_.Exception.Message ([System.Drawing.Color]::Firebrick)
        }
        return
    }

    if ($script:LaunchAction -eq 'open') {
        try {
            Apply-LaunchApiBase
            Start-HelperWorker
            Refresh-UiTasks
        } catch {
            Set-Status $_.Exception.Message ([System.Drawing.Color]::Firebrick)
        }
    }
}

function Process-PendingLaunchCommand {
    $command = Read-LaunchCommand
    if ($null -eq $command) {
        return
    }

    $stamp = [string]$command.timestamp
    if ([string]::IsNullOrWhiteSpace($stamp) -or $stamp -eq $script:LastLaunchCommandStamp) {
        return
    }

    $script:LastLaunchCommandStamp = $stamp
    Clear-LaunchCommand
    Invoke-LaunchCommand $command
}

function Connect-Helper([string]$link连接码) {
    if ([string]::IsNullOrWhiteSpace($link连接码)) {
        throw '请先粘贴网页中的连接码。'
    }

    $config = Read-HelperConfig
    Ensure-DeviceId $config
    Ensure-TaskFolders $config

    $payload = @{
        linkToken = $link连接码.Trim()
        deviceId = $config.deviceId
        deviceName = $env:COMPUTERNAME
        helperVersion = '0.2.0-ui'
        meta = @{
            platform = 'windows-powershell'
            projectId = $script:LaunchProjectId
        }
    }

    $resp = Invoke-HelperApi -Path '/local-helper/link/consume' -Method 'POST' -Body $payload -Anonymous
    if ($resp.code -ne 200) {
        if ($resp.message) { throw $resp.message }
        throw '连接失败。'
    }

    $config.helperToken = $resp.data.helperToken
    $config.clientId = $resp.data.clientId
    Save-HelperConfig $config
    return $resp.data
}

function Start-HelperWorker {
    param([switch]$ForceRestart)

    if (-not (Test-Path $script:HelperScript)) {
        throw '未找到助手后台脚本。'
    }

    if ($ForceRestart) {
        Stop-HelperWorker
        Stop-ExistingHelperWorkerByPid
    }

    if ($script:HelperWorkerProc -and -not $script:HelperWorkerProc.HasExited) {
        return
    }

    $nodeExe = Get-NodeExecutable
    $outLog = Join-Path $PSScriptRoot 'helper-worker.log'
    $errLog = Join-Path $PSScriptRoot 'helper-worker.err.log'
    $script:HelperWorkerProc = Start-Process -FilePath $nodeExe -ArgumentList @($script:HelperScript, '--no-prompt') -WorkingDirectory $PSScriptRoot -WindowStyle Hidden -RedirectStandardOutput $outLog -RedirectStandardError $errLog -PassThru
}

function Stop-ExistingHelperWorkerByPid {
    $pidPath = Join-Path $PSScriptRoot 'local-helper.pid'
    if (-not (Test-Path $pidPath)) {
        return
    }

    try {
        $pidInfo = Get-Content $pidPath -Raw | ConvertFrom-Json
        $workerPid = [int]$pidInfo.pid
        if ($workerPid -gt 0) {
            $proc = Get-Process -Id $workerPid -ErrorAction SilentlyContinue
            if ($proc) {
                Stop-Process -Id $workerPid -Force -ErrorAction SilentlyContinue
            }
        }
    } catch {}

    try { Remove-Item -LiteralPath $pidPath -Force -ErrorAction SilentlyContinue } catch {}
}

function Stop-HelperWorker {
    if ($script:HelperWorkerProc) {
        try {
            if (-not $script:HelperWorkerProc.HasExited) {
                $script:HelperWorkerProc.Kill()
                $script:HelperWorkerProc.WaitForExit(2000) | Out-Null
            }
        } catch {}
        $script:HelperWorkerProc = $null
    }
}

function Get-AssignedTasks {
    $resp = Invoke-HelperApi -Path '/local-helper/assigned-tasks'
    if ($resp.code -ne 200) {
        if ($resp.message) { throw $resp.message }
        throw '加载任务失败。'
    }
    return @($resp.data)
}

function Get-TaskById([int]$taskId) {
    if ($taskId -le 0) {
        return $null
    }
    $tasks = Get-AssignedTasks
    foreach ($task in $tasks) {
        if ([int]$task.id -eq $taskId) {
            return $task
        }
    }
    return $null
}

function Get-TaskKnownFiles([int]$taskId) {
    $state = Read-HelperState
    if ($null -eq $state -or $null -eq $state.processedByTask) {
        return @()
    }

    $taskKey = [string]$taskId
    $known = $state.processedByTask.$taskKey
    if ($known -is [System.Array]) {
        return @($known | ForEach-Object { [string]$_ } | Where-Object { -not [string]::IsNullOrWhiteSpace($_) })
    }
    if ($known) {
        return @([string]$known)
    }
    return @()
}

function Get-TaskSuccessfulFiles([long]$projectId) {
    if ($projectId -le 0) {
        return @()
    }

    try {
        $resp = Invoke-HelperApi -Path "/gallery/imagenames?successOnly=true&projectId=$projectId"
        if ($resp.code -eq 200) {
            if ($resp.data) {
                return @($resp.data | ForEach-Object { [string]$_ } | Where-Object { -not [string]::IsNullOrWhiteSpace($_) })
            }
            return @()
        }
    } catch {
        return $null
    }

    return $null
}

function Get-ImageFileNames([string]$folderPath) {
    if ([string]::IsNullOrWhiteSpace($folderPath) -or -not (Test-Path $folderPath)) {
        return @()
    }

    try {
        return @(
            [System.IO.Directory]::EnumerateFiles($folderPath) |
                Where-Object { [System.IO.Path]::GetExtension($_) -match '^\.(png|jpg|jpeg)$' } |
                ForEach-Object { [System.IO.Path]::GetFileName($_) }
        )
    } catch {
        return @()
    }
}

function Report-TaskPreview([int]$taskId, [string]$folderPath) {
    if ($taskId -le 0 -or [string]::IsNullOrWhiteSpace($folderPath)) {
        return
    }

    $task = Get-TaskById $taskId
    if (-not $task) {
        return
    }

    $files = Get-ImageFileNames $folderPath
    $knownSet = New-Object 'System.Collections.Generic.HashSet[string]' ([System.StringComparer]::OrdinalIgnoreCase)
    $serverKnown = Get-TaskSuccessfulFiles ([long]$task.projectId)
    $knownSource = if ($null -ne $serverKnown) { $serverKnown } else { Get-TaskKnownFiles $taskId }
    foreach ($name in $knownSource) {
        if (-not [string]::IsNullOrWhiteSpace($name)) {
            [void]$knownSet.Add([string]$name)
        }
    }

    $pendingFiles = New-Object System.Collections.Generic.List[string]
    $successfulCount = 0
    foreach ($name in $files) {
        if ($knownSet.Contains([string]$name)) {
            $successfulCount++
        } else {
            [void]$pendingFiles.Add([string]$name)
        }
    }

    $stats = @{
        discovered = $files.Count
        uploaded = $successfulCount
        parsed = $successfulCount
        failed = Get-StatNumber $task.stats 'failed'
        pending = $pendingFiles.Count
        pendingFiles = @($pendingFiles | Select-Object -First 200)
        currentFile = ''
    }

    $resp = Invoke-HelperApi -Path "/local-helper/tasks/$taskId/progress" -Method 'POST' -Body @{
        folderPath = $folderPath
        stats = $stats
    }

    if ($resp.code -ne 200) {
        if ($resp.message) { throw $resp.message }
        throw '刷新待处理图片列表失败。'
    }
}

function Bind-TaskFolder([int]$taskId, [string]$folderPath) {
    $resp = Invoke-HelperApi -Path "/local-helper/helper-tasks/$taskId/bind" -Method 'POST' -Body @{ folderPath = $folderPath }
    if ($resp.code -ne 200) {
        if ($resp.message) { throw $resp.message }
        throw '绑定文件夹失败。'
    }

    $config = Read-HelperConfig
    Ensure-TaskFolders $config
    $taskFolders = @{}
    foreach ($prop in $config.taskFolders.PSObject.Properties) {
        $taskFolders[$prop.Name] = $prop.Value
    }
    $taskFolders[[string]$taskId] = $folderPath
    $config.taskFolders = $taskFolders
    Save-HelperConfig $config
    Report-TaskPreview -taskId $taskId -folderPath $folderPath
}

function Get-SelectedTask {
    if (-not $script:TaskGrid.CurrentRow) {
        return $null
    }
    return $script:TaskGrid.CurrentRow.Tag
}

function Set-Status([string]$text, [System.Drawing.Color]$color) {
    $script:StatusLabel.Text = $text
    $script:StatusLabel.ForeColor = $color
}

function Set-TrayStatus([string]$text, [System.Drawing.Color]$color) {
    if ($script:TrayStatusLabel) {
        $script:TrayStatusLabel.Text = $text
        $script:TrayStatusLabel.ForeColor = $color
    }
}

function Show-LoadingPrompt([string]$text) {
    Close-LoadingPrompt

    $script:LoadingForm = New-Object System.Windows.Forms.Form
    $script:LoadingForm.Text = '真武本地助手'
    $script:LoadingForm.Size = New-Object System.Drawing.Size(390, 130)
    $script:LoadingForm.StartPosition = 'CenterScreen'
    $script:LoadingForm.FormBorderStyle = 'FixedDialog'
    $script:LoadingForm.MaximizeBox = $false
    $script:LoadingForm.MinimizeBox = $false
    $script:LoadingForm.ControlBox = $false
    $script:LoadingForm.TopMost = $true

    $script:LoadingLabel = New-Object System.Windows.Forms.Label
    $script:LoadingLabel.Text = $text
    $script:LoadingLabel.Location = New-Object System.Drawing.Point(22, 18)
    $script:LoadingLabel.Size = New-Object System.Drawing.Size(340, 28)
    $script:LoadingLabel.Font = New-Object System.Drawing.Font('Microsoft YaHei UI', 9)
    $script:LoadingForm.Controls.Add($script:LoadingLabel)

    $script:LoadingProgress = New-Object System.Windows.Forms.ProgressBar
    $script:LoadingProgress.Location = New-Object System.Drawing.Point(22, 58)
    $script:LoadingProgress.Size = New-Object System.Drawing.Size(340, 18)
    $script:LoadingProgress.Style = 'Marquee'
    $script:LoadingProgress.MarqueeAnimationSpeed = 25
    $script:LoadingForm.Controls.Add($script:LoadingProgress)

    $script:LoadingForm.Show()
    $script:LoadingForm.Refresh()
    [System.Windows.Forms.Application]::DoEvents()
}

function Close-LoadingPrompt {
    if ($script:LoadingForm) {
        try {
            $script:LoadingForm.Close()
            $script:LoadingForm.Dispose()
        } catch {}
    }
    $script:LoadingForm = $null
    $script:LoadingLabel = $null
    $script:LoadingProgress = $null
    [System.Windows.Forms.Application]::DoEvents()
}

function Get-TaskStatusLabel([string]$status) {
    switch ($status) {
        'pending_bind' { return '待选择文件夹' }
        'ready' { return '已就绪' }
        'running' { return '解析中' }
        'paused' { return '已暂停' }
        'stopped' { return '已停止' }
        'error' { return '出错' }
        default { return $status }
    }
}

function Prompt-BindSelectedTaskFolder {
    $task = Get-SelectedTask
    if (-not $task) {
        Set-Status '请先选择一个任务。' ([System.Drawing.Color]::Firebrick)
        return
    }

    if (-not [string]::IsNullOrWhiteSpace([string]$task.folderPath) -and (Test-Path $task.folderPath)) {
        $folderDialog.SelectedPath = $task.folderPath
    } else {
        $folderDialog.SelectedPath = ''
    }

    if ($folderDialog.ShowDialog() -eq [System.Windows.Forms.DialogResult]::OK) {
        try {
            Show-LoadingPrompt '正在加载同步目录，请稍候...'
            Bind-TaskFolder -taskId ([int]$task.id) -folderPath $folderDialog.SelectedPath
            Start-HelperWorker
            Close-LoadingPrompt
            Set-Status '监听文件夹已保存。' ([System.Drawing.Color]::FromArgb(55, 125, 34))
            Refresh-UiTasks
        } catch {
            Close-LoadingPrompt
            Set-Status $_.Exception.Message ([System.Drawing.Color]::Firebrick)
        }
    }
}

function Prompt-BindTaskById([int]$taskId) {
    if ($taskId -le 0) {
        Prompt-BindSelectedTaskFolder
        return
    }

    foreach ($row in $script:TaskGrid.Rows) {
        if ($row.Tag -and [int]$row.Tag.id -eq $taskId) {
            $script:TaskGrid.ClearSelection()
            $row.Selected = $true
            $script:TaskGrid.CurrentCell = $row.Cells[0]
            break
        }
    }

    Prompt-BindSelectedTaskFolder
}

function Invoke-DirectFolderBind([int]$taskId) {
    $tasks = Get-AssignedTasks
    $task = $null
    foreach ($item in $tasks) {
        if ([int]$item.id -eq $taskId) {
            $task = $item
            break
        }
    }
    if (-not $task) {
        [System.Windows.Forms.MessageBox]::Show(
            '未找到当前项目的自动解析任务，请回到网页点击刷新后再试一次。',
            '真武本地助手',
            [System.Windows.Forms.MessageBoxButtons]::OK,
            [System.Windows.Forms.MessageBoxIcon]::Warning
        ) | Out-Null
        return
    }

    $dialog = New-Object System.Windows.Forms.FolderBrowserDialog
    $dialog.Description = '请选择当前项目的同步目录。'
    $dialog.ShowNewFolderButton = $false
    if (-not [string]::IsNullOrWhiteSpace([string]$task.folderPath) -and (Test-Path $task.folderPath)) {
        $dialog.SelectedPath = [string]$task.folderPath
    }

    if ($dialog.ShowDialog() -ne [System.Windows.Forms.DialogResult]::OK) {
        return
    }

    try {
        Show-LoadingPrompt '正在加载同步目录，请稍候...'
        Bind-TaskFolder -taskId ([int]$task.id) -folderPath $dialog.SelectedPath
        Start-HelperWorker -ForceRestart
        Close-LoadingPrompt
    } catch {
        Close-LoadingPrompt
        [System.Windows.Forms.MessageBox]::Show(
            $_.Exception.Message,
            '真武本地助手',
            [System.Windows.Forms.MessageBoxButtons]::OK,
            [System.Windows.Forms.MessageBoxIcon]::Error
        ) | Out-Null
    }
}

function Refresh-UiTasks {
    try {
        $tasks = Get-AssignedTasks
        $script:TaskGrid.Rows.Clear()
        $preferredRowIndex = -1
        $fallbackRowIndex = -1
        $pendingBindTask = $null
        foreach ($task in $tasks) {
            $stats = $task.stats
            $rowIndex = $script:TaskGrid.Rows.Add(
                [string]$task.id,
                [string]$task.projectId,
                [string]$task.name,
                (Get-TaskStatusLabel ([string]$task.status)),
                [string]$task.folderPath,
                [string]$stats.uploaded,
                [string]$stats.pending,
                [string]$task.updatedAt
            )
            $row = $script:TaskGrid.Rows[$rowIndex]
            $row.Tag = $task
            if ($fallbackRowIndex -lt 0) {
                $fallbackRowIndex = $rowIndex
            }
            if ($preferredRowIndex -lt 0 -and [string]$task.status -eq 'pending_bind') {
                $preferredRowIndex = $rowIndex
            }
            if (-not $pendingBindTask -and [string]$task.status -eq 'pending_bind' -and [string]::IsNullOrWhiteSpace([string]$task.folderPath)) {
                $pendingBindTask = $task
            }
        }

        if ($script:TaskGrid.Rows.Count -gt 0) {
            $targetIndex = $preferredRowIndex
            if ($targetIndex -lt 0) {
                $targetIndex = $fallbackRowIndex
            }
            if ($targetIndex -ge 0) {
                $script:TaskGrid.ClearSelection()
                $script:TaskGrid.Rows[$targetIndex].Selected = $true
                $script:TaskGrid.CurrentCell = $script:TaskGrid.Rows[$targetIndex].Cells[0]
            }
        }

        $config = Read-HelperConfig
        $linked = -not [string]::IsNullOrWhiteSpace([string]$config.helperToken)
        if ($linked) {
            if ($pendingBindTask) {
                Set-Status '有任务等待绑定同步目录，请在网页里点击“选择同步目录”。' ([System.Drawing.Color]::FromArgb(184, 120, 0))
            } else {
                $deviceText = "已连接 · 设备标识: $($config.deviceId)"
                Set-Status $deviceText ([System.Drawing.Color]::FromArgb(55, 125, 34))
            }
        } else {
            Set-Status '助手尚未连接，请先粘贴网页中的连接码。' ([System.Drawing.Color]::DimGray)
        }
    } catch {
        Set-Status $_.Exception.Message ([System.Drawing.Color]::Firebrick)
    }
}

function Show-HelperWindow {
    if ($script:MainForm) {
        if ($script:NotifyIcon) { $script:NotifyIcon.Visible = $true }
        $script:MainForm.ShowInTaskbar = $true
        $script:MainForm.Show()
        $script:MainForm.WindowState = [System.Windows.Forms.FormWindowState]::Normal
        $script:MainForm.Activate()
    }
}

function Hide-HelperWindow {
    if ($script:MainForm) {
        if ($script:NotifyIcon) { $script:NotifyIcon.Visible = $true }
        $script:MainForm.ShowInTaskbar = $false
        $script:MainForm.WindowState = [System.Windows.Forms.FormWindowState]::Minimized
        $script:MainForm.Hide()
    }
}

function Prompt-BindFolderFromLaunch {
    if ($script:MainForm) {
        [void]$script:MainForm.BeginInvoke([System.Action]{
            if ($script:LaunchTaskId -gt 0) {
                Prompt-BindTaskById $script:LaunchTaskId
            } else {
                Prompt-BindSelectedTaskFolder
            }
        })
        return
    }

    if ($script:LaunchTaskId -gt 0) {
        Prompt-BindTaskById $script:LaunchTaskId
    } else {
        Prompt-BindSelectedTaskFolder
    }
}

function Show-StartupReadyMessage {
    [System.Windows.Forms.MessageBox]::Show(
        '自动化任务文件监听助手已启动。',
        '真武本地助手',
        [System.Windows.Forms.MessageBoxButtons]::OK,
        [System.Windows.Forms.MessageBoxIcon]::Information
    ) | Out-Null
}

function Initialize-NotifyIcon {
    try {
        $script:NotifyIcon = New-Object System.Windows.Forms.NotifyIcon
        if (Ensure-AppIconFile) {
            $script:NotifyIcon.Icon = New-Object System.Drawing.Icon($script:AppIconPath)
        } else {
            $script:NotifyIcon.Icon = [System.Drawing.SystemIcons]::Application
        }
        $script:NotifyIcon.Text = '真武本地助手'
        $script:NotifyIcon.Visible = $true

        $script:NotifyMenu = New-Object System.Windows.Forms.ContextMenuStrip
        $refreshItem = $script:NotifyMenu.Items.Add('刷新任务')
        $refreshItem.Add_Click({ Refresh-UiTasks })
        $exitItem = $script:NotifyMenu.Items.Add('彻底退出')
        $exitItem.Add_Click({
            $script:ExitRequested = $true
            if ($script:MainForm) { $script:MainForm.Close() }
        })
        $script:NotifyIcon.ContextMenuStrip = $script:NotifyMenu
        Set-TrayStatus '托盘状态：已初始化' ([System.Drawing.Color]::FromArgb(55, 125, 34))
    } catch {
        $script:NotifyIcon = $null
        $script:NotifyMenu = $null
        Set-TrayStatus '托盘状态：初始化失败' ([System.Drawing.Color]::Firebrick)
    }
}

$form = New-Object System.Windows.Forms.Form
$script:MainForm = $form
$form.Text = '真武本地助手'
$form.Size = New-Object System.Drawing.Size(980, 640)
$form.StartPosition = 'CenterScreen'
$form.BackColor = [System.Drawing.Color]::White
$form.ShowInTaskbar = $true
$form.WindowState = [System.Windows.Forms.FormWindowState]::Normal
if (Ensure-AppIconFile) {
    try { $form.Icon = New-Object System.Drawing.Icon($script:AppIconPath) } catch {}
}

Initialize-NotifyIcon

$form.Add_FormClosing({
    if (-not $script:ExitRequested) {
        $_.Cancel = $true
        Hide-HelperWindow
        if ($script:NotifyIcon) {
            $script:NotifyIcon.BalloonTipTitle = '真武本地助手'
            $script:NotifyIcon.BalloonTipText = '已隐藏到后台，双击托盘图标可重新打开。'
            $script:NotifyIcon.ShowBalloonTip(1500)
        }
    }
    elseif ($script:NotifyIcon) {
        $script:NotifyIcon.Visible = $false
    }
})

$form.Add_Resize({
    if (-not $script:ExitRequested -and $script:MainForm.WindowState -eq [System.Windows.Forms.FormWindowState]::Minimized) {
        Hide-HelperWindow
    }
})

$form.Add_Shown({
    if ($script:NotifyIcon) {
        $script:NotifyIcon.Visible = $true
        Set-TrayStatus '托盘状态：已初始化' ([System.Drawing.Color]::FromArgb(55, 125, 34))
    }
})

$title = New-Object System.Windows.Forms.Label
$title.Text = '真武本地助手'
$title.Font = New-Object System.Drawing.Font('Segoe UI', 16, [System.Drawing.FontStyle]::Bold)
$title.Location = New-Object System.Drawing.Point(18, 18)
$title.AutoSize = $true
$form.Controls.Add($title)

$subTitle = New-Object System.Windows.Forms.Label
$subTitle.Text = '先在网页创建任务，再在这里为任务选择截图文件夹。助手会在后台持续监听。'
$subTitle.Font = New-Object System.Drawing.Font('Segoe UI', 9)
$subTitle.ForeColor = [System.Drawing.Color]::DimGray
$subTitle.Location = New-Object System.Drawing.Point(20, 50)
$subTitle.AutoSize = $true
$form.Controls.Add($subTitle)

$linkLabel = New-Object System.Windows.Forms.Label
$linkLabel.Text = '连接码'
$linkLabel.Location = New-Object System.Drawing.Point(22, 88)
$linkLabel.AutoSize = $true
$form.Controls.Add($linkLabel)

$script:LinkCodeBox = New-Object System.Windows.Forms.TextBox
$script:LinkCodeBox.Location = New-Object System.Drawing.Point(90, 84)
$script:LinkCodeBox.Size = New-Object System.Drawing.Size(410, 28)
$form.Controls.Add($script:LinkCodeBox)

$connectButton = New-Object System.Windows.Forms.Button
$connectButton.Text = '连接助手'
$connectButton.Location = New-Object System.Drawing.Point(514, 82)
$connectButton.Size = New-Object System.Drawing.Size(100, 30)
$form.Controls.Add($connectButton)

$refreshButton = New-Object System.Windows.Forms.Button
$refreshButton.Text = '刷新任务'
$refreshButton.Location = New-Object System.Drawing.Point(624, 82)
$refreshButton.Size = New-Object System.Drawing.Size(92, 30)
$form.Controls.Add($refreshButton)

$startButton = New-Object System.Windows.Forms.Button
$startButton.Text = '启动后台'
$startButton.Location = New-Object System.Drawing.Point(726, 82)
$startButton.Size = New-Object System.Drawing.Size(120, 30)
$form.Controls.Add($startButton)

$hideButton = New-Object System.Windows.Forms.Button
$hideButton.Text = '隐藏到托盘'
$hideButton.Location = New-Object System.Drawing.Point(856, 82)
$hideButton.Size = New-Object System.Drawing.Size(96, 30)
$form.Controls.Add($hideButton)

$chooseButton = New-Object System.Windows.Forms.Button
$chooseButton.Text = '选择截图文件夹'
$chooseButton.Location = New-Object System.Drawing.Point(22, 126)
$chooseButton.Size = New-Object System.Drawing.Size(230, 30)
$form.Controls.Add($chooseButton)

$exitButton = New-Object System.Windows.Forms.Button
$exitButton.Text = '彻底退出'
$exitButton.Location = New-Object System.Drawing.Point(856, 126)
$exitButton.Size = New-Object System.Drawing.Size(96, 30)
$form.Controls.Add($exitButton)

$script:StatusLabel = New-Object System.Windows.Forms.Label
$script:StatusLabel.Location = New-Object System.Drawing.Point(270, 132)
$script:StatusLabel.Size = New-Object System.Drawing.Size(570, 22)
$script:StatusLabel.Font = New-Object System.Drawing.Font('Segoe UI', 9)
$script:StatusLabel.ForeColor = [System.Drawing.Color]::DimGray
$form.Controls.Add($script:StatusLabel)

$script:TrayStatusLabel = New-Object System.Windows.Forms.Label
$script:TrayStatusLabel.Location = New-Object System.Drawing.Point(270, 108)
$script:TrayStatusLabel.Size = New-Object System.Drawing.Size(570, 18)
$script:TrayStatusLabel.Font = New-Object System.Drawing.Font('Segoe UI', 9)
$script:TrayStatusLabel.ForeColor = [System.Drawing.Color]::DimGray
$script:TrayStatusLabel.Text = '托盘状态：初始化中...'
$form.Controls.Add($script:TrayStatusLabel)

$script:TaskGrid = New-Object System.Windows.Forms.DataGridView
$script:TaskGrid.Location = New-Object System.Drawing.Point(22, 170)
$script:TaskGrid.Size = New-Object System.Drawing.Size(930, 390)
$script:TaskGrid.SelectionMode = 'FullRowSelect'
$script:TaskGrid.MultiSelect = $false
$script:TaskGrid.AllowUserToAddRows = $false
$script:TaskGrid.AllowUserToDeleteRows = $false
$script:TaskGrid.ReadOnly = $true
$script:TaskGrid.RowHeadersVisible = $false
$script:TaskGrid.AutoSizeColumnsMode = 'Fill'
$null = $script:TaskGrid.Columns.Add('taskId', '任务ID')
$null = $script:TaskGrid.Columns.Add('projectId', '项目ID')
$null = $script:TaskGrid.Columns.Add('taskName', '任务名称')
$null = $script:TaskGrid.Columns.Add('status', '状态')
$null = $script:TaskGrid.Columns.Add('folderPath', '监听文件夹')
$null = $script:TaskGrid.Columns.Add('uploaded', '已上传')
$null = $script:TaskGrid.Columns.Add('pending', '待处理')
$null = $script:TaskGrid.Columns.Add('updatedAt', '更新时间')
$script:TaskGrid.Columns['folderPath'].FillWeight = 220
$script:TaskGrid.Columns['taskName'].FillWeight = 130
$form.Controls.Add($script:TaskGrid)

$tipLabel = New-Object System.Windows.Forms.Label
$tipLabel.Text = '流程：1. 在网页创建任务  2. 在这里连接助手  3. 为该任务选择截图文件夹'
$tipLabel.Location = New-Object System.Drawing.Point(22, 574)
$tipLabel.Size = New-Object System.Drawing.Size(920, 22)
$tipLabel.ForeColor = [System.Drawing.Color]::DimGray
$form.Controls.Add($tipLabel)

$folderDialog = New-Object System.Windows.Forms.FolderBrowserDialog
$folderDialog.Description = '请选择会持续新增截图的文件夹。'
$folderDialog.ShowNewFolderButton = $false

$script:LaunchLinkCode = Get-LinkCodeFromLaunchArg $LaunchArg
$launchContext = Read-LaunchContext $LaunchArg
$script:LaunchAction = [string]$launchContext.action
$script:LaunchProjectId = Convert-ToInt64OrDefault $launchContext.projectId
$script:LaunchTaskId = Convert-ToInt32OrDefault $launchContext.taskId
$script:LaunchApiBase = [string]$launchContext.apiBase
if (-not [string]::IsNullOrWhiteSpace($script:LaunchLinkCode)) {
    $script:LinkCodeBox.Text = $script:LaunchLinkCode
}

if ($script:LaunchAction -eq 'open') {
    try {
        Apply-LaunchApiBase
        $config = Read-HelperConfig
        if (-not [string]::IsNullOrWhiteSpace([string]$config.helperToken)) {
            Start-HelperWorker
        }
        Show-StartupReadyMessage
    } catch {
        [System.Windows.Forms.MessageBox]::Show(
            $_.Exception.Message,
            '真武本地助手',
            [System.Windows.Forms.MessageBoxButtons]::OK,
            [System.Windows.Forms.MessageBoxIcon]::Error
        ) | Out-Null
    }
    Clear-PrimaryUiInstance
    Clear-LaunchCommand
    exit
}

if ($script:LaunchAction -eq 'bind-folder') {
    try {
        Apply-LaunchApiBase
        $config = Read-HelperConfig
        if (-not [string]::IsNullOrWhiteSpace([string]$config.helperToken)) {
            Start-HelperWorker -ForceRestart
        }
        Invoke-DirectFolderBind $script:LaunchTaskId
    } catch {
        [System.Windows.Forms.MessageBox]::Show(
            $_.Exception.Message,
            '真武本地助手',
            [System.Windows.Forms.MessageBoxButtons]::OK,
            [System.Windows.Forms.MessageBoxIcon]::Error
        ) | Out-Null
    }
    Clear-PrimaryUiInstance
    Clear-LaunchCommand
    exit
}

$existingUiPid = Get-PrimaryUiPid
if ($existingUiPid -gt 0 -and $existingUiPid -ne $PID) {
    Write-LaunchCommand @{
        timestamp = [guid]::NewGuid().ToString()
        action = $script:LaunchAction
        code = $script:LaunchLinkCode
        apiBase = $script:LaunchApiBase
        projectId = $script:LaunchProjectId
        taskId = $script:LaunchTaskId
    }
    exit
}

Register-PrimaryUiInstance

if ($script:LaunchAction -eq 'link' -and -not [string]::IsNullOrWhiteSpace($script:LaunchLinkCode)) {
    try {
        Apply-LaunchApiBase
        Connect-Helper $script:LaunchLinkCode | Out-Null
        Start-HelperWorker
        $script:LaunchShouldHide = $true
    } catch {
        try {
            $errorLog = Join-Path $PSScriptRoot 'helper-link.err.log'
            ((Get-Date -Format 'yyyy-MM-dd HH:mm:ss') + ' ' + $_.Exception.Message) | Add-Content -Path $errorLog -Encoding UTF8
        } catch {}
    }
}

$connectButton.Add_Click({
    try {
        $result = Connect-Helper $script:LinkCodeBox.Text
        Set-Status ("连接成功 · 当前设备: " + $result.deviceName) ([System.Drawing.Color]::FromArgb(55, 125, 34))
        Start-HelperWorker -ForceRestart
        Refresh-UiTasks
    } catch {
        Set-Status $_.Exception.Message ([System.Drawing.Color]::Firebrick)
    }
})

$refreshButton.Add_Click({
    Refresh-UiTasks
})

$startButton.Add_Click({
    try {
        Start-HelperWorker
        Set-Status '后台监听已启动。' ([System.Drawing.Color]::FromArgb(55, 125, 34))
    } catch {
        Set-Status $_.Exception.Message ([System.Drawing.Color]::Firebrick)
    }
})

$hideButton.Add_Click({
    Hide-HelperWindow
    if ($script:NotifyIcon) {
        Set-Status '窗口已隐藏到托盘。' ([System.Drawing.Color]::FromArgb(55, 125, 34))
    } else {
        Set-Status '托盘未初始化，窗口已隐藏。' ([System.Drawing.Color]::Firebrick)
    }
})

$chooseButton.Add_Click({
    Prompt-BindSelectedTaskFolder
})

$exitButton.Add_Click({
    $script:StopWorkerOnExit = $true
    $script:ExitRequested = $true
    if ($script:MainForm) { $script:MainForm.Close() }
})

$script:TaskGrid.Add_CellDoubleClick({
    if ($script:TaskGrid.CurrentRow) {
        Prompt-BindSelectedTaskFolder
    }
})

$timer = New-Object System.Windows.Forms.Timer
$timer.Interval = 1000
$timer.Add_Tick({
    Process-PendingLaunchCommand
    Refresh-UiTasks
})
$timer.Start()

try {
    $config = Read-HelperConfig
    if (-not [string]::IsNullOrWhiteSpace([string]$config.helperToken)) {
        Start-HelperWorker
    }
} catch {}

Refresh-UiTasks
if (-not [string]::IsNullOrWhiteSpace($script:LaunchLinkCode)) {
    try {
        Apply-LaunchApiBase
        $config = Read-HelperConfig
        if ([string]::IsNullOrWhiteSpace([string]$config.helperToken)) {
            $result = Connect-Helper $script:LaunchLinkCode
            Set-Status ("连接成功 · 当前设备: " + $result.deviceName) ([System.Drawing.Color]::FromArgb(55, 125, 34))
            Start-HelperWorker -ForceRestart
            Refresh-UiTasks
        }
    } catch {
        Set-Status $_.Exception.Message ([System.Drawing.Color]::Firebrick)
    }
}

if ($script:LaunchAction -eq 'bind-folder') {
    try {
        Refresh-UiTasks
        $script:LaunchShouldHide = $true
        $script:LaunchShouldPromptBind = $true
    } catch {
        Set-Status $_.Exception.Message ([System.Drawing.Color]::Firebrick)
    }
}
$form.Add_Shown({
    Process-PendingLaunchCommand
    if ($script:LaunchShouldHide) {
        $script:LaunchShouldHide = $false
        Hide-HelperWindow
    }
    if ($script:LaunchShouldPromptBind) {
        $script:LaunchShouldPromptBind = $false
        [void]$script:MainForm.BeginInvoke([System.Action]{
            if ($script:LaunchTaskId -gt 0) {
                Prompt-BindTaskById $script:LaunchTaskId
            } else {
                Prompt-BindSelectedTaskFolder
            }
        })
    }
})
if ($script:ShowMainWindow) {
    $form.Show()
} else {
    $form.ShowInTaskbar = $false
    $form.WindowState = [System.Windows.Forms.FormWindowState]::Minimized
}
[System.Windows.Forms.Application]::Run($form)

Clear-PrimaryUiInstance

if ($script:NotifyIcon) {
    $script:NotifyIcon.Visible = $false
    $script:NotifyIcon.Dispose()
}

if ($script:NotifyMenu) {
    $script:NotifyMenu.Dispose()
}

if ($script:StopWorkerOnExit) {
    Stop-HelperWorker
}


