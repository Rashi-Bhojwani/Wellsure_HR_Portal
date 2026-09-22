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

See `src/README.md` for the module layout. Phase 0 foundation is in place:
Express (helmet, cors, pino, central error handler, Zod validation
middleware), `/health` + `/ready`, graceful SIGTERM shutdown, env config
validated with Zod at boot, Prisma (connected, no business models yet),
Redis, a Socket.IO server with the Redis adapter, a BullMQ skeleton, and
the `api`/`worker`/`scheduler`/`migrate` entrypoint modes (`src/index.ts`).
No business logic yet — routes/modules under `src/modules/*` start in
Phase 1.

Full picture: `../docs/PROJECT_SPEC.md`.
