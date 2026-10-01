# biometric-agent

The LAN sync agent: the **primary** ingestion route (spec §4.1, route 1).
It runs on an office PC as a Windows service, polls the on-prem device(s)
over the local network (port 4370) every 30 seconds, and forwards new
punches to the central API over HTTPS using an agent API key. It keeps a
local cursor, retries with backoff, catches up after downtime, and sends
a heartbeat that feeds device health monitoring (spec §4.7).

This project also hosts the **punch simulator** (spec §4.6). The agent
talks to devices through a driver interface, and the simulator's driver
stands in for the real 4370 driver, so the same agent code is tested
long before the device is connected. Plan:
[`../docs/plans/PHASE_2.md`](../docs/plans/PHASE_2.md).

Standalone npm project (`npm install` inside this folder, or
`npm run install:all` from the repo root) — its own `package.json` and
`package-lock.json`.

See `src/README.md` for the folder layout. No code exists yet beyond a
placeholder entrypoint. This is built in Phase 2, alongside the
device-push (`/iclock/*`) and emergency-upload routes in `backend/`, all
three feeding one ingestion service.

Full picture: `../docs/PROJECT_SPEC.md`.
