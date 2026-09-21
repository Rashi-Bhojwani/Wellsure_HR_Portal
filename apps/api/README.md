# apps/api

The backend for the Wellsure HR Portal: REST API, Socket.IO real-time
server, and BullMQ workers/scheduler. Ships as a single Docker image with
one entrypoint that can start in `api`, `worker`, `scheduler` or `migrate`
mode (see spec §15.2.3), so staging/production run the same image in
different ECS services.

See `src/README.md` for the module layout. No code exists yet — this is
Phase 0 scaffolding; the Express app, Prisma setup and Dockerfile are built
in Phase 0.

Full picture: `../../docs/PROJECT_SPEC.md`.
