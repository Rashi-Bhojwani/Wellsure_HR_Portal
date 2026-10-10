# Shared by install.ps1, upgrade.ps1, uninstall.ps1 and set-key.ps1.
# Windows PowerShell 5.1 (the one every Windows 10/11 and Server has): no
# PowerShell 7 syntax. docs/plans/PHASE_2.md, "P2-F, commit F2 build design".

Set-StrictMode -Version 2.0
$ErrorActionPreference = 'Stop'

$script:ServiceName = 'WellsureAgent'
$script:AccountName = 'WellsureAgentSvc'
$script:EventSource = 'WellsureAgent'
$script:ExeName     = 'wellsure-agent.exe'
$script:ProgramDir  = Join-Path $env:ProgramFiles 'Wellsure Agent'
$script:DataDir     = Join-Path $env:ProgramData  'Wellsure Agent'
$script:ConfigFile  = Join-Path $script:DataDir 'config.json'

# Well-known SIDs, so this works on a PC whose Windows is not in English
# ("Administrators" and "Users" are translated).
$script:SidAdministrators = 'S-1-5-32-544'
$script:SidUsers          = 'S-1-5-32-545'

function Write-Step([int]$Number, [int]$Of, [string]$Text) {
    Write-Host ''
    Write-Host ("Step {0} of {1}: {2}" -f $Number, $Of, $Text) -ForegroundColor Cyan
}
function Write-Done([string]$Text)    { Write-Host "  OK   $Text" -ForegroundColor Green }
function Write-Note([string]$Text)    { Write-Host "       $Text" }
function Write-Caution([string]$Text) { Write-Host "  !!   $Text" -ForegroundColor Yellow }
function Write-Failure([string]$Text) { Write-Host "  XX   $Text" -ForegroundColor Red }

function Assert-Administrator {
    $principal = New-Object Security.Principal.WindowsPrincipal([Security.Principal.WindowsIdentity]::GetCurrent())
    if (-not $principal.IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)) {
        throw "This must be run as an administrator. Close this window, then right-click 'Windows PowerShell' (or 'Terminal') and choose 'Run as administrator', and run it again."
    }
}

function ConvertFrom-SecureStringPlain([securestring]$Secure) {
    $bstr = [Runtime.InteropServices.Marshal]::SecureStringToBSTR($Secure)
    try { return [Runtime.InteropServices.Marshal]::PtrToStringBSTR($bstr) }
    finally { [Runtime.InteropServices.Marshal]::ZeroFreeBSTR($bstr) }
}

function Read-Secret([string]$Prompt) {
    $secure = Read-Host -Prompt $Prompt -AsSecureString
    return (ConvertFrom-SecureStringPlain $secure).Trim()
}

function New-RandomPassword {
    $alphabet = 'ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz23456789#%+-=?'
    $bytes = New-Object byte[] 24
    $rng = New-Object Security.Cryptography.RNGCryptoServiceProvider
    try { $rng.GetBytes($bytes) } finally { $rng.Dispose() }
    $chars = foreach ($b in $bytes) { $alphabet[$b % $alphabet.Length] }
    # Always satisfies a complexity policy: upper, lower, digit and symbol first.
    return 'Aa1#' + (-join $chars)
}

function Get-AgentExe { return (Join-Path $script:ProgramDir $script:ExeName) }
function Get-Nssm     { return (Join-Path $script:ProgramDir 'nssm.exe') }

function Get-AgentService { return (Get-Service -Name $script:ServiceName -ErrorAction SilentlyContinue) }

function Invoke-Nssm {
    param([Parameter(ValueFromRemainingArguments = $true)][string[]]$Arguments)
    $output = & (Get-Nssm) @Arguments 2>&1
    if ($LASTEXITCODE -ne 0) { throw ("nssm {0} failed (exit {1}): {2}" -f ($Arguments[0..1] -join ' '), $LASTEXITCODE, ($output -join ' ')) }
}

function Stop-AgentService {
    $svc = Get-AgentService
    if ($svc -and $svc.Status -ne 'Stopped') {
        Stop-Service -Name $script:ServiceName -Force
        $svc.WaitForStatus('Stopped', [TimeSpan]::FromSeconds(45))
    }
}

function Start-AgentService {
    Start-Service -Name $script:ServiceName
}

# Copies, retrying a few times: the old executable can stay locked for a moment after the service stops.
function Copy-WithRetry([string]$From, [string]$To) {
    for ($i = 1; $i -le 10; $i++) {
        try { Copy-Item -LiteralPath $From -Destination $To -Force; return }
        catch { if ($i -eq 10) { throw }; Start-Sleep -Milliseconds 500 }
    }
}

# ── The service account ─────────────────────────────────────────────────────
# A local account that can do almost nothing: it is in no group but Users, and
# it owns the agent's data folder. Returns the new password ONLY when it
# creates the account (the service needs it once, then it is discarded). An
# account that already runs a service keeps its password, because resetting a
# local account's password makes Windows lose the credentials saved under it.
# An account left behind with NO service (a first install that failed halfway)
# holds nothing yet, so it is removed and made again.
function Initialize-ServiceAccount([bool]$ServiceExists) {
    $user = Get-LocalUser -Name $script:AccountName -ErrorAction SilentlyContinue
    if ($user -and $ServiceExists) {
        if (-not $user.Enabled) { Enable-LocalUser -Name $script:AccountName }
        return $null
    }
    if ($user) { Remove-ServiceAccount }
    $plain = New-RandomPassword
    New-LocalUser -Name $script:AccountName `
        -Password (ConvertTo-SecureString $plain -AsPlainText -Force) `
        -Description 'Runs the Wellsure Agent service.'   # Windows allows at most 48 characters here `
        -PasswordNeverExpires -UserMayNotChangePassword -AccountNeverExpires | Out-Null
    Add-LocalGroupMember -Group (Get-LocalGroup -SID $script:SidUsers) -Member $script:AccountName
    return $plain
}

