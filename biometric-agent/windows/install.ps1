<#
.SYNOPSIS
  Installs (or re-configures) the Wellsure Agent as a Windows service.

.DESCRIPTION
  Run as administrator from the unzipped release folder. It asks for the few
  things only you know, installs the agent so it starts by itself whenever the PC
  starts, and does not say "WORKING" until the agent has actually reported in to
  the server and read the device. Safe to run again: it updates the settings and
  leaves any punches waiting to be sent alone.

  The agent only ever READS the attendance device. It cannot change, clear or
  pause it. See INSTALL.md.

.PARAMETER ApiUrl
  The app's address, e.g. https://hr.example.com. Asked if not given.

.PARAMETER AgentKey
  The key shown once on Admin Tools > Devices > Sync agents. Asked (hidden) if not given.
  For unattended use it may instead be in the environment variable WELLSURE_INSTALL_AGENT_KEY.

.PARAMETER Device
  One entry per device: "serial,ip-address" or "serial,ip-address,comm-key".
  Asked if not given.

.PARAMETER Unattended
  Never ask: stop with an error if something needed was not given.
#>
[CmdletBinding()]
param(
    [string]$ApiUrl,
    [securestring]$AgentKey,
    [string[]]$Device,
    [switch]$Unattended,
    [int]$WaitSeconds = 120
)

. (Join-Path $PSScriptRoot 'lib.ps1')
$steps = 8

