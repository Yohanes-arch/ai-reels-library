$ErrorActionPreference = "Stop"
$ProjectRoot = Split-Path -Parent $PSScriptRoot
Set-Location $ProjectRoot

$RuntimeNode = Join-Path $env:USERPROFILE ".cache\codex-runtimes\codex-primary-runtime\dependencies\node\bin\node.exe"
$NpmCli = "C:\Program Files\nodejs\node_modules\npm\bin\npm-cli.js"

if (-not (Test-Path $RuntimeNode)) {
  throw "Bundled Node was not found at $RuntimeNode. Install Node.js 20+ or run inside Codex Desktop."
}

if (-not (Test-Path $NpmCli)) {
  throw "npm was not found at $NpmCli. Install Node.js 20+ from https://nodejs.org/en/download and reopen PowerShell."
}

& $RuntimeNode $NpmCli install
