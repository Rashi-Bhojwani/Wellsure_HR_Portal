# Progress

Tracks delivery against the phases in `docs/PROJECT_SPEC.md` §12. Updated at
the end of every phase (tests green, migrations applied, seed updated,
committed).

## Status

| Phase | Description | Status |
|---|---|---|
| — | Initial project structure (this commit) | ✅ Done |
| 0 | Foundation | ✅ Done |
| 1 | Auth, RBAC, org, employees | Done — data layer, authentication, org masters, employee management, import center, exports, audit log viewer and system settings all built and tested. Users & Roles admin screen (permission/role management UI — not role *assignment*, which already exists in Add Employee) deliberately deferred; not asked for in any commit so far. |
| 1.5 | AWS staging environment | Not started |
| 2 | Biometric ingestion + attendance engine + real-time | Not started |
| 3 | Attendance administration | Not started |
| 4 | Leave | In progress — schema/ledger/accrual/comp-off/jobs (commit A), employee self-service (commit B), and admin management incl. manager Review/Employee Leave/Leave Granter/Leave Types & Policies/Holiday Calendars (commit C) built and tested. Year End Process/Recalculator/dashboard/realtime (commit D) still to come. |
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
UI — role *assignment* during Add Employee already exists), letter
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

## Open questions

Carried from spec §14 — configurable, not guessed, until answered:

- [ ] Exact biometric device brand/model and whether ADMS push is supported.
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
      one flat, HR-entered rupee amount, and Year End Process refuses to run
      at all if that amount isn't set (never silently encashes at ₹0).
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
