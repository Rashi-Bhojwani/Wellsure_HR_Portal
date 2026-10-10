# biometric-agent — src

- `main.ts` — the commands: `run`, `diagnose`, `check-config`, `version`.
- `config/` — `config.json`, validated with Zod (HTTPS required except localhost).
- `secrets/` — where the agent key and comm keys come from (environment
  variables now; Windows Credential Manager in F2). Never `config.json`.
- `device/` — the `DeviceDriver` seam: `zk/` is our read-only ZKTeco protocol
  driver (TCP and UDP), `simulated.ts` the punch simulator's driver.
- `sync/` — the agent itself: cursor, outbox, sender, heartbeat, retention
  guard, clock offsets, state on disk.
- `api/` — the HTTPS client for the two agent endpoints.
- `dev/` — the fake device (tests and `npm run fake-device`); not part of the
  agent that runs on the office PC.
- `service/` — the Windows service wrapper (F2).
