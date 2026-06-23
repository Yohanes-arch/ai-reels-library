$ErrorActionPreference = "Stop"
$ProjectRoot = Split-Path -Parent $PSScriptRoot
Set-Location $ProjectRoot

function Resolve-Npm {
  $Npm = Get-Command npm.cmd -ErrorAction SilentlyContinue
  if ($Npm) { return $Npm.Source }

  $LocalNpm = Get-ChildItem -Path (Join-Path $env:LOCALAPPDATA "Programs\nodejs") -Filter "npm.cmd" -Recurse -ErrorAction SilentlyContinue |
    Sort-Object LastWriteTime -Descending |
    Select-Object -First 1
  if ($LocalNpm) { return $LocalNpm.FullName }

  throw "npm was not found. Install Node.js 20+ from https://nodejs.org/en/download and reopen PowerShell."
}

$Npm = Resolve-Npm
& $Npm run build
