# biometric-agent

The LAN sync agent: the **primary** ingestion route (spec §4.1, route 1;
plan: [`../docs/plans/PHASE_2.md`](../docs/plans/PHASE_2.md), "P2-F build
design"). It runs on a PC inside the office network, reads the biometric
device(s) on port 4370 every 30 seconds, and sends new punches to the API
over HTTPS with an agent key.

**It only ever reads the device.** The driver can send nothing but read
commands: it never clears the log, sets the clock, pauses the device or
touches users (a test proves it). The device stays live, people punch on it
all day, and greytHR still reads it at month end.

What it does each cycle, per device:
1. connect (with the device's comm key if one is stored);
2. check the device reports the serial in `config.json` (a wrong IP must not
   put one branch's punches on another);
3. ask for the record count, and read the whole log only if it changed;
4. write new punches, as ATTLOG lines, to an on-disk outbox, **then** move its
   cursor (a position plus a fingerprint, never a timestamp);
5. read the device clock (drift is reported, never corrected).

A sender drains the outbox in order (backoff 5 s → 5 min), deleting a batch
only when the API acknowledges it; a heartbeat reports state and brings back
each device's settings ("Sync punches from", retention) and the thresholds.

## Commands

```bash
npm run agent -- run            --config <config.json>   # the agent
npm run agent -- status         --config <config.json>   # what is true right now, in sentences; exit 0 only if working
npm run agent -- diagnose       --config <config.json>   # read each device and print what it says; sends nothing
npm run agent -- check-config   --config <config.json>   # validate; say which secrets are present (never their values)
npm run agent -- quarantine     --config <config.json>   # punch batches the server refused (--export <folder>, --done)
npm run agent -- version
npm run fake-device -- --serial SIM-001 --port 4370      # development: a fake device speaking the real protocol
npm run fake-api -- --key wsa_test --serial SIM-001      # development and CI: a stand-in for the two agent endpoints
npm run build:exe                                        # the single executable (Node SEA), for this OS
npm test                                                 # the agent's tests
```

`config.json` (no secrets in it):

```json
{
  "apiUrl": "https://api.example.com",
  "pollSeconds": 30,
  "devices": [{ "serial": "AEXY225060969", "host": "192.168.29.213", "port": 4370 }]
}
```

Secrets: the agent key and each device's comm key. On Windows they live in
Credential Manager under the service's own account, handed over through a
locked-down inbox folder (`src/secrets/`). On Linux, for development and CI:
`WELLSURE_AGENT_KEY` and `WELLSURE_COMMKEY_<SERIAL>`.

## On the office PC (Windows)

[`INSTALL.md`](INSTALL.md) is the guide for whoever installs it (not a
developer): written to be followed on the phone. The release zip is built by
the CI job `agent-windows` (executable + NSSM + `windows/*.ps1` + `INSTALL.md`)
and attached to the run as an artifact.

| Folder | What |
|---|---|
| `src/` | The agent (`device/` the read-only driver, `sync/` cursor/outbox/agent, `service/` event log + `status`, `secrets/`) |
| `windows/` | `install.ps1`, `upgrade.ps1`, `uninstall.ps1`, `set-key.ps1`, `lib.ps1` (Windows PowerShell 5.1) |
| `packaging/` | Builds the executable, fetches NSSM against a pinned hash, assembles the release folder |
| `ci/` | The script the Windows CI job uses to install the zip and exercise the real service |

Running it locally against the dev API: `docs/GETTING_STARTED.md`, "Running
the sync agent locally".

Standalone npm project (own `package.json` and `package-lock.json`). It
imports `shared/` (the ATTLOG format and the agent ↔ API contract) through the
`@shared/*` alias, like `backend/` and `frontend/`.
