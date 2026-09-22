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

See `src/README.md` for the folder layout. Phase 0 foundation and app
shell are in place: React Router, TanStack Query, an Ant Design theme
(light/dark), an API client with token-refresh interceptors ready, a
Socket.IO client wrapper, an error boundary, the Employee and HR/Admin
portal layouts (`src/layouts/`), config-driven routing
(`src/routes/*.config.tsx`), and static mock-ups for the highest-traffic
screens — everything else is a `PlaceholderPage` until its phase. See
`docs/UI_REFERENCE.md` for the screens themselves and `docs/PROGRESS.md`
for which pages are real vs placeholder.

Full picture: `../docs/PROJECT_SPEC.md`.
