$ErrorActionPreference = 'Stop'
$secretFile = Join-Path $PSScriptRoot '.env'
if (-not (Test-Path -LiteralPath $secretFile)) {
    $secretBytes = New-Object byte[] 32
    $rng = [System.Security.Cryptography.RandomNumberGenerator]::Create()
    try { $rng.GetBytes($secretBytes) } finally { $rng.Dispose() }
    $secret = -join ($secretBytes | ForEach-Object { $_.ToString('x2') })
    Set-Content -LiteralPath $secretFile -Value "SEARXNG_SECRET=$secret" -Encoding ascii
}
docker compose --project-directory $PSScriptRoot -f (Join-Path $PSScriptRoot 'compose.yaml') up -d
if ($LASTEXITCODE -ne 0) { exit $LASTEXITCODE }
Write-Host 'SearXNG is starting at http://127.0.0.1:8080. Dyad uses this URL by default.'
