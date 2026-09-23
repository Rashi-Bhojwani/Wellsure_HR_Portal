# Wellsure HR Portal

An in-house replacement for **greytHR**, built module by module: an Employee
portal (ESS), an HR/Admin portal, real-time biometric attendance, leave,
engage, and eventually payroll — with real-time updates (a punch, an
approval, a kudos shows on screen within seconds) as the core improvement
over greytHR's month-end sync.

- **Full product & technical spec:** [`docs/PROJECT_SPEC.md`](docs/PROJECT_SPEC.md)
- **UI reference (screen layout & navigation):** [`docs/UI_REFERENCE.md`](docs/UI_REFERENCE.md)
- **Working conventions for contributors (incl. AI agents):** [`CLAUDE.md`](CLAUDE.md)
- **Delivery status & open questions:** [`docs/PROGRESS.md`](docs/PROGRESS.md)
- **Deployment runbook (from Phase 1.5):** [`docs/DEPLOYMENT.md`](docs/DEPLOYMENT.md)

Phase 0 (foundation + app shell) is done — see `docs/PROGRESS.md` for what
exists today vs. what's still ahead. No business logic yet: that starts in
Phase 1. See `docs/PROJECT_SPEC.md` §12 for the phased build order.

## Repository structure

Plain folders, not a package-manager workspace — each of `backend/`,
`frontend/`, `biometric-agent/` and `infra/` is its own standalone npm
project with its own `package.json` and `package-lock.json`. `shared/` is
imported directly as TypeScript source (no package of its own).

```
wellsure_hr_portal/
├── backend/               Backend: REST API, Socket.IO, BullMQ workers & scheduler
├── frontend/               Frontend: Employee portal (ESS) + HR/Admin portal
├── biometric-agent/         LAN sync agent for on-prem biometric devices
├── shared/                   Shared TypeScript (types, Zod schemas, constants, utils)
│                              — imported via the @shared/* path alias, no package.json
├── infra/                    AWS CDK app (staging + production)
├── docs/                      PROJECT_SPEC.md, UI_REFERENCE.md, PROGRESS.md, DEPLOYMENT.md
└── package.json                Root convenience scripts (install:all, dev, lint, typecheck, test, check:services)
```

### `backend`

The backend. REST API + Socket.IO real-time server + BullMQ workers, ships
as a single Docker image with four entrypoint modes (`api`, `worker`,
`scheduler`, `migrate`). Modules under `src/modules/` (each with its own
README):

| Module | Purpose |
|---|---|
| `auth` | Login, RBAC, sessions/tokens, 2FA |
| `employees` | Employee master data, onboarding wizard, profile |
| `attendance` | Rules engine, muster, regularization, finalisation |
| `biometric` | Device push (`/iclock`), agent ingestion API, device registry |
| `leave` | Leave types/policies, ledger, accrual, year-end |
| `engage` | Posts, kudos, polls, auto-posts |
| `documents` | Document Center, letter generation |
| `admin` | Org setup, roles/permissions, workflows, import center, audit log |
| `payroll` | Salary, payroll runs, statutory outputs, bank disbursement file |
| `reports` | Standard reports + custom report builder |
| `notifications` | Persisted, per-user notifications + email dispatch |
| `helpdesk` | Employee tickets to HR |

Plus cross-cutting folders: `realtime/` (Socket.IO + Redis adapter),
`integrations/` (mail, storage — swappable local/AWS implementations),
`jobs/` (BullMQ queues/workers/scheduler), `middleware/` (auth, RBAC +
data-scope, validation, error handling, rate limiting, audit),
`lib/` (Prisma client, encryption, logger), `config/` (env validation).

### `frontend`

The frontend: one React + Vite + Ant Design app serving both portals behind
role-aware routing. `layouts/` (portal shells), `routes/` (route tree +
guards), `pages/employee/` (ESS screens), `pages/admin/` (HR/Admin
screens), `pages/auth/` (login/password), `components/` (shared UI),
`hooks/`, `api/` (HTTP client + query hooks), `sockets/` (Socket.IO client),
`theme/` (Ant Design tokens).

