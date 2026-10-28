$ErrorActionPreference = 'Stop'
$projectRoot = Split-Path -Parent $PSScriptRoot
$compiler = Join-Path $env:WINDIR 'Microsoft.NET\Framework64\v4.0.30319\csc.exe'
if (-not (Test-Path -LiteralPath $compiler)) {
    $compiler = Join-Path $env:WINDIR 'Microsoft.NET\Framework\v4.0.30319\csc.exe'
}
if (-not (Test-Path -LiteralPath $compiler)) { throw '.NET Framework C# compiler was not found.' }
$hostDirectory = Join-Path $projectRoot 'moekoe-song-downloader\host'
New-Item -ItemType Directory -Path $hostDirectory -Force | Out-Null
$executable = Join-Path $hostDirectory 'moekoe-song-saver.exe'
& $compiler /nologo /target:winexe /optimize+ /platform:anycpu /reference:System.Web.Extensions.dll "/out:$executable" (Join-Path $projectRoot 'native\SongSaver.cs')
if ($LASTEXITCODE -ne 0) { throw 'Native saver compilation failed.' }
Copy-Item -LiteralPath (Join-Path $projectRoot 'native\SongSaver.cs') -Destination (Join-Path $hostDirectory 'SongSaver.cs') -Force
Get-Item -LiteralPath $executable | Select-Object FullName, Length
