<#
.SYNOPSIS
  Removes the Wellsure Agent service from this PC.

.DESCRIPTION
  Run as administrator. Stops and removes the service, the program, the event-log
  registration and the service account (with the passwords stored under it).
  The data folder (C:\ProgramData\Wellsure Agent) is KEPT unless you add
  -RemoveData, because it may hold punches the server has not received yet.
  Nothing on the attendance device is touched: the agent never changed it.
#>
[CmdletBinding()]
param([switch]$RemoveData, [switch]$Force)

. (Join-Path $PSScriptRoot 'lib.ps1')

try {
    Assert-Administrator
    $waiting = Get-WaitingBatchFiles
    if ($waiting -gt 0) {
        Write-Caution "$waiting batch file(s) of punches have not reached the server yet (each holds up to 1,000 punches)."
        if ($RemoveData -and -not $Force) {
            $answer = Read-Host 'Removing the data folder will delete them for good. Type DELETE to go ahead, anything else to stop'
            if ($answer -ne 'DELETE') { Write-Host 'Stopped. Nothing was changed.'; exit 1 }
        }
    }

    if (Get-AgentService) {
        Stop-AgentService
        if (Test-Path -LiteralPath (Get-Nssm)) { Invoke-Nssm remove $script:ServiceName confirm }
        else { [void](Invoke-Native (Join-Path $env:SystemRoot 'System32\sc.exe') @('delete', $script:ServiceName)) }
        Write-Done 'Service stopped and removed.'
    } else { Write-Note 'The service was not installed.' }

    Unregister-EventSource
    Write-Done 'Event log registration removed.'

    if (Test-Path -LiteralPath $script:ProgramDir) {
        # The running copy of this script may be inside it; only the program's own files go.
        Get-ChildItem -LiteralPath $script:ProgramDir -File -ErrorAction SilentlyContinue | Remove-Item -Force -ErrorAction SilentlyContinue
        Remove-Item -LiteralPath $script:ProgramDir -Force -ErrorAction SilentlyContinue
        Write-Done 'Program removed.'
    }

    Remove-ServiceAccount
    Write-Done "Account '$($script:AccountName)' and its stored passwords removed."

    if ($RemoveData) {
        Remove-Item -LiteralPath $script:DataDir -Recurse -Force -ErrorAction SilentlyContinue
        if (Test-Path -LiteralPath $script:DataDir) {
            # Something inside has odd permissions: take them back, then try once more.
            [void](Invoke-Native (Join-Path $env:SystemRoot 'System32\icacls.exe') @($script:DataDir, '/reset', '/T', '/C'))
            Remove-Item -LiteralPath $script:DataDir -Recurse -Force -ErrorAction SilentlyContinue
        }
        if (Test-Path -LiteralPath $script:DataDir) { throw "Could not remove $($script:DataDir). Delete it by hand (File Explorer, as an administrator)." }
        Write-Done 'Data folder removed.'
    } elseif (Test-Path -LiteralPath $script:DataDir) {
        Write-Note "Kept $($script:DataDir) (settings, the log, any waiting punches). Install again and it carries on from there; delete it yourself, or run this with -RemoveData, to get rid of it."
    }
    Write-Host ''
    Write-Host 'UNINSTALLED.' -ForegroundColor Green
    exit 0
}
catch {
    Write-Host ''
    Write-Failure $_.Exception.Message
    exit 1
}
