# Run this from the project root AFTER creating an empty GitHub repo named AnAnCelestialWallpaper.
# Do not initialize GitHub README or LICENSE on the GitHub site, to avoid initial-commit conflicts.
$ErrorActionPreference = 'Stop'
if (-not (Test-Path 'AGENTS.md')) { throw 'Run from the project root.' }
if (-not (Get-Command git -ErrorAction SilentlyContinue)) { throw 'Git must be installed.' }
if (-not (Test-Path '.git')) { git init -b main }
git add .
git commit -m 'chore: initialize celestial Wallpaper Engine project'
git remote add origin 'https://github.com/ananwanan/AnAnCelestialWallpaper.git'
git push -u origin main
