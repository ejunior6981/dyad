$ErrorActionPreference = 'Stop'
$metadataPath = Join-Path $PSScriptRoot '.runtime\server.json'
if (!(Test-Path -LiteralPath $metadataPath)) { Write-Host 'No helper-owned ComfyUI server was recorded.'; exit 0 }
$metadata = Get-Content -LiteralPath $metadataPath -Raw | ConvertFrom-Json
$serverProcessId = [int]$metadata.pid
$server = Get-CimInstance Win32_Process -Filter "ProcessId=$serverProcessId"
if (!$server) { Write-Host 'The helper-owned ComfyUI server has already stopped.'; exit 0 }
if ($server.ExecutablePath -ne $metadata.python -or !$server.CommandLine.Contains($metadata.mainFile)) {
    throw 'The recorded PID belongs to a different process; refusing to stop it.'
}
$queue = Invoke-RestMethod 'http://127.0.0.1:8188/queue' -TimeoutSec 3
if ($queue.queue_running.Count -gt 0 -or $queue.queue_pending.Count -gt 0) {
    throw 'ComfyUI still has image jobs. Wait for them to finish before stopping the server.'
}
Stop-Process -Id $serverProcessId
Remove-Item -LiteralPath $metadataPath
Write-Host 'Stopped the helper-owned ComfyUI server. You can now launch it through Comfy Desktop.'
