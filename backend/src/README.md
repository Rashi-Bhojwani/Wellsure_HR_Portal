# backend — src

Backend source root. `modules/` holds one folder per business domain (see each
module's README below); `realtime/`, `integrations/`, `jobs/`, `middleware/`,
`lib/` and `config/` are cross-cutting concerns shared by every module.

`index.ts` is currently a placeholder entrypoint that only proves the
`@shared/*` path alias resolves. Once implemented (starting Phase 1), each
module is expected to follow a consistent internal shape: `routes.ts`,
`controller.ts`, `service.ts`, `repository.ts`, `validators.ts` (Zod),
`types.ts` and a `__tests__/` folder.
