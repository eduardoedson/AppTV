# Starts the Android TV emulator without opening Android Studio
# Usage: .\abrir-emulador.ps1               (picks the TV emulator automatically)
#        .\abrir-emulador.ps1 -AvdName X    (starts a specific emulator)
#        .\abrir-emulador.ps1 -QuickBoot    (resumes from the saved snapshot; cold boot is the default because it avoids black screens)
#        .\abrir-emulador.ps1 -SoftwareGpu  (renders without the graphics card, fixes black screens caused by GPU drivers)
param(
    [string]$AvdName = '',
    [switch]$QuickBoot,
    [switch]$SoftwareGpu
)
$ErrorActionPreference = 'Continue'

function Find-Sdk {
    $candidates = @($env:ANDROID_HOME, $env:ANDROID_SDK_ROOT, (Join-Path $env:LOCALAPPDATA 'Android\Sdk')) | Where-Object { $_ }
    foreach ($candidate in $candidates) {
        if (Test-Path (Join-Path $candidate 'emulator\emulator.exe')) { return $candidate }
    }
    return $null
}

function Get-AvdHome {
    if ($env:ANDROID_AVD_HOME) { return $env:ANDROID_AVD_HOME }
    if ($env:ANDROID_USER_HOME) { return Join-Path $env:ANDROID_USER_HOME 'avd' }
    return Join-Path $HOME '.android\avd'
}

# An AVD is a TV device when its system image tag is android-tv or google-tv
function Test-TvAvd([string]$name, [string]$avdHome) {
    $avdDir = Join-Path $avdHome "$name.avd"
    $iniFile = Join-Path $avdHome "$name.ini"
    if (Test-Path $iniFile) {
        $pathLine = Get-Content $iniFile | Where-Object { $_ -like 'path=*' } | Select-Object -First 1
        if ($pathLine) { $avdDir = $pathLine.Substring(5).Trim() }
    }
    $config = Join-Path $avdDir 'config.ini'
    if (-not (Test-Path $config)) { return $false }
    return [bool](Get-Content $config | Select-String -Pattern '^tag\.id\s*=.*tv')
}

$sdk = Find-Sdk
if (-not $sdk) {
    Write-Host 'Android SDK not found. Install the Emulator package in Android Studio (SDK Manager > SDK Tools).' -ForegroundColor Red
    exit 1
}
$emulator = Join-Path $sdk 'emulator\emulator.exe'
$adb = Join-Path $sdk 'platform-tools\adb.exe'
$hasAdb = Test-Path $adb

# Close any running emulator before starting a fresh one
function Stop-RunningEmulators {
    if ($hasAdb) {
        & $adb start-server *> $null
        $serials = @(& $adb devices | Select-String -Pattern '^(emulator-\d+)\s' | ForEach-Object { $_.Matches[0].Groups[1].Value })
        foreach ($serial in $serials) {
            Write-Host "Closing $serial..."
            & $adb -s $serial emu kill *> $null
        }
        # Wait up to 20 seconds for a clean shutdown
        $deadline = (Get-Date).AddSeconds(20)
        while ((Get-Date) -lt $deadline) {
            $stillRunning = & $adb devices | Select-String -Pattern '^emulator-\d+\s'
            if (-not $stillRunning) { break }
            Start-Sleep -Seconds 1
        }
    }
    # Force close leftover or frozen emulator processes
    $processes = Get-Process -Name 'emulator', 'qemu-system-*' -ErrorAction SilentlyContinue
    if ($processes) {
        Write-Host 'Forcing leftover emulator processes to close...'
        $processes | Stop-Process -Force -ErrorAction SilentlyContinue
        Start-Sleep -Seconds 2
    }
    if ($hasAdb) { & $adb kill-server *> $null }
}

Stop-RunningEmulators

# AVD names only contain letters, numbers, dots, dashes and underscores; other lines are emulator logs
$avds = @(& $emulator -list-avds 2>$null | Where-Object { $_ -match '^[\w.\-]+$' })
if ($avds.Count -eq 0) {
    Write-Host 'No emulator found. Create one in Android Studio: Virtual Device Manager > Create Virtual Device > TV.' -ForegroundColor Red
    exit 1
}

