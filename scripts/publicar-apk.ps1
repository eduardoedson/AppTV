# Builds a new AppTV release and publishes it on Google Drive for the in-app updater.
#  1. Increases versionCode (and versionName) in android/app/build.gradle
#  2. Makes sure AppTV.update.json exists on Drive and its link is in .env (UPDATE_MANIFEST_URL)
#  3. Builds the release APK (gradlew assembleRelease)
#  4. Uploads AppTV.apk and AppTV.update.json to the root of your Drive (same files, same links)
# Usage: .\publicar-apk.ps1 [-Notes "What changed"] [-VersionName 1.2]
param(
    [string]$Notes = '',
    [string]$VersionName = ''
)
$ErrorActionPreference = 'Continue'
. (Join-Path $PSScriptRoot 'rclone-common.ps1')

$remoteName = 'gdrive'
$remoteApk = 'AppTV.apk'
$remoteManifest = 'AppTV.update.json'
$projectRoot = Split-Path $PSScriptRoot -Parent
$gradleFile = Join-Path $projectRoot 'android\app\build.gradle'
$envFile = Join-Path $projectRoot '.env'
$apkPath = Join-Path $projectRoot 'android\app\build\outputs\apk\release\app-release.apk'
$localManifest = Join-Path $projectRoot 'AppTV.update.json'

function Set-EnvValue([string]$Key, [string]$Value) {
    $text = if (Test-Path $envFile) { [System.IO.File]::ReadAllText($envFile) } else { '' }
    $line = "$Key=$Value"
    $pattern = "(?m)^$Key=.*$"
    if ([regex]::IsMatch($text, $pattern)) {
        $text = [regex]::Replace($text, $pattern, { param($m) $line })
    } else {
        $text = $text.TrimEnd() + "`n$line`n"
    }
    Write-Utf8File $envFile $text
}

function Get-DriveLink([string]$FileId) { return "https://drive.google.com/file/d/$FileId/view" }

# 1. Google Drive access
$rclone = Initialize-Rclone $remoteName

# 2. Version bump
$originalGradle = [System.IO.File]::ReadAllText($gradleFile)
$codeMatch = [regex]::Match($originalGradle, 'versionCode\s+(\d+)')
$nameMatch = [regex]::Match($originalGradle, 'versionName\s+"([^"]+)"')
if (-not $codeMatch.Success -or -not $nameMatch.Success) {
    Write-Host "versionCode/versionName not found in $gradleFile" -ForegroundColor Red
    exit 1
}
$oldCode = [int]$codeMatch.Groups[1].Value
$oldName = $nameMatch.Groups[1].Value
$newCode = $oldCode + 1
if (-not $VersionName) {
    # Increase the last number: 1.0 -> 1.1, 1.2.9 -> 1.2.10
    $parts = $oldName.Split('.')
    $last = 0
    if ([int]::TryParse($parts[-1], [ref]$last)) { $parts[-1] = [string]($last + 1) } else { $parts += '1' }
    $VersionName = $parts -join '.'
}
$updatedGradle = [regex]::Replace($originalGradle, 'versionCode\s+\d+', "versionCode $newCode", 1)
$updatedGradle = [regex]::Replace($updatedGradle, 'versionName\s+"[^"]+"', "versionName `"$VersionName`"", 1)
Write-Utf8File $gradleFile $updatedGradle
Write-Host "Version: $oldName ($oldCode) -> $VersionName ($newCode)"

function Restore-Version {
    Write-Utf8File $gradleFile $originalGradle
    Write-Host "Version restored to $oldName ($oldCode)." -ForegroundColor Yellow
}

# 3. The manifest link must be inside the APK, so it is created on Drive before the build
$manifestId = Get-RemoteFileId $rclone $remoteName $remoteManifest
if (-not $manifestId) {
    Write-Host "Creating $remoteManifest on Google Drive..."
    $placeholder = [ordered]@{ versionCode = $oldCode; versionName = $oldName; apkUrl = ''; notes = ''; publishedAt = '' }
    Write-Utf8File $localManifest ($placeholder | ConvertTo-Json)
    & $rclone copyto $localManifest "${remoteName}:$remoteManifest"
    $manifestId = Get-RemoteFileId $rclone $remoteName $remoteManifest
    if (-not $manifestId) {
        Write-Host "Could not create $remoteManifest on Google Drive." -ForegroundColor Red
        Restore-Version
        exit 1
    }
}
Set-EnvValue 'UPDATE_MANIFEST_URL' (Get-DriveLink $manifestId)

# 4. Build. Metro caches the values read from .env, so the cache is cleared first
Get-ChildItem $env:TEMP -Directory -ErrorAction SilentlyContinue |
    Where-Object { $_.Name -like 'metro-*' -or $_.Name -like 'haste-map-*' } |
    Remove-Item -Recurse -Force -ErrorAction SilentlyContinue
Write-Host 'Building the release APK (this takes a few minutes)...'
Push-Location (Join-Path $projectRoot 'android')
& .\gradlew.bat assembleRelease
$buildOk = $LASTEXITCODE -eq 0
Pop-Location
if (-not $buildOk -or -not (Test-Path $apkPath)) {
    Write-Host 'Build failed. Nothing was published.' -ForegroundColor Red
    Restore-Version
    exit 1
}

# 5. Upload the APK, replacing the previous one (keeps the same Drive file and link)
Write-Host 'Uploading AppTV.apk...'
& $rclone copyto $apkPath "${remoteName}:$remoteApk" --checksum
$apkId = Get-RemoteFileId $rclone $remoteName $remoteApk
if ($LASTEXITCODE -ne 0 -or -not $apkId) {
    Write-Host 'APK upload failed. The version in build.gradle was kept; run the script again to retry.' -ForegroundColor Red
    exit 1
}

# 6. Publish the manifest last, so devices only see the update after the APK is in place
$manifest = [ordered]@{
    versionCode = $newCode
    versionName = $VersionName
    apkUrl = Get-DriveLink $apkId
    notes = $Notes
    publishedAt = (Get-Date).ToUniversalTime().ToString('o')
}
Write-Utf8File $localManifest ($manifest | ConvertTo-Json)
& $rclone copyto $localManifest "${remoteName}:$remoteManifest"
if ($LASTEXITCODE -ne 0) {
    Write-Host 'Manifest upload failed. Run the script again to retry.' -ForegroundColor Red
    exit 1
}

Write-Host ''
Write-Host "Published AppTV $VersionName ($newCode)." -ForegroundColor Green
Write-Host 'On the TV, open the version button in the library header to install it.'
