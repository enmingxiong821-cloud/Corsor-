# Registers the "CursorZhAutoSync" scheduled task.
#
# Trigger: every 15 minutes, starting one minute from now.
# Action:  wscript.exe scripts\sync-hidden.vbs -> `node src/cli.mjs sync`
#
# The task only *checks* most of the time (a few milliseconds, read-only). It writes to
# Cursor's install directory only when the version changed or the file was overwritten,
# and never while Cursor.exe is running.
#
# No <LogonTrigger>: registering one requires elevation (HRESULT 0x80070005), and a
# 15-minute cadence already covers "after logon" and "after a Cursor upgrade" with a
# worst case of one interval. No -Principal either: the defaults are exactly what we want
# (current user, InteractiveToken, LeastPrivilege), so the task never asks for elevation.
#
# ASCII-only on purpose: Windows PowerShell 5.1 reads .ps1 in the ANSI code page unless
# the file carries a UTF-8 BOM, and this repo writes plain UTF-8.
#
# Run:  powershell -ExecutionPolicy Bypass -File scripts\register-task.ps1
# Undo: powershell -ExecutionPolicy Bypass -File scripts\unregister-task.ps1

$ErrorActionPreference = 'Stop'

$root = Split-Path -Parent $PSScriptRoot
$vbs  = Join-Path $PSScriptRoot 'sync-hidden.vbs'
$cli  = Join-Path $root 'src\cli.mjs'
$taskName = 'CursorZhAutoSync'

foreach ($p in @($vbs, $cli)) {
    if (-not (Test-Path -LiteralPath $p)) { throw "Missing required file: $p" }
}
if (-not (Get-Command node.exe -ErrorAction SilentlyContinue)) {
    throw 'node.exe not found on PATH; install Node.js or fix PATH first.'
}

$action = New-ScheduledTaskAction -Execute 'wscript.exe' -Argument ('"{0}"' -f $vbs)

# StartBoundary in the near future, then repeat every 15 minutes for ten years.
$trigger = New-ScheduledTaskTrigger -Once -At (Get-Date).AddMinutes(1) `
    -RepetitionInterval (New-TimeSpan -Minutes 15) `
    -RepetitionDuration (New-TimeSpan -Days 3650)

$settings = New-ScheduledTaskSettingsSet `
    -AllowStartIfOnBatteries `
    -DontStopIfGoingOnBatteries `
    -StartWhenAvailable `
    -MultipleInstances IgnoreNew `
    -ExecutionTimeLimit (New-TimeSpan -Minutes 10)

try {
    Register-ScheduledTask -TaskName $taskName `
        -Action $action `
        -Trigger $trigger `
        -Settings $settings `
        -Description 'Keeps the Cursor Simplified-Chinese patch applied across upgrades (cursor-zh sync).' `
        -Force | Out-Null
} catch {
    throw @"
Failed to register the scheduled task: $($_.Exception.Message)

If this says access denied, open Task Scheduler once and grant yourself write access to
the task root, or run this script from an elevated PowerShell window.
"@
}

Write-Host "Registered scheduled task: $taskName"
Write-Host "  action : wscript.exe `"$vbs`""
Write-Host "  trigger: every 15 minutes"
Write-Host ""
Write-Host "Check:  schtasks /Query /TN $taskName /V /FO LIST"
Write-Host "Undo :  powershell -ExecutionPolicy Bypass -File scripts\unregister-task.ps1"