try {
    Assert-Administrator
    foreach ($f in @($script:ExeName, 'nssm.exe')) {
        if (-not (Test-Path -LiteralPath (Join-Path $PSScriptRoot $f))) { throw "$f is missing from this folder. Unzip the whole release and run install.ps1 from inside it." }
    }

    $checked = Test-ReleaseIntegrity $PSScriptRoot

    Write-Host ''
    Write-Host 'Wellsure Agent: install' -ForegroundColor White
    Write-Host 'This installs the program that copies new punches from the attendance device to the HR system.'
    Write-Host 'It only reads the device. It cannot change, clear or pause it.'

    $existing = Read-AgentConfig

    Write-Host "All $checked files in this folder are exactly as they were built."

    # ── 1. What we need to know ────────────────────────────────────────────
    Write-Step 1 $steps 'Checking what you have told me'
    if (-not $ApiUrl -and $existing -and ($existing.PSObject.Properties.Name -contains 'apiUrl')) { $ApiUrl = $existing.apiUrl }
    if (-not $ApiUrl) {
        if ($Unattended) { throw 'ApiUrl is needed.' }
        $ApiUrl = (Read-Host 'The HR system''s address (it starts with https://)').Trim()
    }
    $ApiUrl = $ApiUrl.Trim().TrimEnd('/')
    $loopback = $ApiUrl -match '^http://(localhost|127\.0\.0\.1)(:\d+)?(/|$)'
    if ($ApiUrl -notmatch '^https://' -and -not $loopback) { throw "The address must start with https:// (you gave: $ApiUrl)." }
    Write-Done "HR system: $ApiUrl"

    $keyPlain = $null
    if ($AgentKey) { $keyPlain = (ConvertFrom-SecureStringPlain $AgentKey).Trim() }
    elseif ($env:WELLSURE_INSTALL_AGENT_KEY) { $keyPlain = $env:WELLSURE_INSTALL_AGENT_KEY.Trim() }   # unattended installs (never on a command line)
    elseif (-not $Unattended) {
        $hint = if ($existing) { ' (press Enter to keep the one already stored)' } else { '' }
        $keyPlain = Read-Secret ("The agent key from Admin Tools > Devices > Sync agents$hint")
    }
    if (-not $keyPlain -and -not $existing) { throw 'The agent key is needed: create an agent on Admin Tools > Devices > Sync agents and copy its key.' }
    if ($keyPlain) { Write-Done 'Agent key received (it is stored safely, and never shown or written to a file that stays).' }
    else           { Write-Done 'Keeping the agent key already stored.' }

    # Devices: "serial,ip[,commkey]"
    $devices = @()      # objects for config.json
    $commKeys = @{}     # serial -> comm key
    $entries = @($Device | Where-Object { $_ })
    if ($entries.Count -eq 0 -and $existing -and ($existing.PSObject.Properties.Name -contains 'devices')) {
        foreach ($d in $existing.devices) { $entries += ('{0},{1}' -f $d.serial, $d.host) }
        if ($entries.Count) { Write-Note "Keeping the device(s) already set up: $($entries -join '; ')" }
    }
    if ($entries.Count -eq 0) {
        if ($Unattended) { throw 'At least one -Device is needed.' }
        do {
            $serial = (Read-Host 'Device serial number (printed on the device, or in Admin Tools > Devices)').Trim()
            $ip = (Read-Host 'Device IP address on this network, e.g. 192.168.29.213').Trim()
            $ck = Read-Secret 'Device connection password / "comm key" (press Enter if it has none)'
            $entries += $(if ($ck) { "$serial,$ip,$ck" } else { "$serial,$ip" })
            $more = (Read-Host 'Another device? (y/N)').Trim()
        } while ($more -match '^[yY]')
    }
    foreach ($e in $entries) {
        $parts = $e.Split(',')
        if ($parts.Count -lt 2 -or -not $parts[0].Trim() -or -not $parts[1].Trim()) { throw "Device '$e' should look like: serial,ip-address  (or serial,ip-address,comm-key)." }
        $serial = $parts[0].Trim(); $ip = $parts[1].Trim()
        if ($serial -notmatch '^[A-Za-z0-9_.-]{1,64}$') { throw "Device serial '$serial' has characters I don't expect. Check it against the device." }
        $devices += [pscustomobject]@{ serial = $serial; host = $ip; port = 4370 }
        if ($parts.Count -ge 3 -and $parts[2].Trim()) {
            if ($parts[2].Trim() -notmatch '^\d{1,9}$') { throw "The comm key for $serial must be a whole number." }
            $commKeys[$serial] = $parts[2].Trim()
        }
        if (Test-DeviceReachable $ip 4370) { Write-Done "$serial answers at ${ip}:4370" }
        else { Write-Caution "$serial did not answer at ${ip}:4370. I'll carry on; check the address and that the device is on. The final check will say if it still can't be reached." }
    }

    # ── 2. Account and folders ─────────────────────────────────────────────
    Write-Step 2 $steps 'Creating the account the service runs as, and its folders'
    $svc = Get-AgentService
    if ($svc) { Stop-AgentService; Write-Note 'The agent was already installed; it has been stopped while this runs.' }
    $password = Initialize-ServiceAccount ([bool]$svc)
    Initialize-DataFolder
    Write-Done "Account '$($script:AccountName)' ready; data folder $($script:DataDir) is open only to administrators and that account."

    # ── 3. The program ─────────────────────────────────────────────────────
    Write-Step 3 $steps 'Putting the program in place'
    New-Item -ItemType Directory -Force -Path $script:ProgramDir | Out-Null
    Copy-WithRetry (Join-Path $PSScriptRoot $script:ExeName) (Get-AgentExe)
    Copy-WithRetry (Join-Path $PSScriptRoot 'nssm.exe') (Get-Nssm)
    $version = (Invoke-Native (Get-AgentExe) @('version')).Output
    Write-Done "Installed Wellsure Agent $version in $($script:ProgramDir)"

    # ── 4. Settings and secrets ────────────────────────────────────────────
    Write-Step 4 $steps 'Saving the settings'
    Write-AgentConfig $ApiUrl $devices
    Write-Done "Settings written to $($script:ConfigFile) (no passwords in it)."
    if ($keyPlain) { Write-SecretToInbox 'agent-key.txt' $keyPlain }
    foreach ($s in $commKeys.Keys) { Write-SecretToInbox ("commkey-$s.txt") $commKeys[$s] }
    $keyPlain = $null
    Write-Done 'Passwords left for the service to lock away in Windows Credential Manager when it starts (the files are deleted as it does).'

    # ── 5. The service ─────────────────────────────────────────────────────
    Write-Step 5 $steps 'Setting it up to run by itself'
    if (-not (Get-AgentService)) { Invoke-Nssm install $script:ServiceName (Get-AgentExe) run }
    if ($password) {
        Invoke-Nssm set $script:ServiceName ObjectName ".\$($script:AccountName)" $password
        $password = $null   # the service has it now; nobody else needs it
    }
    Invoke-Nssm set $script:ServiceName DisplayName 'Wellsure Agent'
    Invoke-Nssm set $script:ServiceName Description 'Copies new punches from the attendance device to the Wellsure HR system. Read-only: never changes the device.'
    Invoke-Nssm set $script:ServiceName AppDirectory $script:DataDir
    Invoke-Nssm set $script:ServiceName Start SERVICE_DELAYED_AUTO_START
    Invoke-Nssm set $script:ServiceName AppStdout (Join-Path $script:DataDir 'logs\agent.log')
    Invoke-Nssm set $script:ServiceName AppStderr (Join-Path $script:DataDir 'logs\agent.log')
    Invoke-Nssm set $script:ServiceName AppRotateFiles 1
    Invoke-Nssm set $script:ServiceName AppRotateOnline 1
    Invoke-Nssm set $script:ServiceName AppRotateBytes 10485760
    Invoke-Nssm set $script:ServiceName AppExit Default Restart
    Invoke-Nssm set $script:ServiceName AppRestartDelay 5000
    Invoke-Nssm set $script:ServiceName AppThrottle 5000
    Invoke-Nssm set $script:ServiceName AppStopMethodConsole 15000
    $sc = Invoke-Native (Join-Path $env:SystemRoot 'System32\sc.exe') @('failure', $script:ServiceName, 'reset=', '86400', 'actions=', 'restart/5000/restart/5000/restart/60000')
    if ($sc.ExitCode -ne 0) { throw "Could not set the service's recovery actions: $($sc.Output)" }
    Write-Done 'The service starts when the PC starts, and restarts itself if it stops.'

    # ── 6. Windows event log ───────────────────────────────────────────────
    Write-Step 6 $steps 'Registering with the Windows event log'
    Register-EventSource "Wellsure Agent $version installed."
    Write-Done "Event Viewer > Windows Logs > Application, source '$($script:EventSource)'."

    # ── 7. Sleep ───────────────────────────────────────────────────────────
    Write-Step 7 $steps 'Checking the PC will stay awake'
    if (Test-PcSleeps) {
        Write-Caution 'This PC is set to go to sleep when idle. While it sleeps, nothing is read from the device and punches wait.'
        Write-Note 'To stop that: Settings > System > Power > Screen and sleep > set "When plugged in, PC goes to sleep after" to Never.'
        Write-Note 'Or run, as administrator:  powercfg /change standby-timeout-ac 0'
    } else { Write-Done 'The PC is not set to sleep when plugged in.' }

    # ── 8. Start, and prove it ─────────────────────────────────────────────
    Write-Step 8 $steps 'Starting the agent and checking it works'
    Start-AgentService
    Write-Note "Waiting up to $WaitSeconds seconds for it to report in and read the device..."
    $result = Wait-AgentWorking $WaitSeconds
    Write-Host ''
    $result.Output -split "`n" | ForEach-Object { Write-Host "  $_" }
    Write-Host ''
    if ($result.Working) {
        Write-Host 'WORKING. The agent is running, the server has answered it, and the device is being read.' -ForegroundColor Green
        Write-Host 'Last check: in the app, Admin Tools > Devices should show the device as "Read OK" within a minute.'
        exit 0
    }
    Write-Host 'INSTALLED, BUT NOT WORKING YET.' -ForegroundColor Yellow
    Write-Host 'The lines above say what is wrong. See INSTALL.md, "If something is not right". You can run'
    Write-Host '  & "C:\Program Files\Wellsure Agent\wellsure-agent.exe" status'
    Write-Host 'at any time to see this again.'
    exit 1
}
catch {
    Write-Host ''
    Write-Failure $_.Exception.Message
    Write-Host 'Nothing is half-installed in a way that matters: you can fix the above and run install.ps1 again.'
    exit 1
}
