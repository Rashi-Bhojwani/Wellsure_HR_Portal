# CLAUDE.md

Guidance for Claude Code (and any other agent) working in this repository.

## What this is

Wellsure HR Portal: an in-house replacement for **greytHR**, built module by
module. Employee portal (ESS) + HR/Admin portal, with **real-time**
biometric attendance (a punch shows on screen within seconds, not at month
end), leave, engage (kudos/social feed), and eventually payroll. Full
product and technical spec: **`docs/PROJECT_SPEC.md`** — read it before
building anything. This file is the short, working-conventions companion to
that spec.

## Ground rules

- **Build strictly in phase order** (spec §12: Phase 0 → 1 → 1.5 → 2 → 3 →
  4 → 5 → 5.5 → 6 → 7 → 8). Don't jump ahead to a later phase's feature
  because it seems easy or related.
- **Never guess the open questions in spec §14** (device model, PL
  eligibility boundary, encashment formula, bank file format, PT/LWF rules,
  headcount, domain, static IP, AWS account structure). Keep the relevant
  value configurable and leave the question open in `docs/PROGRESS.md`
  until the user answers it.
- **greytHR runs in parallel** throughout. Attendance + leave go live first;
  payroll runs in parallel with greytHR for 2–3 months before cutover.
  Don't build anything that assumes greytHR is already switched off.
- At the end of every phase: tests green, migrations applied, seed data
  updated, `docs/PROGRESS.md` updated, and the work committed.

## Repository layout

```
apps/api               Backend: REST API, Socket.IO, BullMQ workers/scheduler
apps/web                Frontend: Employee portal (ESS) + HR/Admin portal
apps/biometric-agent     LAN sync agent for on-prem biometric devices
packages/shared          Shared types, Zod schemas, constants, utilities
infra/                   AWS CDK app (staging + production)
docs/                    PROJECT_SPEC.md, PROGRESS.md, DEPLOYMENT.md
```

See the `README.md` in each of those folders, and the `README.md` in each
subfolder, for what specifically goes there. `apps/api/src/README.md` and
`apps/web/src/README.md` are the best starting points for the internal
layout of those two apps.

## Core domain rules to keep in mind

These are easy to get subtly wrong — re-check spec §4/§5 rather than
assuming:

- **Attendance rules engine** (§4.4) evaluates in a strict order per
  employee-date: inactive → holiday → week-off → approved leave → manual
  override → compute from punches. Night shifts crossing midnight belong to
  the shift's **start** date. Half-day-minimum not met → 1 day LOP by
  default (configurable).
- **PL leave policy** (§5.2): 1.0 day/month, eligibility starts after 3
  months from DOJ (exact boundary configurable, not guessed), uncapped
  carry-forward by default, year-end (31 Dec) encashment + reset. Balances
  are **never** a mutable number — always an append-only `leave_ledger`
  (§5.3), balance = sum of entries.
- **RBAC + data scope** (§2): every query is scoped `SELF` / `TEAM` / `ALL`
  in addition to role/permission checks. `HR_EXECUTIVE` never sees salary or
  bank data; only `HR_ADMIN`/`PAYROLL_ADMIN`/`SUPER_ADMIN` do.
- **Realtime** (§8): Socket.IO + Redis adapter, room-scoped events
  (`user:{id}`, `manager:{id}`, `dept:{id}`, `location:{id}`, `role:{role}`,
  `org`). A punch, leave decision, or engage action should reach the
  relevant screen within seconds — that's the whole point of this project.
- **PII encryption** (§9): bank account, PAN, Aadhaar, UAN are AES-256-GCM
  encrypted (KMS envelope encryption in AWS) and masked by default in the
  UI and in exports.
- **No direct money movement**: payroll disbursement (§7.5) generates a
  bank transfer file for HR to upload to net banking; the app never moves
  money itself.
- **Timezone/currency**: Asia/Kolkata, INR, leave year is calendar year
  (Jan–Dec).

## Conventions (once code exists, starting Phase 0)

- pnpm workspaces monorepo; Node ≥20; TypeScript strict mode
  (`tsconfig.base.json`).
- `apps/api` is one Docker image with four entrypoint modes: `api`,
  `worker`, `scheduler`, `migrate` (spec §15.2.3) — don't split it into
  separate images.
- Validate all external input with Zod; request/response schemas shared
  with the frontend via `packages/shared` where practical.
- Storage and email are behind interfaces (`StorageService`, `MailService`)
  with local (MinIO/Mailpit) and AWS (S3/SES) implementations selected by
  env — write against the interface, not the AWS SDK directly.
- Every state-changing admin action that spec §9 calls out gets an
  append-only audit log entry.

## Commands

Not runnable yet — `apps/api` and `apps/web` have no source code or real
dependencies until Phase 0. Once Phase 0 lands: `pnpm dev` (both apps),
`pnpm build`, `pnpm lint`, `pnpm typecheck`, `pnpm test`, and
`docker compose up` for Postgres/Redis/MinIO/Mailpit.
