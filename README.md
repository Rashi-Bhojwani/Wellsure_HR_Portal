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
placeholder READMEs, no business logic, database schema or UI yet. See
`docs/PROJECT_SPEC.md` §12 for the phased build order that follows.

## Repository structure

```
wellsure_hr_portal/
├── apps/
│   ├── api/                Backend: REST API, Socket.IO, BullMQ workers & scheduler
│   ├── web/                 Frontend: Employee portal (ESS) + HR/Admin portal
│   └── biometric-agent/     LAN sync agent for on-prem biometric devices
├── packages/
│   └── shared/               Shared types, Zod schemas, constants, utilities
├── infra/                    AWS CDK app (staging + production)
├── docs/                     PROJECT_SPEC.md, PROGRESS.md, DEPLOYMENT.md
├── docker-compose.yml         Local Postgres, Redis, MinIO, Mailpit
└── package.json                pnpm workspace root
```

### `apps/api`

The backend. REST API + Socket.IO real-time server + BullMQ workers, all one
Docker image with four entrypoint modes (`api`, `worker`, `scheduler`,
`migrate`). Modules under `src/modules/` (each with its own README):

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

### `apps/web`

The frontend: one React + Vite + Ant Design app serving both portals behind
role-aware routing. `layouts/` (portal shells), `routes/` (route tree +
guards), `pages/employee/` (ESS screens), `pages/admin/` (HR/Admin
screens), `pages/auth/` (login/password), `components/` (shared UI),
`hooks/`, `api/` (HTTP client + query hooks), `sockets/` (Socket.IO client),
`theme/` (Ant Design tokens).

### `apps/biometric-agent`

Runs on an office PC where the biometric device can't push to the internet.
Polls the device over the LAN and forwards new punches to `apps/api` over
HTTPS with an API key.

### `packages/shared`

Framework-agnostic TypeScript shared by all three apps: types, Zod schemas,
constants, pure utilities — keeps validation and vocabulary in sync between
frontend and backend.

### `infra/`

AWS CDK app provisioning staging and production: `NetworkStack`,
`DataStack`, `AppStack`, `WebStack`, `EmailStack`, `ObservabilityStack`,
`CiStack`, and (production-only) `BackupStack`.

### `docs/`

`PROJECT_SPEC.md` (the spec), `PROGRESS.md` (phase status + open
questions), `DEPLOYMENT.md` (deployment runbook, written in Phase 1.5).

## Getting started

Not runnable yet. `pnpm install`, `pnpm dev` and `docker compose up` start
working once Phase 0 lands the actual application code.
