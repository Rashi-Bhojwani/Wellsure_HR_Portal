# Progress

Tracks delivery against the phases in `docs/PROJECT_SPEC.md` §12. Updated at
the end of every phase (tests green, migrations applied, seed updated,
committed).

## Status

| Phase | Description | Status |
|---|---|---|
| — | Initial project structure (this commit) | ✅ Done |
| 0 | Foundation | ✅ Done |
| 1 | Auth, RBAC, org, employees | In progress — data layer done |
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
  relations, encrypted-field byte lengths and hash lengths all correct) —
  the full destructive `db:seed` path itself needs the user's explicit
  consent to run (Prisma's own AI-agent safety gate on `migrate reset`),
  still pending as of this entry.
- **Incidental fixes**: `README.md`'s local-setup `CREATE ROLE` command
  was missing `CREATEDB`, which every contributor would need anyway for
  Prisma's `migrate dev` shadow database — not just this sandbox.

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