### `biometric-agent`

Runs on an office PC where the biometric device can't push to the internet.
Polls the device over the LAN and forwards new punches to `backend` over
HTTPS with an API key.

### `shared`

Plain TypeScript shared by `backend` and `frontend`: types, Zod schemas,
constants, pure utilities — imported through the `@shared/*` path alias
(no `package.json`/build step of its own; each consumer compiles it as
part of its own build). Keeps validation and vocabulary in sync between
frontend and backend.

### `infra`

AWS CDK app provisioning staging and production: `NetworkStack`,
`DataStack`, `AppStack`, `WebStack`, `EmailStack`, `ObservabilityStack`,
`CiStack`, and (production-only) `BackupStack`.

### `docs`

`PROJECT_SPEC.md` (the spec), `UI_REFERENCE.md` (greytHR screen layout
reference — our own branding, never greytHR's), `PROGRESS.md` (phase
status + open questions), `DEPLOYMENT.md` (deployment runbook, written in
Phase 1.5).

## Local setup

Local development runs directly on your machine — **no Docker required**.
You'll need **Node.js ≥20**, **npm ≥10**, **PostgreSQL 16** and **Redis 7**
installed and running.

### 1. Install PostgreSQL 16 and Redis 7

**macOS** (Homebrew):

```
brew install postgresql@16 redis
brew services start postgresql@16
brew services start redis
```

**Linux** (Debian/Ubuntu):

```
sudo apt update
sudo apt install postgresql-16 redis-server
sudo systemctl start postgresql
sudo systemctl start redis-server
sudo systemctl enable postgresql redis-server   # optional: start on boot
```

Other distros: use your package manager's PostgreSQL 16 and Redis
packages, or see the [PostgreSQL](https://www.postgresql.org/download/linux/)
and [Redis](https://redis.io/docs/latest/operate/oss_and_stack/install/install-redis/)
install docs.

**Windows:**

- **PostgreSQL** — install the official installer from
  [postgresql.org/download/windows](https://www.postgresql.org/download/windows/)
  (pick version 16). It installs and starts a Windows service
  automatically, and includes `psql`.
- **Redis** — Redis has no official Windows build. Either:
  - **WSL2** (recommended) — install a Linux distro under WSL2, then
    follow the Linux instructions above *inside it*; `localhost` in
    `.env` resolves correctly from Windows either way.
  - **[Memurai](https://www.memurai.com/)** — a Redis-compatible Windows
    service (free tier available), if you'd rather not use WSL2.

### 2. Create the database and user

Matches the defaults in `.env.example` — adjust both if you use different
credentials.

```
psql -U postgres -c "CREATE ROLE wellsure LOGIN CREATEDB PASSWORD 'wellsure';"
psql -U postgres -c "CREATE DATABASE wellsure_hr OWNER wellsure;"
```

`CREATEDB` is required, not just `LOGIN` — Prisma's `migrate dev` creates a
throwaway shadow database to compute each migration's diff, so the role
needs permission to create databases, not just connect to one.

(On Linux, PostgreSQL usually needs `sudo -u postgres psql -c "..."`
instead, unless you've set up peer/password auth for your own user.)

### 3. Configure and verify

```
cp .env.example backend/.env    # edit it if you used different DB credentials
npm run install:all
npm run check:services          # confirms Postgres and Redis are reachable
```

`check:services` prints clear, OS-specific setup instructions if either
service isn't reachable yet.

### 4. Run

```
npm run dev         # backend + frontend together
npm run lint
npm run typecheck
npm run test
```

Local file storage and outgoing mail need no service either — uploaded
files land in `.storage/` and outgoing mail is logged to the console and
written as real `.eml` files to `.mail/` (both gitignored); see
`backend/src/integrations/{storage,mail}`.

## Docker (AWS deployment image only)

Local development doesn't use Docker. `backend/Dockerfile` builds the
image that actually runs on ECS Fargate (spec §15.2.3), and is what CI's
Docker build step exercises:

```
docker build -f backend/Dockerfile -t wellsure-hr-backend .   # from the repo root, so shared/ is included
```
