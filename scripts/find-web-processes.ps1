param([string]$Root)

# Reports the PIDs of processes belonging to this project's web server: the .cmd launcher and
# anything whose command line references the project root. Output is "<pid>|<name>" per line.

Get-CimInstance Win32_Process | Where-Object {
    $_.CommandLine -and (
        $_.CommandLine -like "*$Root*" -or
        $_.CommandLine -like '*start-web.cmd*'
    )
} | ForEach-Object {
    "{0}|{1}" -f $_.ProcessId, $_.Name
}