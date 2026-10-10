# secrets

Where the agent key and each device's comm key come from. Never `config.json`.

- Linux (development, CI): `WELLSURE_AGENT_KEY`, `WELLSURE_COMMKEY_<SERIAL>`
  (`index.ts`).
- Windows: Credential Manager under the service's own account
  (`windowsCredentials.ts`; targets `WellsureAgent/agent-key` and
  `WellsureAgent/commkey/<serial>`), reached through Windows PowerShell so there
  is nothing native to ship. Written by `install.ps1` / `set-key.ps1` through
  `wellsure-agent secrets set` run as that account. The agent key is read again
  after a 401 (a rotated key needs no restart); comm keys are cached for a few
  minutes.
