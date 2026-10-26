# Uploads AppTV.catalago.json from the project root to Google Drive, replacing the existing file.
# The Drive file keeps the same ID, so the link configured in the app does not change.
# Uses rclone (installed with winget if missing). The first run opens the browser to sign in to Google.
param([switch]$Force)
$ErrorActionPreference = 'Continue'

$remoteName = 'gdrive'
$remoteFile = 'AppTV.catalago.json'
$projectRoot = Split-Path $PSScriptRoot -Parent

# The Drive file used by the app comes from DEFAULT_CATALOG_URL in .env, so no ID is hardcoded here
$envFile = Join-Path $projectRoot '.env'
$catalogUrl = ''
if (Test-Path $envFile) {
    $line = Get-Content $envFile | Where-Object { $_ -match '^\s*DEFAULT_CATALOG_URL\s*=' } | Select-Object -First 1
    if ($line) { $catalogUrl = ($line -split '=', 2)[1].Trim() }
}
$idMatch = [regex]::Match($catalogUrl, '(?:/file/d/|[?&]id=)([A-Za-z0-9_-]+)')
$expectedFileId = if ($idMatch.Success) { $idMatch.Groups[1].Value } else { '' }
if (-not $expectedFileId) {
    Write-Host 'DEFAULT_CATALOG_URL in .env must point to the catalog file on Google Drive.' -ForegroundColor Red
    exit 1
}
$localFile = Join-Path $projectRoot 'AppTV.catalago.json'

function Find-Rclone {
    $command = Get-Command rclone.exe -ErrorAction SilentlyContinue
    if ($command) { return $command.Source }
    # winget installs portable packages here and may not refresh PATH for the current session
    $wingetLinks = Join-Path $env:LOCALAPPDATA 'Microsoft\WinGet\Links\rclone.exe'
    if (Test-Path $wingetLinks) { return $wingetLinks }
    $packages = Join-Path $env:LOCALAPPDATA 'Microsoft\WinGet\Packages'
    if (Test-Path $packages) {
        $found = Get-ChildItem $packages -Recurse -Filter 'rclone.exe' -ErrorAction SilentlyContinue | Select-Object -First 1
        if ($found) { return $found.FullName }
    }
    return $null
}

function Get-RemoteFileId([string]$rclone) {
    $json = & $rclone lsjson "${remoteName}:" --files-only --include "/$remoteFile" 2>$null
    if ($LASTEXITCODE -ne 0 -or -not $json) { return $null }
    $entries = @($json | Out-String | ConvertFrom-Json)
    if ($entries.Count -eq 0) { return $null }
    return $entries[0].ID
}

# 1. Validate the local catalog before sending it
if (-not (Test-Path $localFile)) {
    Write-Host "Catalog not found: $localFile" -ForegroundColor Red
    exit 1
}
try {
    $catalog = Get-Content $localFile -Raw -Encoding UTF8 | ConvertFrom-Json
} catch {
    Write-Host "Invalid JSON in $localFile" -ForegroundColor Red
    Write-Host $_.Exception.Message
    exit 1
}
if ($catalog.version -ne 1 -or -not $catalog.items) {
    Write-Host 'The catalog must have "version": 1 and an "items" list.' -ForegroundColor Red
    exit 1
}
Write-Host "Local catalog OK: $(@($catalog.items).Count) item(s)."

# 2. Make sure rclone is installed
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

# 3. Configure Google Drive access on the first run (opens the browser)
$remotes = & $rclone listremotes
if ($remotes -notcontains "${remoteName}:") {
    Write-Host 'First run: a browser window will open to sign in to Google Drive.'
    & $rclone config create $remoteName drive scope=drive
    if ($LASTEXITCODE -ne 0) {
        Write-Host 'Google Drive configuration failed.' -ForegroundColor Red
        exit 1
    }
}

# 4. Confirm the remote file is the one used by the app, so the link keeps working
$currentId = Get-RemoteFileId $rclone
if ($currentId -and $currentId -ne $expectedFileId -and -not $Force) {
    Write-Host "The Drive file '$remoteFile' has ID $currentId, but the app uses $expectedFileId." -ForegroundColor Red
    Write-Host 'Nothing was uploaded. Use -Force to upload anyway (then update src/config.ts with the new link).'
    exit 1
}
if (-not $currentId) {
    Write-Host "'$remoteFile' was not found in the root of your Drive. It will be created with a NEW link." -ForegroundColor Yellow
    if (-not $Force) {
        Write-Host 'Nothing was uploaded. Move the file back to the Drive root or use -Force.'
        exit 1
    }
}

# 5. Upload, replacing the content of the existing file
Write-Host 'Uploading...'
& $rclone copyto $localFile "${remoteName}:$remoteFile" --checksum
if ($LASTEXITCODE -ne 0) {
    Write-Host 'Upload failed.' -ForegroundColor Red
    exit 1
}

$finalId = Get-RemoteFileId $rclone
if ($finalId -eq $expectedFileId) {
    Write-Host 'Catalog updated on Google Drive. The app link stays the same.' -ForegroundColor Green
} else {
    Write-Host "Uploaded, but the file ID is now $finalId. Update DEFAULT_CATALOG_URL in src/config.ts." -ForegroundColor Yellow
}
