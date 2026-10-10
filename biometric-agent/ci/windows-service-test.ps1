# CI only (Windows runner, Windows PowerShell 5.1): installs the shipped release
# zip with install.ps1 and exercises the real service against a fake API and the
# fake device. docs/plans/PHASE_2.md, "P2-F, commit F2 build design", "CI on a
# Windows runner". A runner can't reboot: restart on failure plus automatic
# start stand in for "survives a reboot".
#
#   ci\windows-service-test.ps1 -ZipPath <release zip> -RepoDir <repo root>
param(
    [Parameter(Mandatory = $true)][string]$ZipPath,
    [Parameter(Mandatory = $true)][string]$RepoDir
)
$ErrorActionPreference = 'Stop'

$agentDir = Join-Path $RepoDir 'biometric-agent'
$work = Join-Path $env:RUNNER_TEMP 'agent-ci'
$release = Join-Path $work 'release'
$data = Join-Path $env:ProgramData 'Wellsure Agent'
$program = Join-Path $env:ProgramFiles 'Wellsure Agent'
$exe = Join-Path $program 'wellsure-agent.exe'
$apiKey = 'wsa_ci_' + [Guid]::NewGuid().ToString('N')
$serial = 'SIM-CI'
$results = New-Object System.Collections.ArrayList
$procs = New-Object System.Collections.ArrayList

function Check([string]$Name, [bool]$Ok, [string]$Detail = '') {
    [void]$results.Add([pscustomobject]@{ Name = $Name; Ok = $Ok })
    $tag = if ($Ok) { 'PASS' } else { 'FAIL' }
    $line = "[$tag] $Name"
    if ($Detail) { $line += " -- $Detail" }
    Write-Host $line
}

function Wait-Until([string]$What, [scriptblock]$Condition, [int]$Seconds = 90, [int]$Every = 2) {
    $deadline = (Get-Date).AddSeconds($Seconds)
    while ((Get-Date) -lt $deadline) {
        try { $v = & $Condition; if ($v) { return $v } } catch { }
        Start-Sleep -Seconds $Every
    }
    return $null
}

function Get-FakeApiState { return (Invoke-RestMethod -Uri 'http://127.0.0.1:4401/state' -TimeoutSec 10) }
function Set-FakeApi([string]$Path, [hashtable]$Body) { return (Invoke-RestMethod -Method Post -Uri "http://127.0.0.1:4401$Path" -Body ($Body | ConvertTo-Json) -TimeoutSec 10) }
function Send-FakePunch([string]$UserId) { [void](Invoke-RestMethod -Method Post -Uri 'http://127.0.0.1:4380/punch' -Body (@{ deviceUserId = $UserId } | ConvertTo-Json) -TimeoutSec 10) }
function Get-StoredCount { $s = Get-FakeApiState; return @($s.stored.$serial).Count }
function Get-AgentProcess { return (Get-CimInstance Win32_Process -Filter "Name='wellsure-agent.exe'" | Select-Object -First 1) }
function Get-AgentStatus { return ((& $exe status 2>&1) -join "`n") }
function Test-Working { [void](& $exe status 2>&1); return ($LASTEXITCODE -eq 0) }
function Get-AppEvents([int]$Id) { return @(Get-WinEvent -FilterHashtable @{ LogName = 'Application'; ProviderName = 'WellsureAgent'; Id = $Id } -ErrorAction SilentlyContinue) }
function Start-Background([string]$Name, [string[]]$NodeArgs) {
    $p = Start-Process -FilePath 'node' -ArgumentList $NodeArgs -WorkingDirectory $agentDir -PassThru -WindowStyle Hidden `
        -RedirectStandardOutput (Join-Path $work "$Name.out.log") -RedirectStandardError (Join-Path $work "$Name.err.log")
    [void]$procs.Add($p)
    return $p
}
function Run-Script([string]$Name, [string[]]$ScriptArgs) {
    $out = Join-Path $work "$Name.log"
    $p = Start-Process -FilePath 'powershell.exe' -ArgumentList (@('-NoProfile', '-ExecutionPolicy', 'Bypass', '-File', (Join-Path $release $Name)) + $ScriptArgs) `
        -Wait -PassThru -WindowStyle Hidden -RedirectStandardOutput $out -RedirectStandardError "$out.err"
    Write-Host "----- $Name $($ScriptArgs -join ' ') (exit $($p.ExitCode)) -----"
    Get-Content $out -ErrorAction SilentlyContinue | ForEach-Object { Write-Host "  | $_" }
    Get-Content "$out.err" -ErrorAction SilentlyContinue | ForEach-Object { Write-Host "  ! $_" }
    return $p.ExitCode
}

