param(
    [string]$Root = 'C:\Users\edu\Downloads\series'
)

$ErrorActionPreference = 'Stop'
$projectRoot = Split-Path $PSScriptRoot -Parent
$logPath = Join-Path $projectRoot 'series-conversion.log'
$reportPath = Join-Path $projectRoot 'series-conversion-report.json'
$supportedInputExtensions = @('.avi', '.wmv', '.rm', '.rmvb')

function Find-FFmpegBinary([string]$name) {
    $command = Get-Command "$name.exe" -ErrorAction SilentlyContinue
    if ($command) { return $command.Source }
    $packages = Join-Path $env:LOCALAPPDATA 'Microsoft\WinGet\Packages'
    $found = Get-ChildItem -LiteralPath $packages -Recurse -Filter "$name.exe" -ErrorAction SilentlyContinue |
        Select-Object -First 1
    if ($found) { return $found.FullName }
    throw "$name.exe não encontrado."
}

function Write-Log([string]$message) {
    $line = "$(Get-Date -Format 'yyyy-MM-dd HH:mm:ss') $message"
    Add-Content -LiteralPath $logPath -Value $line -Encoding UTF8
    Write-Host $line
}

function Normalize-BaseName([string]$name) {
    $normalized = [regex]::Replace($name, '\s+', ' ').Trim().TrimEnd('.')
    return $normalized
}

function Read-MediaInfo([string]$ffprobe, [string]$file) {
    $json = & $ffprobe -v error -show_entries 'format=duration:stream=codec_type,codec_name' -of json -- $file 2>$null
    if ($LASTEXITCODE -ne 0 -or -not $json) { return $null }
    return ($json | ConvertFrom-Json)
}

if (-not (Test-Path -LiteralPath $Root -PathType Container)) {
    throw "Pasta não encontrada: $Root"
}

$ffmpeg = Find-FFmpegBinary 'ffmpeg'
$ffprobe = Find-FFmpegBinary 'ffprobe'
$files = @(Get-ChildItem -LiteralPath $Root -File -Recurse |
    Where-Object { $supportedInputExtensions -contains $_.Extension.ToLowerInvariant() } |
    Sort-Object @{ Expression = {
        switch ($_.Extension.ToLowerInvariant()) {
            '.avi' { 0 }
            '.wmv' { 1 }
            '.rm' { 2 }
            default { 3 }
        }
    }}, FullName)

$results = [System.Collections.Generic.List[object]]::new()
$converted = 0
$failed = 0
$skipped = 0
$reclaimedBytes = [int64]0

Write-Log "Início: $($files.Count) arquivo(s) para converter em $Root"

foreach ($file in $files) {
    $baseName = Normalize-BaseName $file.BaseName
    $target = Join-Path $file.DirectoryName "$baseName.mp4"
    $temporary = Join-Path $file.DirectoryName "$baseName.apptv-converting.mp4"
    $startedAt = Get-Date

    if (Test-Path -LiteralPath $target) {
        $skipped += 1
        $results.Add([pscustomobject]@{
            source = $file.FullName
            target = $target
            status = 'collision'
            message = 'Já existe um MP4 com o nome de destino; original preservado.'
        })
        Write-Log "COLISÃO [$($converted + $failed + $skipped)/$($files.Count)] $($file.FullName)"
        continue
    }

    if (Test-Path -LiteralPath $temporary) {
        Remove-Item -LiteralPath $temporary -Force
    }

    try {
        $sourceInfo = Read-MediaInfo $ffprobe $file.FullName
        if (-not $sourceInfo) { throw 'Não foi possível ler os metadados do original.' }
        $sourceDuration = [double]$sourceInfo.format.duration
        if ($sourceDuration -le 0) { throw 'Duração original inválida.' }

        & $ffmpeg -y -hide_banner -loglevel warning -i $file.FullName `
            -map '0:v:0' -map '0:a:0?' -sn -dn `
            -c:v h264_nvenc -preset p6 -tune hq -rc vbr -cq 26 -b:v 0 `
            -profile:v high -pix_fmt yuv420p `
            -c:a aac -b:a 128k -ac 2 `
            -movflags +faststart $temporary
        if ($LASTEXITCODE -ne 0) { throw "FFmpeg terminou com código $LASTEXITCODE." }

        $outputInfo = Read-MediaInfo $ffprobe $temporary
        if (-not $outputInfo) { throw 'Não foi possível validar o MP4 gerado.' }
        $outputDuration = [double]$outputInfo.format.duration
        $videoCodec = @($outputInfo.streams | Where-Object codec_type -eq 'video')[0].codec_name
        $audioStreams = @($outputInfo.streams | Where-Object codec_type -eq 'audio')
        if ($videoCodec -ne 'h264') { throw "Codec de vídeo inesperado: $videoCodec" }
        if ($audioStreams.Count -gt 0 -and $audioStreams[0].codec_name -ne 'aac') {
            throw "Codec de áudio inesperado: $($audioStreams[0].codec_name)"
        }
        if ($outputDuration -lt ($sourceDuration - 3)) {
            throw "Saída incompleta: original $sourceDuration s, saída $outputDuration s."
        }
        $outputFile = Get-Item -LiteralPath $temporary
        if ($outputFile.Length -lt 1MB) { throw 'MP4 gerado é pequeno demais.' }

        Move-Item -LiteralPath $temporary -Destination $target
        Remove-Item -LiteralPath $file.FullName -Force
        $converted += 1
        $reclaimedBytes += ($file.Length - $outputFile.Length)
        $results.Add([pscustomobject]@{
            source = $file.FullName
            target = $target
            status = 'converted'
            sourceBytes = $file.Length
            outputBytes = $outputFile.Length
            durationSeconds = [math]::Ceiling($outputDuration)
            elapsedSeconds = [math]::Round(((Get-Date) - $startedAt).TotalSeconds, 1)
        })
        Write-Log "OK [$($converted + $failed + $skipped)/$($files.Count)] $($file.Name) -> $([IO.Path]::GetFileName($target))"
    } catch {
        if (Test-Path -LiteralPath $temporary) {
            Remove-Item -LiteralPath $temporary -Force
        }
        $failed += 1
        $results.Add([pscustomobject]@{
            source = $file.FullName
            target = $target
            status = 'failed'
            message = $_.Exception.Message
        })
        Write-Log "FALHA [$($converted + $failed + $skipped)/$($files.Count)] $($file.FullName): $($_.Exception.Message)"
    }

    if (($converted + $failed + $skipped) % 10 -eq 0) {
        $results | ConvertTo-Json -Depth 4 | Set-Content -LiteralPath $reportPath -Encoding UTF8
    }
}

$results | ConvertTo-Json -Depth 4 | Set-Content -LiteralPath $reportPath -Encoding UTF8
Write-Log "Fim: convertidos=$converted falhas=$failed colisões=$skipped saldoBytes=$reclaimedBytes"
if ($failed -gt 0 -or $skipped -gt 0) { exit 2 }
