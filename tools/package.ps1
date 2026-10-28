$ErrorActionPreference = 'Stop'
$projectRoot = Split-Path -Parent $PSScriptRoot
$pluginDir = Join-Path $projectRoot 'moekoe-song-downloader'
$manifestPath = Join-Path $pluginDir 'manifest.json'
$manifest = Get-Content -LiteralPath $manifestPath -Raw -Encoding UTF8 | ConvertFrom-Json
if ($manifest.manifest_version -ne 3 -or $manifest.plugin_id -ne 'moekoe-song-downloader') {
    throw 'Invalid plugin manifest.'
}
$required = @('core.js', 'data.js', 'view.js', 'content.js', 'content.css', 'popup.html', 'popup.js', 'page-bridge.js', 'bridge.html', 'bridge.js', 'host/moekoe-song-saver.exe', 'host/SongSaver.cs', 'README.md')
$licensePath = Join-Path $projectRoot 'LICENSE'
if (Test-Path -LiteralPath $licensePath -PathType Leaf) {
    Copy-Item -LiteralPath $licensePath -Destination (Join-Path $pluginDir 'LICENSE') -Force
    $required += 'LICENSE'
}
foreach ($file in $required) {
    if (-not (Test-Path -LiteralPath (Join-Path $pluginDir $file) -PathType Leaf)) {
        throw "Missing plugin file: $file"
    }
}
$outputDir = Join-Path $projectRoot 'dist'
New-Item -ItemType Directory -Path $outputDir -Force | Out-Null
$archive = Join-Path $outputDir "moekoe-song-downloader-v$($manifest.version).zip"
Compress-Archive -LiteralPath $pluginDir -DestinationPath $archive -Force
Add-Type -AssemblyName System.IO.Compression.FileSystem
$zip = [System.IO.Compression.ZipFile]::OpenRead($archive)
try {
    $entries = @($zip.Entries | Where-Object { $_.Name -ne '' } | ForEach-Object { $_.FullName.Replace('\', '/') })
    foreach ($file in @('manifest.json') + $required) {
        if ($entries -notcontains "moekoe-song-downloader/$file") { throw "Missing ZIP entry: $file" }
    }
    if ($entries.Count -ne ($required.Count + 1)) { throw 'The plugin ZIP contains unexpected files.' }
    $entry = $zip.Entries | Where-Object { $_.FullName.Replace('\', '/') -eq 'moekoe-song-downloader/manifest.json' }
    $reader = New-Object System.IO.StreamReader($entry.Open())
    try { $packed = $reader.ReadToEnd() | ConvertFrom-Json } finally { $reader.Dispose() }
    if ($packed.version -ne $manifest.version) { throw 'Packaged version does not match source.' }
} finally { $zip.Dispose() }
$archiveFile = Get-Item -LiteralPath $archive
$archiveHash = (Get-FileHash -LiteralPath $archive -Algorithm SHA256).Hash
"$($archiveHash.ToLowerInvariant())  $($archiveFile.Name)" | Set-Content -LiteralPath "$archive.sha256" -Encoding ASCII
Write-Output "Package: $($archiveFile.FullName)"
Write-Output "Bytes: $($archiveFile.Length)"
Write-Output "SHA256: $archiveHash"
