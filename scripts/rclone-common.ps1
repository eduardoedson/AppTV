# Shared rclone helpers for the AppTV scripts that talk to Google Drive.

function Find-Rclone {
    $command = Get-Command rclone.exe -ErrorAction SilentlyContinue
    if ($command) { return $command.Source }
    # winget installs portable packages here and may not refresh PATH for the current session
    $wingetLink = Join-Path $env:LOCALAPPDATA 'Microsoft\WinGet\Links\rclone.exe'
    if (Test-Path $wingetLink) { return $wingetLink }
    $packages = Join-Path $env:LOCALAPPDATA 'Microsoft\WinGet\Packages'
    if (Test-Path $packages) {
        $found = Get-ChildItem $packages -Recurse -Filter 'rclone.exe' -ErrorAction SilentlyContinue | Select-Object -First 1
        if ($found) { return $found.FullName }
    }
    return $null
}

# Returns the rclone path, installing it and configuring Google Drive access on the first run
function Initialize-Rclone([string]$RemoteName) {
    $rclone = Find-Rclone
    if (-not $rclone) {
        Write-Host 'rclone not found. Installing with winget...'
        & winget install --id Rclone.Rclone --exact --accept-source-agreements --accept-package-agreements
        $rclone = Find-Rclone
        if (-not $rclone) {
            Write-Host 'Could not find rclone after installing. Close and reopen the terminal, then run this script again.' -ForegroundColor Red
            exit 1
        }
    }
    $remotes = & $rclone listremotes
    if ($remotes -notcontains "${RemoteName}:") {
        Write-Host 'First run: a browser window will open to sign in to Google Drive.'
        & $rclone config create $RemoteName drive scope=drive
        if ($LASTEXITCODE -ne 0) {
            Write-Host 'Google Drive configuration failed.' -ForegroundColor Red
            exit 1
        }
    }
    return $rclone
}

# ID of a file in the root of the Drive, or $null when it does not exist
function Get-RemoteFileId([string]$Rclone, [string]$RemoteName, [string]$FileName) {
    $json = & $Rclone lsjson "${RemoteName}:" --files-only --include "/$FileName" 2>$null
    if ($LASTEXITCODE -ne 0 -or -not $json) { return $null }
    $entries = @($json | Out-String | ConvertFrom-Json)
    if ($entries.Count -eq 0) { return $null }
    return @($entries[0].ID)[0]
}

function Write-Utf8File([string]$Path, [string]$Content) {
    [System.IO.File]::WriteAllText($Path, $Content, (New-Object System.Text.UTF8Encoding $false))
}
