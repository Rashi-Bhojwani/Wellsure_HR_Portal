# frontend

The frontend for the Wellsure HR Portal: React + Vite + Ant Design, one app
serving both the Employee portal (ESS) and the HR/Admin portal behind
role-aware routing. Installs as a PWA (Phase 5).

Standalone npm project (`npm install` inside this folder, or
`npm run install:all` from the repo root) — its own `package.json` and
`package-lock.json`. Imports shared code from `../shared` through the
`@shared/*` path alias (see `../shared/README.md`), wired in
`vite.config.ts` (`resolve.alias`) and mirrored in `tsconfig.json`
(`paths`) for type-checking.

See `src/README.md` for the folder layout. No real UI exists yet beyond a
placeholder entrypoint (`index.html` + `src/main.ts`) — this is Phase 0
scaffolding; React, Ant Design, routing and theming are added in Phase 0.

Full picture: `../docs/PROJECT_SPEC.md`.
