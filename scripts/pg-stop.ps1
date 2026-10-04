param(
  [string]$DataDir = "$PSScriptRoot\..\.pg\data"
)
$ErrorActionPreference = "Stop"
$root = Resolve-Path "$PSScriptRoot\.."
$pgCtl = Join-Path $root ".pg\16\bin\pg_ctl.exe"
& $pgCtl -D $DataDir -m fast -w stop
if ($LASTEXITCODE -eq 0) { Write-Output "PostgreSQL stopped." } else { Write-Output "PostgreSQL was not running." }