try {
    New-Item -ItemType Directory -Force -Path $work | Out-Null
    Remove-Item -LiteralPath $release -Recurse -Force -ErrorAction SilentlyContinue
    Expand-Archive -LiteralPath $ZipPath -DestinationPath $release -Force
    # The zip holds one folder named for the version: step into it.
    $inner = @(Get-ChildItem -LiteralPath $release -Directory)
    if ($inner.Count -eq 1) { $release = $inner[0].FullName }
    Write-Host "Release unzipped to $release : $((Get-ChildItem $release | ForEach-Object Name) -join ', ')"
    $sums = Get-Content (Join-Path $release 'SHA256SUMS.txt') | Where-Object { $_ }
    $bad = @()
    foreach ($l in $sums) {
        $hash, $name = $l -split ' \*', 2
        if ((Get-FileHash (Join-Path $release $name) -Algorithm SHA256).Hash.ToLowerInvariant() -ne $hash) { $bad += $name }
    }
    Check 'the release folder matches its SHA256SUMS.txt' ($bad.Count -eq 0 -and $sums.Count -ge 8) ("{0} files; mismatches: {1}" -f $sums.Count, ($bad -join ','))

    # ── The fake world ─────────────────────────────────────────────────────
    $tsx = 'node_modules\tsx\dist\cli.mjs'
    [void](Start-Background 'fake-api' @($tsx, 'src\dev\fakeApiCli.ts', '--key', $apiKey, '--serial', $serial, '--port', '4400', '--control-port', '4401'))
    [void](Start-Background 'fake-device' @($tsx, 'src\dev\fakeDeviceCli.ts', '--serial', $serial, '--port', '4370', '--control-port', '4380'))
    $up = Wait-Until 'fake API and device' { (Get-FakeApiState) -and (Invoke-RestMethod -Uri 'http://127.0.0.1:4380/state' -TimeoutSec 5) } 60 1
    Check 'the fake API and fake device are up' ([bool]$up)
    if (-not $up) { throw 'fake API / device did not start' }

    # ── Install ────────────────────────────────────────────────────────────
    $env:WELLSURE_INSTALL_AGENT_KEY = $apiKey   # how an unattended install takes the key: never a command-line argument
    $code = Run-Script 'install.ps1' @('-Unattended', '-ApiUrl', 'http://localhost:4400', '-Device', "$serial,127.0.0.1", '-WaitSeconds', '150')
    Check 'install.ps1 finishes and says WORKING (exit 0)' ($code -eq 0)
    $svc = Get-Service -Name WellsureAgent -ErrorAction SilentlyContinue
    Check 'the WellsureAgent service exists and is running' ($svc -and $svc.Status -eq 'Running')
    Check 'it starts automatically with the PC' ((Get-CimInstance Win32_Service -Filter "Name='WellsureAgent'").StartMode -eq 'Auto')
    $p = Get-AgentProcess
    $owner = if ($p) { (Invoke-CimMethod -InputObject $p -MethodName GetOwner).User } else { '(no process)' }
    Check 'the agent runs as the dedicated account, not SYSTEM or an administrator' ($owner -eq 'WellsureAgentSvc') $owner
    $acct = Get-LocalUser -Name WellsureAgentSvc -ErrorAction SilentlyContinue
    $groups = @(Get-LocalGroup | Where-Object { Get-LocalGroupMember -Group $_ -Member WellsureAgentSvc -ErrorAction SilentlyContinue } | ForEach-Object Name)
    Check 'that account is in no group but Users' ($acct -and $groups.Count -eq 1 -and $groups[0] -eq (Get-LocalGroup -SID 'S-1-5-32-545').Name) ($groups -join ',')

    # Secrets: nowhere on disk, none left in the inbox, and the agent still authenticates (so it read the key from Credential Manager).
    $inbox = @(Get-ChildItem (Join-Path $data 'secrets-inbox') -Force -ErrorAction SilentlyContinue)
    Check 'the secrets inbox is empty (the service stored and deleted its contents)' ($inbox.Count -eq 0) "$($inbox.Count) left"
    $leak = @(Get-ChildItem $data -Recurse -File -Force -ErrorAction SilentlyContinue | Select-String -SimpleMatch $apiKey -List -ErrorAction SilentlyContinue)
    Check 'the agent key appears in no file in the data folder, nor in config.json' ($leak.Count -eq 0) (($leak | ForEach-Object Path) -join ',')
    $cmdline = if ($p) { $p.CommandLine } else { '' }
    Check 'the agent key is not on the process command line' ($cmdline -notmatch [regex]::Escape($apiKey))
    Check 'the heartbeat reached the fake API with the key from Credential Manager' ((Get-FakeApiState).heartbeats -ge 1)
    $log = Get-Content (Join-Path $data 'logs\agent.log') -Raw -ErrorAction SilentlyContinue
    Check 'the log says it stored the secret from the inbox, and never shows it' ($log -match 'stored a secret from the inbox' -and $log -notmatch [regex]::Escape($apiKey))
    $acl = (Get-Acl $data).Access | ForEach-Object { $_.IdentityReference.Value }
    Check 'the data folder is closed to ordinary users' (-not ($acl | Where-Object { $_ -match 'Users$|Everyone|Authenticated' })) ($acl -join '; ')

    # ── A punch gets through ───────────────────────────────────────────────
    Send-FakePunch '1006'
    $got = Wait-Until 'punch reaches the API' { (Get-StoredCount) -ge 1 } 90 2
    Check 'a punch on the device reaches the API' ([bool]$got) "$(Get-StoredCount) stored"

    # ── Killed: NSSM restarts it ───────────────────────────────────────────
    $before = (Get-AgentProcess).ProcessId
    Stop-Process -Id $before -Force
    $after = Wait-Until 'a new agent process' { $n = Get-AgentProcess; if ($n -and $n.ProcessId -ne $before) { $n.ProcessId } } 90 2
    Check 'killing the agent: the service starts a new one' ([bool]$after) "pid $before -> $after"
    Check 'and it takes over the dead one''s lock and is working again' ([bool](Wait-Until 'working after kill' { Test-Working } 90 3))

    # ── Restart ────────────────────────────────────────────────────────────
    Restart-Service -Name WellsureAgent
    Check 'restarting the service brings it back working' ([bool](Wait-Until 'working after restart' { Test-Working } 90 3))

    # ── API outage: punches wait, then drain ───────────────────────────────
    $stored0 = Get-StoredCount
    [void](Set-FakeApi '/mode' @{ mode = 'down' })
    Send-FakePunch '1007'; Start-Sleep -Seconds 2; Send-FakePunch '1008'
    $waiting = Wait-Until 'punches waiting on the PC' { (Get-AgentStatus) -match '\d+ punch\(es\) waiting' } 120 3
    Check 'with the API down, the punches wait on the PC (status says so)' ([bool]$waiting)
    [void](Set-FakeApi '/mode' @{ mode = 'ok' })
    $drained = Wait-Until 'outbox drains' { (Get-StoredCount) -ge ($stored0 + 2) } 240 3
    Check 'when the API is back the waiting punches all arrive' ([bool]$drained) "$(Get-StoredCount) stored, expected $($stored0 + 2)"

    # ── Event log: a drifting device clock ─────────────────────────────────
    Check 'the service start was written to the Windows event log (ID 1)' ((Get-AppEvents 1).Count -ge 1)
    Invoke-RestMethod -Method Post -Uri 'http://127.0.0.1:4380/clock' -Body (@{ offsetSeconds = 600 } | ConvertTo-Json) | Out-Null
    $drift = Wait-Until 'drift event' { (Get-AppEvents 30).Count -ge 1 } 150 3
    Check 'a device clock 10 minutes out is written to the event log (ID 30), by the service account' ([bool]$drift)
    Invoke-RestMethod -Method Post -Uri 'http://127.0.0.1:4380/clock' -Body (@{ offsetSeconds = 0 } | ConvertTo-Json) | Out-Null
    Check 'and when the clock is right again, ID 31' ([bool](Wait-Until 'recovered event' { (Get-AppEvents 31).Count -ge 1 } 150 3))

    # ── A rotated key, set with set-key.ps1 ────────────────────────────────
    $newKey = 'wsa_ci_new_' + [Guid]::NewGuid().ToString('N')
    [void](Set-FakeApi '/key' @{ key = $newKey })
    Check 'after the key is rotated the agent is no longer working (and says so)' ([bool](Wait-Until 'not working' { -not (Test-Working) } 90 3))
    Check 'the rejected key is in the event log (ID 50)' ([bool](Wait-Until 'key event' { (Get-AppEvents 50).Count -ge 1 } 90 3))
    $env:WELLSURE_INSTALL_AGENT_KEY = $newKey
    $code = Run-Script 'set-key.ps1' @('-WaitSeconds', '150')
    Check 'set-key.ps1 with the new key: working again' ($code -eq 0)

    # ── Graceful stop ──────────────────────────────────────────────────────
    Stop-Service -Name WellsureAgent
    $lock = Join-Path $data 'agent.lock'
    Check 'stopping the service is clean: the agent says it stopped and releases its lock' ((-not (Test-Path $lock)) -and ((Get-Content (Join-Path $data 'logs\agent.log') -Raw) -match 'agent stopped'))
    Start-Service -Name WellsureAgent
    [void](Wait-Until 'working' { Test-Working } 90 3)

    # ── Running install again, and upgrading ───────────────────────────────
    Remove-Item Env:WELLSURE_INSTALL_AGENT_KEY
    $code = Run-Script 'install.ps1' @('-Unattended', '-ApiUrl', 'http://localhost:4400', '-WaitSeconds', '150')
    Check 're-running install.ps1 (keeping the stored key and device) is safe and working' ($code -eq 0)
    $code = Run-Script 'upgrade.ps1' @('-Force', '-WaitSeconds', '150')
    Check 'upgrade.ps1 replaces the program and it is working' ($code -eq 0)
    Check 'the previous program is kept' (Test-Path "$exe.previous")

    # ── The device is only ever read ───────────────────────────────────────
    $dev = Invoke-RestMethod -Uri 'http://127.0.0.1:4380/state' -TimeoutSec 5
    Check 'the fake device received only read commands' (@($dev.violations).Count -eq 0) "$($dev.commands) commands"

    # ── Uninstall ──────────────────────────────────────────────────────────
    $code = Run-Script 'uninstall.ps1' @('-RemoveData', '-Force')
    Check 'uninstall.ps1 -RemoveData finishes (exit 0)' ($code -eq 0)
    Check 'no service is left' (-not (Get-Service -Name WellsureAgent -ErrorAction SilentlyContinue))
    Check 'no account is left' (-not (Get-LocalUser -Name WellsureAgentSvc -ErrorAction SilentlyContinue))
    Check 'no program folder, no data folder' ((-not (Test-Path $program)) -and (-not (Test-Path $data)))
    Check 'no event source is left' (-not [Diagnostics.EventLog]::SourceExists('WellsureAgent'))
}
catch {
    Check 'the test ran to the end without an unexpected error' $false $_.Exception.Message
    Write-Host $_.ScriptStackTrace
}
finally {
    foreach ($p in $procs) { try { Stop-Process -Id $p.Id -Force -ErrorAction SilentlyContinue } catch { } }
}

Write-Host ''
$failed = @($results | Where-Object { -not $_.Ok })
Write-Host ("{0} checks, {1} failed" -f $results.Count, $failed.Count)
if ($failed.Count) { $failed | ForEach-Object { Write-Host "  FAILED: $($_.Name)" }; exit 1 }
Write-Host 'ALL PASS'
