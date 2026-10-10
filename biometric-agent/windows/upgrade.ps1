<#
.SYNOPSIS
  Upgrades the installed Wellsure Agent to the version in this folder.

.DESCRIPTION
  Run as administrator from the NEW release folder. Settings, passwords and any
  punches waiting to be sent are kept. The old program is kept as
  wellsure-agent.exe.previous, and put back automatically if the new one does
  not start working.
#>
[CmdletBinding()]
param([int]$WaitSeconds = 120, [switch]$Force)

. (Join-Path $PSScriptRoot 'lib.ps1')

try {
    Assert-Administrator
    if (-not (Get-AgentService)) { throw 'The agent is not installed on this PC. Run install.ps1 instead.' }
    $newExe = Join-Path $PSScriptRoot $script:ExeName
    if (-not (Test-Path -LiteralPath $newExe)) { throw "$($script:ExeName) is missing from this folder. Unzip the whole release and run upgrade.ps1 from inside it." }

    $installed = Get-AgentExe
    $oldVersion = (& $installed version 2>&1) -join ' '
    $newVersion = (& $newExe version 2>&1) -join ' '
    Write-Host "Installed: $oldVersion"
    Write-Host "This folder: $newVersion"
    if ($oldVersion -eq $newVersion -and -not $Force) {
        Write-Host 'Already on this version. Nothing to do (use -Force to reinstall it anyway).'
        exit 0
    }

    Write-Host 'Stopping the agent (it finishes what it is sending first)...'
    Stop-AgentService
    $previous = "$installed.previous"
    Copy-WithRetry $installed $previous
    Copy-WithRetry $newExe $installed
    $newNssm = Join-Path $PSScriptRoot 'nssm.exe'
    if (Test-Path -LiteralPath $newNssm) { Copy-WithRetry $newNssm (Get-Nssm) }
    Start-AgentService
    Write-Host "Started $newVersion. Waiting up to $WaitSeconds seconds for it to report in..."
    $result = Wait-AgentWorking $WaitSeconds
    $result.Output -split "`n" | ForEach-Object { Write-Host "  $_" }
    if ($result.Working) {
        Write-Host ''
        Write-Host "UPGRADED to $newVersion and WORKING." -ForegroundColor Green
        exit 0
    }

    Write-Host ''
    Write-Failure 'The new version did not start working. Putting the old one back.'
    Stop-AgentService
    Copy-WithRetry $previous $installed
    Start-AgentService
    $back = Wait-AgentWorking 60
    if ($back.Working) { Write-Host "Back on $oldVersion and WORKING. Tell whoever supports the agent what the lines above said." -ForegroundColor Yellow }
    else { Write-Failure "Could not get either version working. Run 'wellsure-agent.exe status' and ask for help." }
    exit 1
}
catch {
    Write-Host ''
    Write-Failure $_.Exception.Message
    exit 1
}
