param(
  [int]$Port = 5433,
  [string]$DataDir = "$PSScriptRoot\..\.pg\data",
  [string]$LogFile = "$PSScriptRoot\..\.pg\logs\postgres.log"
)
$ErrorActionPreference = "Stop"
$root = Resolve-Path "$PSScriptRoot\.."
$bin = Join-Path $root ".pg\16\bin"
$pgCtl = Join-Path $bin "pg_ctl.exe"
$initDb = Join-Path $bin "initdb.exe"

if (-not (Test-Path $pgCtl)) { throw "PostgreSQL binaries not found at $bin" }

New-Item -ItemType Directory -Force -Path (Split-Path -Parent $LogFile) | Out-Null
New-Item -ItemType Directory -Force -Path $root\.pg\logs | Out-Null
$ctlOut = Join-Path $root ".pg\logs\pgctl.out.log"
$ctlErr = Join-Path $root ".pg\logs\pgctl.err.log"

function Invoke-Detached([string]$exe, [string[]]$argList) {
  $p = Start-Process -FilePath $exe -ArgumentList $argList -PassThru -WindowStyle Hidden `
        -RedirectStandardOutput $ctlOut -RedirectStandardError $ctlErr
  $p.WaitForExit(180000) | Out-Null
  return $p.ExitCode
}

if (Test-Path (Join-Path $DataDir "PG_VERSION")) {
  & $pgCtl -D $DataDir status *> $null
  if ($LASTEXITCODE -eq 0) {
    Write-Output "Nexora Entity PostgreSQL is already running on port $Port."
    exit 0
  }
}

if (-not (Test-Path (Join-Path $DataDir "PG_VERSION"))) {
  Write-Output "Initialising PostgreSQL cluster at $DataDir ..."
  New-Item -ItemType Directory -Force -Path $DataDir | Out-Null
  $pwFile = Join-Path $env:TEMP "nexora_pg_superuser.txt"
  Set-Content -LiteralPath $pwFile -Value "nexora-entity-super" -NoNewline -Encoding UTF8
  $initOut = Join-Path $root ".pg\logs\initdb.log"
  $initErr = Join-Path $root ".pg\logs\initdb.err.log"
  $p = Start-Process -FilePath $initDb `
        -ArgumentList @("-D", $DataDir, "-U", "postgres", "-A", "md5", "--pwfile=$pwFile", "-E", "UTF8", "--locale=C") `
        -PassThru -WindowStyle Hidden -RedirectStandardOutput $initOut -RedirectStandardError $initErr
  $p.WaitForExit(300000) | Out-Null
  if ($p.ExitCode -ne 0) {
    Get-Content -LiteralPath $initErr -Tail 30 -ErrorAction SilentlyContinue
    throw "initdb failed with exit code $($p.ExitCode)"
  }
  Remove-Item -LiteralPath $pwFile -Force -ErrorAction SilentlyContinue
  Add-Content -LiteralPath (Join-Path $DataDir "postgresql.conf") -Value "`nport = $Port`nlisten_addresses = '127.0.0.1'`nmax_connections = 100`nshared_buffers = 128MB`nlog_min_messages = warning`nfsync = off`nsynchronous_commit = off`nfull_page_writes = off`n"
  Write-Output "Cluster initialised."
}

Write-Output "Starting PostgreSQL on port $Port ..."
$code = Invoke-Detached $pgCtl @("-D", $DataDir, "-l", $LogFile, "-o", "`"-p $Port`"", "-w", "start")
if ($code -ne 0) {
  Write-Output "--- pgctl stderr ---"
  Get-Content -LiteralPath $ctlErr -Tail 20 -ErrorAction SilentlyContinue
  Write-Output "--- server log ---"
  Get-Content -LiteralPath $LogFile -Tail 40 -ErrorAction SilentlyContinue
  throw "pg_ctl start failed with exit code $code"
}
Write-Output "PostgreSQL running on 127.0.0.1:$Port"