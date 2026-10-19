param([string]$OutputDirectory = '')
$ErrorActionPreference = 'Stop'
$repositoryRoot = Split-Path $PSScriptRoot -Parent
$distPath = Join-Path $repositoryRoot 'dist'
if (-not (Test-Path -LiteralPath (Join-Path $distPath 'index.html'))) { throw 'Build first: npm run build' }
if (Test-Path -LiteralPath (Join-Path $distPath 'project.json')) { throw 'dist must not contain a generated or dummy Wallpaper Engine project.json.' }
if (-not $OutputDirectory) { $OutputDirectory = Join-Path $repositoryRoot 'artifacts' }
$null = New-Item -ItemType Directory -Path $OutputDirectory -Force
$resolvedOutput = (Resolve-Path -LiteralPath $OutputDirectory).Path
$resolvedDist = (Resolve-Path -LiteralPath $distPath).Path
$files = @(Get-ChildItem -LiteralPath $resolvedDist -Recurse -File)
if ($files.Count -eq 0) { throw 'The production build is empty.' }
$manifest = [ordered]@{
  builtAt = [DateTime]::UtcNow.ToString('o')
  type = 'Wallpaper Engine Web import bundle'
  entry = 'index.html'
  projectMetadata = 'Created by Wallpaper Engine editor after import; not supplied by this bundle.'
  files = @($files | ForEach-Object {
    [ordered]@{ path = $_.FullName.Substring($resolvedDist.Length + 1).Replace('\', '/'); bytes = $_.Length; sha256 = (Get-FileHash -LiteralPath $_.FullName -Algorithm SHA256).Hash.ToLowerInvariant() }
  })
}
$manifest | ConvertTo-Json -Depth 8 | Set-Content -LiteralPath (Join-Path $resolvedOutput 'build-manifest.json') -Encoding utf8
$archivePath = Join-Path $resolvedOutput 'AnAnCelestialWallpaper-web.zip'
Compress-Archive -Path (Join-Path $resolvedDist '*') -DestinationPath $archivePath -Force
$archive = Get-Item -LiteralPath $archivePath
[ordered]@{ archive = $archive.FullName; bytes = $archive.Length; sha256 = (Get-FileHash -LiteralPath $archive.FullName -Algorithm SHA256).Hash.ToLowerInvariant(); files = $files.Count } | ConvertTo-Json
