# Progress

Tracks delivery against the phases in `docs/PROJECT_SPEC.md` §12. Updated at
the end of every phase (tests green, migrations applied, seed updated,
committed).

## Status

| Phase | Description | Status |
|---|---|---|
| — | Initial project structure (this commit) | ✅ Done |
| 0 | Foundation | ✅ Done |
| 1 | Auth, RBAC, org, employees | Done — data layer, authentication, org masters, employee management, import center, exports, audit log viewer and system settings all built and tested. Users & Roles admin screen deliberately deferred (built in Phase 5 commit E1 as Roles & Permissions). **Correction (2026-09-30): role assignment does not exist anywhere in the product** — Add Employee always assigns plain `EMPLOYEE` and nothing else assigns roles; an earlier version of this row claimed otherwise. Both are Phase 5 commit E1 ([`docs/plans/PHASE_5.md`](plans/PHASE_5.md)). |
| 1.5 | AWS staging environment | Not started |
| 2 | Biometric ingestion + attendance engine + real-time | In progress — plan approved ([`docs/plans/PHASE_2.md`](plans/PHASE_2.md)); P2-A (attendance configuration, capture choice) done; P2-B → P2-I to follow |
| 3 | Attendance administration | Not started |
| 4 | Leave | ✅ Done — schema/ledger/accrual/comp-off/jobs (commit A), employee self-service (commit B), admin management incl. manager Review/Employee Leave/Leave Granter/Leave Types & Policies/Holiday Calendars (commit C), and Year End Process/Leave Recalculator/Workforce Overview dashboard/real Socket.IO (commit D) all built and tested. Holidays simplified to company-wide (HR-confirmed 2026-09-28) between commits C and D. |
| 5 | Homepage, dashboards, engage, notifications, documents, helpdesk, reports | ✅ Done (2026-10-03) — commits A, B, C, D, D2, E1, E1.1, E2, E3, F and G (mobile bottom bar + PWA), plus interim commits. Full review — every screen and URL, every permission, what's stubbed, open questions, risks for Phase 6 — in [`docs/plans/PHASE_5_REVIEW.md`](plans/PHASE_5_REVIEW.md). Plan and as-built notes per commit in [`docs/plans/PHASE_5.md`](plans/PHASE_5.md). |
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

### Switched from a pnpm monorepo to a plain folder structure

- Moved (via `git mv`, history preserved) `apps/api` → `backend`,
  `apps/web` → `frontend`, `apps/biometric-agent` → `biometric-agent`, and
  `packages/shared/src/*` → `shared/*`. Removed the now-empty `apps/` and
  `packages/` folders.
- Removed all pnpm workspace tooling: `pnpm-workspace.yaml`, the
  monorepo-wide root `eslint.config.mjs`, and the `workspace:*`
  dependency on `@wellsure/shared` from every project. Switched to npm —
  `backend`, `frontend`, `biometric-agent` and `infra` each now have their
  own `package.json`, `package-lock.json` and `eslint.config.mjs`.
- `shared/` is now plain TypeScript (no `package.json`/build step of its
  own), imported through the `@shared/*` path alias: `backend/tsconfig.json`
  and `frontend/tsconfig.json` map it via `paths`, `frontend/vite.config.ts`
  mirrors it via `resolve.alias`, and `backend` resolves it at runtime via
  `tsx`. Each of `backend/src/index.ts`, `frontend/src/main.ts` and
  `infra/bin/app.ts` is a placeholder entrypoint (import from `shared/` in
  the first two) that exists so `tsc`/`eslint`/`vite` have real, passing
  input rather than empty folders.
- Rewrote the root `package.json` down to convenience scripts only:
  `install:all`, `dev` (backend + frontend via `concurrently`), `lint`,
  `typecheck`, `test` — each delegating to the relevant project(s) via
  `npm run <script> --prefix <dir>`.
- Added `backend/Dockerfile` — a minimal, intentionally non-production
  image (see its header comment) that builds from the **repo root** so
  `shared/` is included in the build context; proves the container installs
  and starts with the `@shared/*` alias resolving. The full Phase 0
  production image (Chromium, non-root user, four entrypoint modes) is
  still Phase 0 work.
- Updated `README.md`, this file, `docs/PROJECT_SPEC.md` and `CLAUDE.md` to
  describe the new layout and drop every `apps/`/`packages/`/pnpm
  reference.
- Verified `npm run install:all`, `dev`, `lint`, `typecheck`, `test`, and
  `docker build -f backend/Dockerfile .` all succeed against the new
  layout (see the commit for exact output).
- No new features or business logic — structure/tooling only, per
  instruction.

### Added UI reference

- Added `docs/UI_REFERENCE.md`: a written description of greytHR's
  current employee-portal and HR/admin-portal screens (layout, navigation,
  what's on each page), captured so our portal feels familiar to
  employees and HR who already know greytHR. Reference only — our own
  branding, colours and Ant Design components, never greytHR's logos,
  illustrations, quotes or text.
- Linked it from `README.md` and `CLAUDE.md` alongside `PROJECT_SPEC.md`.
- No UI built yet — this informs the Phase 0 shell and the full screens
  built in Phase 5 (see spec §12); still waiting on those phases in order.

### Phase 0 — Foundation + application shell

**Backend foundation** (`backend/`) — all built and verified live against
real Postgres/Redis (docker-compose):

- Express app (`src/app.ts`): helmet, cors (env-driven origin), pino-http
  request logging, `/health` (liveness) and `/ready` (checks Prisma +
  Redis, returns 503 if either is down), central error handler
  (`src/middleware/errorHandler.ts`, handles `ZodError` → 400, `HttpError`
  → its status, else 500) and a Zod `validate()` middleware factory
  (`src/middleware/validate.ts`) ready for Phase 1 routes.
- `src/config/env.ts`: every env var validated with Zod at boot, fails
  fast (`process.exit(1)`) on invalid config.
- Prisma (`backend/prisma/schema.prisma`, Prisma 6.19.3 — deliberately
  not the 7.x line, which mandates driver adapters and a new generator;
  see the note below): connected, no business models yet — `/ready`
  proves connectivity with `SELECT 1`.
- Redis (`src/lib/redis.ts`) — plain client + a `createBullConnection()`
  helper (BullMQ needs `maxRetriesPerRequest: null`).
- Socket.IO (`src/realtime/socket.ts`) with the `@socket.io/redis-adapter`
  — handshake auth is a placeholder until Phase 1 sessions exist.
- BullMQ skeleton (`src/jobs/`): a `system-ping` queue/worker proves the
  queue → worker → Redis path end to end (enqueued and processed live
  during verification).
- One entrypoint, four modes (`src/index.ts` → `src/modes/{api,worker,
  scheduler,migrate}.ts`), each with graceful SIGTERM/SIGINT shutdown —
  all four verified live (api serves `/health`+`/ready`+Socket.IO and
  shuts down cleanly; worker processes a real job and shuts down cleanly;
  scheduler starts/logs/shuts down cleanly; migrate runs
  `prisma migrate deploy` and exits 0).
  **Bug found and fixed:** the Docker `CMD` originally ran `npm run
  start`, but `npm run` does not reliably forward `SIGTERM` to the child
  process it spawns — confirmed live (the child kept running after the
  `npm` parent was killed). `Dockerfile`'s `CMD` now invokes
  `node_modules/.bin/tsx` directly so the Node process is PID 1.

**Frontend foundation + shell** (`frontend/`):

- React Router (config-driven — see below), TanStack Query
  (`QueryClientProvider` in `App.tsx`), an Ant Design theme with
  light/dark tokens and a toggle (`src/theme/`), an API client with
  access/refresh-token interceptor plumbing ready
  (`src/api/client.ts` — no real endpoints to call yet), a Socket.IO
  client wrapper (`src/sockets/SocketProvider.tsx`, opt-in via `enabled`,
  off by default), and a React error boundary
  (`src/components/common/ErrorBoundary.tsx`).
- Login page (`src/pages/auth/login/`): Employee Code + password, Forgot
  password link, logo placeholder — UI only, no real auth.
- Employee portal layout (`src/layouts/EmployeeLayout.tsx`) matching
  `docs/UI_REFERENCE.md` §1.0: sidebar (logo, profile block, full menu in
  the listed order, grouped/nested), header (page title, Quick Links,
  notification bell, logout), footer; becomes a `Drawer` under the `md`
  breakpoint.
- HR/Admin portal layout (`src/layouts/AdminLayout.tsx`) matching §2.0:
  app switcher panel, per-app top-bar dropdown menus, breadcrumb, Payroll
  Month selector + employee filter in `AdminFiltersContext`
  (`src/context/`), dismissible help strip component
  (`src/components/common/HelpStrip.tsx`), search/settings/avatar/logout.
  Payroll and Admin Tools apps added per spec §7, with menus built from
  §7.5/§7.8.
- Menu/route config (`src/routes/employeeMenu.config.tsx`,
  `adminMenu.config.tsx`): single source of truth per portal — the route
  tree (`src/routes/router.tsx`) is generated from these, rendering a
  registered `element` or `PlaceholderPage` (with its `phase`) otherwise.
  Every employee menu item and every admin app/menu item exists as a
  route today.
- Real static mock-ups (fake data, no backend calls): Employee Home
  (§1.1), Engage (§1.2), Payslips (§1.3), Leave Balances (§1.4),
  Attendance Info incl. month calendar + status colours + stats cards +
  day detail panel (§1.5); Admin Welcome + Dashboard (4 Recharts charts)
  (§2.1–2.2), Workforce Management Overview (§2.3).
- Reusable components (`src/components/`): `StatCard`,
  `StatusCalendarCell`, `MaskedAmount`, `EmptyState`, `ChartCard`,
  `HelpStrip`, `PlaceholderPage`, `ErrorBoundary`.
- Dev-only role switcher (`src/components/common/DevRoleSwitcher.tsx`,
  gated on `import.meta.env.DEV`): jumps between the employee portal, the
  admin portal, and toggles light/dark — no real login required to
  preview either portal.
- Responsive: sidebar → Drawer, admin top bar wraps, all mock-up pages
  use responsive `Row`/`Col` grids — checked at 1440×900 and 390×844.
- Chart colours use the dataviz skill's validated palette
  (`src/theme/chartPalette.ts`, light/dark categorical + sequential +
  diverging steps, run through `validate_palette.js` before use), not
  arbitrary colours.

**CI** (`.github/workflows/ci.yml`): install → lint → typecheck → test in
one job, `docker build -f backend/Dockerfile .` in a second.

**Vite / audit advisory:** upgraded `vite` 5→8 and `@vitejs/plugin-react`
→6 (the latest `@vitejs/plugin-react` already requires Vite 8 as a peer,
so this is just "use current versions," not a forced jump) — `npm audit`
on `frontend` is now clean, resolving the advisory flagged in the
previous session.

**Known follow-ups, not fixed this phase:**
- `npm audit` on `backend` flags a high-severity `deepmerge-ts` issue via
  `prisma`'s `@prisma/config` (dev-only CLI dependency, not
  `@prisma/client`; not yet patched upstream even in `prisma@latest` at
  time of writing). Left as-is rather than downgrading prisma to dodge it
  — dev-tooling-only, no untrusted-input path.
- Ant Design's `List` component is deprecated in favour of a new
  virtualised `Listy` component with a materially different API (not a
  prop-rename). `List` still works and isn't removed until AntD's next
  major, so it's kept for now (used on both Home pages); migrating to
  `Listy` is a small, isolated follow-up whenever convenient.
- The production-hardening items from spec Phase 0 (non-root Docker user,
  Chromium for Puppeteer, multi-stage build) are intentionally deferred —
  `Dockerfile` runs all four entrypoint modes correctly today but isn't
  hardened yet.

**Verification note:** `docker build` was confirmed working end-to-end in
this session (image builds, `@shared/*` resolves inside the container,
the `tsx`-direct `CMD` receives and handles `SIGTERM` correctly) but
repeated attempts in the sandbox this was built in were flaky — this
sandbox's outbound network goes through a local TLS-intercepting proxy
that containers can't reach without workarounds, and `npm install` inside
the container intermittently failed against it (a well-known, documented
limitation of that sandbox, unrelated to this repo). Re-run
`docker build -f backend/Dockerfile .` in a normal environment to
confirm; nothing sandbox-specific is in the committed Dockerfile.

### Replaced docker-compose with local services

Local development no longer uses Docker at all — `docker-compose.yml`
(Postgres, Redis, MinIO, Mailpit) is deleted. `backend/Dockerfile` and
CI's Docker build step are unchanged: that image is still what runs on
ECS Fargate and what CI verifies.

- **Postgres 16 + Redis 7** — installed and run directly on the machine.
  `.env.example`'s `DATABASE_URL`/`REDIS_URL` already pointed at
  `localhost`, so only their comments changed (docker-compose → local
  install). Verified live: created the `wellsure`/`wellsure_hr` role and
  database matching `.env.example`, ran the backend against them, hit
  `/ready` (`{"db":true,"redis":true}`).
- **Storage**: built the `StorageService` interface for real (it was a
  README placeholder before) — `LocalStorageService`
  (`STORAGE_DRIVER=local`, the new default) writes objects under
  `STORAGE_LOCAL_DIR` (default `.storage/`, gitignored) with a sidecar
  `<key>.meta.json` for content type, and simulates signed URLs with an
  HMAC over `key:expiry` verified by a new `/dev/storage` route
  (`backend/src/integrations/storage/devRoute.ts`, mounted in `app.ts`).
  `S3StorageService` (`STORAGE_DRIVER=s3`) is the real AWS implementation
  via `@aws-sdk/client-s3` + `@aws-sdk/s3-request-presigner`, unchanged
  in shape from what MinIO stood in for. Verified live end to end: put an
  object, fetched its signed URL over HTTP (right bytes, right
  `Content-Type`), confirmed a tampered signature and an expired URL both
  get `403`, and a valid signature for a deleted object gets `404`.
- **Mail**: built the `MailService` interface for real too —
  `ConsoleMailService` (`MAIL_DRIVER=console`, the new default) logs the
  message and writes a real `.eml` file to `MAIL_DEV_DIR` (default
  `.mail/`, gitignored) instead of sending anything. `SesMailService`
  (`MAIL_DRIVER=ses`) is the real AWS implementation via
  `@aws-sdk/client-ses`. Verified live: sent a message, confirmed the
  console log and a valid, readable `.eml` file.
- **`npm run check:services`** (`backend/scripts/check-services.ts`,
  delegated from the root): checks Postgres via `prisma.$queryRaw`
  and Redis via `ioredis` ping, prints reachable/unreachable for each
  with the connection string's password masked, and — on failure —
  OS-specific (`darwin`/`linux`/`win32`) install/start instructions.
  Exits non-zero if either is unreachable. Verified both branches live
  (services down → clear instructions + exit 1; services up → exit 0).
- **CI** (`.github/workflows/ci.yml`): added `postgres:16-alpine` and
  `redis:7-alpine` as GitHub Actions service containers on the existing
  job (health-checked, same `wellsure`/`wellsure_hr` credentials as
  local dev), wired `DATABASE_URL`/`REDIS_URL` to them, and added a
  "Check services" step running `npm run check:services` — proves the
  script (and the services) work generically, not just "absent locally".
  Needs nothing from a contributor's machine.
- **Docs**: rewrote `README.md`'s "Getting started" into a "Local setup"
  section with step-by-step Postgres/Redis install + DB/user creation
  for macOS, Linux and Windows (WSL2 or Memurai for Redis, since Redis
  has no official Windows build), plus a separate "Docker (AWS
  deployment image only)" section so it's clear the Dockerfile didn't
  go away, it just isn't part of the dev loop. Updated `CLAUDE.md`'s
  Commands section and `docs/PROJECT_SPEC.md` §12/§15.3 to match (kept
  as historical record: the "Initial project structure" and "Switched
  from a pnpm monorepo" log entries above still say docker-compose/MinIO/
  Mailpit because that's what was true when they were written).

### App shell UI corrections (pre-Phase 1)

Five visual bugs in the Phase 0 shell, found against `docs/UI_REFERENCE.md`
and fixed before starting Phase 1. Verified live (Playwright) at both
1440×900 and 390×844 on both portals.

- **Attendance Info calendar** (`AttendanceInfoPage.tsx`) — the day grid
  used AntD `Row`/`Col` with `span={24 / 7}` (3.43, not a valid integer
  `Col` span), so days wrapped compactly instead of aligning under
  Sun–Sat. Replaced with CSS Grid (`repeat(7, 1fr)`) for both the weekday
  header and the day cells; `StatusCalendarCell` itself is unchanged.
- **Payslip card double/triple masking** (`HomePage.tsx`,
  `MaskedAmount.tsx`) — each of Gross Pay/Deduction/Net Pay rendered its
  own "Show Salary" toggle. Made `MaskedAmount` a controlled/presentational
  component (`revealed` prop, no internal state or button — confirmed it
  had no other call sites) and lifted one `salaryRevealed` toggle to the
  Payslip card, next to "Download", matching UI_REFERENCE.md §1.1's "Links:
  Download and Show Salary".
- **"Type of leaves taken" donut ring** (`OverviewPage.tsx`, admin
  Workforce Management) — the ring wasn't a broken layout, it was Recharts
  3.x's default Pie entrance animation: `.recharts-shape` groups existed
  but were empty until ~1–3s after mount (confirmed by inspecting the live
  DOM — sectors had no `d` path at 500ms, full correct paths at 3s). Set
  `isAnimationActive={false}` on the `Pie` so the ring renders immediately.
- **Attendance day-detail metrics table overflow** — the 10-column session
  table used `scroll={{ x: true }}`, which didn't constrain the table to
  its Card's width, so it overflowed past the card (and near the viewport
  edge) instead of scrolling. Wrapped it in a `div` with `overflowX: auto`
  and changed `scroll` to `{ x: "max-content" }`; confirmed via computed
  geometry that the table now scrolls within a container bounded to the
  card (429px client width, 970px content width) rather than escaping it.
- **Employee Home cards clipped at default window height** — Row 1's
  Review/Track cards were stretched to match each other's height (AntD
  equal-height row behaviour) with more padding than their content needed
  (`Empty` at `24px 0`), pushing the Payslip/Quick Access row just past a
  900px-tall viewport (measured: 902px bottom vs. 900px viewport). Added
  an opt-in `compact` prop to `EmptyState` (`8px 0` padding) used only for
  Review/Track, and tightened the page's outer `Space`/`Row` gutters
  (16→12). Re-measured: Payslip/Quick Access now end at 890px, comfortably
  inside a 900px viewport.

### Phase 1, commit A — data layer (schema, migrations, encryption, seed)

First of several Phase 1 commits, scoped to the database foundation only —
no routes/screens yet. Built after two rounds of schema review (Prisma
model list, then a City/Location correction) captured in this session.

- **`backend/prisma/schema.prisma`** — all 26 Phase 1 models (identity/
  auth, org masters including the new `City`/`Location` two-level branch
  model, employees). Business dates use `@db.Date`, true instants use
  `DateTime`. `EmployeeJobHistory`/`EmployeeBankAccount`/
  `EmployeeNameHistory` are effective-dated; `DeviceUserMapping` decouples
  the permanent Employee Code from the reusable biometric device user ID
  (Phase 2 groundwork — see spec §3/§11). Encrypted fields
  (`EmployeeStatutory`, `EmployeeBankAccount`) carry a last-4 plaintext
  column and an HMAC blind-index hash alongside the ciphertext, so grids
  never decrypt to render a mask and duplicates can be detected without it.
- **Migrations** — two: the initial schema, and a small additive follow-up
  that removed an unused `UserStatus.LOCKED` enum value found redundant
  with `lockedUntil`/`failedLoginAttempts` while verifying the seed (kept
  as two migrations rather than folded together, since the fix was found
  after the first had already been applied and seeded locally). Four
  partial unique indexes Prisma can't express in `schema.prisma` were
  hand-added to the generated SQL: one open `EmployeeJobHistory` row per
  employee, one open `EmployeeBankAccount` row per employee, no two
  employees sharing an *active* bank account, and one active
  `DeviceUserMapping` per device user ID — plus the same "one open row"
  pattern for `EmployeeNameHistory`.
- **`backend/src/lib/`** — `encryption.ts` (AES-256-GCM, key derived from
  `KMS_FIELD_KEY_ID`; swaps for real KMS envelope encryption in Phase 1.5
  behind the same function signatures), `fieldHash.ts` (HMAC-SHA256 blind
  index keyed by a separate `FIELD_HASH_PEPPER`, plus PAN/Aadhaar/account-
  number normalisers), `redact.ts` (masks known-sensitive keys to their
  last 4 in any JSON value), `audit.ts` (`writeAuditLog()` — the only
  function permitted to insert an `audit_logs` row, redacts automatically).
  `env.ts` now validates both new env vars and refuses to boot if they're
  equal to each other.
- **`backend/prisma/seed.ts`** — Company; 2 cities (Ajmer, and a
  placeholder "Delhi" for the Panchsheel branches — see the open question
  below) with 7 branches (3 Ajmer, 3 Panchsheel, 1 deliberately misspelled
  "C-10 Panchsheeel" as the Organisation Setup merge-flow fixture);
  generic departments/designations/grades/cost-centres; 7 roles and 19
  Phase 1 permissions (`role.manage`/`settings.manage` are SUPER_ADMIN-
  only per spec §2's explicit callout; `HR_EXECUTIVE` gets no
  `employee.bank.*`); 30 employees (Super Admin "Aditi Sharma" — code
  1000 — continuing the placeholder name already used throughout the
  Phase 0 UI; HR Admin; 4 managers; the rest individual contributors) with
  realistic Indian names, real encrypted/hashed statutory and bank data,
  and a deliberate mix of account states (INVITED, ACTIVE, one locked, two
  separated) including a **device-ID reuse fixture**: separated employee
  1090 freeing that device user ID for the collision/suggestion flow to be
  tested against once Add Employee exists. `npm run db:seed` wraps
  `prisma migrate reset --force` (wipe + reapply migrations + reseed);
  verified by running migrations from empty and the seed script directly
  against a freshly-migrated empty database (30/30 employees, all
  relations, encrypted-field byte lengths and hash lengths all correct).
  The full destructive `db:seed` path itself (`prisma migrate reset
  --force`) needed the user's explicit consent to run — Prisma's own
  AI-agent safety gate blocks that command outright otherwise — and was
  verified end to end with that consent in commit A2 below.
- **Incidental fixes**: `README.md`'s local-setup `CREATE ROLE` command
  was missing `CREATEDB`, which every contributor would need anyway for
  Prisma's `migrate dev` shadow database — not just this sandbox.

### Phase 1, commit A2 — RBAC middleware, permission resolution, data-scope builder

Closes a gap: commit A's own scope included the authorization layer, not
just the schema — built now, with unit tests, before any route depends on
it, per explicit instruction to prove it first.

- **Dev-only destructive-action guard**: `src/lib/devGuard.ts`
  (`assertDevelopmentEnvironment()`) refuses to proceed unless
  `APP_ENV === "development"`, independent of Prisma's own interactive
  confirmation. Wired into both `prisma/seed.ts` and a new
  `scripts/reset-db.ts` (`npm run db:seed` now runs through this wrapper
  instead of calling `prisma migrate reset --force` directly) — verified
  it actually refuses under `APP_ENV=production`, then verified the full
  `npm run db:seed` path end to end under `APP_ENV=development` with the
  user's explicit consent (database wiped, both migrations reapplied from
  scratch, 30 employees reseeded correctly).
- **`shared/constants/permissions.ts` / `roles.ts`** — the Phase 1
  permission-key list and role-code list, now a single source of truth
  instead of living only inside `prisma/seed.ts` (which now imports
  `PERMISSION_KEYS` from here instead of redeclaring it) — the frontend
  will import the same constants when menu configs get permission-gated.
- **`src/lib/permissions.ts`** — `resolveUserPermissions(userId)` (union
  of every held role's permissions, spec §2) and `resolveUserRoleCodes()`.
- **`src/lib/dataScope.ts`** — `getTeamEmployeeIds(managerId)` (a
  `WITH RECURSIVE` CTE over the *current* `employee_job_history` rows,
  since Prisma has no recursive-query API, walking direct and indirect
  reports) and `buildEmployeeScopeWhere(employeeId, scope)` producing the
  Prisma `where` fragment for SELF/TEAM/ALL.
- **`src/middleware/rbac.ts`** + **`types.ts`** — `requireAuth`/
  `requirePermission(key)` Express middleware reading `req.user` (the
  `AuthenticatedUser` shape the JWT auth middleware in commit B will
  populate); follows Phase 0's existing `HttpError`/centralized
  `errorHandler` convention rather than writing responses directly.
- **Vitest** set up for `backend/` for the first time (Phase 0 named it as
  a Phase 0 target but never installed it) — pinned to `vitest@^4.1.11`
  rather than the latest 5.x, which requires `@types/node@^22`; backend
  is pinned to `@types/node@^20` for Node 20 per CLAUDE.md, so newer
  vitest wouldn't resolve cleanly. 13 tests across 3 files (permission
  union/empty-set, team-hierarchy walking at multiple levels, SELF/TEAM/
  ALL where-clause shape, RBAC middleware auth/permission checks),
  self-contained fixtures (not dependent on `prisma/seed.ts`'s demo data,
  since CI never runs the seed) with verified cleanup — confirmed zero
  leftover rows after a full run.
- **CI gap closed**: `.github/workflows/ci.yml` never applied migrations
  before running tests — would have failed the moment any test needed a
  real table. Added a "Migrate" step (`npm run db:migrate`, i.e.
  `prisma migrate deploy` — non-interactive, additive-only, not the
  destructive reset path) between "Check services" and "Test".

### Phase 1, commit B — authentication and session management

The complete auth flow: backend (JWT + refresh rotation, TOTP 2FA,
password/invitation flows, rate limiting, audit logging, email) and
frontend (real login through Account & Security, replacing the dev role
switcher). Every action is audit-logged; see the click-through steps and
seeded test accounts below for manual verification.

**Backend** (`backend/src/modules/auth/`, `backend/src/middleware/`):

- **Login** (`POST /api/auth/login`) — Employee Code + password (spec §3).
  Every failure path (unknown code, wrong password) returns the same
  generic message; only "account locked" and "not yet activated" get
  distinct messages, since neither leaks anything an Employee Code
  (an openly-known internal identifier) doesn't already. 5 failed attempts
  locks the account for 15 minutes (`User.failedLoginAttempts`/
  `lockedUntil`, both configurable via `SystemSetting`).
- **Sessions** — access tokens are short-lived stateless JWTs
  (`src/lib/jwt.ts`); refresh tokens are opaque random strings, tracked in
  `refresh_tokens`, delivered as an httpOnly/sameSite=strict cookie scoped
  to `/api/auth` (never touched by JS). `POST /refresh` rotates the token
  and detects reuse: presenting an already-*rotated* token revokes every
  session for that user (spec §9) — found and fixed a real bug here during
  testing, where a plain `/logout` (revoked, never rotated) was
  indistinguishable from a rotated-away token and would have triggered the
  same false "compromise" cascade; only `revokedAt` **and**
  `replacedByTokenId` together now count as reuse. `GET /sessions`,
  `DELETE /sessions/:id` (IDOR-checked — 404s on another user's session id
  rather than revealing it exists), `POST /logout`, `POST /logout-all` are
  all in place.
- **Deactivation takes effect immediately, not at token expiry** — the
  `authenticate` middleware re-checks `User.status === ACTIVE` against the
  database on every single request, not just the JWT's own signature/
  expiry, so a deactivated/suspended account loses access within one
  request, not up to 15 minutes later. Directly tested (deactivate mid-
  session, same still-valid token immediately rejected).
