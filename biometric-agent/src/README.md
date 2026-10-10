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
- `simulator/` — the punch simulator's command line (`npm run simulate`) and its
  parts: `routes.ts` (the three ways a punch reaches the server: the real agent
  reading a simulated device, ADMS push, the file upload), `serverApi.ts` (an
  HTTP client, and the refusal to run against anything that looks like
  production), `run.ts` (send a plan, then compare the server's days with it),
  `setup.ts`, `cli.ts`. The scenarios, the reference model and the planner it
  uses are in `shared/attendance/simulator/`. Development only; not part of the
  release.