# Removes the account and its Windows profile (which is where its saved credentials live).
function Remove-ServiceAccount {
    $user = Get-LocalUser -Name $script:AccountName -ErrorAction SilentlyContinue
    if (-not $user) { return }
    $sid = $user.SID.Value
    Remove-LocalUser -Name $script:AccountName
    Get-CimInstance -ClassName Win32_UserProfile -ErrorAction SilentlyContinue |
        Where-Object { $_.SID -eq $sid } |
        Remove-CimInstance -ErrorAction SilentlyContinue
}

# The data folder holds punch data, so only administrators, the system and the
# service account may open it (and what it holds, including the secrets inbox).
function Initialize-DataFolder {
    foreach ($d in @($script:DataDir, (Join-Path $script:DataDir 'logs'), (Join-Path $script:DataDir 'secrets-inbox'))) {
        New-Item -ItemType Directory -Force -Path $d | Out-Null
    }
    $account = "$env:COMPUTERNAME\$($script:AccountName)"
    $out = & icacls.exe $script:DataDir /inheritance:r `
        /grant:r "*$($script:SidAdministrators):(OI)(CI)F" "*S-1-5-18:(OI)(CI)F" "${account}:(OI)(CI)M" /T /C 2>&1
    if ($LASTEXITCODE -ne 0) { throw "Could not restrict the data folder: $($out -join ' ')" }
}

# ── config.json (no secrets in it) ──────────────────────────────────────────
function Read-AgentConfig {
    if (-not (Test-Path -LiteralPath $script:ConfigFile)) { return $null }
    try { return (Get-Content -LiteralPath $script:ConfigFile -Raw | ConvertFrom-Json) } catch { return $null }
}

function Write-AgentConfig([string]$ApiUrl, [object[]]$Devices) {
    $cfg = Read-AgentConfig
    if (-not $cfg) { $cfg = [pscustomobject]@{} }   # keeps anything else already in the file (poll interval, ...)
    $cfg | Add-Member -NotePropertyName apiUrl -NotePropertyValue $ApiUrl -Force
    $cfg | Add-Member -NotePropertyName devices -NotePropertyValue @($Devices) -Force
    $json = ConvertTo-Json -InputObject $cfg -Depth 6
    # UTF-8 WITHOUT a byte-order mark.
    [IO.File]::WriteAllText($script:ConfigFile, $json, (New-Object Text.UTF8Encoding($false)))
}

# ── Secrets: dropped in the inbox, stored by the service account at start ───
function Write-SecretToInbox([string]$FileName, [string]$Value) {
    $path = Join-Path (Join-Path $script:DataDir 'secrets-inbox') $FileName
    [IO.File]::WriteAllText($path, $Value, (New-Object Text.UTF8Encoding($false)))
}

# ── Checks ──────────────────────────────────────────────────────────────────
function Test-DeviceReachable([string]$HostName, [int]$Port, [int]$TimeoutMs = 5000) {
    $client = New-Object Net.Sockets.TcpClient
    try {
        $attempt = $client.BeginConnect($HostName, $Port, $null, $null)
        if (-not $attempt.AsyncWaitHandle.WaitOne($TimeoutMs, $false)) { return $false }
        $client.EndConnect($attempt)
        return $true
    } catch { return $false }
    finally { $client.Close() }
}

# True if the PC is set to go to sleep on mains power (a sleeping PC reads nothing).
function Test-PcSleeps {
    try {
        $text = (& powercfg.exe /query SCHEME_CURRENT SUB_SLEEP STANDBYIDLE 2>$null) -join "`n"
        $values = [regex]::Matches($text, '0x[0-9a-fA-F]{8}')
        if ($values.Count -lt 2) { return $false }
        # The last two are "current AC setting" then "current DC setting".
        return ([Convert]::ToInt64($values[$values.Count - 2].Value, 16) -ne 0)
    } catch { return $false }
}

# Registers the "WellsureAgent" event source the way Windows' own eventcreate
# does (so Event Viewer shows our text cleanly), and writes the first entry.
function Register-EventSource([string]$Text) {
    & (Join-Path $env:SystemRoot 'System32\eventcreate.exe') /ID 3 /L APPLICATION /T INFORMATION /SO $script:EventSource /D $Text 2>&1 | Out-Null
}

function Unregister-EventSource {
    try {
        if ([Diagnostics.EventLog]::SourceExists($script:EventSource)) { [Diagnostics.EventLog]::DeleteEventSource($script:EventSource) }
    } catch { }
}

# Waits until `status` says WORKING (the agent runs, the server has answered it,
# every device is being read), up to the timeout. Returns the last output either way.
function Wait-AgentWorking([int]$Seconds = 120) {
    $deadline = (Get-Date).AddSeconds($Seconds)
    $text = ''
    do {
        $text = (& (Get-AgentExe) status 2>&1) -join "`n"
        if ($LASTEXITCODE -eq 0) { return [pscustomobject]@{ Working = $true; Output = $text } }
        Start-Sleep -Seconds 3
    } while ((Get-Date) -lt $deadline)
    return [pscustomobject]@{ Working = $false; Output = $text }
}

function Get-WaitingBatchFiles {
    $outbox = Join-Path $script:DataDir 'outbox'
    if (-not (Test-Path -LiteralPath $outbox)) { return 0 }
    return @(Get-ChildItem -LiteralPath $outbox -Recurse -Filter '*.json' -File -ErrorAction SilentlyContinue).Count
}
