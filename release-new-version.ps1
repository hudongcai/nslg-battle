param(
    [string]$CommitMessage = "Release",
    [switch]$BuildHelper,
    [switch]$SkipCommit,
    [switch]$SkipPush,
    [switch]$SkipVerify
)

$ErrorActionPreference = "Stop"

function Write-Utf8NoBom {
    param(
        [Parameter(Mandatory = $true)][string]$Path,
        [Parameter(Mandatory = $true)][string]$Value
    )
    $utf8NoBom = New-Object System.Text.UTF8Encoding($false)
    [System.IO.File]::WriteAllText($Path, $Value, $utf8NoBom)
}

function Run-Step {
    param(
        [Parameter(Mandatory = $true)][string]$Title,
        [Parameter(Mandatory = $true)][scriptblock]$Script
    )
    Write-Host ""
    Write-Host $Title -ForegroundColor Yellow
    & $Script
}

function Get-PublishLabel {
    return -join @(
        [char]0x6700, # zui
        [char]0x65B0, # xin
        [char]0x53D1, # fa
        [char]0x5E03  # bu
    )
}

Set-Location $PSScriptRoot

$now = Get-Date
$versionTime = $now.ToString("yyyyMMddHHmm")
$displayTime = $now.ToString("yyyy.MM.dd HH:mm")
$shortVersion = $now.ToString("MMddHHmm")
$installerName = "zhenwu-local-helper-setup-$shortVersion.exe"
$publishLabel = Get-PublishLabel

Write-Host "========================================" -ForegroundColor Cyan
Write-Host "Zhenwu release script" -ForegroundColor Cyan
Write-Host "========================================" -ForegroundColor Cyan
Write-Host "Publish time: $displayTime" -ForegroundColor Gray
Write-Host "Asset version: $versionTime" -ForegroundColor Gray

Run-Step "[1/6] Update publish time and frontend cache version" {
    $indexFile = Join-Path $PSScriptRoot "index.html"
    $indexContent = Get-Content $indexFile -Raw -Encoding UTF8

    $subText = "$publishLabel $displayTime"
    $indexContent = [regex]::Replace(
        $indexContent,
        '<span class="sub">.*?</span>',
        "<span class=""sub"">$subText</span>"
    )
    $indexContent = [regex]::Replace(
        $indexContent,
        'ocr-system\.js\?v=\d+',
        "ocr-system.js?v=$versionTime"
    )
    $indexContent = [regex]::Replace(
        $indexContent,
        'ocr-watch-v2\.js\?v=\d+',
        "ocr-watch-v2.js?v=$versionTime"
    )

    Write-Utf8NoBom -Path $indexFile -Value $indexContent
    Write-Host "Updated publish time: $subText"
    Write-Host "Updated cache version: $versionTime"
}

if ($BuildHelper) {
    Run-Step "[2/6] Build local helper installer" {
        $env:ZHENWU_HELPER_VERSION_SUFFIX = $shortVersion
        try {
            & (Join-Path $PSScriptRoot "local-helper\build-local-helper-package.ps1")
        }
        finally {
            Remove-Item Env:\ZHENWU_HELPER_VERSION_SUFFIX -ErrorAction SilentlyContinue
        }
        if ($LASTEXITCODE -ne 0) {
            throw "Helper installer build failed"
        }
        Write-Host "Built: downloads\$installerName"
    }
} else {
    Write-Host ""
    Write-Host "[2/6] Skip helper build. Use -BuildHelper when needed." -ForegroundColor DarkGray
}

Run-Step "[3/6] Syntax checks" {
    node --check nslg-backend.js
    node --check ocr-system.js
    node --check ocr-watch-v2.js
    node --check local-helper.minimal.js
}

if ($SkipCommit) {
    Write-Host ""
    Write-Host "[4/6] Skip commit" -ForegroundColor DarkGray
} else {
    Run-Step "[4/6] Commit changes" {
        git add -u
        git reset -- local-helper.pid local-helper.state.json 2>$null
        if ($BuildHelper -and (Test-Path (Join-Path $PSScriptRoot "downloads\$installerName"))) {
            git add "downloads\$installerName"
        }

        $status = git diff --cached --name-only
        if (-not $status) {
            Write-Host "No staged changes to commit"
            return
        }

        $fullCommitMessage = "$CommitMessage ($displayTime)"
        git commit -m $fullCommitMessage
        if ($LASTEXITCODE -ne 0) {
            throw "Commit failed"
        }
        Write-Host "Committed: $fullCommitMessage"
    }
}

if ($SkipPush -or $SkipCommit) {
    Write-Host ""
    Write-Host "[5/6] Skip push" -ForegroundColor DarkGray
} else {
    Run-Step "[5/6] Push to origin/main" {
        git push origin main
        if ($LASTEXITCODE -ne 0) {
            throw "Push failed"
        }
    }
}

if ($SkipVerify -or $SkipPush -or $SkipCommit) {
    Write-Host ""
    Write-Host "[6/6] Skip production verification" -ForegroundColor DarkGray
} else {
    Run-Step "[6/6] Verify production page" {
        $ok = $false
        for ($i = 1; $i -le 18; $i++) {
            Start-Sleep -Seconds 10
            try {
                $url = "https://www.zhenwu.fun/?releaseCheck=$([DateTimeOffset]::UtcNow.ToUnixTimeSeconds())"
                $html = (Invoke-WebRequest -Uri $url -UseBasicParsing -TimeoutSec 20).Content
                if ($html -match [regex]::Escape("$publishLabel $displayTime") -and $html -match "ocr-system\.js\?v=$versionTime") {
                    $ok = $true
                    break
                }
            } catch {
            }
        }

        if (-not $ok) {
            throw "Production page has not shown the new publish time yet"
        }
        Write-Host "Production updated: $publishLabel $displayTime"
    }
}

Write-Host ""
Write-Host "========================================" -ForegroundColor Cyan
Write-Host "Release script finished" -ForegroundColor Green
Write-Host "========================================" -ForegroundColor Cyan
Write-Host "Publish time: $displayTime" -ForegroundColor Gray
Write-Host "Frontend version: $versionTime" -ForegroundColor Gray
if ($BuildHelper) {
    Write-Host "Helper installer: $installerName" -ForegroundColor Gray
}
