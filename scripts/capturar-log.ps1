# Captures Android TV logs while reproducing a problem with AppTV.
# Usage: .\scripts\capturar-log.ps1 [-TvIp 192.168.1.50]
param([string]$TvIp = '')

$ErrorActionPreference = 'Stop'
$Package = 'com.apptvclient'

function Find-Adb {
    $command = Get-Command adb.exe -ErrorAction SilentlyContinue
    if ($command) { return $command.Source }
    $sdkAdb = Join-Path $env:LOCALAPPDATA 'Android\Sdk\platform-tools\adb.exe'
    if (Test-Path $sdkAdb) { return $sdkAdb }
    return $null
}

$adb = Find-Adb
if (-not $adb) {
    Write-Host 'adb not found. Install Android SDK Platform Tools or add platform-tools to PATH.' -ForegroundColor Red
    exit 1
}

# Connect over the network when no device is attached yet
$devices = & $adb devices | Select-String -Pattern "`tdevice$"
if (-not $devices) {
    if (-not $TvIp) { $TvIp = Read-Host 'IP da TV (ex.: 192.168.1.50)' }
    if ($TvIp -notmatch ':') { $TvIp = "${TvIp}:5555" }
    & $adb connect $TvIp | Out-Host
    Start-Sleep -Seconds 2
    $devices = & $adb devices | Select-String -Pattern "`tdevice$"
    if (-not $devices) {
        Write-Host 'Nao foi possivel conectar. Ative a depuracao USB/rede nas Opcoes do desenvolvedor da TV e aceite o pedido na tela.' -ForegroundColor Red
        exit 1
    }
}

$root = Split-Path -Parent $PSScriptRoot
$logDir = Join-Path $root 'logs'
New-Item -ItemType Directory -Force -Path $logDir | Out-Null
$stamp = Get-Date -Format 'yyyyMMdd-HHmmss'
$logFile = Join-Path $logDir "tv-$stamp.log"
$infoFile = Join-Path $logDir "tv-$stamp-info.txt"

# Start from a clean log and stream everything to a file while the problem is reproduced
& $adb logcat -c 2>$null
$logcat = Start-Process -FilePath $adb -ArgumentList @('logcat', '-v', 'threadtime', '-b', 'main,system,crash,events') `
    -RedirectStandardOutput $logFile -RedirectStandardError (Join-Path $logDir "tv-$stamp-err.txt") `
    -NoNewWindow -PassThru

Write-Host ''
Write-Host 'Gravando o log da TV.' -ForegroundColor Green
Write-Host 'Agora abra e feche o AppTV na TV ate ele nao abrir mais (como voce costuma usar).'
Write-Host 'Quando o app travar, NAO reinicie a TV. Volte aqui e aperte Enter.'
Read-Host | Out-Null

Start-Sleep -Seconds 2
Stop-Process -Id $logcat.Id -Force -ErrorAction SilentlyContinue

# Snapshot of the app process and system state at the moment of the failure
$sections = [ordered]@{
    'pidof'           = @('shell', 'pidof', $Package)
    'exit-info'       = @('shell', 'dumpsys', 'activity', 'exit-info', $Package)
    'activities'      = @('shell', 'dumpsys', 'activity', 'activities')
    'processes'       = @('shell', 'dumpsys', 'activity', 'processes', $Package)
    'meminfo-app'     = @('shell', 'dumpsys', 'meminfo', $Package)
    'meminfo-system'  = @('shell', 'cat', '/proc/meminfo')
    'media-codecs'    = @('shell', 'dumpsys', 'media.player')
    'media-resources' = @('shell', 'dumpsys', 'media.resource_manager')
    'anr-traces'      = @('shell', 'ls', '-l', '/data/anr')
    'device'          = @('shell', 'getprop', 'ro.product.model')
    'android-version' = @('shell', 'getprop', 'ro.build.version.release')
}
foreach ($name in $sections.Keys) {
    Add-Content -Path $infoFile -Value "===== $name ====="
    $output = & $adb @($sections[$name]) 2>&1 | Out-String
    Add-Content -Path $infoFile -Value $output
}

Write-Host ''
Write-Host "Log salvo em: $logFile" -ForegroundColor Green
Write-Host "Estado da TV salvo em: $infoFile" -ForegroundColor Green
