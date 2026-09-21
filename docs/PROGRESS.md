# Progress

Tracks delivery against the phases in `docs/PROJECT_SPEC.md` §12. Updated at
the end of every phase (tests green, migrations applied, seed updated,
committed).

## Status

| Phase | Description | Status |
|---|---|---|
| — | Initial project structure (this commit) | ✅ Done |
| 0 | Foundation | Not started |
| 1 | Auth, RBAC, org, employees | Not started |
| 1.5 | AWS staging environment | Not started |
| 2 | Biometric ingestion + attendance engine + real-time | Not started |
| 3 | Attendance administration | Not started |
| 4 | Leave | Not started |
| 5 | Homepage, dashboards, engage, notifications, documents, helpdesk, reports | Not started |
| 5.5 | AWS production environment and go-live hardening | Not started |
| 6 | Payroll | Not started |
| 7 | Tax & benefits | Not started |
| 8 | Extras | Not started |

## Log

### Initial project structure

- Created the pnpm monorepo: `apps/api`, `apps/web`, `apps/biometric-agent`,
  `packages/shared`, `infra/`.
- Created the full module/folder layout for `apps/api` (auth, employees,
  attendance, biometric, leave, engage, documents, admin, payroll, reports,
  notifications, helpdesk, realtime, integrations, jobs, middleware, lib,
  config) and `apps/web` (layouts, routes, employee pages, admin pages,
  auth pages, components, hooks, api client, sockets, theme), each folder
  documented with a short README placeholder.
- Added root tooling config: `package.json`, `pnpm-workspace.yaml`,
  `tsconfig.base.json` (+ per-package `tsconfig.json`), ESLint (flat
  config), Prettier, `.gitignore`, `.editorconfig`, `.env.example`,
  `docker-compose.yml` (postgres, redis, minio, mailpit).
- Added `docs/PROJECT_SPEC.md` (the product spec) and this file.
- No business logic, database schema, or UI screens yet — structure and
  configuration only, per instruction.

## Open questions

Carried from spec §14 — configurable, not guessed, until answered:

- [ ] Exact biometric device brand/model and whether ADMS push is supported.
- [ ] Exact PL eligibility boundary (credit on completing 3 months vs from
      next month) and pro-rating.
- [ ] Leave encashment formula and its tax treatment (to be confirmed by CA).
- [ ] Bank bulk-transfer file format (from bank).
- [ ] PT/LWF applicability per location's state.
- [ ] Actual headcount and full location list.
- [ ] Company domain name for the portal and whether DNS is on Route 53.
- [ ] Whether the office has a static public IP (needed for device push).
- [ ] AWS account structure (single account, two environments, or separate
      staging/production accounts).
