# shared

Framework-agnostic TypeScript shared by `backend/` and `frontend/`: types,
Zod schemas, constants and pure utility functions. No business logic — just
the vocabulary the other projects build on, so validation and types stay in
sync between frontend and backend.

Plain `.ts` files, not an npm package — there's no `package.json` or build
step here. Each consumer imports it directly through the `@shared/*` path
alias:

- `backend/tsconfig.json` — `paths` maps `@shared/*` to `../shared/*`, and
  `backend/` runs on [`tsx`](https://github.com/privatenumber/tsx), which
  resolves that alias (and executes the `.ts` source directly) both in dev
  and in the Docker image — see `backend/Dockerfile`.
- `frontend/vite.config.ts` — `resolve.alias` maps `@shared` to `../shared`;
  `frontend/tsconfig.json` mirrors it in `paths` for type-checking.

See `index.ts` (the barrel — currently a placeholder) and `types/`,
`schemas/`, `constants/`, `utils/` below for the folder layout.