if ($AvdName) {
    if ($avds -notcontains $AvdName) {
        Write-Host "Emulator '$AvdName' not found. Available: $($avds -join ', ')" -ForegroundColor Red
        exit 1
    }
    $selected = $AvdName
} else {
    $avdHome = Get-AvdHome
    $tvAvds = @($avds | Where-Object { Test-TvAvd $_ $avdHome })
    # @() keeps a single result as an array, otherwise [0] would return its first character
    $options = @(if ($tvAvds.Count -gt 0) { $tvAvds } else { $avds })
    if ($tvAvds.Count -eq 0) { Write-Host 'No TV emulator found, showing all emulators.' -ForegroundColor Yellow }

    if ($options.Count -eq 1) {
        $selected = $options[0]
    } else {
        Write-Host 'Choose the emulator:'
        for ($i = 0; $i -lt $options.Count; $i++) { Write-Host "  [$($i + 1)] $($options[$i])" }
        do {
            $choice = Read-Host 'Number'
            $number = 0
            $valid = [int]::TryParse($choice, [ref]$number) -and $number -ge 1 -and $number -le $options.Count
        } until ($valid)
        $selected = $options[$number - 1]
    }
}

Write-Host "Starting $selected..."
# Emulator output goes to log files so startup errors can be shown if it closes
$logFile = Join-Path $env:TEMP 'apptv-emulator.log'
$errorLogFile = Join-Path $env:TEMP 'apptv-emulator-error.log'
$emulatorArguments = @('-avd', $selected, '-netdelay', 'none', '-netspeed', 'full')
# Cold boot by default: a snapshot saved before a forced close can leave the screen black
if (-not $QuickBoot) { $emulatorArguments += '-no-snapshot-load' }
if ($SoftwareGpu) { $emulatorArguments += @('-gpu', 'swiftshader_indirect') }
Write-Host "Arguments: $($emulatorArguments -join ' ')"
$emulatorProcess = Start-Process -FilePath $emulator `
    -ArgumentList $emulatorArguments `
    -RedirectStandardOutput $logFile -RedirectStandardError $errorLogFile `
    -PassThru

function Show-EmulatorLog {
    Write-Host 'The emulator closed during startup. Last log lines:' -ForegroundColor Red
    foreach ($file in @($logFile, $errorLogFile)) {
        if (Test-Path $file) { Get-Content $file -Tail 25 | ForEach-Object { Write-Host "  $_" } }
    }
    Write-Host "Full logs: $logFile and $errorLogFile"
}

if (-not $hasAdb) {
    Start-Sleep -Seconds 10
    if ($emulatorProcess.HasExited) { Show-EmulatorLog; exit 1 }
    Write-Host 'Emulator started. Install Platform-Tools to let this script wait for the boot.' -ForegroundColor Yellow
    exit 0
}

# Wait until Android finishes booting so "npm run android" can install right away.
# Polling instead of "adb wait-for-device" avoids hanging forever when the emulator crashes.
Write-Host 'Waiting for Android to boot...'
& $adb start-server *> $null
$deadline = (Get-Date).AddMinutes(5)
$booted = $false
while (-not $booted -and (Get-Date) -lt $deadline) {
    Start-Sleep -Seconds 3
    if ($emulatorProcess.HasExited) {
        Show-EmulatorLog
        exit 1
    }
    $serial = & $adb devices | Select-String -Pattern '^(emulator-\d+)\s+device' | ForEach-Object { $_.Matches[0].Groups[1].Value } | Select-Object -First 1
    if (-not $serial) { continue }
    $state = "$(& $adb -s $serial shell getprop sys.boot_completed 2>$null)".Trim()
    $booted = $state -eq '1'
}

if ($booted) {
    Write-Host 'Emulator ready. In the project folder run: npm start (terminal 1) and npm run android (terminal 2).' -ForegroundColor Green
} else {
    Write-Host "The emulator did not finish booting in 5 minutes. Check the logs: $logFile" -ForegroundColor Yellow
    exit 1
}
