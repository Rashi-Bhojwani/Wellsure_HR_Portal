<#
.SYNOPSIS
  Gives the installed agent a new agent key (after the key was rotated in the app).

.DESCRIPTION
  Run as administrator. Asks for the new key (hidden), hands it to the service,
  restarts it, and waits until it is working. Rotating the key in the app
  (Admin Tools > Devices > Sync agents > Rotate key) stops the old one working at
  once, so run this straight away; punches wait safely on this PC meanwhile.
#>
[CmdletBinding()]
param([securestring]$AgentKey, [int]$WaitSeconds = 120)

. (Join-Path $PSScriptRoot 'lib.ps1')

try {
    Assert-Administrator
    if (-not (Get-AgentService)) { throw 'The agent is not installed on this PC. Run install.ps1 first.' }
    $plain = if ($AgentKey) { (ConvertFrom-SecureStringPlain $AgentKey).Trim() }
             elseif ($env:WELLSURE_INSTALL_AGENT_KEY) { $env:WELLSURE_INSTALL_AGENT_KEY.Trim() }
             else { Read-Secret 'The new agent key (hidden as you type)' }
    if (-not $plain) { throw 'No key given. Nothing was changed.' }
    Write-SecretToInbox 'agent-key.txt' $plain
    $plain = $null
    Write-Host 'Restarting the agent so it stores the new key...'
    Stop-AgentService
    Start-AgentService
    $result = Wait-AgentWorking $WaitSeconds
    $result.Output -split "`n" | ForEach-Object { Write-Host "  $_" }
    Write-Host ''
    if ($result.Working) { Write-Host 'WORKING with the new key.' -ForegroundColor Green; exit 0 }
    Write-Host 'NOT WORKING YET. If the lines above say the server is not answering, check the key was copied exactly (no spaces) and that it is the newest one.' -ForegroundColor Yellow
    exit 1
}
catch {
    Write-Host ''
    Write-Failure $_.Exception.Message
    exit 1
}
