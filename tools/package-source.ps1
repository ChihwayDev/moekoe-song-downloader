$ErrorActionPreference = 'Stop'
$projectRoot = [System.IO.Path]::GetFullPath((Split-Path -Parent $PSScriptRoot))
$manifest = Get-Content -LiteralPath (Join-Path $projectRoot 'moekoe-song-downloader\manifest.json') -Raw -Encoding UTF8 | ConvertFrom-Json
$files = @()
foreach ($name in @('README.md', 'package.json', 'CHANGELOG.md', 'PRIVACY.md', '.gitignore', '.gitattributes')) {
    $files += Get-Item -LiteralPath (Join-Path $projectRoot $name)
}
if (Test-Path -LiteralPath (Join-Path $projectRoot 'LICENSE') -PathType Leaf) {
    $files += Get-Item -LiteralPath (Join-Path $projectRoot 'LICENSE')
} else {
    Write-Warning 'No LICENSE has been selected. Confirm the license before publishing.'
}
foreach ($directory in @('moekoe-song-downloader', 'native', 'tests', 'tools', 'docs', '.github')) {
    $files += Get-ChildItem -LiteralPath (Join-Path $projectRoot $directory) -Recurse -Force -File | Where-Object {
        $relative = $_.FullName.Substring($projectRoot.Length + 1).Replace('\', '/')
        -not $relative.StartsWith('moekoe-song-downloader/host/')
    }
}
$files = @($files | Sort-Object FullName -Unique)
$paths = @()
foreach ($file in $files) {
    $relative = $file.FullName.Substring($projectRoot.Length + 1).Replace('\', '/')
    if ($file.Attributes -band [System.IO.FileAttributes]::ReparsePoint) { throw "Source links are not allowed: $relative" }
    if ($relative -match '(^|/)(\.git|\.verification|MoeKoeMusic|dist|node_modules)(/|$)' -or $relative -match '\.(exe|dll|zip|log|part|mp3|flac|wav)$') {
        throw "Unexpected source entry: $relative"
    }
    if ($file.Length -gt 5MB) { throw "Unexpected large source file: $relative" }
    $sourceText = [System.IO.File]::ReadAllText($file.FullName)
    if ($sourceText.Contains($projectRoot) -or $sourceText.Contains($projectRoot.Replace('\', '/'))) { throw "Personal workspace path in source: $relative" }
    if ($sourceText -match 'gh[pousr]_[A-Za-z0-9]{20,}|github_pat_[A-Za-z0-9_]{20,}|-----BEGIN (?:RSA |EC |OPENSSH )?PRIVATE KEY-----') {
        throw "Potential credential found in source: $relative"
    }
    $paths += $relative
}
Add-Type -AssemblyName System.IO.Compression.FileSystem
$outputDirectory = Join-Path $projectRoot 'dist'
New-Item -ItemType Directory -Path $outputDirectory -Force | Out-Null
$archivePath = Join-Path $outputDirectory "moekoe-song-downloader-v$($manifest.version)-source.zip"
$stream = [System.IO.File]::Open($archivePath, [System.IO.FileMode]::Create, [System.IO.FileAccess]::ReadWrite)
$archive = New-Object System.IO.Compression.ZipArchive($stream, [System.IO.Compression.ZipArchiveMode]::Create)
try {
    for ($index = 0; $index -lt $files.Count; $index++) {
        [System.IO.Compression.ZipFileExtensions]::CreateEntryFromFile($archive, $files[$index].FullName, "moekoe-song-downloader/$($paths[$index])", [System.IO.Compression.CompressionLevel]::Optimal) | Out-Null
    }
} finally { $archive.Dispose(); $stream.Dispose() }
$packed = [System.IO.Compression.ZipFile]::OpenRead($archivePath)
try {
    if ($packed.Entries.Count -ne $files.Count) { throw 'Source package entry count mismatch.' }
    for ($index = 0; $index -lt $files.Count; $index++) {
        $entry = $packed.GetEntry("moekoe-song-downloader/$($paths[$index])")
        if (-not $entry) { throw "Source package is missing: $($paths[$index])" }
        $entryStream = $entry.Open()
        $sourceStream = [System.IO.File]::OpenRead($files[$index].FullName)
        $hashProvider = [System.Security.Cryptography.SHA256]::Create()
        try {
            $entryHash = [BitConverter]::ToString($hashProvider.ComputeHash($entryStream))
            $sourceHash = [BitConverter]::ToString($hashProvider.ComputeHash($sourceStream))
            if ($entryHash -ne $sourceHash) { throw "Source package differs: $($paths[$index])" }
        } finally { $entryStream.Dispose(); $sourceStream.Dispose(); $hashProvider.Dispose() }
    }
} finally { $packed.Dispose() }
$paths | Set-Content -LiteralPath (Join-Path $outputDirectory "moekoe-song-downloader-v$($manifest.version)-source.files.txt") -Encoding UTF8
$archiveHash = (Get-FileHash -LiteralPath $archivePath -Algorithm SHA256).Hash.ToLowerInvariant()
"$archiveHash  $([System.IO.Path]::GetFileName($archivePath))" | Set-Content -LiteralPath "$archivePath.sha256" -Encoding ASCII
Write-Output "Source package: $archivePath"
Write-Output "Verified source files: $($files.Count)"
Write-Output "SHA256: $archiveHash"
