$ErrorActionPreference = "Stop"
$ProjectRoot = Split-Path -Parent $PSScriptRoot
Set-Location $ProjectRoot

$RuntimeNode = Join-Path $env:USERPROFILE ".cache\codex-runtimes\codex-primary-runtime\dependencies\node\bin\node.exe"
$ViteBin = Join-Path (Get-Location) "node_modules\vite\bin\vite.js"

if (-not (Test-Path $RuntimeNode)) {
  throw "Bundled Node was not found at $RuntimeNode. Install Node.js 20+ or run inside Codex Desktop."
}

if (-not (Test-Path $ViteBin)) {
  throw "Dependencies are not installed. Run .\scripts\install-deps.ps1 first."
}

& $RuntimeNode $ViteBin build
