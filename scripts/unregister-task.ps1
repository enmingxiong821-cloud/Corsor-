# Removes the "CursorZhAutoSync" scheduled task. Nothing else is touched:
# Cursor keeps the current translations until you run `node src/cli.mjs restore`.
$ErrorActionPreference = 'Stop'

$taskName = 'CursorZhAutoSync'
$task = Get-ScheduledTask -TaskName $taskName -ErrorAction SilentlyContinue
if (-not $task) {
    Write-Host "Task '$taskName' is not registered; nothing to do."
    return
}

Unregister-ScheduledTask -TaskName $taskName -Confirm:$false
Write-Host "Removed scheduled task: $taskName"
Write-Host "The Cursor patch itself is still installed; run 'node src/cli.mjs restore' to undo it."
