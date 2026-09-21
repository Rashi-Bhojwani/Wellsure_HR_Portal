# Wellsure HR Portal

An in-house replacement for **greytHR**, built module by module: an Employee
portal (ESS), an HR/Admin portal, real-time biometric attendance, leave,
engage, and eventually payroll — with real-time updates (a punch, an
approval, a kudos shows on screen within seconds) as the core improvement
over greytHR's month-end sync.

- **Full product & technical spec:** [`docs/PROJECT_SPEC.md`](docs/PROJECT_SPEC.md)
- **Working conventions for contributors (incl. AI agents):** [`CLAUDE.md`](CLAUDE.md)
- **Delivery status & open questions:** [`docs/PROGRESS.md`](docs/PROGRESS.md)
- **Deployment runbook (from Phase 1.5):** [`docs/DEPLOYMENT.md`](docs/DEPLOYMENT.md)

This is currently a **structure-only scaffold** — folders, configuration and
placeholder READMEs, no business logic, database schema or real UI yet. See
`docs/PROJECT_SPEC.md` §12 for the phased build order that follows.

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
├── docs/                      PROJECT_SPEC.md, PROGRESS.md, DEPLOYMENT.md
├── docker-compose.yml          Local Postgres, Redis, MinIO, Mailpit
└── package.json                 Root convenience scripts (install:all, dev, lint, typecheck, test)
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

`PROJECT_SPEC.md` (the spec), `PROGRESS.md` (phase status + open
questions), `DEPLOYMENT.md` (deployment runbook, written in Phase 1.5).

## Getting started

```
npm run install:all   # npm install in the root, backend/, frontend/, biometric-agent/ and infra/
npm run dev            # runs backend + frontend together (concurrently)
npm run lint
npm run typecheck
npm run test
```

`docker compose up` starts local Postgres, Redis, MinIO and Mailpit.
`docker build -f backend/Dockerfile -t wellsure-hr-backend .` (from the repo
root, so `shared/` is included in the build context) builds the backend
image — see `backend/Dockerfile` for why it's still minimal at this stage.

There's no real application behavior yet beyond placeholder entrypoints
that prove the `@shared/*` alias resolves — the actual Express app, React
shell, and device-sync logic are built starting Phase 0/1/2.
