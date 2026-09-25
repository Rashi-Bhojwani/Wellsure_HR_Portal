# Wellsure HR Portal

An in-house replacement for **greytHR**, built module by module: an Employee
portal (ESS), an HR/Admin portal, real-time biometric attendance, leave,
engage, and eventually payroll — with real-time updates (a punch, an
approval, a kudos shows on screen within seconds) as the core improvement
over greytHR's month-end sync.

- **Setup and everyday commands:** [`docs/GETTING_STARTED.md`](docs/GETTING_STARTED.md) — start here to run the app locally
- **Full product & technical spec:** [`docs/PROJECT_SPEC.md`](docs/PROJECT_SPEC.md)
- **UI reference (screen layout & navigation):** [`docs/UI_REFERENCE.md`](docs/UI_REFERENCE.md)
- **Working conventions for contributors (incl. AI agents):** [`CLAUDE.md`](CLAUDE.md)
- **Delivery status & open questions:** [`docs/PROGRESS.md`](docs/PROGRESS.md)
- **Deployment runbook (from Phase 1.5):** [`docs/DEPLOYMENT.md`](docs/DEPLOYMENT.md)

See `docs/PROGRESS.md` for what's built vs. still ahead, and
`docs/PROJECT_SPEC.md` §12 for the phased build order.

## Repository structure

Plain folders, not a package-manager workspace — each of `backend/`,
`frontend/`, `biometric-agent/` and `infra/` is its own standalone npm
project with its own `package.json` and `package-lock.json`. `shared/` is
imported directly as TypeScript source (no package of its own).

```
backend/            REST API, Socket.IO, BullMQ workers & scheduler
frontend/             Employee portal (ESS) + HR/Admin portal
biometric-agent/       LAN sync agent for on-prem biometric devices
shared/                  Shared TypeScript, imported via @shared/*, no package.json
infra/                    AWS CDK app (staging + production)
docs/                      PROJECT_SPEC.md, UI_REFERENCE.md, GETTING_STARTED.md, PROGRESS.md, DEPLOYMENT.md
```

`docs/GETTING_STARTED.md` §11 has the detailed breakdown of what lives
where and where to look when changing something.

## Docker

Local development doesn't use Docker (see `docs/GETTING_STARTED.md`).
`backend/Dockerfile` builds the image that actually runs on ECS Fargate
(spec §15.2.3), and is what CI's Docker build step exercises:

```
docker build -f backend/Dockerfile -t wellsure-hr-backend .   # from the repo root, so shared/ is included
```
