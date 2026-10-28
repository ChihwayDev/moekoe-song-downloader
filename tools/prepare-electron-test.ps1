param(
    [Parameter(Mandatory = $true)]
    [string]$InstalledDirectory
)
$ErrorActionPreference = 'Stop'
$projectRoot = Split-Path -Parent $PSScriptRoot
$verificationRoot = Join-Path $projectRoot '.verification'
$runtimeRoot = Join-Path $verificationRoot 'runtime'
New-Item -ItemType Directory -Path $runtimeRoot -Force | Out-Null
New-Item -ItemType Directory -Path (Join-Path $runtimeRoot 'locales') -Force | Out-Null
$appRoot = Join-Path $runtimeRoot 'resources\app'
New-Item -ItemType Directory -Path $appRoot -Force | Out-Null
$extensions = @('.dll', '.pak', '.bin', '.dat', '.json')
Get-ChildItem -LiteralPath $InstalledDirectory -File | Where-Object {
    $_.Name -eq 'MoeKoe Music.exe' -or $extensions -contains $_.Extension
} | ForEach-Object {
    Copy-Item -LiteralPath $_.FullName -Destination (Join-Path $runtimeRoot $_.Name) -Force
}
Copy-Item -LiteralPath (Join-Path $InstalledDirectory 'locales\en-US.pak') -Destination (Join-Path $runtimeRoot 'locales\en-US.pak') -Force
Copy-Item -LiteralPath (Join-Path $projectRoot 'tests\electron-v2.cjs') -Destination (Join-Path $appRoot 'main.cjs') -Force
@{ archive = (Join-Path $InstalledDirectory 'resources\app.asar') } | ConvertTo-Json | Set-Content -LiteralPath (Join-Path $appRoot 'source.json') -Encoding UTF8
$pluginManifest = Get-Content -LiteralPath (Join-Path $projectRoot 'moekoe-song-downloader\manifest.json') -Raw -Encoding UTF8 | ConvertFrom-Json
@{ name = 'moekoe-downloader-verification'; version = $pluginManifest.version; main = 'main.cjs' } | ConvertTo-Json | Set-Content -LiteralPath (Join-Path $appRoot 'package.json') -Encoding UTF8
Write-Output (Join-Path $runtimeRoot 'MoeKoe Music.exe')
