param([string]$InstanceId)
$ErrorActionPreference = 'Stop'
$endpoint = 'http://127.0.0.1:8188'
try {
    $existing = Invoke-RestMethod "$endpoint/system_stats" -TimeoutSec 2
    if ($existing.system) { Write-Host "ComfyUI is already running at $endpoint"; exit 0 }
} catch {}

$desktopDir = Join-Path $env:APPDATA 'Comfy Desktop'
$registryFile = Join-Path $desktopDir 'installations.json'
$instances = Get-Content -LiteralPath $registryFile -Raw | ConvertFrom-Json
$instance = $null
foreach ($entry in $instances) {
    if ($entry.status -eq 'installed' -and $entry.installPath -and (!$InstanceId -or $entry.id -eq $InstanceId)) {
        $instance = $entry
        break
    }
}
if (!$instance) { throw 'No installed local Comfy Desktop instance was found.' }

$sourceDir = Join-Path $instance.installPath 'ComfyUI'
if (!(Test-Path -LiteralPath (Join-Path $sourceDir 'main.py'))) { $sourceDir = $instance.installPath }
$mainFile = Join-Path $sourceDir 'main.py'
$baseDir = if ($instance.adoptedBaseDir) { $instance.adoptedBaseDir } else { $sourceDir }
$python = if ($instance.adoptedPythonPath) { $instance.adoptedPythonPath } else { Join-Path $baseDir '.venv\Scripts\python.exe' }
if (!(Test-Path -LiteralPath $mainFile) -or !(Test-Path -LiteralPath $python)) {
    throw 'ComfyUI source or Python environment is missing. Repair this instance in Comfy Desktop.'
}

$runtimeDir = Join-Path $PSScriptRoot '.runtime'
New-Item -ItemType Directory -Path $runtimeDir -Force | Out-Null
function Quote-Argument([string]$value) {
    if ($value.Contains('"') -or $value.Contains("`n") -or $value.Contains("`r")) { throw 'Invalid path in ComfyUI instance configuration.' }
    return '"' + $value + '"'
}
$launchArgs = @('-s', (Quote-Argument $mainFile), '--listen', '127.0.0.1', '--port', '8188',
    '--base-directory', (Quote-Argument $baseDir), '--user-directory', (Quote-Argument (Join-Path $baseDir 'user')),
    '--input-directory', (Quote-Argument (Join-Path $baseDir 'input')), '--output-directory', (Quote-Argument (Join-Path $baseDir 'output')),
    '--disable-all-custom-nodes', '--lowvram', '--reserve-vram', '8',
    '--disable-dynamic-vram', '--disable-async-offload', '--disable-cuda-malloc', '--cache-none')
$modelConfig = Join-Path $desktopDir ('instance-model-paths\' + $instance.id + '.yaml')
if (Test-Path -LiteralPath $modelConfig) { $launchArgs += @('--extra-model-paths-config', (Quote-Argument $modelConfig)) }
$process = Start-Process -FilePath $python -ArgumentList ($launchArgs -join ' ') -WorkingDirectory $sourceDir -WindowStyle Hidden -PassThru `
    -RedirectStandardOutput (Join-Path $runtimeDir 'stdout.log') -RedirectStandardError (Join-Path $runtimeDir 'stderr.log')
@{ pid = $process.Id; python = $python; mainFile = $mainFile; instanceId = $instance.id } | ConvertTo-Json | Set-Content -LiteralPath (Join-Path $runtimeDir 'server.json') -Encoding utf8
for ($attempt = 0; $attempt -lt 30; $attempt++) {
    Start-Sleep -Seconds 1
    if ($process.HasExited) { throw "ComfyUI exited. See $runtimeDir\stderr.log" }
    try {
        $stats = Invoke-RestMethod "$endpoint/system_stats" -TimeoutSec 2
        if ($stats.system) { Write-Host "ComfyUI is ready at $endpoint (PID $($process.Id))."; exit 0 }
    } catch {}
}
throw "ComfyUI is still starting. Check $runtimeDir\stderr.log."
