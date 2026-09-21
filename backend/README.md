# backend

The backend for the Wellsure HR Portal: REST API, Socket.IO real-time
server, and BullMQ workers/scheduler. Ships as a single Docker image with
one entrypoint that can start in `api`, `worker`, `scheduler` or `migrate`
mode (see spec §15.2.3), so staging/production run the same image in
different ECS services.

Standalone npm project (`npm install` inside this folder, or
`npm run install:all` from the repo root) — its own `package.json` and
`package-lock.json`. Imports shared code from `../shared` through the
`@shared/*` path alias (see `../shared/README.md`), resolved at runtime by
[`tsx`](https://github.com/privatenumber/tsx) and at type-check time via
`tsconfig.json`'s `paths`.

See `src/README.md` for the module layout. No real application code exists
yet beyond a placeholder entrypoint — this is Phase 0 scaffolding; the
Express app, Prisma setup and the full production Dockerfile are built in
Phase 0. `Dockerfile` here is a minimal build-verification image only (see
its header comment).

Full picture: `../docs/PROJECT_SPEC.md`.
