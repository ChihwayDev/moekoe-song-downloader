param([string]$FFmpegPath = 'ffmpeg')
$ErrorActionPreference = 'Stop'
$projectRoot = Split-Path -Parent $PSScriptRoot
$fixtureDirectory = Join-Path $projectRoot '.verification\audio-fixtures'
New-Item -ItemType Directory -Path $fixtureDirectory -Force | Out-Null
$ffmpegExecutable = (Get-Command $FFmpegPath -ErrorAction Stop).Source
function Invoke-FixtureEncoding {
    param([string[]]$EncodingArguments)
    & $ffmpegExecutable -hide_banner -loglevel error @EncodingArguments
    if ($LASTEXITCODE -ne 0) { throw 'Could not generate an audio test fixture.' }
}
$wavePath = Join-Path $fixtureDirectory 'tone.wav'
Invoke-FixtureEncoding -EncodingArguments @('-f', 'lavfi', '-i', 'sine=frequency=440:sample_rate=44100:duration=0.8', '-c:a', 'pcm_s16le', '-y', $wavePath)
Invoke-FixtureEncoding -EncodingArguments @('-i', $wavePath, '-c:a', 'libmp3lame', '-b:a', '128k', '-y', (Join-Path $fixtureDirectory '128.mp3'))
Invoke-FixtureEncoding -EncodingArguments @('-i', $wavePath, '-c:a', 'libmp3lame', '-b:a', '320k', '-y', (Join-Path $fixtureDirectory '320.mp3'))
Invoke-FixtureEncoding -EncodingArguments @('-i', $wavePath, '-c:a', 'flac', '-y', (Join-Path $fixtureDirectory 'flac.flac'))
Invoke-FixtureEncoding -EncodingArguments @('-i', $wavePath, '-ar', '96000', '-sample_fmt', 's32', '-c:a', 'flac', '-y', (Join-Path $fixtureDirectory 'high.flac'))
Get-ChildItem -LiteralPath $fixtureDirectory -File | Select-Object Name, Length
