# biometric-agent

The LAN sync agent (Path B in spec §4.1) for offices where the biometric
device can't push to the internet (ADMS) or a static public IP isn't
available for Path A. Runs on an office PC, polls the on-prem device(s)
over the local network (port 4370), and forwards new punches to the
central API over HTTPS using an agent API key. Intended to run as a
Windows service.

Standalone npm project (`npm install` inside this folder, or
`npm run install:all` from the repo root) — its own `package.json` and
`package-lock.json`.

See `src/README.md` for the folder layout. No code exists yet beyond a
placeholder entrypoint — this is built in Phase 2, alongside the
device-push (`/iclock/*`) ingestion path in `backend/`.

Full picture: `../docs/PROJECT_SPEC.md`.
