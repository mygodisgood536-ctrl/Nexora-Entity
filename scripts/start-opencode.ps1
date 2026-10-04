param([string]$Root, [int]$Port = 4137)

# Registers (once) and starts the OpenCode server as a scheduled task.
#
# A server launched from an interactive console is killed by console control events when that
# console closes, and during a crash-recovery window it refuses connections — both of which look
# like provider discovery failing. A scheduled task runs in its own session with no console.
#
# The task is only ever registered when missing, and only ever started: re-registering a running
# task tears the process down and forces a re-listen window.

$ErrorActionPreference = 'Stop'

$TaskName = 'NexoraEntityOpenCode'
$Binary = Join-Path $Root 'node_modules\opencode-ai\bin\opencode.exe'
$Launcher = Join-Path $Root 'scripts\start-opencode.cmd'

if (-not (Test-Path $Binary)) {
    Write-Error "OPENCODE BINARY MISSING at $Binary. Run: npm run opencode:install"
    exit 1
}

$existing = Get-ScheduledTask -TaskName $TaskName -ErrorAction SilentlyContinue
if (-not $existing) {
    $action = New-ScheduledTaskAction -Execute $Launcher
    $settings = New-ScheduledTaskSettingsSet `
        -AllowStartIfOnBatteries `
        -DontStopIfGoingOnBatteries `
        -ExecutionTimeLimit ([TimeSpan]::Zero) `
        -MultipleInstances IgnoreNew
    $principal = New-ScheduledTaskPrincipal -UserId $env:USERNAME -LogonType Interactive -RunLevel Limited
    Register-ScheduledTask -TaskName $TaskName -Action $action -Settings $settings -Principal $principal -Force |
        Out-Null
    Write-Output "registered"
}

Start-ScheduledTask -TaskName $TaskName
Write-Output "started on port $Port"