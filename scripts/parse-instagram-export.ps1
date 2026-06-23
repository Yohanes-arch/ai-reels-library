param(
  [Parameter(Mandatory=$true)]
  [string]$InputPath,
  [string]$OutPath = "data\processed\reels-normalized.json"
)

$ErrorActionPreference = "Stop"
$RuntimePython = Join-Path $env:USERPROFILE ".cache\codex-runtimes\codex-primary-runtime\dependencies\python\python.exe"

if (Get-Command python -ErrorAction SilentlyContinue) {
  $Python = "python"
} elseif (Test-Path $RuntimePython) {
  $Python = $RuntimePython
} else {
  throw "Python was not found. Install Python 3.11+ or run this inside Codex Desktop."
}

& $Python scripts\ingest_instagram_export.py --input $InputPath --out $OutPath

