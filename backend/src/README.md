# backend — src

Backend source root. `modules/` holds one folder per business domain (see each
module's README below); `realtime/`, `integrations/`, `jobs/`, `middleware/`,
`lib/` and `config/` are cross-cutting concerns shared by every module.

`index.ts` is the real entrypoint — it dispatches to `modes/{api,worker,
scheduler,migrate}.ts` based on `APP_MODE`/argv. `app.ts` is the Express
app factory (helmet, cors, pino-http, `/health`, `/ready`, error handler);
module routes mount into it starting Phase 1. Once implemented, each
module under `modules/` is expected to follow a consistent internal
shape: `routes.ts`, `controller.ts`, `service.ts`, `repository.ts`,
`validators.ts` (Zod), `types.ts` and a `__tests__/` folder.
