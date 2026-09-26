# Progress

Tracks delivery against the phases in `docs/PROJECT_SPEC.md` §12. Updated at
the end of every phase (tests green, migrations applied, seed updated,
committed).

## Status

| Phase | Description | Status |
|---|---|---|
| — | Initial project structure (this commit) | ✅ Done |
| 0 | Foundation | ✅ Done |
| 1 | Auth, RBAC, org, employees | In progress — data layer, authentication, org masters and employee management all done; bulk import, users/roles admin UI and audit log viewer still ahead |
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

## Open questions

Carried from spec §14 — configurable, not guessed, until answered:

- [ ] Exact biometric device brand/model and whether ADMS push is supported.
- [ ] Exact PL eligibility boundary (credit on completing 3 months vs from
      next month) and pro-rating.
- [ ] Leave encashment formula and its tax treatment (to be confirmed by CA).
- [ ] Bank bulk-transfer file format (from bank).
- [ ] PT/LWF applicability per location's state.
- [ ] Actual headcount and the authoritative branch (`locations`) list — branches are HR-managed and growing (e.g. 3 separate Ajmer branches, not the single "Ajmer" row earlier drafts assumed), so this isn't a one-time seed value. Also open: which city each of the 3 Panchsheel branches (C-10, SPN, B-22) belongs to, and the correct names/addresses for the 3 Ajmer branches — seeded as placeholders for now (see the Phase 1 log entry below).
- [ ] Company domain name for the portal and whether DNS is on Route 53.
- [ ] Whether the office has a static public IP (needed for device push).
- [ ] AWS account structure (single account, two environments, or separate
      staging/production accounts).