- **Invitation accept** (`GET`/`POST /invitations/:token`) — validates,
  sets the password, activates the account, sends a welcome email, and (per
  spec §3.5) logs the employee straight in — through the same 2FA-required
  check as a normal login.
- **Forgot/reset password** — `POST /forgot-password` takes an Employee
  Code (not email, since `personalEmail` isn't unique) and returns an
  **identical response, padded to a ~200ms floor**, whether or not the
  code exists or the account can receive a reset — verified with an
  automated timing test alongside the response-body-equality test.
  `POST /reset-password/:token` is single-use and revokes every existing
  session for the account.
- **TOTP 2FA** (`src/modules/auth/totp.ts`, via `otplib`) — setup
  (QR code + manual-entry secret, secret stored AES-256-GCM encrypted),
  verify (issues 10 single-use backup codes, hashed with SHA-256 — high-
  entropy random codes, not passwords, so argon2's deliberate slowness
  isn't needed), disable (requires password + a current code), backup-code
  regeneration. Enforced at login for roles in `SystemSetting`
  `auth.require2faRoles` (default: `SUPER_ADMIN`, `HR_ADMIN`,
  `HR_EXECUTIVE`, `PAYROLL_ADMIN`) via a two-step challenge: login returns
  a short-lived `challengeToken` (`requires_totp_setup` if not yet
  enrolled, `requires_totp` if it is) instead of real tokens, and
  `/2fa/setup`+`/2fa/verify` accept that token in place of a session for
  the mid-login case, completing the login once verified. Self-disable is
  blocked with `TOTP_REQUIRED_BY_ROLE` if the account's role still
  requires it — only a Super Admin can force a reset (`employees/:id/2fa/
  reset`, employees module, not yet built).
- **Privacy notice** (`POST /privacy-notice/accept`, spec §9's DPDP
  requirement) — tracked on `User.privacyNoticeAcceptedAt`, surfaced on
  `/me`.
- **Rate limiting** (`src/middleware/rateLimit.ts`) — Redis-backed,
  IP-scoped, limits read from `SystemSetting` (falling back to a
  hardcoded default if unseeded) on login, forgot-password, invite-accept,
  reset-password and 2FA-verify. Deliberately separate from the per-
  account lockout above — this stops the *endpoint* being hammered (code
  enumeration, email spam), lockout stops one *account* being brute-forced.
- **Audit logging** — every action above writes through `writeAuditLog()`
  (commit A2); verified live that the full login → 2FA setup → verify →
  refresh → reuse-detected → lockout sequence produces a matching,
  correctly-ordered audit trail.
- **Email** (`src/modules/auth/emails.ts`, via the existing `MailService`)
  — invitation, password reset, welcome; verified `.eml` files land in
  `.mail/` with working links.
- Added `cookie-parser`, `jsonwebtoken`, `otplib`, `qrcode`; added
  `JWT_ACCESS_SECRET`/`JWT_REFRESH_SECRET`/`JWT_ACCESS_TTL`/
  `JWT_REFRESH_TTL` to `env.ts` (already in `.env.example`, never
  previously wired up) with the same "must differ" refine as the
  encryption key/pepper pair.
- **46 tests** (`src/modules/auth/__tests__/`) — login (success, generic-
  failure parity, lockout, 2FA setup/challenge branching), refresh
  rotation + reuse detection, logout/logout-all/session IDOR, forgot/
  reset-password including the timing-safety test, the deactivation-
  window test, TOTP disable/backup-codes/role-required blocking, privacy
  notice, invitation accept. `vitest.config.ts` now runs test files
  sequentially (`fileParallelism: false`) — found this was necessary
  when two files racing on the same `SystemSetting` row produced flaky
  failures; self-contained per-test fixtures, still independent of
  `prisma/seed.ts`.

**Frontend** (`frontend/src/pages/auth/`, `pages/account-security/`,
`hooks/useAuth.tsx`, `api/`):

- `hooks/useAuth.tsx` — `AuthProvider`/`useAuth`, silent-refresh bootstrap
  on load (access tokens are memory-only per spec §9, never
  `localStorage`, so a page reload needs the httpOnly refresh cookie to
  recover a session), `login`/`logout`/`hasPermission`/`hasRole`.
  `api/client.ts`'s 401-retry interceptor (a Phase 0 placeholder) now
  calls the real refresh endpoint.
- Real screens: `LoginPage` (rewritten — real errors, 2FA branching),
  `SetPasswordPage`, `ForgotPasswordPage`, `ResetPasswordPage`,
  `TotpChallengePage`, `TotpSetupPage` (QR + manual secret + backup-code
  reveal), `AccountSecurityPage` (2FA status/setup/disable/backup-code
  regeneration, active sessions with revoke, log out everywhere) — wired
  to the existing gear icon in both `EmployeeLayout` and `AdminLayout`,
  which (along with the sidebar's greeting and the logout icon) now show
  the real signed-in user instead of the hardcoded "Hi Aditi".
- `DevRoleSwitcher` → `DevQuickLogin`: still dev-only
  (`import.meta.env.DEV`), but now goes through real login with the
  seeded demo accounts' known password rather than just navigating past
  auth — Phase 1's explicit "keep a dev-only quick login" ask.
- `RequireAuth` route guard on every `/app` and `/admin` route.
- Verified live in a real browser (Playwright): full login for a non-2FA
  employee, the complete 2FA enrolment flow (QR → code → backup codes →
  landed on the right portal), the already-enrolled 2FA challenge, Account
  & Security showing real session data, and forgot-password's identical
  response screen.

### Interim fixes (between commit B and commit C)

- **`.env` was never actually loaded on a clean shell.** `env.ts`'s
  `safeParse(process.env)` silently depended on `@prisma/client`'s own
  internal `.env` loading, which only ran when something imported
  `@prisma/client` *before* `env.ts` evaluated — true for
  `scripts/check-services.ts` (imports `lib/prisma.ts` first) but not for
  `scripts/reset-db.ts`, or even the main server entrypoint `src/index.ts`
  itself. A completely clean checkout (`.env` present, no exported shell
  vars — exactly what `docs/GETTING_STARTED.md` documents) would fail
  `npm run dev` outright with "Invalid environment configuration". Fixed
  by loading `.env` explicitly and unconditionally at the top of `env.ts`
  via `process.loadEnvFile()`, guarded by `existsSync` so staging/
  production (env injected via ECS task env, no `.env` file) are
  unaffected. Also fixed `check-services.ts`'s password-masking regex,
  which partially leaked a password containing a literal `@`.
- Dropped the now-deprecated `baseUrl` compiler option from all three
  `tsconfig.json` files (TS 6+ deprecates it ahead of removal in TS 7.0;
  `paths` has resolved relative to each tsconfig's own directory without
  it since TS 4.1, so this is a no-op behaviourally).
- **2FA enforcement temporarily disabled by default** —
  `auth.require2faRoles`' fallback default flipped to `[]` (was
  `["SUPER_ADMIN","HR_ADMIN","HR_EXECUTIVE","PAYROLL_ADMIN"]`) so manual
  testing of the admin/HR flows isn't gated behind a TOTP challenge on
  every login. Reversible via the `SystemSetting` row (or restoring the
  code default) once the surrounding auth flow work settles; the setup/
  verify/disable/backup-code endpoints, UI and their tests are untouched.

### Phase 1, commit C — org masters and employee management

Builds entirely on commit A's schema — City/Location/Department/
Designation/Grade/CostCentre, Employee + its satellite tables,
`ProfileChangeRequest`, `Separation` and `DeviceUserMapping` already
existed, so this commit is the service/route/UI layer plus one small
additive migration (`SavedView`, for the All Employees grid's saved
views — personal, per-user grid preferences, not effective-dated or
audited since it's UI convenience state, not business data).

**Policy correction found while scoping the IDOR tests**: commit A's
seed gave `HR_EXECUTIVE` `employee.statutory.view`/`.edit` alongside
`employee.view`. Spec §2 says HR_EXECUTIVE gets "no salary or bank
data" — re-reviewing against that bar, PAN/Aadhaar/UAN are held to the
same standard here, so `HR_EXECUTIVE` now excludes statutory access too,
same as bank. Both are proven by an explicit test (see below).

**Backend — org masters** (`backend/src/modules/org/`, mounted at
`/api/org`): City/Location(+merge/isActive/delete-blocked-when-
referenced)/Department/Designation/Grade/CostCentre CRUD. Reads need only
an authenticated session (every role needs these lists for dropdowns/
filters); mutations require `org.manage`. Location merge repoints every
`EmployeeJobHistory` row from the source branch to the target inside a
transaction, then deletes the (now unreferenced) source — one call, one
audit entry, matching spec §7.8's "merge-near-duplicates" ask. Delete on
any of the six resources is blocked (409, not a raw FK error) when
still referenced, checked proactively for a clear message.

**Backend — employee module** (`backend/src/modules/employee/`, mounted
at `/api/employees`):

- **Add Employee** (spec §3) — `deviceCode.ts` implements the exact
  collision flow: raw Device User ID collides with an existing Employee
  Code (any status, since codes are never reused) → the wizard is told
  who held it and when they separated, plus the next free `<id>-2`,
  `-3`, … suggestion. `POST /` creates Employee + User(INVITED) +
  Personal + NameHistory + JobHistory + DeviceUserMapping (+ optional
  Statutory/BankAccount) in one transaction, then issues the invitation
  (a new `createInvitation`/`resendInvitation` pair added to the auth
  module, which had the accept/validate side from commit B but nothing
  that actually created one — Add Employee is the first caller).
- **Profile + reveal + history** — `getEmployeeProfile` omits the bank/
  statutory sections entirely (not just masked) when the caller lacks
  `employee.bank.view`/`.statutory.view`; `getMyProfile` (View My Info)
  always includes the caller's *own* masked bank/statutory regardless of
  those permissions (spec §6 vs. spec §7.2 are different access paths —
  "can I see my own masked info" vs. "can I see someone else's"), but
  full reveal stays permission-gated even for your own record, so plain
  `EMPLOYEE` accounts never get an unmasked view through this UI.
  Job/name/bank history timelines; bank history additionally gated
  behind `employee.bank.view`.
- **Effective-dated updates** — job/bank/name changes close the current
  row (`effectiveTo` set) and open a new one in the same transaction;
  statutory is a direct in-place update (not effective-dated — matches
  the schema, `EmployeeStatutory` has no effective-dating columns).
- **Profile change requests** — employee submits (bank/statutory changes
  are encrypted into their `xxxEncrypted`/`xxxLast4`/`xxxHash` shape,
  base64-packed for JSON storage, *before* being written to
  `changesJson` — never the raw PAN/account number — then still run
  through the shared `redact()` as defense in depth); HR approves
  (applies the already-encrypted change) or rejects.
- **Separations** — initiate/cancel; `processScheduledSeparations()` (a
  new daily BullMQ repeatable job, `jobs/scheduler.ts` +
  `jobs/worker.ts`, `upsertJobScheduler` — this BullMQ version deprecated
  `Queue.add(..., {repeat})`) completes every `INITIATED` separation
  whose last working date has passed (computed against Asia/Kolkata
  "today", not the server's own clock — see the timezone comment in
  `separations.ts`): separates the employee, deactivates login, revokes
  every session, closes the open job-history row and frees the device
  user ID (`DeviceUserMapping.validTo`) for reuse. Matches spec §3.8.
- **All Employees grid** (`grid.ts`) — search/filter/paginate, sorted/
  paginated in memory (acceptable at current headcount; revisit if the
  still-open actual-headcount question lands much higher), Excel export
  via `exceljs` (last-4/masked columns only, never live decryption — the
  sensitive columns require `employee.bank.view`/`.statutory.view` and
  are separately audit-logged as `employee.export.sensitive`), and
  personal saved views (`SavedView`).

**A real IDOR bug found by this commit's own tests, then fixed**:
`findScopedEmployee`'s original `{ id: employeeId, ...scopeWhere }` — a
manager viewing an out-of-team employee got **200**, not the expected
404, because `scopeWhere` (TEAM/SELF) also produces an `id` key, and a
later spread key silently overwrites an earlier one in a plain object
literal. The check degenerated into "does *any* employee in my scope
exist" instead of "is *this* employee in my scope" — always true once
the scope is non-empty. Fixed with an explicit `AND: [{ id: employeeId
}, scopeWhere]` (the same pattern already used correctly in `grid.ts`),
robust regardless of `scopeWhere`'s own shape.

**Also found**: Express 5 makes `req.query` a getter-only accessor
(computed fresh from `req.url`); `validate.ts`'s `req.query = ...` threw
"Cannot set property query which has only a getter" the moment any
route actually used `validate({ query })` — nothing had, until this
commit's grid/export/device-code-check endpoints. Fixed with
`Object.defineProperty` instead of direct assignment.

**Tests** (`backend/src/modules/{org,employee}/__tests__/`, 40 new —
86 total across the backend): org CRUD + delete-blocked + merge;
Add Employee create + duplicate-code 409 + the full device-ID collision/
suggestion sequence (`-2`, then `-3`); data-scope SELF/TEAM/ALL via
`/:id` (this is what caught the IDOR bug above); **`HR_EXECUTIVE`
blocked from both the bank and statutory reveal endpoints, and from the
bank history endpoint, and from seeing either section on the profile
response**, while `HR_ADMIN` sees masked sections and can reveal
(audit-logged) — the explicitly-requested test; effective-dated job/
bank/name update round-trips (old row closed, new row open, response
never carries a raw account number); **direct-Prisma-insert rejection
of a second open row** for `EmployeeJobHistory`, `EmployeeNameHistory`
and `EmployeeBankAccount`, a second employee holding the same *active*
bank account, and a second active `DeviceUserMapping` for one device
user ID — all five hand-added partial unique indexes from commit A's
migration, proven directly; change-request submit/approve (verified the
applied bank row, not just the 204)/reject/self-approval-blocked;
separation initiate → not-immediately-deactivated → cancel, and
`processScheduledSeparations()` end to end (login blocked afterward).
Two real test-fixture bugs surfaced and fixed along the way: a fixed
fake PAN/Aadhaar/account number collided across fixtures the moment a
test created more than one full employee (now a monotonic per-process
counter); and several files' shared literal role codes (`MANAGER`,
`HR_ADMIN`, `HR_EXECUTIVE` — needed because `resolveDataScope` matches
literal strings, so a randomized `TEST_*` code silently fell through to
SELF scope regardless of intent) needed a `revokePermissions` helper so
a negative test doesn't inherit a stale grant from an earlier local
seed run.

**Frontend** (`frontend/src/pages/admin/{organisation,employee}/`,
`frontend/src/pages/employee/profile/`): Organisation Setup (tabbed:
Cities/Branches/Departments/Designations/Grades/Cost Centres, branch
merge with a confirming modal, active/inactive toggle); Add Employee
(5-step wizard — Official/Personal/Statutory/Bank/Review, live device-
ID collision check with the suggested-code banner, Statutory/Bank
steps skippable); All Employees (search/filter/column chooser/saved
views/Excel export gated behind a sensitive-data confirmation modal
when the viewer can see bank or statutory columns); Employee Profile
(Official/Personal/Statutory/Bank/History tabs, reveal buttons,
effective-dated job/bank change modals, Initiate Separation); Change
Requests (HR approve/reject queue); Separations (list + cancel); View
My Info (masked statutory/bank always visible on your own record,
direct edit for address/emergency contact, "Request a change" for
everything else, which opens the change-request flow above). New menu
entries: Employee app gains "Change Requests"; the employee-profile
detail route (`/admin/employee/profile/:id`) is reached by clicking a
grid/list row rather than through the menu, same pattern as the
existing account-security route.

Verified live in a real browser (Playwright, 1440×900): Organisation
Setup across all six tabs (including the merge-flow fixture's near-
duplicate C-10 Panchsheel branches), the full Add Employee wizard
submitted end to end (device ID → pre-filled code → org-master
dropdowns → personal details → skipped optional steps → review → save,
landing on the new employee's real profile with the confirmation
toast), All Employees grid, Employee Profile's Official/Statutory/Bank/
History tabs, Separations (empty state), Change Requests (empty
state), and View My Info's Official tab as a plain employee account.

**`npm audit`**: `exceljs` (new, for the Excel export) pulls a
moderate-severity `uuid <11.1.1` advisory (missing bounds check when a
caller-supplied buffer is passed — `exceljs` never does that, so this
specific code path isn't reachable through it) via a transitive
dependency. Left as-is alongside the pre-existing `deepmerge-ts`/
`@prisma/config` flag from Phase 0 (dev-tooling-only) rather than
downgrading `exceljs` to a materially older, less-maintained major
version to dodge an unreachable advisory.

**Not done this commit** (deliberately out of the agreed scope): bulk
import (Excel/CSV), letter generation, resend-invite has a backend
endpoint but no UI button yet, Users & Roles admin screen, and the
audit log viewer — all still placeholder routes for later.

**Destructive reset still pending user consent**: extensive local
testing (this commit's own manual verification plus everything since
the last full reseed) has left the dev database with test-fixture
garbage (stray `TEST-*`/`MERGE-TGT-*` locations, a few employees created
by wizard verification, HR_EXECUTIVE still carrying its now-removed
statutory grant on the *existing* role row — `grantPermissions` only
ever adds). A single `npm run db:seed` clears all of it and gets every
account back onto `HR_EXECUTIVE`'s corrected permission set. Per the
standing agreement, this needs the user's fresh, explicit consent each
time (Prisma's own AI-agent safety gate blocks it outright otherwise) —
asked for, not yet run as of this commit.

### Phase 1, commit D — import center, exports, audit log and settings

The last commit of Phase 1: one additive migration (`ImportBatch`/
`ImportStagingRow`, no changes to any existing table) plus the service/
route/UI layer for the four remaining Admin Tools screens spec §7.8/§10
call for.

**Backend — Import Center** (`backend/src/modules/import/`, mounted at
`/api/import`, gated by `import.manage`): upload → parse → validate →
stage → (fix and re-upload as needed) → commit-in-one-transaction, per
spec §10, for four datasets — `org-masters` (Location/Department/
Designation/Grade/CostCentre, one flat sheet with a `type` column),
`employees` (reuses the wizard's own `createEmployee` logic, refactored
into a `createEmployeeInTx(tx, …)` core so every row in a batch commits
inside one shared transaction rather than each getting its own — Prisma
doesn't support nesting `$transaction` calls), `statutory` and `bank`
(both key off an already-existing `employeeCode`, so org-masters and
employees must be imported first, matching the migration's natural
order).

- **Validation**: duplicate employee codes and device IDs (both within
  the file and against the DB), PAN/IFSC/email/mobile/Aadhaar format
  (reusing the exact same regexes the Add Employee wizard's Zod schemas
  use — extracted to named exports so the two can never drift apart),
  unknown department/location/designation/grade/cost-centre/manager
  references, and a Levenshtein-distance near-duplicate check (new
  `lib/levenshtein.ts`) on location and department names — a warning,
  never blocking, with a pointer to Organisation Setup's merge tool.
  Errors block that row from committing (and block the *whole batch*
  from committing at all until fixed and re-uploaded); warnings don't.
- **Sensitive data never touches the staging table as plaintext**: PAN/
  Aadhaar/account-number are transformed into the same encrypted/last4/
  hash shape the live tables use *at validation time*, before the row is
  ever written to `ImportStagingRow.data` — the identical base64-pack
  pattern `employee/changeRequests.ts` already used for
  `ProfileChangeRequest.changesJson`, now factored out to
  `lib/bytesJson.ts` and shared by both. The downloadable error report
  and every API response echo only the last-4-masked value, so "never
  echo full account numbers" holds even for a row that *failed*
  validation.
- **Bank dataset** additionally requires `employee.bank.edit` (checked at
  both upload and commit — commit checks it in the service, not route
  middleware, since `/batches/:id/commit` has no `:dataset` URL segment
  to key a static check off of) and a typed confirmation (`"IMPORT BANK
  DATA"`, checked server-side, not just disabled in the UI until typed).
- **Never auto-invites** (spec §10: "invitations are sent in batches,
  HR-triggered, never automatically on import") — `createEmployee` gained
  an `options.sendInvitation` flag (default `true`, unchanged for the
  wizard); the import commit path passes `false`, so a bulk import
  creates `INVITED`-status accounts with no email sent; HR sends each
  one's invite from the existing per-employee "Resend Invite" action.
- **Reconciliation report** (`GET /api/import/reconciliation`) — active
  headcount by branch and by department, computed live off
  `employee_job_history`'s current rows; a tab on the same Import Center
  page rather than a separate Reports screen, matching where spec §10
  places it.

**Backend — Audit Log viewer** (`backend/src/modules/auditLog/`, mounted
at `/api/audit-logs`, gated by `audit.view`): one `GET /`, filterable by
actor (name/code search, joined through `User → Employee →
NameHistory`), entity type, action (substring) and a date range,
paginated. Deliberately GET-only — no PATCH or DELETE route exists
anywhere for `audit_logs`, matching its append-only design.

**Backend — System Settings** (`backend/src/modules/settings/`, mounted
at `/api/settings`, gated by the (new) `settings.manage` permission,
added to `HR_ADMIN_PERMS`): a fixed catalog, not a generic key-value
editor — lockout attempts/duration, password minimum length, invitation
link validity (hours), which roles require 2FA, and the five auth
rate-limit buckets (login/2FA-verify/invite-accept/forgot-password/
reset-password). Every field was already read via `getSetting()` **except
two that turned out to be silently unused**: `auth.invitationTtlHours`
(the invitation TTL was hardcoded to 48h) and `auth.passwordMinLength`
(only the Zod schema's own fixed `.min(8)` applied, nothing read a
setting). Both are now wired to their real enforcement points —
`createInvitation` reads the configured TTL, and a new
`assertPasswordMeetsPolicy()` check runs in both `acceptInvitation` and
`resetPassword` on top of (not instead of) the Zod floor, so the setting
can raise the bar but never lower it below 8. Proven with a test that
sets a 9-character password (passes the Zod floor) and confirms it's
still rejected once the configured minimum is 12.

**A real, pre-existing bug found and fixed while adding the export audit
log's column set** (see below): `exportQuerySchema`'s `includeSensitive:
z.coerce.boolean()` parsed the *string* `"false"` as `true` — `Boolean()`
treats any non-empty string as truthy, and axios serialises a JS `false`
query param as the literal string `"false"`. That meant the All
Employees grid's plain "Export" button — which explicitly sends
`includeSensitive: false` — could silently produce a sensitive export
(bank/PAN/Aadhaar last-4 columns) for anyone holding bank or statutory
view permission, entirely bypassing the typed sensitive-data confirmation
modal that flag exists to gate. Fixed with `z.stringbool()` (zod 4's
purpose-built string-to-boolean parser). New regression test file
(`employee/__tests__/export.test.ts`, previously untested despite
existing since commit C) proves both directions and the permission
boundary. Also added: the export's audit log entry now records the
actual exported `columns` (header list), not just `rowCount`/
`includeSensitive`, as asked.

**Seed**: explicit `SystemSetting` rows for every Phase 1 key (so a fresh
install shows real, seeded values rather than only code fallbacks), one
already-`COMMITTED` `ImportBatch` fixture, and a handful of realistic
`AuditLog` entries spanning several action types and roles — the seed
script itself writes via raw Prisma calls (not through the service
layer's `writeAuditLog()`), so without this the audit log would
otherwise start completely empty on a fresh install.

**Tests** (24 new — 113 total across the backend): Import Center
end-to-end per dataset (org-masters unknown-city block + near-duplicate
warning + exact-duplicate rejection; employees duplicate-code-within-file
+ never-auto-invites; statutory unknown-employee + invalid-PAN + the
full response never contains the raw bad PAN string; bank's
permission-then-confirmation gating in that order, the exact confirm
phrase required, and the partial-unique-index guarantee — exactly one
open `EmployeeBankAccount` row survives a commit); Audit Log's
permission gate, action filter, an empty-date-range filter, and asserting
the PATCH/DELETE routes 404; Settings' permission gate, a partial update
leaving other fields untouched, the audit-log entry it writes, and the
two enforcement-wiring tests described above; the export bug's
regression tests. **The full onboarding end-to-end test** (spec-named
explicitly): HR calls the real `POST /api/employees`, the invitation
email is read back out of a real `.eml` file `ConsoleMailService` wrote
to `.mail/` (not a shortcut token), the new hire calls the real accept-
invitation and login endpoints, then — since a freshly-onboarded
`EMPLOYEE` role holds *no* admin permissions at all (`employee.view`
included) — proves they see their own data only via `GET /api/employees/
me` (self-service, no permission required) while the admin grid and
admin per-employee-profile route both 403 regardless of whose id is
requested, including their own.

**Also found and fixed along the way**: `login.test.ts`'s "2FA-required
roles" describe block assumed no `auth.require2faRoles` `SystemSetting`
row existed yet (`if (!settings) create(...)`) — true on an empty DB,
false from now on since this commit's own seed changes populate that key
by default. Rewrote it to snapshot whatever's already there (a real
seeded value or nothing) and restore exactly that afterward, rather than
assuming and unconditionally deleting. `settings.test.ts` needed the same
discipline for `auth.lockout`, discovered when its own test run's leftover
value broke `login.test.ts`'s unrelated lockout test on the next full
suite run — every `SystemSetting` key is a global singleton shared by the
whole test run, not something one file can mutate without restoring.

**Frontend** (`frontend/src/pages/admin/{import,auditLog,settings}/`):
Import Center (tabs per dataset, drag-and-drop upload via antd's
`Upload.Dragger`, per-row error/warning table, error-report download,
commit button disabled until the batch is error-free — and, for bank,
until the exact confirmation phrase is typed — plus a reconciliation-
report tab and an upload-history table per dataset); Audit Log (actor/
entity/action/date-range filters, paginated table, a detail modal showing
the redacted before/after JSON); System Settings (one form, sectioned by
concern, saves via a single `PUT`). Both the existing "Bulk Import" menu
item under Employee and "Data Import/Export" under Admin Tools now point
at the same Import Center page — same feature, no reason for one of the
two entry points to stay a dead placeholder.

Verified live in a real browser (Playwright, 1500×1200) against the
already-seeded dev database: Import Center's Org Masters and Employees
tabs end to end (template download → upload → validate → commit →
"Recent uploads" history showing the new row), the Reconciliation Report
tab, Audit Log's row list and action filter plus opening a detail modal,
and System Settings loading real seeded values, saving a change, and the
change surviving a page reload.

**`npm audit`**: unchanged from commit C's note — `multer` (new, for
Import Center's file upload) introduced no new advisories.

**Not done this commit** (still deliberately out of scope, unchanged from
commit C's note): Users & Roles admin screen (permission/role management
UI — **correction 2026-09-30: this originally said role assignment "already exists" in Add Employee; it does not, Add Employee only ever assigns `EMPLOYEE`, see Phase 5 commit E1**), letter
generation. Both are still placeholder routes.

**Phase 1 is now complete.**

### Phase 1 follow-up — router fix: two apps' base paths fell through to a stub

**Bug reported by the user**: opening the Employee app in the admin portal
(`/admin/employee`) showed `PlaceholderPage` ("Employee — Coming in Phase
1") instead of the All Employees grid, even though every item under it
was real. Same for `/admin/admin-tools`.

**Root cause**: `adminMenu.config.tsx`'s `router.tsx` builds each app's
own base route (e.g. `/admin/employee`) from that app's own top-level
`element` field — but the "Employee" and "Admin Tools" app entries never
had one (only their individual menu items did), and both still carried a
stale `phase: "Phase 1"` marker left over from before commit C/D wired up
their children. So the app's own base path always rendered
`PlaceholderPage`, regardless of how many real screens existed one level
down. Confirmed live (Playwright, seeded Super Admin): both
`/admin/employee` and `/admin/admin-tools` showed the stub before the fix.

**Fix**: `frontend/src/routes/resolveMenuRoutes.tsx` (new) is now the
single source of truth for turning both menu configs into route elements,
used by both `router.tsx` (the real route tree) and a new test (below) —
so they can't drift apart. An app whose own `element` is unset now falls
back to a `<Navigate>` redirect to its first sub-item that has a real
`element`, in menu-declaration order, instead of a stub — so
`/admin/employee` redirects to `/admin/employee/all` and
`/admin/admin-tools` redirects to `/admin/admin-tools/organisation`. The
stale `phase: "Phase 1"` markers on both app entries were removed. No
other Phase 1 route was affected — every other built screen already had
its own `element` wired up correctly.

**Guard added**: `frontend/src/routes/__tests__/routes.test.tsx` — asserts
every route without a `phase` marker (the codebase's own "this is
delivered" convention, see `adminMenu.config.tsx`'s file comment) resolves
to something other than `PlaceholderPage`, computed structurally via a
`kind: "real" | "redirect" | "placeholder"` field rather than by rendering
a page component (which would call React hooks outside a render tree).
Verified with a deliberate mutation test: temporarily reintroducing the
bug made the test fail with a specific, readable message naming both
broken routes; reverting made it pass again. This is the first frontend
test in the repo — added `vitest` (matching the backend's version) plus
`frontend/vitest.config.ts`; `frontend/package.json`'s `test` script now
actually runs it instead of a no-op placeholder.

Two screens are static Phase 0 UI-shell mock-ups (Employee Home, Engage,
Payslips, Leave Balances, Attendance Info, Admin Welcome/Dashboard,
Workforce Overview — see Phase 0's log entry above) and were never part
of this bug: they already had real `element`s with no `phase` marker by
design, since Phase 0 deliberately built their static/fake-data UI ahead
of the phase that gives them a real backend.

### Phase 4, commit A — leave schema, ledger, accrual, comp-off, jobs (foundation)

Built ahead of Phase 2 (biometric/attendance) per the user's explicit
instruction — the device model still isn't known (spec §14), which blocks
Phase 2, not Leave. Zero UI/routes in this commit; a full written plan
(schema, endpoints, screens, the Phase 2 seam, test plan) was reviewed and
revised before any code — see the two "MUST FIX"/"SHOULD FIX" review
rounds below for what changed between the first draft and what actually
got built.

**Schema** (`backend/prisma/schema.prisma`, migration
`20260928132056_add_leave_phase4`): 9 new models — `LeaveType`,
`LeavePolicy` (one row per type, typed columns rather than 5 polymorphic
tables — exactly 5 fixed types, most columns null for a type that doesn't
use them), `LeaveLedger` (spec §5.3's source of truth — balance for
(employee, leaveType) as of any date is `SUM(days) WHERE entry_date <=
asOfDate`, full history; `leave_year` is a reporting tag only, never a
balance-computation boundary), `LeaveRequest`, `Holiday` /
`RestrictedHoliday` (both per-branch, spec §7.8), `CompOffCredit` (FIFO
lot tracking — see below), `YearEndRun` / `YearEndRunItem`. 7 new enums.
2 hand-added partial unique indexes: one ACCRUAL row per
(employee, leave type, `accrual_month`) — the credited month, not the
date the job happened to run, is the real idempotency key, since a
retried or manually re-triggered run must still resolve to the same
key; and one COMMITTED `YearEndRun` per `leave_year`.

**A real naming-convention bug found and fixed before this ever reached a
review**: `LeaveType.isPaid`/`.allowHalfDay`/`.isActive` were missing
`@map` to snake_case, unlike every other field in this schema — caught by
inspecting the seeded columns directly (`\d leave_types` showed
`"isPaid"` instead of `is_paid`), fixed by regenerating the migration
before it was ever applied anywhere that mattered.

**Two review rounds on the plan itself, before any code** — the user
reviewed the schema/endpoint/screen/seam/test plan and sent back 4 "MUST
FIX" correctness/concurrency issues and 4 "SHOULD FIX" hardenings, all
incorporated into what was actually built:

1. **Accrual idempotency key was wrong.** A unique index on
   `(employee_id, leave_type_id, entry_date)` only prevented a duplicate
   on the exact same calendar date — a job retried a day later, or a
   manual re-trigger, would have produced a second accrual for the same
   month. Fixed by adding `accrual_month` (the credited month's 1st) as
   the real key.
2. **Year-end cutoff semantics needed to be explicit**, specifically what
   happens to a January accrual posted while a December run is still in
   `PREVIEW`. Resolved: a year-end run for year Y computes each
   employee's closing balance as `SUM(days) WHERE entryDate <=
   'Y-12-31'` — an explicit cutoff, never the `leave_year` tag — so a
   `(Y+1)-01-01` accrual is excluded from Y's encashment purely by
   falling outside that window, with no special-case code needed. Proven
   directly by a test (`yearEnd.test.ts`, commit D), not just asserted in
   the design.
3. **Comp-off's original design let ordinary leave silently erode a
   lot's coverage** with no record of which lot was spent, so expiry had
   to defensively re-check the aggregate ledger balance and could leave a
   genuinely-spent lot "AVAILABLE forever." Redesigned around FIFO lot
   tracking: `CompOffCredit.remainingDays`, decremented oldest-first at
   approval, one `LeaveLedger` `CONSUMED` row written per lot touched
   (via the new `compOffCreditId` FK) so cancellation-reversal restores
   exactly the right lots and the daily expiry job needs no defensive
   balance check at all — it simplified the expiry job versus the
   original proposal, not just fixed a bug.
4. **Overlap/balance checks needed to be concurrency-safe.** Two
   approvals arriving at once could both pass a check-then-write race and
   both succeed. Fixed with `withEmployeeLeaveLock()` — every leave-
   mutating operation for an employee acquires that employee's row lock
   (`SELECT ... FOR UPDATE`) first, inside the same transaction as the
   write. Proven with a real concurrency test: two simultaneous comp-off
   consumption attempts against a balance that can satisfy only one —
   exactly one succeeds, the ledger never goes negative.
5. **(Should-fix) Locked-period hook** — `AttendanceLeaveSink` gained
   `isPeriodLocked(employeeId, date)` now, so Phase 2's finalised-month
   lock (spec §4.5) has somewhere to plug into without a later interface
   change; the stub always returns `false`.
6. **(Should-fix) LOP's no-balance rule made explicit** — a
   `skipBalanceCheck` policy flag (true only for LOP) rather than
   modelling "unlimited" through the same machinery as a real balance;
   LOP applications always succeed, and the payroll-read contract Phase 6
   needs is documented (a plain read of `CONSUMED` LOP ledger rows in the
   payroll period, no new leave-module code).
7. **(Should-fix) Year End preview lifecycle** — added a `SUPERSEDED`
   status and a discard action so re-previewing (or explicitly abandoning
   a stale preview) never leaves two ambiguous "current" previews lying
   around; commit only ever re-verifies against the balance at commit
   time, never trusts a possibly-stale stored preview number.
8. **(Should-fix) Encashment rate fails loudly.** The
   `EncashmentRateProvider` stub throws
   `EncashmentRateNotConfiguredError` rather than returning 0 when the
   `leave.encashment.defaultDailyRate` setting is unset — a year-end run
   that quietly encashed everyone at ₹0 would be worse than an error.

**Backend — business logic** (`backend/src/modules/leave/`, all pure
service functions, no HTTP routes yet):

- `ledger.ts` — `getLeaveBalance`/`getLeaveBalancesForEmployee` (the
  `SUM(days) WHERE entryDate <= asOfDate` query), `assertSufficientBalance`
  (the generic balance gate every type except comp-off uses — comp-off's
  authoritative check is its own FIFO lot sum), `writeLedgerEntry` (the
  one function every write path goes through).
- `accrual.ts` — `computeEligibilityDate`/`firstAccrualMonth`/
  `isEligibleForAccrualMonth` implement HR's exact rule, including the
  inclusive-boundary case the third worked example pins down: an
  eligibility date landing exactly on a month's 1st counts as already
  passed for that same month's credit, not pushed to the following month
  (joined 3 Oct → eligible 1 Jan → first credit 1 Jan, not 1 Feb).
  `creditMonthlyAccrualForEmployee` (idempotent, proactive existence
  check backed by the partial unique index) and `runMonthlyPlAccrual`
  (the bulk driver the scheduled job calls).
- `compOff.ts` — `creditCompOff` (shared by Leave Granter's manual path
  today and Phase 2's attendance path later — see below),
  `consumeCompOffFifo`, `reverseCompOffConsumption`, `expireCompOffCredits`.
- `concurrency.ts` — `withEmployeeLeaveLock`.
- `dayCount.ts` — `computeTotalLeaveDays`, the pure half-day/holiday/
  week-off-exclusion calculation Leave Apply will call in commit B.
- `attendanceIntegration.ts` — the Phase 2 seam: `AttendanceLeaveSink`
  interface (`onLeaveApproved`/`onLeaveReversed`/`isPeriodLocked`) with a
  no-op stub registered today via `setAttendanceLeaveSink()`; Phase 2
  registers a real implementation with zero leave-module changes.
- `weekOff.ts` — `getDefaultWeekOffDays()`, a single global
  `system_settings`-backed default (Sun+Sat) standing in for per-employee
  week-off patterns until Phase 2.
- `encashmentRate.ts` — `EncashmentRateProvider` interface,
  `SettingsBasedEncashmentRateProvider` (Phase 4's only implementation,
  throws rather than defaulting to ₹0 — see point 8 above).

**New scheduled jobs** (`backend/src/jobs/`, following
`employee-separations`' exact registration pattern): monthly PL accrual
(`leave-pl-accrual`, 00:30 IST on the 1st) and daily comp-off expiry
(`comp-off-expiry`, 01:30 IST) — both idempotent, safe to re-run.

**A small precedent-following refactor**: extracted `businessToday()`
(Asia/Kolkata "today" truncated to UTC midnight) plus `addCalendarDays`/
`addCalendarMonths`/`startOfMonthUTC` into a new
`backend/src/lib/businessDate.ts`, since `separations.ts` already had its
own private copy of exactly this "today" function and the new accrual/
expiry jobs needed the identical logic — one shared implementation now,
not a third copy-paste.

**Permissions + seed**: 7 new keys (`leave.apply.onBehalf`, `leave.view`,
`leave.approve`, `leave.grant`, `leave.policy.manage`, `leave.recalculate`,
`leave.yearend.manage`) added to `shared/constants/permissions.ts`.
Role grants: HR_ADMIN gets all 7; HR_EXECUTIVE gets view/approve/grant/
onBehalf (config-and-financial actions stay HR_ADMIN+, same narrowing as
`settings.manage`/`import.manage`); MANAGER gets onBehalf (scope-limited
to their own team via the existing `resolveDataScope`); APPROVER gets
approve+view; PAYROLL_ADMIN gets view only. Seed: PL/LOP/COF/WFH/RH leave
types + policies (HR-confirmed fields marked as such, everything else a
documented default — see Open Questions below), and 2026 holiday +
restricted-holiday calendars for every seeded branch.

**Tests** (38 new, all in `backend/src/modules/leave/__tests__/` — 151
total across the backend): `accrual.test.ts` (all 3 HR worked examples
verbatim, the inclusive-boundary case, never-pro-rated, month-key
idempotency including a same-day double-run and the DB constraint
directly), `ledgerBalance.test.ts` (balance = sum of entries after an
arbitrary sequence, `leave_year` non-scoping proven directly),
`negativeBalance.test.ts` (the balance gate plus LOP's `skipBalanceCheck`),
`halfDay.test.ts` (day-part arithmetic plus holiday/week-off exclusion),
`compOff.test.ts` (FIFO across 2+ lots, exact reversal, expiry touching
only genuinely-unconsumed `remainingDays`, a fully-consumed lot never
resurfacing), `concurrency.test.ts` (two simultaneous approvals racing a
one-day balance — exactly one wins, ledger never negative).

**Verification**: migrations regenerated and reapplied cleanly from
scratch on a disposable database (the standing pattern this project uses
to verify seed/migrations without touching the shared dev database
without fresh consent for a destructive reset); full backend suite green
(151/151); lint/typecheck clean.

**Not done this commit** (commits B–D, per the reviewed plan): every
HTTP route, every screen, Year End Process, Leave Recalculator, the
Workforce Overview dashboard's real data wiring, and finishing
`realtime/socket.ts`'s handshake auth/room-joining (stubbed since Phase 0,
needed for `leave.applied`/`leave.decided`).

### Phase 4, commit B — employee self-service (apply/approve/reject/cancel, balances, calendars)

HTTP routes and the four employee-facing screens on top of commit A's
service layer. No admin screens yet (Employee Leave, Leave Granter, Leave
Types & Policies, Holiday/RH admin — commit C).

**A real seed gap found while designing the approve endpoint's permission
check, before any test was written**: `MANAGER_PERMS` in
`backend/prisma/seed.ts` only granted `employee.view` and
`leave.apply.onBehalf` — no manager could ever have approved their own
team's leave, since data scope alone (from `resolveDataScope`) narrows
*which* rows a query returns but grants no permission by itself. Fixed by
adding `leave.view`/`leave.approve` to `MANAGER_PERMS`, flagged to the
user inline rather than silently patched.

**Backend** (`backend/src/modules/leave/`):

- `scope.ts` — `buildLeaveEmployeeIdFilter`/`isEmployeeInScope`, the same
  SELF/TEAM/ALL shape `resolveDataScope` already produces for Phase 1,
  adapted for leave's `employeeId`-keyed tables. IDOR rule throughout:
  out-of-scope always reads as 404 (never confirms another employee's
  request exists to a caller who can't see them); "no `leave.view`/
  `leave.approve` at all" is a separate 403 gate layered on top of scope.
  A person can never approve/reject their own request, even holding
  `leave.approve`.
- `dayCountContext.ts` — resolves the holiday-dates set and week-off days
  an apply/day-count calculation needs for one employee/date-range,
  wrapping commit A's `holidays.ts`/`weekOff.ts` reads.
  `types.ts` — `LeaveViewer`/`ActorMeta`, the same `viewer(req)`/
  `actorMeta(req)` controller-helper shape used across the employee/org
  modules since Phase 1.
- `requests.ts` — `applyForLeave`, `listLeaveRequests`,
  `getLeaveRequestById`, `approveLeaveRequest`, `rejectLeaveRequest`
  (comments required), `bulkApproveLeaveRequests` (per-id success/failure,
  never all-or-nothing), `cancelLeaveRequest` (REVERSAL + exact FIFO
  comp-off credit-back via commit A's `reverseCompOffConsumption`). Every
  write acquires `withEmployeeLeaveLock` before checking overlap/balance,
  same as commit A's approve/comp-off paths. Self-approval blocked;
  already-decided requests reject with 409; overlapping requests reject
  with 409; LOP always succeeds (`skipBalanceCheck`).
- `balances.ts` — `getLeaveBalancesForDisplay` (granted vs. current
  balance per type, for the Balances cards and the Apply screen's live
  check). `calendar.ts` — `getLeaveCalendar` ("who's on leave" — defaults
  to the caller's own department unless they hold `leave.view`, in which
  case org-wide with filters). `holidays.ts` gained the read side
  (`listHolidays`/`listRestrictedHolidays`); mutations are commit C.
  `leaveTypes.ts` — `listActiveLeaveTypes` for the Apply screen's dropdown
  (missed in the initial commit A/B split, added when the Apply screen
  needed it).
- `validators.ts`/`controller.ts`/`routes.ts` — Zod schemas for every new
  endpoint; `leaveRouter` mounted at `/api/leave`
  (`/types`, `/requests` + `:id`/`:id/approve`/`:id/reject`/
  `bulk-approve`/`:id/cancel`, `/balances`, `/calendar`) and
  `holidaysRouter` at `/api` (`/holidays`, `/restricted-holidays`), both
  wired into `app.ts`.

**Two response-shape/error-class bugs caught by the new HTTP tests, not
by manual testing**: `InsufficientLeaveBalanceError` and
`InsufficientHoursForCompOffError` (commit A) were plain `Error`
subclasses, so the central error handler's `instanceof HttpError` check
missed them and returned a generic 500 instead of a 400 — fixed by
extending `HttpError`, the established convention `separations.ts`
already follows. Separately, `applyForLeave`/`approveLeaveRequest`/
`rejectLeaveRequest`/`cancelLeaveRequest` originally returned the raw
Prisma row, whose `Decimal totalDays` serializes as a JSON *string*
(`"2"`, not `2`) — inconsistent with the list/detail endpoints. Fixed by
re-fetching and formatting every write's response the same way the list
endpoint does (`reloadFormatted`), and by writing a `toAuditJson` helper
so `writeAuditLog`'s `before`/`after` payloads never carry a raw
`Prisma.Decimal` (which breaks JSON serialization outright).

**Frontend** (`frontend/src/`):

- `api/leave.ts` — typed client functions for every new endpoint.
- `pages/employee/leave/LeaveApplyPage.tsx` — leave type + date range
  (half-day toggle on the first/last day), a live balance check as soon
  as a type is picked, an estimated day count that excludes holidays/
  week-offs before submit, and a "who else on the team is off" panel for
  the selected range.
- `pages/employee/leave/LeaveBalancesPage.tsx` — rewritten from the
  Phase 0 mock array onto `getLeaveBalances()`; the per-type download
  button from the old mock was dropped (not asked for in this commit).
- `pages/employee/leave/LeaveCalendarPage.tsx` — a month grid in the same
  custom-CSS-grid style as `AttendanceInfoPage.tsx` (deliberately not
  AntD's `Calendar` component, to avoid its `cellRender` API version
  uncertainty), marking days the caller's team is on leave.
- `pages/employee/leave/HolidayCalendarPage.tsx` — Holidays/Restricted
  Holidays tabs, per-year.
- `routes/employeeMenu.config.tsx` — all 4 leave menu entries now have a
  real `element` (Leave Balances already did from Phase 0); the
  `phase: "Phase 4"` markers on Apply/Calendar/Holiday Calendar removed.

**Tests** (33 new — `requests.integration.test.ts`, `idor.test.ts`,
`permissions.test.ts` — 71 total in the leave module, 184 across the
backend): full apply→approve→ledger-consumption→cancel→reversal HTTP
flow; self-approval blocked; already-decided 409; reject requires
comments; bulk-approve's per-id mixed results; overlap 409; LOP always
succeeds; half-day totalDays; SELF/TEAM/ALL scope across requests/
balances/apply-on-behalf with the 403-vs-404 distinction; all 7
permission keys checked directly against every seeded role.

A `pan_hash`-collision bug surfaced while writing these tests: the
existing `employeeTestHelpers.ts` fixture counter is unique only within
one Vitest file's module instance, and leave's two new HTTP test files
both create several "full" employees — running them together collided on
the shared unique index. Rather than touching the shared Phase 1 helper
(risk to other modules' tests for no leave-specific benefit), added a
lighter `createLoginableTestEmployee()`/`cleanupLoginableTestEmployee()`
to `leaveTestHelpers.ts` that skips statutory/bank/device-mapping
entirely, which leave's own tests never touch.

**Verification**: full backend suite green from a clean migrate+seed on
a disposable database (184/184, 29 files, zero regressions elsewhere);
`lint`/`typecheck` clean on both `backend/` and `frontend/`; frontend
suite green including the routing guard (confirms no Phase 4 route
resolves to `PlaceholderPage`); live browser walkthrough as an employee
covering all 4 screens plus a real end-to-end apply — leave type dropdown
populated from seeded types, live "Current balance: 1 day(s)" check,
date-range + half-day pickers, the estimated-day-count note, the "who
else is off" panel, submit producing "Applied for 1 day(s) — pending
approval", and the balance correctly staying unconsumed (still 1) until
approval, matching the design that consumption happens at approve time,
not apply time.

**Not done this commit** (commit C): Employee Leave, Leave Granter (+
`LEAVE_GRANTS` Import Center dataset), Leave Types & Policies admin
screen, Holiday/RH admin mutations.

### Phase 4, commit C — admin management (grants, catalog, manager Review, employee leave, holidays)

Every remaining Phase 4 admin surface, plus — per the user's explicit
addition to this commit's scope — manager approvals moved into the
employee portal's To do → Review menu and Home page Review card
(previously Phase 0 placeholders), since that is where greytHR puts
manager-facing approvals, not the admin portal.

**Backend** (`backend/src/modules/leave/`):

- `grants.ts` (new) — `manualGrantOrDebit` (any type except COF; positive
  `days` writes a `GRANT` row, negative writes `DEBIT`, still running
  through the same `withEmployeeLeaveLock` + `assertSufficientBalance`
  gate every other debit path uses), `manualCompOffGrant` (thin wrapper
  over commit A's `creditCompOff`, `source: "MANUAL_GRANT"`),
  `listCompOffCredits` (SELF/TEAM/ALL + `leave.view`, same shape as
  balances). `POST /api/leave/grants`, `POST /api/leave/comp-off/grant`,
  `GET /api/leave/comp-off` — all `leave.grant` except the read, which
  follows the same permission-vs-scope split as balances.
- `leaveTypes.ts` gained `listAllLeaveTypesWithPolicy`, `createLeaveType`,
  `updateLeaveType`, `upsertLeavePolicy` — every `leave_policies` column
  editable, not just the ones the 5 seeded types currently use (the
  standing rule: every configurable value gets an admin screen, and nulls
  out one at a time via a partial update, never a destructive full-row
  replace). `POST/PATCH /api/leave/types`, `PUT /api/leave/types/:id/
  policy`, `GET /api/leave/types/all` — `leave.policy.manage`.
- `holidays.ts` gained the mutating side: `createHoliday`/`updateHoliday`/
  `deleteHoliday`/`bulkCreateHolidays` and the restricted-holiday
  equivalents. Bulk reports a per-location `created`/`skipped` result,
  never all-or-nothing — a branch that already has a holiday on that date
  doesn't block the others. `POST/PATCH/DELETE /api/holidays` (+`/bulk`)
  and the restricted-holiday routes — `leave.policy.manage`.
- `backend/src/modules/import/` — `LEAVE_GRANTS` joins the `ImportDataset`
  enum (migration `20260928184732_add_leave_grants_import_dataset`) as
  Leave Granter's bulk path: `employeeCode, leaveTypeCode, days,
  entryDate, remarks`. COF is rejected at row-validation time (points to
  the Comp-Off Grant action, same rule as the manual-grant endpoint).
  Commits write ledger entries directly against `commitBatch`'s own
  transaction handle rather than through `grants.ts` (which opens its own
  `withEmployeeLeaveLock` transaction — Prisma can't nest one inside the
  other), taking the same per-employee `FOR UPDATE` lock manually. A
  debit that would violate `negativeBalanceAllowed=false` **throws**,
  rolling back the whole transaction, rather than silently skipping just
  that row — a batch either fully commits or visibly fails with a clear
  error, never a partial commit nobody asked for.

**A real timezone bug found by the full regression suite, not by design
review**: `requests.integration.test.ts`'s cancel-and-reverse test started
failing — deterministically, on a freshly seeded database, ruled out as
test pollution — but only depending on the time of day this ran. Root
cause: `getLeaveBalance`/`getLeaveBalanceDetail`/`getLeaveBalancesForEmployee`/
`assertSufficientBalance`/`getLeaveBalancesForDisplay`/
`expireCompOffCredits` all defaulted their `asOfDate` parameter to
`new Date()` (the current instant), while every *write* to a `leave_ledger`
row dates it with `businessToday()` (today's calendar date in Asia/Kolkata,
represented as UTC midnight). Asia/Kolkata is UTC+5:30, so whenever the
server's wall-clock UTC time is between 18:30 and 23:59, IST has already
crossed into tomorrow — `businessToday()` then returns a Date that is
*later* than `new Date()`, so a same-day reversal's `entryDate` fails the
`entryDate <= asOfDate` filter and silently drops out of the balance sum
for up to ~5.5 hours a day. Fixed by defaulting every one of those
functions to `businessToday()` instead — `entry_date` is a `@db.Date`
column, so every comparison against it should use the same business-date
concept the writes use, never a raw instant. (The real scheduled jobs
were never affected — `jobs/worker.ts` already passed `businessToday()`
explicitly; only callers relying on the default, like this test, hit it.)

**A response-shape inconsistency found during browser verification, not
by a test**: `holidays.ts`'s read-only `listHolidays`/
`listRestrictedHolidays` (commit B) returned the raw Prisma row, whose
`date` is a full `DateTime`, not a plain `YYYY-MM-DD` string — inconsistent
with the same file's own `createHoliday`/`updateHoliday`, which already
used a `dateOnlyJson` formatter. The employee-facing Holiday Calendar
screen happened to paper over this with its own client-side `new Date(v)`
formatting, so it was never visibly wrong until the new admin table (no
such formatting) rendered a raw ISO timestamp. Fixed both ends: the reads
now go through `dateOnlyJson` too, and the admin table also formats the
date client-side for a human-readable display, matching the employee
screen.

**Frontend**:

- `pages/employee/todo/ReviewPage.tsx` (new, `/app/todo/review`) — a
  manager's pending-approval queue (reuses commit B's
  `GET /api/leave/requests?status=PENDING`, which already scopes to
  TEAM for a caller with `leave.view`+`leave.approve` and no explicit
  `employeeId` filter — no new backend needed for the listing itself).
  Per-row Approve, a Reject modal requiring comments, row-selection bulk
  approve, and a live per-employee balance column (one
  `getLeaveBalances(employeeId)` call per distinct employee in the queue,
  deduped by react-query's cache). Gated on `leave.approve`; a caller
  without it sees the empty state rather than their own pending requests
  misrendered as a decision queue.
- `pages/employee/home/HomePage.tsx` — the Review card's `EmptyState` mock
  replaced with a real pending count (same query key as the Review page,
  so the two stay cache-consistent) and a link through.
- `pages/admin/workforce/EmployeeLeavePage.tsx` (new) — HR's org-wide view
  of every leave request (status filter, approve/reject/cancel inline)
  plus an Apply on Behalf modal (employee picker + the same apply-form
  shape as the employee screen).
- `pages/admin/workforce/LeaveGranterPage.tsx` (new) — three tabs: Manual
  Grant/Debit, Comp-Off Grant (with that employee's comp-off lot table
  refreshing after each credit), and Bulk Upload, which reuses
  `ImportCenterPage.tsx`'s upload/validate/commit component (exported as
  `ImportDatasetTab`) parametrised with `dataset="leave-grants"` rather
  than duplicating it.
- `pages/admin/adminTools/LeaveTypesPoliciesPage.tsx` (new) — every leave
  type with an Edit (type-level fields) and Policy (every
  `leave_policies` column, grouped by concern — accrual, balance rules,
  comp-off, WFH, RH) action; a banner reminding that several defaults
  await HR/CA confirmation (docs/PROGRESS.md's Open Questions).
- `pages/admin/adminTools/HolidayCalendarsAdminPage.tsx` (new) — Holidays/
  Restricted Holidays tabs, branch + year pickers, per-branch CRUD, and
  the requested multi-branch bulk action (a branch multi-select + one
  date/name, applied to all of them with a per-branch created/skipped
  result).
- `routes/employeeMenu.config.tsx` / `adminMenu.config.tsx` — `todo/review`,
  `workforce/leave/employee-leave`, `workforce/leave/granter`,
  `admin-tools/holidays`, `admin-tools/leave-policies` all got real
  `element`s; `todo/tasks` stays a Phase 5 placeholder (not asked for,
  and Tasks is a distinct, larger Phase 5 concern per spec §6).

**Tests** (21 new — `adminGrants.test.ts`, `adminCatalog.test.ts`,
`import/__tests__/leaveGrants.test.ts` — 205 across the backend):
grant/debit balance effects and the negative-balance gate, COF blocked on
the generic grant endpoint, comp-off grant + its insufficient-hours 400,
comp-off list scope; leave type create/duplicate-code-409/update, policy
upsert leaving untouched fields alone and accepting an explicit `null`
back to "unlimited"; holiday/RH create/update/duplicate-409/delete and
the bulk endpoint's per-location created/skipped split; the `LEAVE_GRANTS`
dataset's COF rejection, unknown-employee/type/malformed-days validation,
a successful grant+debit commit, and the whole-batch-abort-on-insufficient-
balance case with a direct assertion that nothing partial was written.

**Verification**: full backend suite green from a clean migrate+seed on a
disposable database (205/205, 32 files, zero regressions — including the
timezone bug found and fixed along the way); `lint`/`typecheck` clean on
both `backend/` and `frontend/`; frontend suite green; live browser
walkthrough covering the full loop — an employee applies, their manager
sees the real-time Review badge on Home and approves from the Review
queue, HR sees the same request (now APPROVED) in Employee Leave, and all
three Admin Tools/Workforce Management screens (Leave Granter's three
tabs, Leave Types & Policies' catalog and policy modal, Holiday Calendars'
branch view and multi-branch bulk-add modal) render and operate against
real data.

**Not done this commit** (commit D, per the reviewed plan): Year End
Process (preview/discard/commit), Leave Recalculator, Workforce Overview
dashboard's real data wiring, and finishing `realtime/socket.ts`'s
handshake auth/room-joining for `leave.applied`/`leave.decided`.

### Interim — holidays and every other leave/attendance rule made company-wide (HR-confirmed 2026-09-28)

Before commit D, HR clarified a modelling assumption every prior commit
had gotten wrong: holidays, leave types/policies, shifts, week-off
patterns and attendance rules are identical for every branch — branches
differ in exactly one way, which biometric machine their punches arrive
from. That's a device-to-branch mapping (Phase 2's `devices.location_id`),
not a policy difference, so none of Phase 4's rule tables should reference
`locations` at all.

**Schema**: `Holiday`/`RestrictedHoliday` lost `locationId`; both are now
one company-wide list (`@@unique([date])` in place of
`@@unique([locationId, date])`). Migration
`20260928192111_make_holidays_company_wide` de-duplicates existing
per-branch rows on `date` before dropping the column — verified safe
against a scratch database seeded with real per-branch duplicate data
first (every branch's row for a given date shared the identical `name`,
confirmed via psql before trusting the migration). `Location` itself is
unchanged: employees still belong to a branch, grids/dashboards still
filter and group by branch and city, job history is unchanged — branch
stays a first-class organisational/reporting attribute, just never a
rule-scoping one.

**Backend**: `holidays.ts` rewritten with no `locationId` anywhere
(`listHolidays(year?)`/`listRestrictedHolidays(year?)` now return a plain
array); `dayCountContext.ts` queries holidays directly with no job-history/
location lookup; the two `bulkCreate*` functions and their routes are
gone (no longer meaningful with one company-wide list); `seed.ts` seeds
one flat holiday/RH list instead of per-location loops.

**Frontend**: `HolidayCalendarPage.tsx` (employee) and
`HolidayCalendarsAdminPage.tsx` (admin) both lost their branch
`Select`/location params; the admin page's "Add to Multiple Branches"
bulk modal is gone entirely, since there's only one branch to add to now.

**Docs**: `docs/PROJECT_SPEC.md` §4.4/§5.4/§7.3/§7.4/§7.8/§11 updated to
state explicitly that holidays/leave policies/shifts/week-off
patterns/attendance rules are company-wide, that `devices` (Phase 2) is
the one and only table that references `locations` for a branch-varying
reason, and that the attendance rules engine itself does not vary by
branch.

**Breaking change for local data**: yes, for anyone with holiday/RH data
in a local database already — the schema and the `GET/POST/PATCH
/api/holidays`(+`/restricted-holidays`) response/request shapes both
changed (no more `locationId`, no more `/bulk`). Re-run
`npx prisma migrate deploy` (or `migrate dev` in local-only setups) to
apply the de-duplicating migration, then `npm run db:seed` if you want
the seeded holiday/RH data back in its new company-wide shape — a plain
migrate without reseeding also works and keeps your existing (now
de-duplicated) rows.

**Design note — reopening branch-specific holidays later**: if a future
need ever requires one branch to observe a local holiday the rest of the
company doesn't, the door is left ajar, not closed — re-add a nullable
`locationId` to `Holiday`/`RestrictedHoliday` (null = company-wide, a
value = that branch only), which is an additive, backwards-compatible
migration, and widen `dayCountContext.ts`'s query to also match
`locationId: null OR locationId: employee's branch`. No data model
rework, no lost history.

### Phase 4, commit D — Year End Process, Leave Recalculator, Workforce Overview dashboard, real Socket.IO (Phase 4 complete)

The final Phase 4 commit: the two admin financial/corrective tools that
were deliberately saved for last (both write ledger entries at scale and
both needed the rest of the leave module working first to be testable),
the dashboard's real data wiring, and finishing the real-time layer that
had been a Phase 0 skeleton since the very first commit.

**Backend** (`backend/src/modules/leave/`):

- `yearEnd.ts` (new) — preview → (discard or re-preview, which
  auto-supersedes the old one) → commit. Preview never writes to
  `leave_ledger`, only to `YearEndRunItem`; each employee's closing PL
  balance is computed as an explicit `entryDate <= 'Y-12-31'` cutoff
  (never the `leaveYear` tag), so a Jan-1 accrual for the next year
  posted while this year's run is still `PREVIEW` is automatically
  excluded and correctly starts the next year's balance instead — proved
  directly by `yearEnd.test.ts`, not just asserted in a comment. The
  encashment rate (via `EncashmentRateProvider`, commit A's throwing
  stub) is resolved for every employee *before* any row is written — an
  unconfigured rate aborts the whole preview with zero rows written, and
  the live browser check confirmed the exact error text surfaces as a
  toast. Commit re-verifies every item's balance fresh against the
  ledger and rejects the *whole* commit — never a partial one — if
  anything drifted since preview; both paths require a typed
  confirmation (`"COMMIT YEAR END"`). `buildYearEndReport` regenerates an
  Excel report on demand from the immutable `YearEndRunItem` rows rather
  than persisting to `StorageService` at commit time — equally correct,
  zero new integration surface, `YearEndRun.reportStorageKey` stays
  unused by design. One schema fix along the way: `YearEndRunItem.
  employeeId` (commit A) had no real Prisma relation/FK to `Employee`,
  needed once the report/detail view started joining in employee names —
  added (migration `20260928193500_add_year_end_run_item_employee_
  relation`).
- `recalculator.ts` (new) — diffs what *should* be in the ledger
  (recomputed fresh from an employee's *current* DOJ and *current*
  policy) against what's actually there, month by month, for every
  accrual-enabled type, producing `CREDIT`/`REVERSE` actions for an
  explicit employee list (unlike Year End's org-wide sweep). Deliberately
  does *not* need Year End's "drifted since preview, reject" check —
  commit simply re-diffs fresh, which is idempotently always correct —
  documented in the module comment as a different design choice and why.
  **A real idempotency bug caught while writing `recalculator.test.ts`,
  not by design review**: the REVERSE check only looked for an existing
  `ACCRUAL` row in that month to decide whether to propose a reversal,
  never checking whether that row had *already* been reversed by a prior
  recalculation run (a `REVERSAL` row is a different `entryType`, so the
  original never-deleted `ACCRUAL` row always looked "still wrong"). A
  second run on the same drifted month would propose — and, on commit,
  write — another `REVERSAL`, double-reversing the balance every time it
  ran. Fixed by also checking for a `REVERSAL` row already referencing
  that `ACCRUAL` row's id (`referenceType: "RECALCULATION"`,
  `referenceId: <accrual id>`) and skipping it once one exists;
  `recalculator.test.ts`'s idempotency test (preview → commit → preview
  again → commit again, asserting the second round is a no-op and the
  row count is unchanged) is what caught it and what now guards it.
- `dashboard.ts` (new) — `getWorkforceDashboard(year)`, one query per
  year returning every (month, leaveTypeCode) total plus which
  Restricted Holidays were actually taken and by how many employees;
  bucketed by each request's `fromDate`, the same convention
  `writeLedgerEntry` already uses for a `CONSUMED` row's `entryDate`, so
  a multi-month request is attributed the same way the ledger itself
  would show it. `GET /api/leave/dashboard?year` — `leave.view`, org-wide
  only (no SELF/TEAM scoping — this is an aggregate management view, not
  a per-employee one).
- `backend/src/modules/settings/` gained a `LeaveSettings` section
  (`getLeaveSettings`/`updateLeaveSettings`, `GET/PUT /api/settings/
  leave`, `settings.manage`) holding `leave.encashment.
  defaultDailyRate` — the System Settings location commit A's error
  message already promised ("Set System Settings -> Leave -> Default
  Daily Rate") but never actually built. Caught while live-verifying
  Year End Process in a browser: generating a preview correctly surfaced
  the "not configured" error, but there was nowhere in the UI to
  actually configure it — `encashmentRate.ts`'s
  `EncashmentRateNotConfiguredError` also proactively fixed to extend
  `HttpError` (not plain `Error`), the same convention two earlier
  commits' domain errors had already needed fixing to.
- `backend/src/realtime/socket.ts` — real handshake auth (same access-
  token verification and live active-account re-check as
  `middleware/authenticate.ts`, since a socket connection is just as
  authenticated a session as an HTTP request) and room-joining: every
  socket joins `user:{employeeId}`, `manager:{employeeId}` (so server
  code emitting to `manager:{id}` reaches the one connected socket
  belonging to the employee who *is* manager `id`), `org`, `role:{role}`
  for each held role, and `dept:{id}`/`location:{id}` from current job
  history. `realtime/emit.ts` (new) holds the one process-wide `io`
  singleton `requests.ts` calls into for `leave.applied` (→ the
  applicant's reporting manager's room) and `leave.decided` (→ the
  applicant's own room) — no-ops cleanly when no socket server is
  running (every test, `worker`/`scheduler` modes), so a leave write
  never depends on anyone being connected to notify.

**Frontend**:

- `pages/admin/workforce/YearEndProcessPage.tsx` (new) — leave-year
  picker + Generate Preview, a run-history table, and a detail panel for
  the selected run (per-employee balances/days/rate/amount, Discard,
  typed-confirmation Commit, Download Report). Verified live: preview
  correctly blocked with the exact "not configured" toast before the
  rate existed, and — after configuring it via the new System Settings →
  Leave card — a real preview against the seeded 32-employee roster
  (₹16,000 total) with the Commit button staying disabled until
  `"COMMIT YEAR END"` is typed exactly.
- `pages/admin/workforce/LeaveRecalculatorPage.tsx` (new) — multi-employee
  picker + a "recompute from" month, a preview results table
  (colour-coded CREDIT/REVERSE tags per action), typed-confirmation
  Apply. Verified live against a real seeded employee: preview correctly
  listed 7 months of missing `CREDIT` actions.
- `pages/admin/workforce/OverviewPage.tsx` — the three charts (donut,
  monthly bar, RH bar) rewired from static mock data to
  `getWorkforceDashboard(year)`; both "Category: All ▾" filters are now
  real (client-side slicing of the one fetched year, no extra round
  trips per filter change) rather than the inert dropdowns the mock had.
- `pages/admin/settings/SystemSettingsPage.tsx` gained the Leave section
  described above.
- `pages/admin/workforce/AdminLeaveCalendarPage.tsx` (new) — a gap caught
  while wiring commit D's menu entries: the original plan's screen list
  had `/admin/workforce/leave/calendar` down for commit C, but it was
  never built (still carrying a `phase: "Phase 4"` marker with no
  route). Same org-wide "who's on leave" month grid as the employee
  screen, plus the branch/department filters `leave.view` callers get
  per `modules/leave/calendar.ts`.
- `sockets/SocketProvider.tsx` now sends the real access token in the
  handshake (`api/client.ts` gained `getAccessToken()`), and connects
  only once `useAuth()` reports a signed-in user (`App.tsx`'s new
  `AuthenticatedSocketProvider` wrapper) — it had been permanently
  `enabled={false}` since Phase 0. `sockets/useLeaveNotifications.ts`
  (new, wired into `RequireAuth.tsx` so it runs for every signed-in
  route) listens for `leave.applied`/`leave.decided` and shows an antd
  toast plus invalidates the `leave.requests`/`leave.balances` query
  keys — verified live: both portals' WebSocket connections completed a
  clean Socket.IO handshake with no auth errors.
- `routes/adminMenu.config.tsx` — `workforce/leave/calendar`,
  `workforce/leave/year-end`, `workforce/leave/recalculator` all got real
  `element`s; every Phase 4 route now resolves to a real page.

**Tests** (25 new — `yearEnd.test.ts`, `recalculator.test.ts`,
`dashboard.test.ts`, `realtime/__tests__/socket.test.ts` — 230 across the
backend): Year End's cutoff/Y+1-exclusion scenario end to end through
commit, the loud preview failure with zero rows written when the rate
isn't configured, commit rejecting a whole run on balance drift with no
partial write, re-preview superseding, discard, and the DB-level
one-committed-run-per-year unique index; the Recalculator's CREDIT+REVERSE
scenario in one preview, preview being a true dry run, and the
double-reversal idempotency bug above caught and now guarded; the
dashboard's (month, type) aggregation and RH breakdown, correctly
excluding non-approved requests; socket handshake auth resolving
`employeeId`/`roleCodes`/department/location for a valid active-account
token and rejecting a malformed token, a suspended account, and an
unknown user id. Every new test file also has a couple of route-level
403/200 checks for its permission gate.

**Verification**: full backend suite green from a clean migrate+seed on a
disposable database (230/230, 36 files, zero regressions);
`lint`/`typecheck` clean on both `backend/` and `frontend/`; frontend
suite green; live browser walkthrough as Super Admin covering every new
screen plus the gap-fills (Workforce Overview's real charts, Year End's
full not-configured → configure-the-rate → preview → ready-to-commit
loop against the real 32-employee seed, the Recalculator's real
CREDIT-action preview, the Admin Leave Calendar, the new Leave settings
card) and, as a second employee, confirming the Socket.IO handshake
completes cleanly with no console errors from either portal. Commit was
not clicked in the browser (already covered end-to-end by
`yearEnd.test.ts`) to avoid mutating the verification database
unnecessarily.

Phase 4 is now complete.

### Phase 5, commit A — notifications substrate, Employee Home, Admin Homepage (Welcome + Dashboard)

Built ahead of Phase 2/3 (attendance) for the same reason Phase 4 was — spec
§12 still lists Phase 5 next regardless, and nothing in this commit needs
attendance data. A full written plan was reviewed and sent back with 4
"MUST FIX" and 5 "SHOULD FIX" corrections before any code; all incorporated
below. The mobile bottom-tab-bar commit (G) is blocked on the user adding
four greytHR screenshots to `docs/screenshots/` and stays last in the
7-commit plan for that reason — not started this commit.

**Schema** (`backend/prisma/schema.prisma`, migration
`20260929095306_add_phase5_notifications_announcements_dashboard`): 4 new
models — `Notification` (userId → `User`, type/title/body/link/payload,
`readAt` nullable = unread, indexed `[userId, readAt]`), `Announcement`
(the Home page HR banner replacing greytHR's product ads — optional
`scopeLocationId`/`scopeDepartmentId`, `activeFrom`/`activeTo` date
window), `DashboardLayout` (one row per user — ordered widget-key array +
visibility), `UserFavourite` (Admin Homepage shortcut tiles, `rank`-ordered).
New permission: `announcements.manage` (HR_ADMIN+, same config-action
narrowing as `settings.manage`).

**Notification persistence is deliberately decoupled from the realtime
emit** — the MUST-FIX the user caught in review: `createNotification()` is
called directly by each write-path service function (`leave/requests.ts`'s
`applyForLeave`/`approveLeaveRequest`/`rejectLeaveRequest`, via a new
`notifyEmployee()` helper) as its own step, before the emit — never from
inside `realtime/emit.ts`. The row exists whether or not anyone is
connected; the emit (`emitNotificationNew`, → `user:{employeeId}`) is
delivery on top of an already-durable record, never the write path itself.
A second new emit, `emitTasksCounts` (signal-only, no payload — the
frontend just invalidates its query on receipt), fires to the applicant's
manager room plus every `role:HR_ADMIN`/`role:HR_EXECUTIVE` room on every
leave apply/approve/reject.

**Announcement precedence is explicit, not inferred** — the other MUST-FIX:
`getActiveAnnouncementForEmployee()` resolves every currently-active,
date-in-range, scope-matching row for the caller, then ranks by
specificity (count of non-null `scopeLocationId`/`scopeDepartmentId` —
both-scoped beats one-scoped beats org-wide) with ties broken by most
recent `activeFrom`. Covered by dedicated tests for both rules
(`announcements.test.ts`): a both-scoped row beating org-wide, a
one-scoped row beating org-wide but losing to both-scoped, and two
equally-specific rows resolving on `activeFrom` recency.

**Admin Dashboard's 7 widgets** (`modules/admin/dashboard.ts`) — years in
service, additions & attrition (last 12 calendar months), headcount by
branch and by city, age distribution, gender split, department
headcount — cached in Redis as one JSON blob, **TTL-only (5 minutes), no
write-triggered invalidation** (the third MUST-FIX): the set of writes
that could change these numbers (create, separate, a cancelled
separation, a job-history transfer, a name/DOB/gender edit) is large and
easy to under-cover, so a flat staleness bound was chosen deliberately
over partial invalidation that would be wrong in ways nobody notices —
documented as the explicit tradeoff in the module's own comment, not an
oversight.

**"My Tasks" review/monitor split** (`modules/admin/tasks.ts`) — review =
pending items within the caller's own approval scope (gated on
`leave.approve`, reusing the exact `listLeaveRequests` query the Review
page already uses); monitor = org-wide pending count minus review,
computed only for `leave.view` + ALL-scope holders. A real, slightly
subtle consequence surfaced by the tests: an ALL-scope role that also
holds `leave.approve` (HR_ADMIN) has its own "review" query already
covering every org-wide pending request (ALL scope + no employeeId filter
= sees everyone), so its monitor total nets to 0 — correct, not a gap.
Proving "monitor" actually shows a nonzero number needed a role with
`leave.view` + ALL scope but no `leave.approve` (PAYROLL_ADMIN, per seed).
`RegularizationRequestSink` (the fourth MUST-FIX's counterpart —
`modules/admin/regularizationIntegration.ts`) is the same seam shape as
Phase 4's `AttendanceLeaveSink`: a `NoopRegularizationRequestSink`
returning genuine zero counts today, with `setRegularizationRequestSink`
exported for Phase 2/3 to plug a real one in later with zero call-site
changes.

**Frontend**: `pages/employee/home/HomePage.tsx` rewritten off real data —
greeting from `useAuth().user`, Upcoming Holidays from
`leaveApi.listHolidays()`, the announcement banner from
`GET /api/announcements/active` (rendered only when one resolves — no
placeholder banner when none is active), Track from the caller's own
pending leave requests. Payslip/Quick Access/IT Declaration/POI stay
explicit "Coming in Phase 6" states, per spec §6's own "show 'coming soon'
earlier" for Salary. `pages/admin/home/HomePage.tsx` rewritten with a
working Welcome tab (My Favourites CRUD with a fixed icon catalog and an
Add Shortcut modal, My Tasks wired to the counts above, Latest Updates —
the full admin announcement list for an `announcements.manage` holder,
falling back to just the single active one for anyone else) and a
Dashboard tab rendering all 7 widgets through the existing `ChartCard`/
`useChartColors` pattern (years-in-service and age distribution as line
charts, headcount-by-branch/city and department headcount as horizontal
bars, gender split as a donut `PieChart`), plus an Edit modal
(visibility toggle + reorder arrows per widget) persisting to
`DashboardLayout`. A new shared `components/common/NotificationBell.tsx`
(Badge + Popover list, mark-read/mark-all-read) replaced the static
non-functional bell in `EmployeeLayout` and was added to `AdminLayout`,
which had no bell at all before this commit. New
`sockets/useNotifications.ts` listens for `notification.new`/
`tasks.counts` and is wired into `RequireAuth.tsx` alongside the existing
leave-specific hook.

**A real duplicate-toast bug found and fixed via live browser testing**
(not caught by any automated test): applying for/deciding a leave request
now fires *two* realtime events for the same action —
`leave.applied`/`leave.decided` (Phase 4's own channel) and the new
generic `notification.new` (this commit's channel, since every leave
event now also persists a `Notification` row). Both hooks were showing a
toast, so both sides of a live two-browser apply→approve→reject walkthrough
(screenshotted) showed the same message twice, stacked. Fixed by stripping
the toast out of `sockets/useLeaveNotifications.ts` entirely — it's now
cache-invalidation only (`leave.requests`/`leave.balances` query keys);
`useNotifications` is the single place a toast gets shown, driven by the
persisted Notification row (the actual source of truth for "what did we
tell the user"), for every event type including leave's. Re-verified live
after the fix: exactly one toast per action on both sides.

**A real test-infrastructure gap found while running the full suite**: the
three new Phase 5 tables FK-reference `User.id`, but the shared
`cleanupFullTestEmployee`/`cleanupTestUser` helpers (`employeeTestHelpers.ts`,
`authTestHelpers.ts`) didn't know to delete `Notification`/`UserFavourite`/
`DashboardLayout` rows before deleting the `User` row — any test whose
fixture user picked up a notification (which, after this commit, includes
every leave apply/approve/reject integration test) hit a live FK violation
in cleanup. Fixed in both helpers, not worked around per-test-file, since
it's shared infrastructure every future module's tests will also rely on.

**Tests** (7 new files, 271 across the backend): notification create/
list/mark-read/mark-all-read, always self-scoped (another user's
notification 404s, never 403, matching the codebase's existing
don't-confirm-existence convention); announcement precedence (both rules,
scope mismatch, expired/future windows) plus CRUD permission gating;
dashboard widget aggregate correctness against real fixtures plus a
cache-hit check; favourites CRUD, ownership-scoped delete, and reorder
(including the exact-id-set validation); dashboard layout default-then-
round-trip and an unknown-widget-key rejection; task counts' review/
monitor split across a manager, a no-permission employee, and both flavors
of ALL-scope viewer, plus the `RegularizationRequestSink` seam proven with
an installed fake sink; three new assertions added to the existing
`requests.integration.test.ts` proving each of apply/approve/reject
persists the right `Notification` row for the right target.

**Verification**: full backend suite green from a clean `migrate reset` +
reseed on the shared dev database (271/271, 42 files, zero regressions —
required an explicit fresh reset-consent from the user, since the database
had accumulated stray test-fixture rows across many earlier sessions
without ever having `prisma/seed.ts` run against it, which is why 36
pre-existing Phase 1–4 tests were failing before the reset for reasons
unrelated to this commit); `lint`/`typecheck` clean on both `backend/` and
`frontend/`; frontend suite green (route-placeholder guard). Live
Playwright walkthrough as Super Admin (Aditi) and as a plain Employee
(Arjun) against a fresh migrate+seed on the disposable
`wellsure_hr_devcheck` scratch database: both Home pages, the Admin
Dashboard's real charts, the Edit Dashboard and Add Shortcut modals, and
both portals' notification bells — plus the full apply → realtime toast →
approve → realtime toast, and a second apply → reject round, driven
through the real API with both browser tabs open throughout to prove the
Socket.IO delivery live, not just via a follow-up fetch.

### Phase 5, commit B — Engage (posts, kudos, polls, reactions, comments, groups, moderation, auto-posts)

Per the plan, with three corrections the user called out explicitly before
any code: kudos deletion behaviour on moderation had to be decided and
tested (not left implicit), auto-post idempotency had to handle 29 February
birthdays and survive a duplicate-key error mid-loop without aborting the
rest of the batch, and joining posts had to fire on the real joining event,
not the daily cron. All three are addressed below with their own dedicated
tests, not just handled in passing.

**Schema** (`backend/prisma/schema.prisma`, migration
`20260929110137_add_engage_phase5_commit_b`): `Post` — the feed's one
uniform row for every kind (`USER`/`KUDOS`/`POLL`/`AUTO_BIRTHDAY`/
`AUTO_JOINING`/`AUTO_ANNIVERSARY`), with `authorEmployeeId` nullable (null
for AUTO_* posts — nobody "wrote" them) and `subjectEmployeeId`/
`occurredOn` set only for AUTO_* kinds. `Kudos`/`Poll` are 1:1 child tables
via `postId` so the feed always queries `Post` uniformly regardless of
kind. `PollOption`/`PollVote` (`@@unique([pollId, employeeId])` — one vote
per employee per poll, moved rather than duplicated on a re-vote).
`Comment`, `Reaction` (`@@unique([postId, employeeId])` — a second reaction
from the same employee replaces, not adds). `Group`/`GroupMember` — plain
categorisation only; **membership is deliberately not access control**,
documented directly in the schema comment: posting into or viewing a
group's posts is never membership-gated, a deliberate scope
simplification. `EngageAutoPostSetting` — a closed 3-row catalog (one per
AUTO_* kind) holding `enabled` + `template`, same one-row-per-fixed-kind
shape as `LeavePolicy`; the shared daily batch run hour lives in
`SystemSetting` (`engage.autopost.dailyRunHour`, default 8 for spec §8's
"daily 08:00 cron"), not in this table, since it's one shared schedule
covering two of the three kinds. A hand-added partial unique index (the
established Prisma-can't-express-this pattern, applied after
`prisma migrate dev --create-only`) enforces the auto-post idempotency key:
`posts_auto_kind_subject_occurred_key` on `(kind, subject_employee_id,
occurred_on)` where both columns are non-null. New permissions:
`engage.moderate`, `engage.groups.manage`, `engage.autopost.manage`, all
granted to `HR_ADMIN`/`SUPER_ADMIN` only in seed — a plain `EMPLOYEE`
holds none of them, matching every other admin-gated Phase 4/5 permission.

**Moderation is a soft hide, never a delete** — this codebase's standing
append-only convention (`YearEndRun` SUPERSEDED, `Location.isActive`),
applied to `Post` for the first time: `moderatePost()`/`unmoderatePost()`
set/clear `moderatedAt`/`moderatedByUserId`; the row (and its backing
Kudos/Poll/Comment/Reaction rows) stay in the database. Every feed and
detail-view query filters `moderatedAt IS NULL`; the admin moderation
queue is the one place that deliberately doesn't, so HR can review and
restore. The explicit review requirement — kudos deletion behaviour must be
decided and tested — is answered directly: `getKudosReceivedCount()`/
`getKudosGivenCount()` are always a live `prisma.kudos.count()` filtered
through `post: { moderatedAt: null }`, never a stored counter, so a
moderated kudos post stops counting toward its recipient's total
immediately with no separate decrement step to get wrong.
`moderation.test.ts` proves the full cycle end to end: give kudos → count
includes it → moderate the post → count excludes it while the row still
exists (found via the admin queue) → unhide → count includes it again.

**Auto-post idempotency** (`modules/engage/autoPosts.ts`) —
`isEventDateCelebratedToday()` (now exported for direct unit testing)
handles the 29 February rule explicitly: a leap-day birthday is celebrated
on 28 February in a non-leap year, matched on today's real calendar date
(never rolling forward to 1 March), and the emitted `occurredOn` is always
that real match date — so the partial unique index never double-fires
later the same year, and the following year's own 28-or-29 February still
creates a fresh post since `occurredOn` differs. Each employee's insert
inside `runDailyAutoPosts()` is individually try/caught: a `P2002`
(duplicate-key — a retried run, or a genuine race) is treated as an
idempotent skip; any other error is logged and counted as failed; **the
loop always continues to the next employee regardless of one row's
outcome** — proven directly in `autoPosts.test.ts` by pre-seeding one
employee with today's post already present (simulating a partial prior
run) alongside a second, fresh employee with a matching birthday in the
same call: the first employee's pre-existing post is left untouched (not
duplicated, not overwritten) and the second employee's post is still
created in the same run. Joining posts fire on the actual joining event —
`createJoiningPost()` is called from `auth/service.ts`'s `acceptInvitation`
(the only real path that flips `User.status` `INVITED`→`ACTIVE`; Add
Employee always creates `INVITED`, confirmed by code search), keyed on the
employee's real `dateOfJoining`, not the moment they happened to click the
link. `runDailyAutoPosts()` never scans for `AUTO_JOINING` at all — proven
in `autoPosts.test.ts` by running the cron on the exact day matching an
employee's join-date and asserting zero posts appear until
`createJoiningPost()` is called explicitly — and `joiningEvent.test.ts`
drives the real HTTP path end to end (Add Employee → invitation email →
accept → post appears, exactly the E2E onboarding flow's own shape) to
prove the wiring holds outside the unit-level guarantee too.

**Backend** `modules/engage/`: `posts.ts` (`FEED_INCLUDE` batches
author/subject/group/kudos/poll/reactions/comment-count in one query, no
N+1; `listFeed()` filters by kind/group/location-or-department-via-current-
job-history/search), `kudos.ts`, `polls.ts` (`votePoll()` upserts on the
`[pollId, employeeId]` unique key so a re-vote moves rather than adds;
`closePoll()` gated to the poll's author or an `engage.moderate` holder),
`reactions.ts` (toggle: same emoji again removes, a different emoji
replaces), `comments.ts`, `groups.ts`, `moderation.ts`,
`autoPostSettings.ts`, `autoPosts.ts`, `employeeSearch.ts` — a new, minimal
self-serve `GET /api/engage/employees/search` (name + code only), built
because the existing `modules/employee` search needs `employee.view`,
which a plain `EMPLOYEE` doesn't hold but must still be able to search
colleagues to give kudos. Realtime: `emitEngagePost`/`emitEngageKudos`/
`emitEngageReaction`/`emitEnginePostCommentCount`/`emitEngageBirthday`/
`emitEngageJoining`/`emitEngageAnniversary`, all to the `org` room (the
feed is org-wide by design — see the Group schema comment). Jobs:
`engageAutoPostsQueue`, a `getDailyRunHour()`-driven `upsertJobScheduler`
entry (read once at scheduler-registration time — a changed hour takes
effect on the scheduler's next restart, since BullMQ repeatable jobs
aren't live-reloaded; the admin screen's own `Alert` says so explicitly),
a thin worker calling `runDailyAutoPosts(businessToday())`.

**A real bug found via the live Playwright walkthrough, not any automated
test**: the moderation queue route (`GET /api/engage/moderation/posts`)
had no query-schema validation, so a request without explicit `page`/
`pageSize` — which is exactly how the real `ModerationPage.tsx` calls it
(`{ moderated, pageSize: 50 }`, no `page`) — computed `skip: NaN` and 500'd
in production, not just in a contrived test. Fixed by adding
`listModerationQuerySchema` (the same coerced-with-defaults shape
`listFeedQuerySchema` already uses) and wiring it through `validate()` at
the route.

**A second real bug found the same way**: wiring `createJoiningPost` into
`acceptInvitation` means any test that drives the real accept-invitation
HTTP flow now also creates a real `Post` row as a side effect — which
three *pre-existing*, untouched test files do
(`auth/__tests__/invitation.test.ts`, `employee/__tests__/
e2eOnboarding.test.ts`, `settings/__tests__/settings.test.ts`).
`Post.authorEmployeeId`/`subjectEmployeeId` are optional FKs, so Prisma's
default `onDelete` is `SetNull`, not a blocking error — those tests'
existing `cleanupFullTestEmployee`/`cleanupTestUser` calls didn't fail,
they silently left an orphaned `Post` (subject nulled out) permanently in
the dev database, which then rendered as **"null just joined us!"** in the
real Engage feed — caught only by looking at the live UI, not by the green
test suite. Fixed at the shared-infrastructure level (not per test file):
a new `cleanupEmployeeEngageRows()` in `lib/__tests__/testHelpers.ts`
(the base test-helper layer both `authTestHelpers.ts` and
`employeeTestHelpers.ts` already depend on) deletes every engage row
referencing the employee — as author or reactor, and every child row of
any post they authored or are the subject of — before the `Employee` row
itself is deleted; wired into both `cleanupFullTestEmployee` and
`cleanupTestUser`. The 4 orphaned rows already in the dev database from
earlier runs were purged directly. This is the same class of gap commit A
found and fixed for `Notification`/`UserFavourite`/`DashboardLayout`
against `User.id` — this time against `Employee.id`, and now guarded
against for every future module that adds an Employee-referencing table.

**Frontend**: `pages/employee/engage/EngagePage.tsx` fully rewritten off
real data (previously 100% static mock) — top card with Give Kudos/Create
Poll/inline post composer, a Filters panel (activity type, search,
groups/location/department), the feed itself (`PostCard` handling all 6
kinds including poll voting bars, per-post reactions and comments, and a
moderator-only Hide action), `GiveKudosModal` (debounced employee-search
`Select`), `CreatePollModal`. Takes an optional `initialActivity` prop,
reused by a new, thin `pages/employee/engage/KudosPage.tsx`
(`/app/my-worklife/kudos`) rather than a second parallel kudos
implementation — the frontend's `MeResponse` has no `employeeId` field to
filter a "my kudos" view by otherwise. New
`sockets/useEngageRealtime.ts` listens for all 7 engage events,
invalidating the feed query on post/kudos/reaction/comment and showing a
celebratory toast for birthday/joining/anniversary; wired into
`RequireAuth.tsx` alongside the existing hooks. Admin: `ModerationPage.tsx`
(Visible/Hidden segmented filter, Hide/Restore), `GroupsAdminPage.tsx`
(Table+Modal CRUD plus a Members modal), `AutoPostSettingsPage.tsx`
(per-kind template/enabled cards plus the shared daily-run-hour field with
its restart-to-apply `Alert`) — and `AnnouncementsAdminPage.tsx`, the
admin CRUD screen for commit A's `Announcement` schema that commit A's own
plan explicitly deferred to "whenever Engage admin's screens get built,
since it's one app in the menu" and was never actually built until now.
Menu: `my-worklife/kudos` and all 4 `engage-admin` sub-items lost their
`phase` markers; the `engage-admin` app itself deliberately keeps no
`element` of its own (an app with `menus` auto-redirects `/admin/engage`
to the first sub-item with a real element per `resolveMenuRoutes.tsx`'s
established convention — briefly got this backwards mid-commit, caught by
re-reading that file before it shipped).

**Tests** (10 new files, 69 new tests, 340 across the backend): feed
CRUD/every filter/group-scoping (`posts.test.ts`); kudos give/self-kudos
rejection/live-count correctness/the employee-search picker
(`kudos.test.ts`); poll create/vote/re-vote-moves-not-adds/close
permission-gating/closed-poll-rejects-vote (`polls.test.ts`); reaction
toggle-on/toggle-off/replace (`reactions.test.ts`); comment CRUD
(`comments.test.ts`); group CRUD/membership (idempotent add,
member-not-found on remove)/`engage.groups.manage` gating
(`groups.test.ts`); moderation soft-hide/already-moderated and
not-moderated rejections/the full kudos-count exclusion cycle/
`engage.moderate` gating (`moderation.test.ts`); the 29-February rule
directly, same-day double-run idempotency, the mid-loop-duplicate-key
resilience proof, work-anniversary year-count and less-than-a-year
exclusion, and joining-fires-on-event-not-cron at both the unit and real
HTTP-flow level (`autoPosts.test.ts`, `joiningEvent.test.ts`); auto-post
settings CRUD, the closed-catalog defensive defaults, the daily-run-hour
0–23 validation, and `engage.autopost.manage` gating
(`autoPostSettings.test.ts`).

**Verification**: fresh `migrate reset` + reseed on the shared dev
database (Postgres/Redis needed starting in this fresh container — the
prior session's data had persisted but this session's own migration/seed
state hadn't, caught by `prisma migrate status` before assuming anything
was current; the reset needed a fresh explicit consent from the user per
this codebase's dangerous-AI-action guard); full backend suite green
(340/340, 52 files, zero regressions); `lint`/`typecheck` clean on both
`backend/` and `frontend/`; frontend suite green including the
route-placeholder guard. Live Playwright walkthrough (two simultaneous
employee sessions plus an HR Admin session, chromium headless) proved
real-time delivery end to end without any page reload: Employee A posts →
Employee B's feed updates live; Employee B gives Employee A kudos →
Employee A's feed updates live; Employee A creates a poll → Employee B
votes on it after it syncs live; both persisted correctly across a reload.
HR Admin hid Employee A's post via Moderation → it disappeared from
Employee A's live feed. All 4 Engage admin screens (Announcements,
Moderation, Groups, Auto-Post Settings) exercised directly: a new group
was created and appeared in the table, a template edit on Auto-Post
Settings saved and persisted. All Playwright-generated test data (22 posts,
2 groups, one mutated auto-post-setting row) was purged from the dev
database afterward. Two real bugs were found this way and are detailed
above — the moderation-queue pagination 500 and the orphaned-post "null
just joined us!" test-infrastructure gap — both fixed and re-verified.

### Interim — schema-driven test cleanup, and plans written into the repo

A standalone commit between Phase 5 commits B and C, fixing two process
problems rather than adding features.

**1. The recurring "new table not in the test cleanup" bug, fixed
structurally.** Three commits in a row (Phase 4's leave helpers, Phase 5
A and B) found a new table that FK-referenced `Employee` or `User` but
wasn't in a hand-maintained cleanup helper. It surfaced later as a live FK
violation or, worse, a silent orphan (an optional FK defaults to
`SetNull`, which is how "null just joined us!" reached the Engage feed).
The hand-maintained lists are gone:

- `backend/src/lib/__tests__/cleanup.ts` (new) reads every relation from
  `Prisma.dmmf` and implements `deleteWithDependents(model, ids)`. It
  collects the root rows plus every row depending on them, transitively,
  and deletes children before parents in an order computed from the
  schema. Required FKs always cascade. **Optional FKs need an explicit
  policy** in `OPTIONAL_FK_POLICY`, because the schema can't say whether
  an optional pointer means "belongs to" (an auto-post about an employee,
  so delete) or "merely references" (a seeded `SystemSetting` last edited
  by a test user, or another employee whose reporting manager was a
  fixture, so null the pointer and keep the row). A plain cascade would
  have silently deleted seeded settings.
  `deleteEmployeesAndDependents(ids)` wraps it for per-employee fixtures
  and also removes `AuditLog` rows *about* the employee (`entityId` is a
  polymorphic string, not an FK, so the engine can't see it).
- Every shared cleanup helper (`cleanupTestUser`,
  `cleanupFullTestEmployee`, `cleanupLoginableTestEmployee`,
  `cleanupMinimalTestEmployee`, `cleanupAutoPostTestEmployee`,
  `cleanupTestData`, `cleanupEmployeeTestOrgMasters`, `cleanupTestRole`,
  `cleanupEngagePosts`, `cleanupEngageGroups`) now delegates to the
  engine, with names and signatures unchanged, so no test file needed
  touching for this. `cleanupEmployeeEngageRows` was deleted as redundant.
  About 160 lines of hand-ordered `deleteMany` calls became about 40.
- **Guard test** `backend/src/lib/__tests__/cleanup.test.ts`:
  `findCleanupSchemaProblems()` fails the suite, naming the exact
  model/field and the fix, when an optional FK has no policy, when a model
  isn't reachable from any cleanup root (`Employee`/`User`, or an entry in
  `STANDALONE_ROOT_MODELS` saying how tests remove it), when a policy
  entry has gone stale, or when the graph has a shape the engine can't
  order (a cross-table cycle, a "delete" self-FK, a non-`id` or composite
  FK target). **Mutation-tested**: temporarily adding a model with an
  unclassified optional FK to `Employee` and a model with no FK at all
  made it fail with exactly those two messages; reverting made it pass. A
  functional test builds one employee with rows in every kind of
  dependent table (sessions, a refresh-token rotation chain, notifications,
  favourites, saved views, audit rows by and about them, separation,
  change request, leave request, comp-off lot and ledger, group
  membership, a poll post voted, commented and reacted on by a colleague,
  a kudos, an auto-post, their reaction on a colleague's post). It
  deletes the employee, then sweeps every relation in the schema for
  anything still pointing at them, and asserts that the report's job row,
  the colleague's post and the edited setting all survive with their
  pointers nulled.

**Real leaks this surfaced on a green suite.** A full run on the
pre-change code left 5 employees, a TEST department and branch, and a
role behind every time, all silently:

- `employee/create.test.ts` deleted wizard-created employees with a bare
  `prisma.employee.deleteMany(...).catch(() => undefined)`, which
  FK-failed on their user/personal/job rows. The swallowed error then
  made the org-master cleanup fail silently too. Now uses a new
  `cleanupEmployeesByCode()`.
- `import/leaveGrants.test.ts` never removed its test role. Fixed.
- `leave/accrual.test.ts`'s bulk-driver tests run the org-wide monthly PL
  job, which credits **every** active employee, seeded ones included, and
  never reversed it. That silently changed seeded leave balances in any
  database the suite ran against. It now snapshots existing ACCRUAL rows
  and removes only the ones its run added. Not an FK gap (a job test
  mutating rows it doesn't own), but the same "tests leave residue" class.

**2. Plans live in the repo.** The detailed Phase 5 C–G plan existed only
in an earlier chat session. `docs/plans/PHASE_5.md` (new) reconstructs
it from this file's one-line statuses, the spec, `UI_REFERENCE.md` and the
remaining placeholder routes, marking every item **[recorded]** or
**[reconstructed]**. It records the user's expanded commit E (three-level
hierarchy: Manager Management, per-manager permissions, team-scope
enforcement, validation, plus the two open questions), and notes that
commit G is no longer blocked: the four mobile screenshots are in
`docs/screenshots/` (as `*.png.jpeg`). It also lists the placeholder
routes none of the recorded one-liners own, with a proposed home for
each. CLAUDE.md gains the standing rule: an approved plan is written
into the repo before it's built.

**Verification**: fresh `DROP`/`CREATE` + migrate + seed of
`wellsure_hr_devcheck`. Baseline on the untouched code was 340/340. After
the change the full backend suite is **343/343** (53 files, the 3 new
guard tests included), and a row-count snapshot of the database taken
after the seed is **identical** after the full suite (employees, users,
TEST org masters, roles, posts, ledger, audit log, notifications); the
baseline run had left 5 employees, 2 org masters, 1 role and 28–56
ledger rows. `lint`/`typecheck` clean across all projects; frontend
suite green. No schema, runtime code or UI changed, so no browser
walkthrough applies to this commit.

**Environment gotcha found and documented**: this container exports a
`DATABASE_URL` pointing at an unrelated remote database, and `env.ts`'s
`process.loadEnvFile()` never overrides a variable already set in the
shell. The seed and tests would have targeted it (the connection failed,
so nothing was touched). Added to GETTING_STARTED.md troubleshooting.

### Interim — development-database guard

Follow-up to the environment gotcha recorded in the previous entry: a
`DATABASE_URL` exported in the shell (here, an unrelated remote RDS
database in the cloud dev container) silently overrides `backend/.env`,
and only a failed connection stopped `db:seed` and the suite from using
it. Relying on a remote host being unreachable isn't a safeguard.

- `backend/src/config/databaseGuard.ts` (new): with
  `APP_ENV=development`, `DATABASE_URL` must be local (`localhost`,
  `127.0.0.1`, `::1`, or a Unix socket via `?host=/path`). A `host=` query
  parameter pointing elsewhere, a lookalike such as
  `localhost.evil.example`, or an unparseable URL all count as not local
  (fail safe). Enforced in `config/env.ts`, the one module every entry
  point loads, so it runs before any Prisma or Redis client exists. The
  refusal message masks the password and says whether the value came
  from the shell, overriding `.env` (captured before `.env` is loaded), or
  from `.env` itself, with the fix. No override flag: a remote database
  isn't a development environment.
- Tests: `vitest.globalSetup.ts` loads `config/env` once before any test
  file, so the suite refuses once, loudly, instead of each file failing
  separately. `config/__tests__/databaseGuard.test.ts` covers local and
  non-local URLs, the message, and password masking (12 tests).
- `npm run db:migrate --prefix backend`, which GETTING_STARTED.md already
  documented, didn't exist: only the root script did, and it called
  `prisma migrate deploy` directly. Added `backend/scripts/migrate.ts`
  (loads `config/env`, so it's guarded too, then runs
  `prisma migrate deploy`); the root `db:migrate` delegates to it. The
  Docker image's `migrate` mode (staging/production) is unchanged.
- **Verified live against the real remote URL still exported in this
  container's shell**: `tsx src/index.ts` (the API), `npm run db:seed`,
  `npm run db:migrate`, `tsx prisma/seed.ts` and `vitest run` all exit 1
  with the refusal message before opening any connection. With
  `DATABASE_URL` unset, `.env`'s local scratch database is used,
  `db:migrate` runs, and the full backend suite passes.

### Phase 5, commit C — People directory, org chart, photos, Document Center

The approved plan, with the user's five corrections and four answers, is in
[`docs/plans/PHASE_5.md`](plans/PHASE_5.md) (commit C section, plus an
"As built" subsection for everything that differs or was added). This
entry summarises what shipped and what was found along the way.

**Schema** (migration `20260930102931_add_documents_people_phase5_commit_c`):
- New `DocumentCategory` (admin-editable, `COMPANY`/`EMPLOYEE`), `CompanyDocument`
  (optional branch/department audience, same rule as `Announcement`) and
  `CompanyDocumentDownload` (one row per document and employee: first/last
  download plus count, which answers "who has read the policy").
- `EmployeeDocument` (unused since Phase 1) moves from free-text
  `documentType` to a category FK, and gains title,
  `visibleToEmployee`, and archive fields. The migration refuses to run if
  the table has rows rather than guess a mapping.
- `EmployeePersonal` gains `photoThumbStorageKey` and `photoVersion`.
- **Scope FKs on `Announcement` and `CompanyDocument` go from SET NULL to
  RESTRICT** (see bugs below).
- New permissions: `documents.manage`, `employee.documents.view` and
  `employee.documents.manage`, held by SUPER_ADMIN, HR_ADMIN and
  HR_EXECUTIVE. Never by MANAGER: a manager can't open their team's
  documents.

**Backend:**
- **`modules/people`:**
  - Directory and person endpoints return only what the field-policy
    allowlist (`fieldPolicy.ts`) and the company-wide toggles permit.
    ACTIVE employees only; anyone else 404s.
  - The org chart is one gzipped payload.
  - Photos run through a sharp pipeline: decoded (format judged from the
    bytes), auto-oriented, then re-encoded to a 512 px WebP plus a 96×96
    thumbnail. All metadata, GPS included, is gone, and the original is
    never stored. There's a 64-megapixel decode cap against decompression
    bombs.
  - Photos are served with a 1-hour, photo-only HMAC token, because `<img>`
    can't send the Authorization header. Responses are cacheable per
    version, carry `CORP: same-site`, and the token is redacted from logs.
    Photo tokens stop working when an account is deactivated.
- **`modules/documents`:**
  - Categories.
  - Company documents: an audience-filtered employee list, a management
    list with download counts, upload, edit, archive and unarchive,
    downloads (a 60-second signed URL with the original filename, plus the
    download record), and "who downloaded" stats.
  - Per-employee documents: every route checks permission **and** data
    scope. HR downloads are audit-logged. A visible upload, or flipping a
    document to visible, notifies the employee (persisted, then
    `notification.new`).
  - Uploads check the admin-set size limit, the type allowlist, the
    extension and the file's magic bytes.
- **Settings:** a new People & Documents section (directory toggles,
  photo and document size limits, allowed types), audit-logged.
- **`lib/`:**
  - `audience.ts` (shared scope rule);
  - `uploads.ts` (multer at a hard ceiling, validation, filename
    sanitising);
  - `reportingHierarchy.ts` (the three-level rule, used by the seed
    assertion now and E's enforcement later);
  - `devFixtures.ts` (a tiny valid-PDF generator for the seed and tests);
  - `StorageService.getObject()` and download filenames on signed URLs.

**Seed:**
- The reporting lines now follow Admin → Managers → Employees:
  - 1024 gains `MANAGER` and takes the HR staff (1021–1023);
  - 1005 moves under Admin;
  - 1090 moves under 1002.
- An end-of-seed assertion (`findReportingLineViolations`) fails the seed
  if any reporting manager lacks `MANAGER`, apart from Admin managing
  managers. **Mutation-tested**: putting 1021 back under 1001 made the seed
  fail with that exact line named.
- The seed also refuses a manager referenced before it exists, which is
  the bug below.
- Adds document categories, three company documents (one Sales-only) and
  two documents for Arjun (1006): a visible letter and an HR-only ID proof.
- Adds the four new settings rows.

**Frontend:**
- **People:** a directory with lazy-loaded thumbnails and a person drawer,
  and an Org Chart tab. Teams are collapsed by default; a team's cards are
  only mounted when expanded. Search reveals and highlights a person.
- **Document Center:** Policies & Forms (grouped by category), My
  Documents, and Payslips / Form 16 as "coming" states.
- **Photos:** a `PhotoUploader` on View My Info and in the admin profile
  header.
- **Admin:**
  - The employee profile gains a Documents tab (upload, visibility
    toggle, archive, download).
  - New page: Employee app → Company Documents (Documents and Categories
    tabs, with a "who downloaded" modal).
  - System Settings gains a People & Documents card.
- **Live update:** `document.*` notifications invalidate My Documents.
- `people` and `document-center` are no longer placeholders; the route
  guard enforces it.

**Real bugs found and fixed:**
1. **Scoped content silently went org-wide.** Deleting or merging away a
   branch or department set `Announcement.scopeLocationId` to NULL. That
   bug has existed since commit A. Merge now repoints scoped content,
   delete is refused with a clear 409, and the FK is RESTRICT as the
   database backstop. The existing announcements test was doing exactly
   this, deleting a branch its announcement was scoped to; the new
   RESTRICT caught it.
2. **A raw storage key was writable.** `photoStorageKey` was accepted as a
   free string on create, HR edit and **employee self-edit**. With photos
   served by storage key, anyone could have pointed their photo at a
   colleague's stored ID proof. Removed from all three schemas; a test
   proves a sent value is ignored.
3. **Credentials were in the logs.** pino-http's default serializer logged
   every request header, including `Authorization: Bearer <access token>`
   and the refresh-token cookie. The request log is now an allowlist.
   Verified live: a request carrying three secret markers left zero in the
   log.
4. **Photos 401'd before reaching their route.** `holidaysRouter` is
   mounted at bare `/api` and runs `authenticate` for every `/api/*`
   request that reaches it, so the photo route (token-authenticated) got
   401s. It's now mounted ahead of all `/api` routers, with a comment
   explaining why.
5. **Silent "no manager" in the seed.** Specs are created in array order,
   so a manager defined after its reports silently gave them no manager.
   The seed's own assertion couldn't see it, because it only checks lines
   that exist. Caught when the org chart showed three unexpected
   "unassigned" people. Fixed by failing loudly and reordering.
6. **Test residue** (the cleanup engine now also deletes stored files, and
   guards `*StorageKey`/`fileKey` columns). Its first run found two columns
   it had missed. Also: `totpAndPrivacy.test.ts` deleted the seeded
   `auth.require2faRoles` row instead of restoring it.

**Tests** (9 new files, 45 new tests; 400 across the backend):
- **Directory allowlist guard:** every `Employee`/`EmployeePersonal` column
  must be classified. Mutation-tested: an unclassified `pronouns` column
  was named with the fix.
- **Sentinel test:** a unique marker in every personal text column, with
  all toggles off and then on; only allowed columns may appear, and never
  the birth year. Mutation-tested: emitting `mobile` regardless of its
  toggle was reported as leaked.
- Directory filters, search and pagination; separated employees 404; org
  chart shape and the unassigned group.
- Photos: EXIF/GPS present in the input and absent from both stored
  outputs, sizes, format, rejection of a non-image, a GIF and an oversize
  file, old objects deleted on replace, token required/tampered/expired,
  an access token rejected as a photo token, deactivation, a separated
  employee's photo hidden from colleagues but not HR, `employee.edit`
  gating.
- Company documents: audience 404 on list and download, the signed-URL
  filename and anti-replay, the download record and stats, magic-byte /
  extension / type / size rejections, category rules, archive plus audit.
- Employee documents IDOR: another employee, a manager without the
  permission, and a TEAM-scoped holder of the permission outside their team
  are all refused. Plus HR download audit and the visible-upload and
  flip-to-visible notifications.
- Org: merge carries scoped content; delete is blocked.
- Settings: permission gate, validation, audit, immediate effect.
- The permission matrix against seeded roles.
- The reporting-line checker.

**Verification:**
- Fresh migrate and seed on `wellsure_hr_devcheck`. Full backend suite
  **400/400**, and after the suite the database **and `.storage/`** are
  identical to a fresh seed.
- Lint and typecheck clean everywhere; frontend 4/4.
- **Live Playwright walkthrough:**
  - As a plain employee (Arjun, 1006): directory, drawer, org chart
    (expand, search and highlight), photo upload from a GPS-tagged JPEG
    (renders as a 512 px WebP), and Document Center. He sees the org-wide
    policy but not the Sales-only one, and his letter but not the HR-only
    ID proof. The download arrives with its real filename.
  - As Super Admin: Arjun's photo in the profile header, an HR-only
    document downloaded (audit-logged), a Company Documents publish with
    an Engineering audience (Arjun sees it), the "who downloaded" modal
    (1 of 28), and the settings toggle (mobile numbers then appear in the
    drawer).
  - **Two browsers side by side:** HR uploads a visible letter on Arjun's
    profile, and Arjun's already-open My Documents list and bell update in
    **~360 ms with no reload**.
  - At 390 px width, no horizontal overflow on People, the Org Chart
    (collapsed and expanded), Document Center or admin Company Documents,
    after fixing an org-chart overflow found this way.
- **Org chart at scale (correction 3):** about 490 generated employees on
  the scratch DB (removed afterwards), measured on a production build.
  - The payload is 130 KB of JSON, 13.8 KB gzipped, compressed per route.
    Not app-wide, because responses that mix secrets with user input
    shouldn't be compressed (BREACH).
  - Initial render mounts 27 cards.
  - The first version janked: one team expand blocked 126 ms, and "Expand
    all" blocked for 1.46 s. After switching to memoised plain cards,
    CSS ellipsis, a shared photo token and `startTransition`: one team is
    a single 75 ms block, and **"Expand all" has zero long tasks**, with
    all 488 cards mounted in 184 ms.
- **Console:** only pre-existing messages remain: the expected 401 from
  the login page's silent-refresh probe, AntD's static-`message` context
  warning, and `List` deprecation from the pre-existing notification bell.
  Commit C adds no `List` usages, and fixed one deprecated
  `notification({ message })` call it touched.
- **Docker:** `sharp` 0.35.5 is **verified on Alpine**. In a clean
  `node:20-alpine` container it installs its musl binary and re-encodes a
  GPS-tagged JPEG to a 512×384 WebP with EXIF gone, and the backend
  lockfile carries the `linuxmusl` packages the production image needs.
  The full `docker build -f backend/Dockerfile .`, however, **fails
  before and after this commit alike**:
  - Plain, `npm install` inside the build hits this sandbox's proxy, and
    npm crashes with "Exit handler never called!" yet the RUN step still
    exits 0. That leaves a half-installed image, a silent-failure mode
    worth knowing about.
  - With the sandbox proxy and CA wired in (a scratch Dockerfile, not
    committed), `npm install` gets further and fails compiling **argon2**
    from source: node-gyp can't find Python in `node:20-alpine`. That's
    despite argon2 0.45.1 shipping a `linux-x64/argon2.musl.node`
    prebuild.
  - Building the previous commit (`6df230e`) the same way fails at the
    identical point, so this is **pre-existing, not introduced by commit
    C** (argon2 has been a dependency since Phase 1). Fixed in the
    next commit, "Interim — Docker image fixed".

**Follow-ups, not done:**
- The employee sidebar greeting shows a generic icon, because
  `/api/auth/me` doesn't return the employee id or photo version.
- Whether to compress responses app-wide is a Phase 5.5 decision.
- This container also exports `PORT=3000`, which overrides `.env` the same
  way `DATABASE_URL` did. Harmless, so no guard; documented in
  GETTING_STARTED troubleshooting.

### Interim — Docker image fixed (Node 22), and a silent-failure hole closed

`docker build -f backend/Dockerfile .` had been failing since Phase 1, and
nobody had seen it because CI has never run on GitHub. The repository has
zero workflow runs; `ci.yml` triggers only on pull requests and pushes to
`main`, and neither has happened yet.

**Root cause**, isolated in clean containers outside the repo:
- argon2 0.45.1's prebuilt binaries **segfault on Node 20**, on glibc
  (`node:20-bookworm-slim`) and musl (`node:20-alpine`) alike, despite the
  package declaring support for Node ≥16.
- At install time `node-gyp-build` test-loads the binary, sees the crash,
  falls back to compiling from source, and fails because the image has
  no Python or C++ toolchain.
- On Node 22, the same package installs from its prebuilt binary and works,
  on both Alpine and Debian. Node 20 also reached end-of-life in April
  2026.

**Fix:**
- `backend/Dockerfile` moves to `node:22-alpine`; the OS was never the
  problem, so the base stays Alpine. It adds `openssl` (Prisma's query
  engine needs it).
- `npm install` becomes **`npm ci`** (exact lockfile, fails loudly), plus
  an explicit `npx prisma generate` instead of relying on a postinstall
  side effect.
- A **build-time check** loads argon2, sharp and the generated Prisma
  client, so a half-installed image fails the build rather than the first
  production request. Before this, npm crashed mid-install behind this
  sandbox's proxy ("Exit handler never called!") and still exited 0,
  leaving a broken image that passed `docker build`.
  **Mutation-tested**: a variant that deletes `sharp` after install fails
  the build with "Cannot find module 'sharp'".
- CI's `node-version` and the root `engines` move from 20 to 22, along with
  the Node minimum in CLAUDE.md and GETTING_STARTED.md. Local dev in this
  container already runs Node 22; all 400 backend tests have been passing
  on it.

**Verified:**
- The image builds. This sandbox needs its proxy CA and settings injected
  into the build, done via a scratch Dockerfile generated from the
  committed one with only those lines added after `FROM`; nothing
  sandbox-specific is committed.
- Run against the local scratch database, all four modes work:
  - `migrate` applies migrations;
  - `api` passes `/health` and `/ready`, a real login succeeds (argon2
    verify), and a photo upload re-encodes to a 96×96 and a 512×384 WebP
    with EXIF stripped (sharp);
  - `worker` and `scheduler` start;
  - `api`, `worker` and `scheduler` all shut down cleanly on SIGTERM, exit
    code 0.

### Interim — first real CI run, and why it failed

CI now runs on every push to every branch (`push: branches: ["**"]`, plus
pull requests and manual dispatch). Its first complete run (e9703d7,
2026-10-01) **failed**: the Docker build job passed, but install → lint →
typecheck stopped at **typecheck**, with 266 errors across the backend. Migrate and
Test never ran.

Three problems were found. Each was reproduced on a clean worktree with
only CI's two env vars (`DATABASE_URL`, `REDIS_URL`) and no `.env`:

1. **The Prisma client was never generated on a fresh install.** Nothing in
   `backend/` ran `prisma generate`; it only worked because
   `@prisma/client`'s own postinstall sometimes does it. That hook silently
   leaves an empty stub if it runs before the `prisma` CLI is linked, which
   is what happened on GitHub. Local checkouts had a client generated long
   ago, so nobody noticed. **Fix:** `backend/package.json` now has
   `"postinstall": "prisma generate"`, which runs after every dependency is
   installed. This also covers a fresh clone following GETTING_STARTED.
2. **CI tested an unseeded database.** The backend suite assumes the seeded
   dataset (roles, permissions, leave types, settings, seeded employees),
   just like local runs. Without it, 60 tests failed. **Fix:** a `Seed`
   step (`npm run db:seed`, the same reset + migrate + seed as local dev)
   after `Migrate`. The earlier note (Phase 1) that tests are independent
   of the seed is no longer true and hasn't been for several phases.
3. **A date time-bomb in `recalculator.test.ts`.** The test was written in
   September and assumed only September's PL accrual was due. The
   recalculator diffs through the *current* month, so on 1 Oct 2026 it
   correctly also credited October and the test failed (3 accruals, not
   2). This was a test bug, not a product bug. **Fix:** the file pins
   `Date` to 15 Sep 2026 (`vi.useFakeTimers({ toFake: ["Date"] })`; real
   timers stay real).

Also changed: the Postgres service health check now runs as `wellsure`, which
silences the `role "root" does not exist` log noise.

**Verified locally, end to end:** clean worktree, fresh empty database,
CI's env only. `install:all` → lint → typecheck → check:services →
db:migrate → db:seed → test all exit 0: backend 400/400, frontend 4/4.
The GitHub result for the pushed commit (run #3, green) is recorded in the next entry.

Not covered by CI yet: the frontend has a single route-config test file.
The screen-level checks are the manual Playwright walkthroughs run each
commit, and CI doesn't run them.

### Phase 5, commit D — Helpdesk, Request Hub, Tasks inbox

Plan (approved 2026-10-01, with the user's six answers):
[`docs/plans/PHASE_5.md`](plans/PHASE_5.md) §D. Built as planned except
where noted under **Deviations**.

**CI result first.** The CI fix (fe40e1f, previous entry) ran green on
GitHub as run #3. Install, lint, typecheck, check:services, migrate, seed
and test all ran (backend 400/400, frontend 4/4), and the Docker image
built. One non-blocking warning: GitHub says `actions/checkout@v4` and
`actions/setup-node@v4` target the deprecated Node 20 runtime (forced onto
Node 24 for now). Bumping them is a small follow-up.

**Schema** (migration `20261001063642_add_helpdesk_phase5_commit_d`):
- `HelpdeskCategory`: code, name, `isSensitive`, optional default
  assignee, `isActive`, `sortOrder`.
- `HelpdeskTicket`: `number` is an autoincrement sequence shown as
  `HD-000123`. It also holds raiser, category, subject, `LOW | NORMAL |
  HIGH` priority, optional assignee, `OPEN → IN_PROGRESS →
  WAITING_ON_EMPLOYEE → RESOLVED → CLOSED`, `resolvedAt`, `closedAt` and
  `lastActivityAt`.
- `HelpdeskMessage` (with `isInternalNote`) and `HelpdeskAttachment`.

Cleanup classification: assignee and default assignee are `setNull`, the
attachment `fileKey` is a storage column, and `HelpdeskCategory` is a
standalone root.

**Permissions and seed:**
- `helpdesk.manage`: HR_EXECUTIVE, HR_ADMIN, SUPER_ADMIN.
- `helpdesk.sensitive.view`: HR_ADMIN, SUPER_ADMIN.
- Settings `helpdesk.autoCloseDays` and `helpdesk.reopenWindowDays`, both
  7.
- Six categories. **Payroll & Salary** and **Grievance** are sensitive.
- Three tickets: Arjun (1006) has a resolved comp-off question with an
  internal note and an open address-proof request; Rahul (1010) has an
  in-progress payroll (sensitive) ticket.

**Backend:**
- `modules/helpdesk`:
  - One access decision per ticket (`resolveAccess`). The raiser gets the
    raiser view. HR needs `helpdesk.manage`, plus `helpdesk.sensitive.view`
    for sensitive categories, and never handles a ticket they raised.
    Anything else is a 404.
  - Internal notes and their attachments are filtered out server-side for
    the raiser.
  - Status follows the conversation: the raiser replying to Resolved or
    Waiting-on-you hands the ticket back to HR, HR's first public reply
    moves Open to In progress, and internal notes never change status.
  - The reopen window is enforced on both replies and Reopen.
  - Every response carries `autoClosesAt` and `reopenUntil`, computed in
    one place (`lib/helpdeskSettings.ts`) that the job also uses.
  - Audited: raise, status/priority/assignee changes (before/after),
    reopen, auto-close, category create/update (sensitive flag included),
    and every HR view of a sensitive ticket.
  - Notifications go to the other side on every reply, status change and
    assignment, persisted and pushed live.
- **Attachments** go through the new `prepareDocumentUpload`
  (`lib/uploads.ts`): size, type, extension and magic-byte checks, then a
  sharp re-encode of JPEG/PNG that drops all metadata, EXIF and GPS
  included. At most 3 files per message; multer's limit errors are
  translated into readable messages. Downloads use 60-second signed URLs.
- **Fixed gap from commit C:** Document Center and HR-held employee
  document images were stored with their metadata intact. Both now use
  the same `prepareDocumentUpload`, and there's a test for each.
- **Auto-close job** `helpdesk-auto-close` (worker + scheduler). It's
  idempotent: a raced reply wins, and a retried run touches nothing.
- **Request Hub** `GET /api/request-hub` (`modules/requestHub`). My leave
  requests, profile change requests and tickets, normalised into one list
  (shared types in `shared/types/inbox.ts`) with type and open/closed
  filters pushed into each source's query. Always self-scoped. Sources
  sit in `REQUEST_HUB_SOURCES`, so regularizations (Phase 3) and
  reimbursements (Phase 6) add one entry each.
- **Tasks inbox** `GET /api/tasks/mine` (`modules/tasks`), with no new
  schema (user decision 1). It lists, oldest first:
  - pending leave I can decide (`leave.approve`, my data scope, never my
    own);
  - pending profile change requests (`profile.changerequest.approve`,
    never my own);
  - Open or In-progress tickets assigned to me (sensitive ones only with
    the permission).

  Each source uses the same rules as the screen that acts on the item.
- System Settings → Helpdesk: `GET/PUT /api/settings/helpdesk`
  (`settings.manage`, 1–90 days each, audited).
- Real-time: `helpdesk.queue` goes to the HR role rooms and
  `helpdesk.ticket` to the raiser and assignee. Both are signal-only, so
  no ticket content rides on a socket. An internal note signals only the
  assignee.

**Frontend:**
- Employee `/app/helpdesk`: Active/Closed/All list, Raise ticket
  (category, subject, description, priority, up to 3 attachments).
  Resolved rows say "Closes automatically on …".
- Employee `/app/helpdesk/:id`: the thread. A resolved ticket shows the
  banner "Resolved — this ticket will close automatically on 8 Oct,
  12:47 pm unless you reply". A closed one shows "reopen until …" with a
  Reopen button, or tells the employee to raise a new ticket.
- `/app/request-hub` (In progress / Completed / All, type filter).
- `/app/todo/tasks` and the admin **Tasks** app share one `TasksInbox`;
  each row opens the screen where the item is handled.
- The Home **Track** card now reads the Request Hub (open items, any
  module).
- Admin **Employee → Helpdesk**: the queue (status, category and
  assignee filters, live) and the thread at
  `/admin/employee/helpdesk/:id`, with status, priority and assignee,
  internal notes styled unmistakably, and the sensitive tag.
- **Admin Tools → Helpdesk Categories**: sensitive and active toggles,
  default assignee, add category.
- A Helpdesk card in System Settings.
- Feedback re-marked `phase: "Phase 8"`.
- The employee layout maps detail paths (`helpdesk/<id>`) to their menu
  entry for the page title and highlighted item.
- Dates are formatted in Asia/Kolkata (`lib/dates.ts`) whatever the
  browser's timezone.

**Deviations from the plan, and why:**
1. **The auto-close job runs hourly (at :05), not daily.** With a daily
   run, a ticket could close up to 24 hours after the time the employee
   was shown, which works against decision 5. Hourly keeps the actual
   close within the hour; the job is idempotent and cheap. A test pins
   that the job closes exactly at the shown time and not a millisecond
   before.
2. **The admin helpdesk lives under the Employee app** (next to Change
   Requests), at `employee/helpdesk`. UI_REFERENCE doesn't place it and
   greytHR's admin tiles have no Helpdesk app. Links come from one shared
   helper (`helpdeskAdminPath`/`helpdeskEmployeePath`), so moving it later
   is a one-line change.
3. **Home Track card bug fixed on the way.** It listed pending leave with
   no employee filter, so anyone holding `leave.view` (managers, HR) saw
   *other people's* pending leave labelled as their own tracking. It now
   reads the always-self-scoped Request Hub.

**Known limitation, for E1:** `helpdesk.queue` is sent to fixed role rooms
(`role:HR_ADMIN`, `role:HR_EXECUTIVE`, `role:SUPER_ADMIN`). Once E1 makes
permissions assignable to any role, a custom role holding
`helpdesk.manage` won't get the live queue refresh; it still sees the
right data on load. Nothing leaks, since the signal carries no content.
E1 should add permission-keyed rooms, or emit per holder.

**Tests:** 31 new, in 4 files.
- `helpdesk/__tests__/helpdesk.test.ts` (19):
  - the seeded permission matrix and sensitive categories;
  - raise, validation, internal notes (thread, notification, and socket
    rooms via a recording fake server);
  - IDOR for another employee, a manager, a missing ticket, and the raiser
    managing their own ticket;
  - HR never handling their own ticket;
  - sensitive hidden from HR_EXECUTIVE in the queue and on direct access,
    with an audited HR_ADMIN view;
  - toggling the flag (immediate effect, audited before/after);
  - assignment rules, notification and audit, and default assignee;
  - all status transitions, the auto-close and reopen dates (and that
    they follow the setting), and the reopen window for replies and
    Reopen;
  - category admin, and the settings endpoint.
- `attachments.test.ts` (4): JPEG and PNG stored with no EXIF/GPS (and
  the recorded size is the re-encoded one) while PDFs are stored as-is;
  disguised, mismatched-extension, disallowed, oversize and too-many
  uploads are refused with nothing stored; download IDOR, including an
  internal note's attachment; Document Center and employee-document
  images stripped.
- `autoClose.test.ts` (2): closes at exactly the shown time, idempotent,
  audited and notified; follows the setting; leaves non-resolved tickets
  alone. It runs the global job against 2020 dates, so no seeded or real
  ticket can be touched.
- `tasks/__tests__/inbox.test.ts` (6): Request Hub union, self-scoping,
  type/state filters and the auto-close field; Tasks inbox per role
  (manager team-only, never own; HR_EXECUTIVE change requests and
  assigned tickets, never resolved or sensitive; HR_ADMIN org-wide; a
  plain employee gets nothing).
- **Mutation-checked:** removing the internal-note filter, removing the
  sensitive-category check, or skipping the image re-encode each fails
  the relevant tests.

**Verified:**
- Fresh `wellsure_hr_devcheck`: dropped and recreated, then
  `db:migrate` + `prisma db seed`. Prisma's own AI-agent gate refuses
  `migrate reset`, and it was not bypassed; this database is covered by
  the standing consent.
- Backend **431/431** (67 files), frontend 4/4, lint and typecheck clean.
- No residue: ticket, category, employee, notification and leave counts
  are identical before and after the run, and no stored files are left.

**Two-browser walkthrough** (Super Admin 1000 and Arjun 1006, side by
side; Playwright):
- Arjun raises a Payroll & Salary ticket with a GPS-tagged photo, and the
  HR queue shows it **without a reload**.
- HR assigns it to themselves and adds an internal note. Arjun's thread
  never shows it, but does show the attachment. The stored photo has no
  EXIF and no marker bytes.
- HR's public reply appears in Arjun's open thread live (~0.2 s), and the
  status moves to In progress.
- The admin Tasks app lists the assigned ticket.
- HR resolves it, and Arjun's open thread shows "Resolved — this ticket
  will close automatically on 8 Oct, 12:47 pm unless you reply" live,
  with a matching toast.
- The Request Hub's Completed tab shows "Closes automatically on 8 Oct
  2026 unless you reply".
- Home Track lists Arjun's open address-proof ticket, and his Tasks
  inbox is empty.
- Helpdesk Categories, the System Settings Helpdesk card and the
  Feedback "Phase 8" placeholder all checked.
- At 390 px the ticket page has 0 px horizontal overflow.
- Console: only pre-existing noise. The 401s are `/api/auth/refresh` on
  the login page (silent refresh before any session exists), and AntD's
  static `message`/`List` deprecation warnings predate this commit.

**Docs corrected:** GETTING_STARTED's account table said Super Admin and
HR Admin have "2FA required". The seed currently sets
`auth.require2faRoles` to `[]` (disabled fleet-wide, chore 7f99cfd), so
the table now says so.

**Next:** D2 (letter templates + PDF generation with headless Chromium,
plus the image-size note in DEPLOYMENT.md), then E1.

### Interim — attendance approach recorded (Phases 2–3 built before the device)

Recorded for the record (user, 2026-10-01). Nothing was built; the
current work order (D2, then E1–E3, F, G) is unchanged.
- **Phases 2 and 3 are built completely without the physical device.**
  That's ingestion, the rules engine, shifts, week-offs, exceptions,
  regularization, muster, manual entry, period finalisation, and every
  screen and report, all production-ready. **The device connection is the
  final step, not the first.**
- A **punch simulator** is a first-class tool (spec §4.6). It covers
  realistic ATTLOG streams and the hard cases, replays a month for 500
  employees, and drips single punches live. It goes through the real
  ingestion routes, never the database.
- **Three ingestion routes, one ingestion service and one dedupe** (spec
  §4.1):
  - the sync agent, as the primary route (Windows service, 30 s polling,
    cursor, backoff, catch-up, heartbeat);
  - ADMS push;
  - a manual file upload through the Import Center, emergency only. The
    greytHR-style month-end export is no longer the daily process.
- **Device and agent health monitoring** is built in Phase 2 (spec §4.7):
  silence alerts during working hours, a morning check, and the Devices
  screen.

Updated:
- `docs/PROJECT_SPEC.md`: §4.1 rewritten, §4.2, §4.3, new §4.6 and §4.7,
  §7.3, the §12 Phase 2/3 scope and done-criteria, §14, §15.4.
- `docs/plans/PHASE_2.md` (new).
- `biometric-agent/README.md`.

**ATTLOG format: confirmed (follow-up, same day).** The user re-supplied a
real export from our device. It had been given in an earlier session but
was never written into the repo, so this entry's first version wrongly
recorded the layout as an assumption. Spec §4.1 now has the confirmed
format and the sample itself:
- six tab-separated columns: device user ID, timestamp, status, verify,
  workcode, reserved;
- **status is always 1, so the direction is inferred** (first punch IN,
  last OUT);
- **device user IDs are 2–126, not Employee Codes**, so §4.3 now maps
  punches only through `device_user_mappings`;
- the sample's three-seconds-apart duplicate (user 113) is a mandatory
  test fixture.

The ATTLOG open question is removed. One new question: §3's
pre-filling of Employee Code from Device User ID conflicts with those
low device IDs.

### Phase 5, commit D2 — Letter templates and PDF generation

Plan (approved 2026-10-01): [`docs/plans/PHASE_5.md`](plans/PHASE_5.md)
§D2. The user's answers:
- letters only (system emails become editable in a later commit);
- offer letters are generated against the employee record, with CTC and
  similar figures typed in (spec §12 Phase 6 now says to revisit this);
- all five letters are visible to the employee by default;
- the editor is TipTap;
- **letters are legal documents: always reproducible, never overwritten.**

**Schema** (migration `add_letters_phase5_commit_d2`):
- `LetterTemplate`.
- `LetterTemplateVersion` (append-only; the current version is the
  highest number).
- `GeneratedLetter`:
  - reference `LTR-000123`, the template version, **frozen merge values**
    (already formatted, plus a letterhead snapshot with the logo's storage
    key and hash), and **`generatedAt`**;
  - status, the document link, the PDF SHA-256, the renderer version, and
    `reissueOfId`.

**Immutability, enforced in Postgres**, so no code path can break it:
- template versions can't be updated;
- an issued letter's content can't change (only the worker's
  `QUEUED → GENERATED/FAILED` step is allowed);
- **an employee document's file (key, name, type, size) can't change after
  insert, for every employee document;**
- `generated_letters → employee_documents` is `ON DELETE RESTRICT`.

The service additionally refuses title/category edits on a letter's
document (`LETTER_IMMUTABLE`). Reissue always creates a new letter and
document.

**Permissions:** `letters.template.manage` (HR_ADMIN), `letters.generate`
(HR_ADMIN, HR_EXECUTIVE), plus data scope on every issue/read (404 out of
scope).

**Rendering** (`lib/pdf/renderer.ts`): headless Chromium via
`puppeteer-core`:
- **JavaScript off, every network request blocked** (tested with a local
  probe server that receives nothing);
- **one bundled font** (Noto Sans, OFL, including ₹), embedded, so the
  machine's fonts don't matter;
- PDF metadata dates are fixed to `generatedAt`.
- **Verified byte-identical** across renders, browser restarts and separate
  container runs, on the same Chromium version.

Templates are sanitized to a formatting allowlist. Placeholders come from
a closed catalog (`shared/constants/letters.ts`) plus each version's typed
fields; unknown or half-formatted ones are refused at save. Merge values
are HTML-escaped. Letters use the employee's details **as in force on the
letter's date** (name and job, from the effective-dated histories).

**Flow:**
1. HR issues from the employee's Documents tab.
2. The API checks permission and scope, resolves and freezes every value,
   allocates the reference (only after the values resolve, so refusals
   don't burn numbers), and queues `letters-generate`.
3. The worker renders, stores the file and files it under Letters, in one
   transaction that can only complete a `QUEUED` letter (a duplicate job
   is a no-op).
4. The employee is notified, and HR's table updates live.

Also:
- **Reproduce** re-renders from the stored version, values and timestamp,
  and says whether it matches the stored hash.
- **Preview** renders a draft against any employee and stores nothing.
- The letterhead (legal name, address, logo with a new storage key per
  upload) and the signatory live in System Settings → Letters. Issuing is
  refused until they're set.

**Found and fixed on the way — live updates from background jobs never
arrived.**
- Only the `api` process had a Socket.IO server, so every `emit*()` made
  inside a BullMQ job was silently dropped. That affected:
  - this commit's "letter ready";
  - commit D's helpdesk auto-close;
  - Phase 5 commit B's daily Engage auto-posts and their notifications.

  The persisted notifications still showed on the next page load, which is
  why it went unnoticed.
- **Fix:** the `worker` now installs a Socket.IO **Redis emitter**
  (`realtime/emitter.ts`), publishing through the same Redis adapter the
  api uses.
- `realtime/__tests__/workerEmitter.test.ts` proves an emit from an
  emitter-only process reaches a browser connected to an api server.
- In the walkthrough, "letter issued" reached HR's and the employee's
  screens in about 0.27 s.

**Also:**
- `npm run dev` now starts the worker too (api + worker + frontend).
  Otherwise an issued letter waits for a worker forever locally.
- `requireAnyPermission()` added: the template list serves both editors
  and issuers.
- The letters queue is created lazily in `jobs/lettersQueue.ts`, so the api
  and tests don't open Redis connections they never use.
- The seed has five starter templates in our own wording (marked "draft —
  HR to review"), an obviously-placeholder letterhead (ASCII-only, so no
  font fallback), and the fake HR Admin as signatory.
- CI sets `CHROMIUM_PATH=/usr/bin/google-chrome` (the GitHub runner's
  Chrome), so PDF tests run for real there.

**Docker image** (measured; details in `docs/DEPLOYMENT.md`): 379 MB →
**804 MB**. Chromium accounts for +322 MB and the npm dependencies for
+103 MB (mostly test-only packages present because the image installs dev
dependencies; that's Phase 5.5 hardening). A build-time check starts
Chromium.
- Letters render inside the container, and the metadata-IP request is
  blocked there too.
- The container's Chromium 152 and this machine's Chrome 141 produce
  different bytes for the same letter. So "reproduce" is exact per
  renderer version, and each letter records its version. The stored PDF
  is always the record of what was sent.

**Tests:** 30 new.
- `letters/__tests__/template.test.ts` (7): sanitizer; placeholder
  validation (unknown, split by formatting, stray braces, undefined
  extras); key rules; escaping; and that every seeded template passes the
  editor's own validation *unchanged*. That last check caught the seed
  being stored in a non-normalised form.
- `letters/__tests__/letters.test.ts` (14), against real Chromium and the
  database:
  - the permission matrix, route gates, and versioning (v1 unchanged after
    v2; an unchanged save adds nothing; this caught a real bug, because
    `jsonb` reorders keys, so the no-op check now compares canonically);
  - issuing end to end, with the PDF text extracted (reference, ₹
    amount, name), the notification, audit, queue job, **byte-identical
    reproduce**, and an idempotent second job run;
  - the name as of the letter date despite a scheduled rename; manager
    data scope (404 outside the team);
  - up-front refusals that don't consume a reference (missing field, no
    separation, incomplete letterhead);
  - all five seeded templates rendering for a leaver with no literal
    `{{`;
  - reissue leaving the original byte-for-byte intact; **database triggers
    refusing every rewrite**; the letter document title lock;
  - render failure → `FAILED` with a reason and nothing filed; the
    network-blocking probe; preview storing nothing.
- `realtime/__tests__/workerEmitter.test.ts` (2).
- **Mutation-checked:** disabling the triggers fails the database test,
  and letting the renderer allow network requests fails the SSRF test.

**Verified:** fresh `wellsure_hr_devcheck` (drop, recreate, migrate,
seed); backend **454/454** (70 files); frontend 4/4; lint and typecheck
clean across all projects; no row or file residue. Two-browser walkthrough (Super Admin and Arjun):
- set the letterhead and logo;
- edit the Offer Letter in TipTap (placeholder from the menu) and save a
  new version (history shows each);
- preview with Arjun (the PDF opens);
- issue with CTC: HR's table goes Generating → Issued **live** and
  Arjun's Document Center shows the letter **live**;
- Reproduce reports "identical"; Reissue creates `LTR-…` "reissue of"
  with the original kept;
- 0 px overflow on mobile.

### Phase 5, commit E1 — Role & permission system

Plan: [`docs/plans/PHASE_5.md`](plans/PHASE_5.md) §E1 (approved
2026-09-30); as-built notes directly below it. The user's requirements:
- every permission always for SUPER_ADMIN, computed in code;
- never revocable, by anyone including itself;
- scope always ALL;
- the last active SUPER_ADMIN protected from deactivation, demotion and
  separation, with two real Super Admins planned for production;
- seeded accounts stay fake;
- a runtime-only bootstrap for the first real Super Admin;
- a documented recovery procedure.

**Schema** (migration `e1_roles_permissions_lockout`):
- `Role.dataScope` (`SELF | TEAM | ALL`), backfilled to today's mapping.
- `UserPermissionOverride`: GRANT or REVOKE, with a required reason;
  unique per user and permission.
- `role.manage` is retired.
- Triggers on `users` and `user_roles` refuse any change that would leave
  zero active SUPER_ADMINs.

**Backend:**
- One access resolver, `resolveAccess` in `lib/permissions.ts`, used by
  HTTP auth, sockets and `/me`.
- `modules/access`: role list and edit, per-person access, overrides, role
  assignment, and the security actions (reset 2FA, unlock, password reset).
  Rules 1–8 are enforced and audited.
- `lib/accessCatalog.ts` gives never-seeded databases their roles.
- Permission-keyed socket rooms, plus `permissions.changed`.

**CLIs** (`backend/scripts/`):
- `npm run admin:bootstrap`: the first real Super Admin. It refuses once an
  active one exists, takes details from prompts, flags or `BOOTSTRAP_*`
  env vars, and never handles a password (the person gets the invitation).
- `npm run admin:recover`: break-glass reset of 2FA, unlock or
  password-reset link for a Super Admin.

Both are documented in GETTING_STARTED.md §12, together with the four-step
recovery procedure (the last resort is direct SQL, which was tested).

**Frontend:**
- Admin Tools → Roles & Permissions: one column per role, permissions
  grouped by area, a scope selector, and a locked Super Admin column.
  Super Admins can edit; `role.view` holders see it read-only.
- Employee profile → Access tab: roles, effective permissions and where
  each comes from, exceptions with reasons, and the sign-in security
  buttons.
- `usePermissionsRealtime` refetches `/me` live.

**Seed:** unchanged accounts. Roles and permission rows now come from
`ensureAccessCatalog` (the same code as production).

**Verification:**
- devcheck dropped, recreated, migrated and seeded.
- Backend **483/483**, including a new 29-test `access.test.ts`. It covers:
  - every rule;
  - the Super Admin keeping everything after its role rows are deleted;
  - lockout through the API, the triggers, separation and the job;
  - override order;
  - out-of-scope 404s;
  - audit rows;
  - permission rooms and `permissions.changed`;
  - the bootstrap, run end to end on a simulated fresh database;
  - recovery;
  - the catalog.
- Frontend 4/4. Lint and typecheck are clean.
- Two-browser walkthrough:
  - Super Admin grid locked;
  - HR read-only;
  - employee gets a 403;
  - a grant on the Access tab reaches the employee's open browser live
    (their `/me` now includes the key), and removing it reverses that;
  - removing the last Super Admin's role shows the refusal message.
- Both CLIs smoke-tested against devcheck. The bootstrap refused because
  seeded `1000` exists, and the recovery CLI refused a non-Super-Admin.

**Still open:** none new. The real Super Admins are created with the
bootstrap during Phase 1.5 staging setup, and their details never enter
the repo.

### Phase 5, commit E1.1 — Append-only audit log, loud break-glass recovery, manager data leaks

Plan: [`docs/plans/PHASE_5.md`](plans/PHASE_5.md) §E1.1 (approved
2026-10-02); as-built notes and the manager-leak survey directly below it.

**Audit log made append-only at the database level.** Spec §9 has said
"append-only" since Phase 1, but nothing enforced it until now.
- Migration `e1_1_audit_append_only_security_events` adds triggers that
  refuse UPDATE, DELETE and TRUNCATE on `audit_logs`.
- The test-only exception needs a session flag **and** a row in
  `dev_database_marker`. Only the dev seed writes that row, so a
  never-seeded production database has no exception.
- The actor column is no longer a foreign key.
- Test cleanup goes through `purgeAppendOnly`.

**Break-glass is loud** (`lib/securityAlerts.ts`). `admin:recover` and
`admin:bootstrap`:
- write a `security.breakglass` log line first, outside the database;
- email every active Super Admin (the target included) and the new
  optional `SECURITY_ALERT_EMAIL` **before acting**. They stop if email
  fails, unless `--mail-is-down` is given, in which case the alert is
  queued (`security-alert-email`, retried for 24 hours, sent by the
  worker);
- create an append-only `security_events` row. It shows a red banner to
  every Super Admin on every admin page until a Super Admin other than
  the target acknowledges it (audited), and notifies each Super Admin.

**Recovery CLI inputs.**
- `--reason` (≥10 characters), `--operator` and `--confirm-no-other-admin`
  are required.
- It lists the other active Super Admins and when each last signed in.
- All of these are recorded on every action's audit entry. Unlock now
  records its reason; E1 had dropped it.

**In-app resets tell the person.** Reset 2FA, unlock and password reset
from the Access tab email the target with who did it and why. Unlock now
takes a reason.

**Manager data leaks fixed.** Four endpoints served company-wide data to
managers; they now apply data scope:
- the Admin dashboard;
- the leave dashboard;
- the leave calendar, including a no-department hole;
- former employees' photos.

The full survey is in the plan.

**Spec.**
- §9 states the honest limit plainly: a shell operator can bypass the
  tools, and the real control is the records outside the database.
- §12 Phase 1.5 and DEPLOYMENT.md list the wiring that has to exist:
  - a CloudWatch alarm on `security.breakglass`;
  - ECS Exec session logging and CloudTrail;
  - an app database role without UPDATE/DELETE on the audit tables;
  - RDS log export or pgaudit;
  - `SECURITY_ALERT_EMAIL`.

**Verification:**
- devcheck dropped, recreated, migrated and seeded.
- Backend **492/492**, including the new `securityAlerts.test.ts`. It
  covers:
  - the triggers, including that the exception fails without the marker;
  - email to every Super Admin before acting, and the log line before the
    email;
  - mail failure changing nothing, and `--mail-is-down` queueing the alert;
  - the banner, and that the target can't acknowledge their own event;
  - the operator, reason and justification on every audit row;
  - the target being emailed on an in-app reset;
  - all four leak fixes.
- Frontend lint, typecheck and tests clean.

### Interim — test isolation and CI determinism (2026-10-02)

Prompted by a docs-only commit failing CI (run #11). The user's bar: a red
CI run must always mean a real problem.

**What happened.** Two separate things:
- **CI run #11:** two letters tests that render a real PDF in headless
  Chromium hit vitest's 5 s default timeout on a slow runner. The same code
  was green before and after.
- **Locally only:** a dev worker left running consumed the test suite's
  queued letter jobs. Both used Redis database 0.

**Fixed (commits 8699238, d77a4ff, a9a4606):**
- **Redis isolation.** Under vitest, `config/env.ts` moves the suite to its
  own Redis logical database (`REDIS_TEST_DB`, default 15): queues,
  caches and rate limits. It also gives the suite its own Socket.IO pub/sub
  channel (`SOCKET_IO_REDIS_KEY` + `-test`), because Redis pub/sub isn't
  scoped by database number. It refuses to start if dev's `REDIS_URL`
  already uses the test database. `testRedisIsolation.test.ts` proves a
  job queued on either side is invisible to the other. A running
  `npm run dev` can no longer take or see the suite's jobs and broadcasts.
- **Timeouts.** A global `testTimeout` of 30 s and `hookTimeout` of 60 s.
  They only change how long a genuinely stuck test takes to fail. The
  e-mail polling helpers got a 20 s deadline.
- **Wall-clock coupling.** The e-mail polling helpers compared file mtimes
  with the process clock, which is fragile on coarse-mtime filesystems.
  They now match on the unique recipient.
- **Tests that read "the newest audit row in the database"** instead of
  their own:
  - the export test could be beaten by the seed's sample export row;
  - the settings test would have passed even if its own write logged
    nothing.

  Both are now scoped to their own actor. No other unscoped audit lookups
  remain.

**How determinism was checked.** Not by inspection alone. Seed and the
full suite were run with the process clock shifted (a `node --import`
preload) to:
- 31 Dec 19:00 UTC, already 1 Jan in IST: a leave-year rollover;
- 28 Feb 19:00 UTC, already 1 Mar in IST: a month end;

as well as at the real time. The only failure at the shifted instants was
the export-test lookup above (fixed, then re-verified at the shifted
time). The full suite on a fresh seed is 495/495. Expected-error noise in
the Postgres log (duplicate keys, trigger refusals) comes from negative
tests and is not a failure signal.

**What can still make CI red without a code defect** (known and accepted,
each recognisable):
- **External services:** npm registry, Docker Hub / Alpine package mirrors,
  GitHub's runner or service containers. These fail in the Install,
  Docker-build or "Initialize containers" steps, not in Test. If Test
  itself is red, treat it as real.
- **A run that straddles IST midnight** (18:30 UTC) could see "today"
  change between a fixture being created and asserted on. The window is
  the few seconds of any one test. It hasn't been observed, but the
  shifted-clock runs can't rule it out.
- **The runner's Chrome is updated with GitHub's runner image.** PDF tests
  compare renders within one run, so an update can't cause a mismatch. A
  real rendering regression in new Chrome would still show as a
  (legitimate) failure.
- ~~**Locally only:** tests share the Postgres database with the dev app, so
  changing settings in the dev UI during a run can interfere.~~ **Fixed**
  in the interim commit after E2 (below): the suite has its own database.

### Phase 5, commit E2 — Three-level hierarchy, Manager Management, manager-grantable list, endpoint audit

Plan: [`docs/plans/PHASE_5.md`](plans/PHASE_5.md) §E2 (approved
2026-10-02); as-built notes directly below it. Spec §2 rewritten (§2.1
hierarchy, §2.2 manager-grantable list, §2.3 access rules).

**Hierarchy model A.**
- Super Admins are a synthetic Admin root.
- Managers and HR Admins have no reporting manager.
- Everyone else reports to one active `MANAGER` holder, or is
  Unassigned.

`lib/reportingHierarchy.ts` holds the rules. They are enforced in:
- Add Employee and Change job details;
- Manager Management;
- role assignment (`MANAGER` only with `EMPLOYEE`; top-level roles clear
  the reporting line);
- the Excel import;
- the seed assertion.

A manager's or HR Admin's own leave notifies every Super Admin.

**Manager Management** (Admin Tools; three new keys `manager.appoint`,
`manager.team.assign` and `manager.permissions.manage`, held by HR_ADMIN
via migration `e2_manager_management_permissions`):
- the managers list with team size ("No team yet");
- appoint, and remove (refused while the team isn't empty; needs the
  person's new manager);
- team moves as effective-dated job rows (future dates refused);
- the Unassigned list with a reason and a bulk assign, plus its count on
  the Admin home;
- a per-manager Permissions drawer.

Every action is audited. `team.changed` reaches the old and new managers
live.

When a manager with a team separates, the team becomes Unassigned and
team-assigners are notified.

**The manager-grantable list** is enforced on the role, on overrides and at
access resolution, even against a Super Admin:
- `employee.view`, `leave.view`, `leave.approve`, `leave.apply.onBehalf`,
  `employee.documents.view` and `letters.generate`;
- TEAM scope at most;
- bank and statutory data never.

The screens disable non-grantable choices for managers ("Not for
managers").

**Endpoint audit.**
- `routeInventory.test.ts` walks the real Express mounts (`API_MOUNTS`)
  and the permission gates tagged on each route. It fails if a route is
  unclassified, stale, or classified inconsistently with its gate.
- `managerReach.test.ts` has an IDOR case for each of the 26 scoped
  routes a manager can reach: an outsider's record is a 404, a team
  member's works.

No new leak was found beyond the four E1.1 fixed.

**Org chart.**
- An Admin root card names the Super Admins.
- Managers carry "Manager · N" or "Manager · No team yet"; HR Admins
  carry "HR Admin"; plain employees carry neither. This resolves the
  Rohan Mehta ambiguity.
- An Unassigned group shows to `manager.team.assign` holders only.

**Seed.**
- Managers and 1001 have no reporting manager.
- New fake accounts: **1029 Farhan Qureshi** (a manager, no team) and
  **1030 Leela Menon** (Unassigned).
- 32 employees.

**Verified:**
- a fresh devcheck seed;
- the full backend and frontend suites, lint and typecheck;
- a two-browser walkthrough:
  - HR assigns Leela to Farhan, and Farhan's All Employees grid shows her
    without a reload;
  - the org chart badge goes from "No team yet" to "1";
  - a manager gets "You can't manage managers";
  - a manager's Permissions show bank data as "Not for managers";
  - no console errors.

### Interim — the test suite gets its own Postgres database (2026-10-02)

The user asked for the Redis pattern to be applied to Postgres too, so dev
can stay running during a test run with no interaction at all.

**What changed:**
- **Postgres.** Under vitest, `config/env.ts` (`isolateTestDatabase`)
  points the suite at its own database on the same server:
  `TEST_DATABASE_NAME`, default `<dev database>_test`, so
  `wellsure_hr_test` locally and in CI. It refuses to start if dev's
  `DATABASE_URL` already points there. `lib/prisma.ts` now takes its URL
  from `config/env` instead of Prisma's own read of `process.env`, so the
  isolation applies to every query.
- **Files.** Uploads, letter PDFs and `.eml` files from tests go to
  `.storage-test/` and `.mail-test/` (gitignored), never dev's `.storage/`
  and `.mail/`.
- **Every run starts from the same state.** `vitest.globalSetup.ts`:
  1. drops and recreates the test database;
  2. migrates it (`scripts/migrate.ts`);
  3. seeds it (`prisma db seed`);
  4. flushes the test Redis database;
  5. empties the test folders.

  This takes about 7–14 s. A leftover from an earlier, interrupted run can
  never leak into the next one.
- `testDatabaseIsolation.test.ts` checks:
  - the suite's connection is to its own database and dev's is untouched;
  - the database was migrated and seeded by the setup;
  - the folders are separate;
  - the refusal.
- Needs the `CREATEDB` privilege, which §3 of GETTING_STARTED already
  requires.

**Verified:**
- The full backend suite (539/539) ran while the dev api, worker and Vite
  were up and the E2 browser walkthrough was logging in and reassigning a
  team on the dev UI at the same time. Both passed.
- Afterwards the dev database held only the walkthrough's audit rows
  (logins, one team assignment) and the seed's 32 employees. Nothing from
  the test run.

CI still migrates and seeds `wellsure_hr` before testing. That checks the
dev setup path works from scratch; the suite itself then builds
`wellsure_hr_test`.

### Phase 5, commit E3 — Workflow Delegates

Plan and as-built notes: [`docs/plans/PHASE_5.md`](plans/PHASE_5.md) §E3,
written from the user's requirements of 2026-10-02 before building. Spec
§2.4 added.

**What a delegation is.** A manager hands their leave approvals to
someone who **already holds `leave.approve`**, for an inclusive date range.
- Nothing is granted. `modules/delegations/reach.ts` is the one place that
  adds the delegator's current team to the delegate's reach, and only in
  the approval flows: the review queue, request detail, approve, reject
  and bulk approve, the requester's balances, and Tasks.
- **Not transitive.** The delegator keeps their own access.
- **Self-approval stays blocked**, including for a delegate who is in the
  delegator's team.
- **No overlaps:** overlapping non-revoked delegations from one delegator
  are refused under a row lock, so two simultaneous requests can't both
  pass.
- **Revoke, never delete.**

**On behalf of.**
- `audit_logs.on_behalf_of_user_id` and
  `leave_requests.decided_on_behalf_of_user_id` record the delegator next
  to the real actor.
- The Audit Log viewer shows "Priya Nair on behalf of Karan Kapoor".
- Review tags such requests "On behalf of …".
- The delegator gets an FYI notification for each decision made for them.

**Super Admins don't delegate** (recommendation recorded in the plan):
- the two Super Admins already cover each other;
- HR Admins (ALL scope) can approve any manager's leave;
- delegating to a manager would create peer approval.

Only MANAGER holders can be delegators. Everyone else is told why.

**Screens.**
- **Workflow Delegates** in the employee portal: a manager's own
  delegations (create, revoke), plus "You're covering" for anyone who is a
  delegate.
- **Admin Tools → Workflow Delegates** for HR (`delegation.manage`, new,
  HR_ADMIN by default): everyone's, with a status filter. HR can set one
  up for a manager and revoke any.
- A delegate who has lost `leave.approve` is flagged "Can't approve".

**Realtime.**
- New requests reach active delegates (`leave.applied` + notification).
- `delegation.changed` refreshes both people's screens and HR's.

**Migration** `e3_workflow_delegates`:
- the `workflow_delegates` table, with CHECKs (range; not self);
- the two on-behalf columns;
- `delegation.manage` granted to HR_ADMIN.

**Verified:**
- a fresh devcheck seed;
- the full backend and frontend suites, lint and typecheck;
- `delegations.test.ts`, 17 cases: every rule, including the concurrent
  overlap, non-transitivity, scheduled/ended/revoked reach, and a delegate
  losing the permission;
- the route inventory (9 new routes classified);
- a multi-browser walkthrough:
  - a Super Admin is told why they don't delegate;
  - Karan (1002) delegates to Priya (1003) in the UI;
  - Arjun's new request appears in Priya's Review within ~0.1 s, tagged
    "On behalf of Karan Kapoor";
  - Priya approves it, and the request records decided by 1003 on behalf
    of 1002;
  - Karan is notified;
  - HR sees the delegation with "1 decided on their behalf", and the audit
    log names both;
  - HR revokes it, and Kavya's pending request leaves Priya's queue with
    no reload;
  - no console errors.

### Phase 5, commit F — Core reports

Plan and as-built notes: [`docs/plans/PHASE_5.md`](plans/PHASE_5.md) §F,
written from the user's requirements of 2026-10-03 before building. Spec
§2.2 and §7.6 updated.

**Seven reports in the new Reports app** (`/admin/reports`):
- headcount (as of a date, with the placement held that day);
- joiners;
- leavers and attrition;
- birthdays and anniversaries;
- leave balance (as of a date);
- leave liability;
- LOP (leave LOP only).

Each has filters (date or range, department, branch, employment type, plus
report-specific ones), summary tiles, breakdown tables, a sortable list,
and an **Excel export** of exactly those rows plus a Summary sheet and one
sheet per breakdown. Every export is audited (`report.exported`).

Nothing reads attendance or payroll data. The LOP report says
attendance-based LOP arrives with Phase 3.

**Permissions.**
- **`reports.view`** is held by HR_EXECUTIVE, HR_ADMIN, PAYROLL_ADMIN and
  MANAGER. It **joins the manager-grantable list**, the deliberate code
  change spec §2.2 requires:
  - all three report routes are classified `scoped`;
  - `managerReach.test.ts` proves each report gives a manager their team
    only, export included.
- **`reports.liability.view`** is new, not grantable, and held by HR_ADMIN
  and PAYROLL_ADMIN only. Leave liability is days × the encashment rate,
  which becomes "one day's salary" in Phase 6, and salary stays off
  HR_EXECUTIVE and managers.

Migration `f_reports_permissions`.

**Provisional rate.**
- Leave liability shows "Encashment rate is provisional", or "No
  encashment rate is set — showing days only".
- **Year End now shows the same warning** (`ProvisionalRateAlert`) when
  its run uses the flat settings rate. Until now its only sign was a
  "Rate Source" column.
- The Year End export footer says the same.

**The shared Excel helper.** `lib/xlsx.ts` handles typed columns (real
dates, ₹ amounts, percentages), totals and footers. There wasn't one
before; the employee grid and Year End exports now use it too.

**Verified:**
- a fresh devcheck seed;
- the full backend and frontend suites, lint and typecheck;
- `reports.test.ts`: every report's numbers on a fixture, including
  - historical headcount with an effective-dated move;
  - an imported leaver;
  - the attrition formula;
  - the 29 Feb birthday;
  - balances as of a date;
  - liability with and without a rate;
  - LOP straddling the range and a holiday;
  - the export's sheets and audit row;
- manager reach for all seven reports;
- a browser walkthrough:
  - HR sees all seven reports and a 30-person headcount;
  - leavers year to date: 1090, attrition 3.3%;
  - liability: no rate, then ₹1,500/day × 10.5 granted days = ₹15,750,
    flagged provisional;
  - an LOP request for 1–2 Oct counts 1 day (Gandhi Jayanti excluded);
  - the headcount export has 5 sheets;
  - Karan sees his 6-person team tagged "Showing your team only", no
    liability card, and a 403 on liability;
  - no console errors.

### Interim — Approval Workflows dropped; ex-employees importable (2026-10-03)

User decisions after F.

**Approval Workflows dropped.**
- Spec §7.8 now says why no general approval-chain engine exists, so a
  future session doesn't bring one back. The `approval_*` tables are gone
  from §11.
- The Workflow app and Admin Tools → Approval Workflows placeholders are
  removed.
- Payroll maker-checker is specified in §12 Phase 6 as one small
  purpose-built piece for the payroll run and the bank batch:
  - a different checker;
  - approval bound to a content hash of the exact figures;
  - voided by any change;
  - downstream steps re-verify the hash;
  - locked once approved.

**Ex-employees in the Excel import** (found in F: imported leavers have no
Separation row).
- The Employees dataset gains optional `lastWorkingDate` and `exitReason`
  columns. Such a row is created already separated through
  `markSeparatedInTx`, now shared with separation completion: status
  SEPARATED, account DEACTIVATED (never invitable), placement and device
  mapping ended that day.
- The device mapping is created already ended, so a reused device ID
  doesn't collide.
- The reporting manager only needs to exist.
- Refused: a future date, a date before joining, or a reason without a
  date. A missing reason is a warning.
- New `employees.exit_reason` column (migration backfills it from
  completed separations). Leavers & attrition reads it first.
- Also fixed: a report's "placement on a date" for a leaver on or after
  their last working day, whose last row is closed that day, now uses
  their latest row, not their first.
- Recorded in spec §12 Phase 1.5 as data-migration notes, with a leavers
  reconciliation step before invites.
- Tested: `import.test.ts` (an ex-employee row end to end, plus each
  refusal) and `reports.test.ts` (the imported reason in Leavers).

### Phase 5, commit G — Mobile bottom bar and PWA (Phase 5 complete)

Plan and as-built notes: [`docs/plans/PHASE_5.md`](plans/PHASE_5.md) §G.
Layout spec: **PART 4 — EMPLOYEE MOBILE APP** in `docs/UI_REFERENCE.md`,
written from the four greytHR mobile screenshots before building.

**The bottom bar.** At phone widths (below `md`), the employee portal
replaces its sidebar drawer with a four-tab bottom bar: **Home, Action,
Explore, Engage**. Everything comes from `employeeMenu.config.tsx`:
- **the tabs** (`mobileTabs`);
- **Action:** leaves marked `quickAction`, in menu order;
- **Explore:** every menu entry except the tab ones. Groups expand in
  place; single pages open directly. The subtitles come from
  `description`.

A menu change reaches mobile with no mobile code touched; a test adds an
entry and checks.

Pages that aren't built (`phase`), or are built over data that doesn't
exist yet (`needs: attendance | payroll`: Payslips and Attendance Info,
both Phase 0 mock-ups), are left out of Action and greyed "Coming soon"
in Explore. They can't be tapped.

**PWA.**
- `public/manifest.webmanifest`: standalone, starting at `/app/home`.
- Our own icons generated from the "W" mark: 192, 512, maskable 512, and
  the Apple touch icon.
- `public/sw.js`:
  - network-first navigations with an offline app-shell fallback;
  - cache-first for hashed `/assets/*`;
  - **never** the API or anything cross-origin.

  Registered in production builds only.
- An install banner (Chrome/Android: the real prompt; iOS: Share → Add
  to Home Screen). Dismissible, and the dismissal is remembered on the
  device.

**Also fixed:**
- `vite build` now always builds production. A shell exporting
  `NODE_ENV=development` had been silently producing a dev bundle with no
  service worker.
- The dev toolbar sits above the tab bar on phones.
- Engage's filters fold away on phones.

**Verified:**
- the full suites, lint and typecheck;
- `mobile.test.tsx`: the tabs, Action and Explore derived from the
  config, coming-soon rules, active-tab mapping, the manifest, icons and
  service worker;
- a phone walkthrough (390×844, iPhone user agent): tabs, no sidebar,
  drawer or footer; Action list; Leave Apply from Action (Action stays
  active); Salary and Attendance coming soon and untappable; People from
  Explore; Engage; iOS install instructions, dismissal remembered;
  desktop unchanged; no console errors;
- a production build served by `vite preview`:
  - the service worker registers, activates and controls the page;
  - Chrome parses the manifest with no errors, and its only
    installability objection is "in-incognito" (Playwright's contexts
    are incognito);
  - offline, the app shell still opens.

### Interim — managers start with nothing (2026-10-03, user decision)

**Rule.** The MANAGER role's default permission set is **empty**. Being
appointed a manager grants no powers; every one is granted by Admin, per
manager. The manager-grantable list (spec §2.2) stays the ceiling,
enforced even against a Super Admin; bank and statutory keys are
permanently off it.

**Built.**
- `systemRoles.ts`: `MANAGER_PERMS = []`. Migration
  `20261003120000_manager_role_empty` deletes the role's existing rows.
- The MANAGER role is locked: `PUT /api/access/roles/MANAGER` answers
  403 `MANAGER_ROLE_LOCKED`; Roles & Permissions shows its column
  read-only with a lock and a pointer to Manager Management.
- Manager Management:
  - a **Can do** column; managers with nothing granted show a **No
    permissions** warning tag, and an alert above the table counts them;
  - **Grant leave approval / Remove leave approval**: one click with a
    confirm (`POST /api/managers/:employeeId/leave-approval`, gated on
    `manager.permissions.manage`). It sets GRANT overrides for
    `leave.view` + `leave.approve` and writes
    `manager.leave_approval.granted|removed` to the audit log;
  - the appoint dialog has an **unticked** "Also let them approve their
    team's leave" box. Ticking it needs `manager.permissions.manage`; an
    appointer without it gets a 403 and nobody is appointed.
- Removing a manager clears their manager-grantable GRANT overrides in
  the same transaction (`grantsCleared` on the audit row).
- A reporting manager without `leave.approve` no longer gets the "New
  leave request" notification. The request still lands in HR's Employee
  Leave queue and Tasks.
- Seed: Karan `1002` has leave approval + `employee.view` +
  `reports.view`; Priya `1003` has leave approval; `1004`, `1005`,
  `1024`, `1029` have nothing.

**What the empty default broke** (all fixed in this commit): 35 tests in
9 files assumed managers held leave approval or `employee.view` by
default. They now grant explicitly (`grantManager`,
`LEGACY_MANAGER_GRANTS` in `testHelpers.ts`). New tests: a newly
appointed manager can do nothing (404/403 across leave, employees,
reports); no notification to a manager who can't approve; one-click
grant and removal with audit; no self-grant; appointing grants nothing
by default; removal clears grants; no payroll/bank/salary key is ever
grantable.

**Planned, not built:** Phase 2/3 attendance rules for managers are in
`docs/plans/PHASE_2.md` ("Managers and attendance"): at most view and
approve their own team's regularizations, if granted; finalising,
overrides and anything feeding payroll stay Admin-only.

### Interim — go-live fixes from the Phase 5 review (2026-10-03)

The three "must fix before go-live" items in
`docs/plans/PHASE_5_REVIEW.md` §3:
- **Payslips and Attendance Info mock-ups retired.** The Phase 0 pages
  (hardcoded BASIC/HRA figures, an invented attendance month) are
  deleted. Their menu entries now carry `phase: "Phase 6"` /
  `phase: "Phase 3"`, so desktop shows the "Coming in Phase N"
  placeholder and mobile shows "Coming soon". The `needs` menu field
  existed only for them and is gone. Phase 6 / Phase 3 build these pages
  from scratch.
- **Quick Links wired** (employee header): Company Policies →
  `/app/document-center` (Policies & Forms tab), Org Chart →
  `/app/people?tab=org-chart`, Raise a Helpdesk Ticket →
  `/app/helpdesk?raise=1`, which opens the raise dialog (the param is
  cleared on close).
- **Footer links removed** from both portals. They pointed at `#privacy`
  and `#terms`, and no such pages exist. They come back with the §9
  privacy notice, whose text the user has to supply.

**Verified:**
- frontend typecheck, lint and tests (`mobile.test.tsx` pins the phase
  markers);
- a browser walkthrough as Arjun (1006): both pages show the
  placeholder with no demo figures; each Quick Link lands correctly and
  the helpdesk one opens the dialog; both footers have no links.

### Interim — pay and ID documents HR-only; no stranded leave (2026-10-03)

**Rule (user decision): any document category that can contain money
figures is HR-only, structurally.** A manager never sees it, whatever
they're granted, the same permanent way as bank and statutory data. It
is never a per-letter box.

**Built:**
- `document_categories.sensitivity`: `GENERAL | PAY | STATUTORY`
  (migration `20261003130000_document_sensitivity`). The rules live in
  `shared/constants/peopleDocuments.ts`:
  - PAY needs the new key `documents.pay.view` (HR_ADMIN, PAYROLL_ADMIN;
    never grantable);
  - STATUTORY needs `employee.statutory.view`;
  - unknown contents default to PAY.
  Seeded: Letters PAY, ID Proofs STATUTORY, Other PAY, company categories
  GENERAL.
- Enforced in the service on every read path:
  - the employee-documents list (filtered);
  - download, update and archive (404, indistinguishable from absent);
  - upload (403 when you couldn't read the category back);
  - moving a document (409 if less sensitive).
- Category sensitivity is required for new employee categories,
  raise-only (409 `SENSITIVITY_LOWERING`), and always GENERAL for company
  categories.
- Letters: every letter is filed under Letters (the job refuses to file a
  letter anywhere that isn't PAY). Without `documents.pay.view`, the
  letters API returns the letter's existence only (`contentsWithheld`:
  no typed values, no PDF, no hash), and reissue/reproduce are 403.
- UI:
  - Document categories: "May contain" column, raise-only select with a
    confirm, and a required choice when creating an employee category.
  - The upload picker lists only categories you can read.
  - Issued letters show "Contents restricted" instead of the actions.

**Audit of everything a manager can be granted, for pay or other
sensitive data:**
- **Fixed:**
  - Letters (CTC in typed values and the PDF).
  - ID proofs (PAN/Aadhaar copies, reachable through
    `employee.documents.view`).
  - "Other" documents (unknown contents).
- **Fixed (latent):** year-end encashment ledger remarks wrote the daily
  rate ("… at 1234.00/day"). No screen serves ledger remarks today, but
  any future ledger view would have leaked a salary-derived figure to
  `leave.view` holders. Remarks now carry days only.
- **Clean:**
  - Leave encashment amounts live only on the Year End Process run
    (`leave.yearend.manage`, not grantable). Leave liability needs
    `reports.liability.view` (not grantable).
  - The leave balance, LOP, headcount, joiners/leavers and celebrations
    reports carry days and counts, no money.
  - Profiles show bank and statutory data only to holders of those keys.
  - Helpdesk Payroll & Salary tickets need non-grantable keys.
- **Flagged, not changed:** a team member's **grade** is visible to a
  manager with `employee.view` (job history). If grades map to pay bands,
  that implies salary. This is the user's call.

**HR Executive changes (spec §2 says HR_EXECUTIVE never sees salary,
bank or statutory data):** the same bar applies to them. They no longer
see Letters, ID Proofs or Other documents, a letter's typed values, or
reissue/reproduce. HR Admin does all of that.

**Leave requests with no team-side approver are never stranded**
(`leave/noTeamApprover.ts`):
- When the manager can't approve and no delegate covers, or there's no
  reporting manager, everyone with company-wide leave approval gets a
  `leave.applied.noTeamApprover` notification. It links to HR's queue
  filtered to these requests.
- HR's Employee Leave queue tags them "No manager can approve", with an
  alert and a "Show only these" toggle (`?noTeamApprover=1`).
- Admin Home shows a warning with a count (`leaveNoTeamApprover` on task
  counts).
- All of this is computed live: a grant or a delegation clears it at
  once.

**Tests:**
- `documents/__tests__/sensitivity.test.ts`:
  - a manager holding every grantable key sees GENERAL only;
  - HR Executive vs HR Admin;
  - upload, move, category rules;
  - seeded sensitivities.
- `leave/__tests__/noTeamApprover.test.ts`:
  - HR is notified and the manager isn't;
  - flags and counts;
  - a grant clears the flag;
  - the filter is restricted to company-wide viewers.
- `managerReach`: a manager's own team's letter is withheld; reissue and
  reproduce are 403.
- The grantable-keys guard now also forbids `documents.pay.*`.

### Effective dating EF1 — foundation (2026-10-04)

Plan: [`docs/plans/EFFECTIVE_DATES.md`](plans/EFFECTIVE_DATES.md), approved
2026-10-03 with all six decisions as recommended. This is commit 1 of 4.
Users see no behaviour change, except that history that would have been
corrupted is now refused.

**Built:**
- **`lib/effectiveDating.ts`, the one model:**
  - a row covers its start up to but not including its end;
  - `inForceOn(day)` / `mappingInForceOn(day)`;
  - `planTimelineChange`, a pure function:
    - append after the latest row;
    - amend on its own start date;
    - refuse anything earlier (`HISTORY_BEFORE_LATEST`), or earlier than
      a scheduled change (`HISTORY_SCHEDULED_EXISTS` — cancel it first);
    - refuse more than 366 days ahead (setting
      `history.maxScheduleAheadDays`) and changes after leaving;
  - the only writers, `writeJobChange`, `writeNameChange` and
    `writeBankChange`, which lock the employee row first;
  - `cancelScheduledJobChange` (its endpoint and UI come in EF3);
  - `closeHistoryOnLeaving`.
- **Every history writer moved onto it:**
  - Change job details;
  - Manager Management team moves;
  - role changes;
  - name changes;
  - bank changes (direct, approved change requests, import);
  - separations.

  Bank changes now default to the IST business date, not `new Date()`.
- **Separations close history the day AFTER the last working day**, so a
  leaver is in force on it. The last working day can't be before joining,
  or before a job change already in force. Scheduled changes after it
  are dropped (audited). A blocked completion stays pending, with a daily
  audit entry.
- **Database rules** (migration `20261004090000_effective_dating`; changes
  no data):
  - CHECK that each row ends after it starts, on all four history tables;
  - `btree_gist` EXCLUDE constraints: no overlap per employee on all four
    tables, and none per device ID.

  If existing rows break these rules, the migration stops before changing
  anything.
- **History repair, preview → approve → apply** (user addition):
  - `npm run history:repair` lists every row it would fix (current → new
    value, and why) and every row a person must decide, with a
    fingerprint.
  - `--apply` needs that fingerprint plus `--approved-by` and
    `--operator`. It refuses if the list changed, applies in one
    transaction, and writes one `history.repaired` audit entry per row.
  - `db:migrate` and the `migrate` mode warn when a repair is pending;
    they never repair.
  - Procedure: `docs/DEPLOYMENT.md`.
- **Import:** a device ID whose dates would overlap another holder's is a
  per-row error. The Add Employee wizard maps the same constraint to a
  clear 409.
- **Seed:** leavers 1028 and 1090 are now closed the day after their last
  working day, so the seed needs no repair.
- **Test clock:** `setBusinessTodayForTests(day)`, vitest only, so tests
  can move "today".

**Repair preview on a copy of devcheck with the OLD seed data**
(`wellsure_hr_repairdemo`): 4 rows to fix, 0 needing a person.
- 1028 and 1090: job placements still open after leaving → close them
  the day after the last working day.
- Their device mappings end ON the last working day → move the end to the
  day after.
- Fingerprint `8068df96b59be0d2`. **Not applied — awaiting user
  approval.**

A wrong fingerprint and a missing approver were both refused, with
nothing changed. `wellsure_hr` (the user's own dev database) was not
touched.

**Tests:**
- `lib/__tests__/effectiveDating.test.ts`:
  - planner cases;
  - a property test: 300 random histories × 12 changes against a
    reference model, checking contiguous, non-overlapping and correct in
    force on sampled days.
- `lib/__tests__/timeline.integration.test.ts`:
  - append, amend and refuse;
  - the database rejects overlaps and backwards rows;
  - a scheduled change is not in force before its day and can be
    cancelled;
  - leaving: in force on the last working day, scheduled change dropped,
    in-force conflict refused;
  - repair preview, refusal, apply and audit;
  - the seed needs no repair.
- Separation and import tests updated: their fixtures had a last working
  day before joining, or a device ID shared by two people at once.

### Effective dating EF2 — every read is "in force today" (2026-10-08)

Commit 2 of 4 (`docs/plans/EFFECTIVE_DATES.md`). From here, a change dated
D affects every screen and every access check on D, and not before.

**Built:**
- **All 99 reads in 37 backend files** now go through
  `inForceOn(day)` (Prisma) or `inForceSql(alias, day)` (raw SQL). That
  covers names, placements, bank, team counts, the directory and org
  chart, grid and filters, dashboard, leave calendar and routing, the
  no-team-approver check, engage filters, audiences, socket rooms, import
  checks and reports.
- **Team scope** (`getTeamEmployeeIds`, the recursive query behind every
  manager's reach) walks rows in force on a given day, default today.
- **Module-level `include`/`select` constants that read history are now
  functions** ("today" moves at midnight; a constant froze it at server
  start): engage feed and names, helpdesk tickets, delegations, leave
  request lists, tasks, the directory.
- **`placementsOn` moved into `lib/effectiveDating.ts`** for reports and,
  later, payroll. The leaver workaround is gone, because leavers are in
  force on their last day since EF1.
- **Pre-joiners:** first rows start on the earlier of joining and today
  (`firstHistoryDay`). Old pre-joiners are a new `history:repair`
  category (preview → approve → apply).
- **Guard:** `lib/__tests__/currentRowGuard.test.ts` fails on any
  `effectiveTo: null`-style read outside `lib/effectiveDating.ts` and
  `lib/historyRepair.ts`.

**Tests:**
- `lib/__tests__/timeTravel.test.ts`: on D, schedule a move to manager B
  in a new department, and a name change, for D+7.
  - Through D+6, manager A sees and reaches the employee and B gets 404;
    from D+7 it's the reverse.
  - The department filter and the displayed name switch on D+7.
  - A pre-joiner added on D (joining a month later) is named and in
    their manager's team from D.
- The full backend suite passes.
- Fixed a date-dependent test: the delegation test's "leave 500 days
  from today" fell on a Sunday from 8 Oct; it now picks the next
  weekday.

**Verified:**
- the full suites, lint and typecheck;
- a smoke walkthrough with no console errors: grid, Manager Management,
  dashboard, Employee Leave, headcount, org chart and directory as HR,
  and Karan's team grid.

### Effective dating EF3 — scheduled changes go live (2026-10-08)

Commit 3 of 4 (`docs/plans/EFFECTIVE_DATES.md`). A change dated after
today is stored now, shown as scheduled, can be cancelled until its day,
and takes effect on it.

**Built:**
- **E2's stopgap is lifted for team moves.** Manager Management "Add to
  team", bulk assign from Unassigned, removing a member, and Change job
  details can all be dated ahead, up to 366 days (the timeline writer's
  cap).
  - Appointing or removing a manager stays today-or-earlier: the role
    changes at once, so its reporting line must too (`FUTURE_DATE`).
  - A manager can't be removed while anyone is scheduled to join their
    team (`TEAM_NOT_EMPTY`).
- **Visibility:**
  - Job, name and bank history rows carry `status: past | current |
    scheduled`.
  - Profile → History shows "Scheduled from 20 Oct 2026" with Cancel,
    and "until <last day>" for past rows.
  - The Change job dialog says "Takes effect now" or "Scheduled — takes
    effect on …".
  - The Manager Management team drawer lists scheduled joiners and
    leavers, each with Cancel.
- **Cancel:** `POST /api/employees/:id/history/{job|name|bank}/:rowId/cancel`.
  - Uses the same permission as making the change (job:
    `employee.edit` or `manager.team.assign`; name: `employee.edit`;
    bank: `employee.bank.edit`), scope-checked.
  - Only the latest, not-yet-in-force row can be cancelled; the previous
    row reopens.
  - The audit entry holds the removed row in full (bank: last 4, IFSC,
    bank — never the number).
  - The employee and the manager they were going to are told.
  - All three routes are classified Admin-only in the route inventory.
- **Told when it's scheduled:** the employee, the old manager and the new
  manager each get a `team.move.scheduled` notification.
- **The daily rollover** (BullMQ `history-rollover`, 00:05 IST, before
  separations):
  - for each job change written before its day that has now started, it
    moves the person's live sockets to the new `dept:`/`location:`
    rooms, refreshes both managers' team screens and task counts, and
    notifies all three (`team.move.effective`);
  - it catches up any missed days (`history.rolloverLastRun`) and never
    repeats a day.
- **Immediate job changes** now move the person's live rooms at once too.

**Tests:**
- `employee/__tests__/scheduledChanges.test.ts`:
  - scheduled via Change job details: status, three notifications,
    `HISTORY_SCHEDULED_EXISTS` for an earlier second change;
  - the rollover catches up a missed day, moves rooms, emits team
    changes, notifies, and runs once only;
  - name cancel: a scheduled one cancels, an in-force one is refused.
- `managers.test.ts`: the old "future move refused" test now checks that
  a move is scheduled, appears in the team view's joining list, and
  cancels from the profile history; appointing with a future date is
  still `FUTURE_DATE`.

**Verified:**
- 609 backend and 12 frontend tests, lint and typecheck;
- a browser walkthrough: Karan's team → add Leela for 20 Oct shows
  "Scheduled — takes effect on 20 Oct 2026", she isn't a member yet,
  "Leela Menon joins on 20 Oct 2026" appears with Cancel, and cancelling
  it leaves her history with one row.

### Effective dating EF4 — the payroll contract (2026-10-08). Effective dating complete.

Commit 4 of 4. The contract is written in
[`docs/plans/PHASE_6.md`](plans/PHASE_6.md) "Effective-dating contract".

**Built:**
- **Readers, each taking an explicit day:**
  - `placementOn`;
  - `placementSegments(employeeId, from, to)`, which splits a pay period
    on change days;
  - `placementsOn`;
  - `nameOn`;
  - `bankAccountOn` (for a payment, the payment date);
  - `employeeForDeviceUserOn` (whose punch);
  - `employedOn(day)`, from `dateOfJoining`/`lastWorkingDate`, never
    `status`.
- **The payroll-lock hook:**
  - `assertNotInLockedPayroll(day)` is called by every history writer,
    cancellation and separation close;
  - Phase 6 registers the real check with `setPayrollLockCheck`. Until
    then nothing is locked.
- **Guard:** payroll, attendance and biometric code must never query a
  history table directly (`currentRowGuard.test.ts`, second case). Those
  modules are empty today, so the guard is in place before Phase 2's
  first line.

**Tests** (`lib/__tests__/payrollContract.test.ts`):
- a transfer on the 16th gives two segments;
- a leaver is placed and employed on their last working day, not the day
  after;
- a bank change on the 10th sends a payment on the 25th to the new
  account, and the 9th to the old one;
- a name change takes effect on its own date;
- a reused device ID gives the last day's punch to the leaver and the
  next day's to the new holder;
- the lock refuses a change, or a leaving, dated inside a finalised
  period.

**Effective dating, EF1–EF4, is done:**
- one model;
- one writer;
- constraints in the database;
- every read "in force today";
- scheduled changes visible, cancellable and rolled over;
- a written, guarded contract for payroll and attendance.

Next (user, 2026-10-08): plan Phase 2 in full and show it before building.
**Done:** [`docs/plans/PHASE_2.md`](plans/PHASE_2.md) rewritten as the
full Phase 2 plan, awaiting review. It covers the data model; three
routes into one ingestion service; the rules engine with sources and
`NM`; manual entry; the simulator; the agent; device health; screens;
the commit split; what stays unproven until the device is connected;
acceptance gates; and decisions D1–D7.

### Phase 2, commit P2-A — attendance configuration and the capture choice (2026-10-08)

Plan: [`docs/plans/PHASE_2.md`](plans/PHASE_2.md) §2.1, §2.4, §4.3, §4.6.

- **Schema and migration** `20261008100000_attendance_config`:
  - `shifts` + `shift_sessions` (ordered WORK/BREAK parts), `week_off_patterns`
    (weekday, optional weeks of the month), `attendance_policies` (thresholds,
    half-day-not-met LOP, near-duplicate window, punch plausibility; penalty
    rules stored but empty — HR: no penalty);
  - `attendance_assignments`: effective-dated employee → shift, week-off,
    policy, under the EF rules (CHECK, EXCLUDE overlap, one open row);
  - `attendance_cycle_rules` (start day 1–28, effective-dated);
  - `attendance_manual_branches` (who may mark which branch);
  - `locations.has_biometric_device`.
  - **What HR confirmed is created by the migration on every database**, not
    only the dev seed: GEN 10:00–19:00 in two sessions with lunch
    14:00–14:45, Sunday off, the default policy, the calendar-month cycle,
    the company default setting, and an assignment for everyone already on
    record. Grace and the full/half-day minimums are **placeholders**
    (`placeholder_fields`), flagged on screen until HR's values are entered
    or confirmed.
- **Readers/writers** in `lib/effectiveDating.ts`: `writeAssignmentChange`,
  `cancelScheduledAssignment`, `assignmentOn`, `assignmentSegments`,
  `assignmentsOn`, `nextAssignmentChanges`, `assignmentHistory`,
  `assignmentUsage`, `namesOn`, `deviceCapturedOn`. Leaving closes the
  assignment the day after the last working day. The guard now also forbids
  `attendanceAssignment` queries in the attendance/biometric/payroll modules.
- **`lib/attendanceCycle.ts`**: `cycleFor(day)`, `recentCycles`; a start-day
  change applies only after the current cycle ends, so past cycles never move.
- **Permissions:** `attendance.view`, `attendance.config.manage`,
  `attendance.manual.enter`, `attendance.process`, `attendance.devices.manage`.
  HR Admin all; HR Executive view + manual entry + process; Payroll Admin view.
  `attendance.manual.enter` is the one **manager-grantable** key (the
  SPN/Wellsure 2 marker is a manager), limited to the branches assigned in
  Attendance Settings → Manual-entry branches; company-wide holders mark every
  branch. Enforcement on entries arrives with P2-D.
- **Add Employee (D2):** Branch first, then "Attendance capture" — *Biometric
  device* (Device User ID required) or *No device: attendance is marked
  manually* (no ID, no device mapping), defaulted from the branch, with the
  explanation shown and a warning on a mismatch. Every new hire gets the
  company default assignment from their first history day. The Excel import
  has the same `attendanceCapture` column. Profiles show a "Manual
  attendance" badge (manual = no mapping in force, never a flag).
- **Attendance Settings** (Workforce → Attendance → Attendance Settings; Admin
  Tools → Shift Master / Week-off Patterns open the same page): Shifts with a
  session editor validated live, Week-off patterns with a six-week preview,
  Policies, Assignments (company default, filters, per-person history,
  scheduled changes and cancel, all-or-nothing bulk change), Attendance cycle,
  Manual-entry branches. Organisation Setup shows and edits "Has a biometric
  machine". All changes audited; nothing in use can be deactivated.
- **Seed:** SPN-Panchsheel has no machine; its four people are manual capture
  (no mappings); Priya `1003` holds `attendance.manual.enter` for SPN only.
- **Deferred within Phase 2:** the roster generator and the penalty-rule
  builder (HR: no penalties, only GEN so far) — noted in PHASE_2.md.
- Tests: cycle and session/week-off unit tests; config API (permissions,
  placeholders, sessions, deactivation guards, cycle boundaries, scheduled and
  bulk assignments, leaving, manual branches); Add Employee and import capture
  cases; cleanup and route-inventory guards updated.

## Open questions

- [x] **Approval Workflows — dropped (user decision 2026-10-03).** No
      approval needs a configurable chain. Payroll maker-checker is one
      small purpose-built piece in Phase 6 (spec §12), and the rationale is
      written into spec §7.8 so it isn't reintroduced. The Workflow app and
      Admin Tools → Approval Workflows placeholders were removed (Phase 5
      G prep).

- [ ] **Privacy notice (DPDP Act 2023) and Terms of Service wording —
      the user supplies it. Needed BEFORE real employee data goes onto
      AWS, not after** (user, 2026-10-03). Spec §9 requires the privacy
      notice to be acknowledged on first login. The footer's dead Privacy
      Policy / Terms links were removed (2026-10-03) and come back with
      these pages. Blocks: loading real employee data into staging or
      production.

Carried from spec §14 — configurable, not guessed, until answered:

- [ ] The eSSL device model number, and whether it supports ADMS push. Not blocking (2026-10-01): Phases 2–3 are built against the punch simulator, and the device is connected last.
- [ ] The device's LAN IP address and admin password (needed by the sync agent). The password is supplied at install and kept in the agent's local configuration or a secrets store, never in the repo.
- [ ] Whether an always-on office PC exists to run the sync agent as a Windows service (Windows version), and how many devices there are.
- [ ] Employee Code vs Device User ID default (spec §3): Add Employee pre-fills Employee Code from the Device User ID, but our device's IDs (2–126) differ from the 1000-series Employee Codes. Keep pre-filling or not? (Punch mapping is unaffected; it always uses `device_user_mappings`.)
- [ ] Working hours and working days for the device-silence alert (spec §4.7): configurable defaults until HR confirms.
- [x] **Branches without a biometric machine: SPN and Wellsure 2**, both
      marked by one manager entering IN/OUT times (HR, 2026-10-08;
      Phase 2 plan D4).
- [ ] **"Wellsure 2" isn't in the seeded branch list** (the seed's branches
      are placeholders). Which branch is it, or should it be added? Its
      "Has a biometric machine" switch must be turned off in Organisation
      Setup, as SPN's is in the seed.
- [ ] **Attendance rule values still to come from HR** (Phase 2 plan D3):
      grace minutes before someone counts as late, half-day and full-day
      minimum hours, and whether any shift other than GEN exists.
      Seeded as placeholders and configurable; not guessed.
      Confirmed already:
      - working days Monday–Saturday, Sunday off;
      - GEN 10:00–19:00 in two sessions (10:00–14:00, lunch 14:00–14:45,
        14:45–19:00);
      - no late penalty;
      - the attendance cycle is the calendar month.
- [ ] **The biometric device's log capacity (retention)**, once the model
      is known. The agent's retention guard defaults pessimistically to
      3 days / 20,000 records until then (Phase 2 plan §7.1).
- [x] Exact PL eligibility boundary: **HR-confirmed 2026-09-28** — 90 calendar
      days from DOJ (`leave_policies.eligibility_mode = DAYS`,
      `eligibility_value = 90`), no pro-rating, always a full 1.0-day credit.
      See the Phase 4 commit A log entry below for the exact worked examples
      and the inclusive-boundary rule (an eligibility date landing exactly on
      the 1st of a month counts as already passed for that month's credit).
- [ ] Leave encashment formula and its tax treatment: HR has confirmed the
      *intent* ("one working day's salary per leave day") but not the exact
      formula or its tax treatment — both still await CA confirmation.
      `EncashmentRateProvider` (see Phase 4 commit A below) is the
      swappable interface this resolves into once confirmed; until then it's
      one flat, HR-entered rupee amount (configurable at System Settings →
      Leave → Default Daily Rate, Phase 4 commit D), and Year End Process
      refuses to run at all if that amount isn't set (never silently
      encashes at ₹0).
- [ ] Comp-off minimum hours worked to earn a credit, and its expiry window
      — defaulted to 4h / 60 days pending HR confirmation
      (`leave_policies.comp_off_min_hours_worked` /
      `.comp_off_expiry_days`).
- [ ] WFH monthly/yearly limits — defaulted to unlimited (`null`) pending HR
      confirmation (`leave_policies.wfh_monthly_limit` / `.wfh_yearly_limit`).
- [ ] Restricted Holiday yearly quota — defaulted to 2 pending HR
      confirmation (`leave_policies.rh_yearly_quota`).
- [ ] Leave advance-notice requirement (days' notice before an apply is
      valid) — not yet modelled at all; no default enforced until HR
      specifies whether this applies, and to which leave types.
- [ ] Treatment of an unapproved absence (LOP by default? something else?)
      — deferred to Phase 2/3's attendance rules engine, since "absence" as
      a concept doesn't exist until punches/attendance do; not a Phase 4
      `leave_policies` concern.
- [ ] Whether unused Restricted Holiday balance lapses at year-end or
      carries forward like PL/COF — defaulted to carry-forward (the safer,
      less surprising default) until HR confirms; the ledger's reserved
      `LAPSE` entry type is what Year End Process would emit if HR confirms
      it should lapse instead.
- [ ] Bank bulk-transfer file format (from bank).
- [ ] PT/LWF applicability per location's state.
- [ ] Actual headcount and the authoritative branch (`locations`) list — branches are HR-managed and growing (e.g. 3 separate Ajmer branches, not the single "Ajmer" row earlier drafts assumed), so this isn't a one-time seed value. Also open: which city each of the 3 Panchsheel branches (C-10, SPN, B-22) belongs to, and the correct names/addresses for the 3 Ajmer branches — seeded as placeholders for now (see the Phase 1 log entry below). The commit D reconciliation report (Import Center → Reconciliation Report tab) is the tool to compare against greytHR once the real numbers are in hand.
- [ ] Company domain name for the portal and whether DNS is on Route 53.
- [ ] Whether the office has a static public IP (needed for device push).
- [ ] AWS account structure (single account, two environments, or separate
      staging/production accounts).

## Open issues (known bugs, not yet fixed)

- [x] **Future-dated job changes take effect immediately for access
      checks** — FIXED by effective dating EF1–EF3 (2026-10-08):
      - every read is "in force today";
      - a change dated later is scheduled, shown and cancellable;
      - the 00:05 IST rollover applies it on its day.

      The original note follows. (found 2026-10-02 while planning E2). `updateJob` accepts
      any `effectiveFrom`. It closes the current row and inserts the new
      one with `effective_to = NULL`. Every scope and team query treats
      `effective_to IS NULL` as "current", so a change dated next month
      applies today:
      - reporting line, so team scope and approvals;
      - department and branch.

      E2 refuses future dates on team moves as a stopgap, both in Manager
      Management and in Change job details whenever the reporting manager
      changes. Other job fields (department, branch, designation) still
      accept a future date and still take effect early. **The general
      fix (current = `effective_from <= today AND (effective_to IS NULL OR
      effective_to > today)`, everywhere job history is read) is required
      before Phase 6**, because payroll depends on effective dates being
      honoured exactly. **Plan written 2026-10-03, awaiting review:**
      [`docs/plans/EFFECTIVE_DATES.md`](plans/EFFECTIVE_DATES.md). It also
      covers two related defects found while planning:
      - back-dated changes can invert or overlap history;
      - separations close history on the last working day itself, so a
        leaver has no placement on that day.
