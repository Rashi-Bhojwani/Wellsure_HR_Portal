# Downloads NSSM (the service wrapper) and checks it against a pinned SHA-256
# before anything uses it. NSSM is never committed to the repository.
# docs/plans/PHASE_2.md, "P2-F, commit F2 build design", rule 1: nssm.cc is the
# only official source and is sometimes unreliable, so this retries, and CI
# caches the verified zip by its hash.
param(
    [string]$Version = '2.24',
    [Parameter(Mandatory = $true)][string]$Sha256,
    [Parameter(Mandatory = $true)][string]$OutDir
)
$ErrorActionPreference = 'Stop'
New-Item -ItemType Directory -Force -Path $OutDir | Out-Null
$zip = Join-Path $OutDir "nssm-$Version.zip"
$url = "https://nssm.cc/release/nssm-$Version.zip"

if (-not (Test-Path -LiteralPath $zip)) {
    [Net.ServicePointManager]::SecurityProtocol = [Net.SecurityProtocolType]::Tls12
    for ($i = 1; $i -le 5; $i++) {
        try {
            Write-Host "Downloading $url (attempt $i)"
            Invoke-WebRequest -UseBasicParsing -Uri $url -OutFile $zip -TimeoutSec 60
            break
        } catch {
            Write-Host "  failed: $($_.Exception.Message)"
            if ($i -eq 5) { throw "Could not download NSSM from $url after 5 attempts." }
            Start-Sleep -Seconds (5 * $i)
        }
    }
}

$actual = (Get-FileHash -LiteralPath $zip -Algorithm SHA256).Hash.ToLowerInvariant()
Write-Host "SHA-256 of nssm-$Version.zip: $actual"
if ($actual -ne $Sha256.ToLowerInvariant()) {
    Remove-Item -LiteralPath $zip -Force
    throw "NSSM zip does not match the pinned SHA-256.`n  pinned: $($Sha256.ToLowerInvariant())`n  got:    $actual`nNot using it."
}
Expand-Archive -LiteralPath $zip -DestinationPath $OutDir -Force
$exe = Join-Path $OutDir "nssm-$Version\win64\nssm.exe"
if (-not (Test-Path -LiteralPath $exe)) { throw "nssm.exe not found at $exe after unzipping." }
Write-Host "NSSM ready: $exe"
