param(
    [switch]$Quiet
)

$installDir = Join-Path $env:LOCALAPPDATA 'ZhenwuLocalHelper'
$pidFile = Join-Path $installDir 'local-helper.pid'
$uiPidFile = Join-Path $installDir 'helper-ui.pid'
$launchCommandFile = Join-Path $installDir 'helper-launch-command.json'

function Write-Info([string]$message) {
    if (-not $Quiet) {
        Write-Host $message
    }
}

function Get-ProcessInfoMap {
    $map = @{}
    try {
        Get-CimInstance Win32_Process | ForEach-Object {
            $map[[int]$_.ProcessId] = [pscustomobject]@{
                CommandLine = [string]$_.CommandLine
                ParentProcessId = [int]$_.ParentProcessId
            }
        }
    } catch {
        try {
            Get-WmiObject Win32_Process | ForEach-Object {
                $map[[int]$_.ProcessId] = [pscustomobject]@{
                    CommandLine = [string]$_.CommandLine
                    ParentProcessId = [int]$_.ParentProcessId
                }
            }
        } catch {}
    }
    return $map
}

function Test-IsHelperCommand([string]$cmd) {
    if ([string]::IsNullOrWhiteSpace($cmd)) {
        return $false
    }
    return ($cmd -match 'local-helper|helper-ui\.ps1|start-local-helper\.vbs|Zhenwu Local Helper|zhenwu-local-helper') -and
           ($cmd -notmatch 'close-local-helper\.ps1|close-local-helper\.bat')
}

function Get-DescendantProcessIds([int]$rootPid, $infoMap) {
    $result = New-Object System.Collections.Generic.HashSet[int]
    $queue = New-Object System.Collections.Generic.Queue[int]
    $queue.Enqueue($rootPid)
    while ($queue.Count -gt 0) {
        $currentId = $queue.Dequeue()
        foreach ($kv in $infoMap.GetEnumerator()) {
            $childPid = [int]$kv.Key
            $parentPid = [int]$kv.Value.ParentProcessId
            if ($parentPid -eq $currentId -and $result.Add($childPid)) {
                $queue.Enqueue($childPid)
            }
        }
    }
    return $result
}

function Stop-ProcessTree([int]$rootPid, $infoMap) {
    $all = New-Object System.Collections.Generic.List[int]
    foreach ($childPid in @(Get-DescendantProcessIds -rootPid $rootPid -infoMap $infoMap)) {
        $all.Add([int]$childPid)
    }
    $all.Add($rootPid)
    foreach ($targetId in ($all | Sort-Object -Descending -Unique)) {
        try {
            $process = Get-Process -Id $targetId -ErrorAction SilentlyContinue
            if ($process) {
                Stop-Process -Id $targetId -Force -ErrorAction Stop
                Write-Info ("Stopped process {0} ({1})" -f $process.ProcessName, $targetId)
            }
        } catch {
            Write-Info ("Failed to stop {0}: {1}" -f $targetId, $_.Exception.Message)
        }
    }
}

$infoMap = Get-ProcessInfoMap
$targets = New-Object System.Collections.Generic.HashSet[int]
$selfPid = $PID

if (Test-Path $pidFile) {
    try {
        $pidData = Get-Content -Path $pidFile -Raw | ConvertFrom-Json
        $workerPid = [int]$pidData.pid
        if ($workerPid -gt 0 -and $workerPid -ne $selfPid) {
            [void]$targets.Add($workerPid)
        }
    } catch {}
}

if (Test-Path $uiPidFile) {
    try {
        $pidData = Get-Content -Path $uiPidFile -Raw | ConvertFrom-Json
        $uiPid = [int]$pidData.pid
        if ($uiPid -gt 0 -and $uiPid -ne $selfPid) {
            [void]$targets.Add($uiPid)
        }
    } catch {}
}

Get-Process -ErrorAction SilentlyContinue | ForEach-Object {
    $name = [string]$_.ProcessName
    $info = $infoMap[$_.Id]
    $cmd = if ($info) { [string]$info.CommandLine } else { '' }
    if ($name -ieq 'node' -or $name -ieq 'powershell' -or $name -ieq 'wscript') {
        $isInstallDirMatch = (-not [string]::IsNullOrWhiteSpace($cmd)) -and
            ($cmd -like ("*" + $installDir + "*"))
        if ((Test-IsHelperCommand $cmd -or $isInstallDirMatch) -and $_.Id -ne $selfPid) {
            [void]$targets.Add([int]$_.Id)
        }
    }
}

foreach ($targetId in @($targets)) {
    foreach ($childPid in @(Get-DescendantProcessIds -rootPid $targetId -infoMap $infoMap)) {
        if ($childPid -ne $selfPid) {
            [void]$targets.Add([int]$childPid)
        }
    }
}

if (-not $targets.Count) {
    Write-Info 'No running local helper process was found.'
    exit 0
}

Write-Info ('Preparing to stop helper-related processes: ' + (($targets | Sort-Object -Unique) -join ', '))
foreach ($targetId in ($targets | Sort-Object -Unique)) {
    Stop-ProcessTree -rootPid $targetId -infoMap $infoMap
}

Start-Sleep -Milliseconds 500
if (Test-Path $pidFile) {
    try {
        Remove-Item -LiteralPath $pidFile -Force -ErrorAction SilentlyContinue
    } catch {}
}

if (Test-Path $uiPidFile) {
    try {
        Remove-Item -LiteralPath $uiPidFile -Force -ErrorAction SilentlyContinue
    } catch {}
}

if (Test-Path $launchCommandFile) {
    try {
        Remove-Item -LiteralPath $launchCommandFile -Force -ErrorAction SilentlyContinue
    } catch {}
}

Write-Info 'close complete'
