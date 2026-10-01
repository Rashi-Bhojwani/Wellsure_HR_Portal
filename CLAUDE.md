# CLAUDE.md

Guidance for Claude Code (and any other agent) working in this repository.

## What this is

Wellsure HR Portal: an in-house replacement for **greytHR**, built module by
module. Employee portal (ESS) + HR/Admin portal, with **real-time**
biometric attendance (a punch shows on screen within seconds, not at month
end), leave, engage (kudos/social feed), and eventually payroll. Full
product and technical spec: **`docs/PROJECT_SPEC.md`** — read it before
building anything. For screen layout, navigation and what's on each page,
also read **`docs/UI_REFERENCE.md`** before building any UI — it describes
greytHR's current screens (which ours should feel familiar to) with a hard
constraint: our own branding, colours and Ant Design components, never
greytHR's logos, illustrations, quotes or text. This file is the short,
working-conventions companion to both.

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
- **Plans live in the repo, not the chat.** Any plan the user approves
  (schema, endpoints, screens, test plan, scope changes) is written into
  the repo *before* it's built: under `docs/plans/` (e.g.
  `docs/plans/PHASE_5.md`) or as a detailed section in
  `docs/PROGRESS.md`. A new session must be able to pick up from the
  repo alone.
- At the end of every phase: tests green, migrations applied, seed data
  updated, `docs/PROGRESS.md` updated, `docs/GETTING_STARTED.md` updated
  if anything about setup, env vars, seeded accounts or everyday commands
  changed, and the work committed.

## Repository layout

Plain folders, **not** a pnpm/npm workspace — each of `backend/`,
`frontend/`, `biometric-agent/` and `infra/` is a standalone npm project
with its own `package.json` and `package-lock.json`. `shared/` is imported
directly as TypeScript source, with no `package.json` of its own.

```
backend/               Backend: REST API, Socket.IO, BullMQ workers/scheduler
frontend/                Frontend: Employee portal (ESS) + HR/Admin portal
biometric-agent/          LAN sync agent for on-prem biometric devices
shared/                    Shared TypeScript (types, Zod schemas, constants, utils),
                            imported via the @shared/* path alias — no package.json
infra/                     AWS CDK app (staging + production)
docs/                      PROJECT_SPEC.md, UI_REFERENCE.md, PROGRESS.md, DEPLOYMENT.md
```

See the `README.md` in each of those folders, and the `README.md` in each
subfolder, for what specifically goes there. `backend/src/README.md` and
`frontend/src/README.md` are the best starting points for the internal
layout of those two projects.

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

- npm, one standalone project per top-level folder (`backend/`,
  `frontend/`, `biometric-agent/`, `infra/`); Node ≥22 (Node 20 is end-of-life, and argon2's prebuilt binaries segfault on it); TypeScript strict
  mode (`tsconfig.base.json`, extended by each project's own
  `tsconfig.json`).
- `shared/` is plain TypeScript, no package of its own. `backend/` and
  `frontend/` import it through the `@shared/*` path alias — wired in
  `tsconfig.json` (`paths`) for both, plus `vite.config.ts`
  (`resolve.alias`) for `frontend/` and resolved at runtime by `tsx` for
  `backend/`. Keep it that way; don't turn `shared/` back into an npm
  package (no `package.json`, no build step, no version to bump).
- `backend/` is one Docker image with four entrypoint modes: `api`,
  `worker`, `scheduler`, `migrate` (spec §15.2.3) — don't split it into
  separate images. Build the image from the **repo root**
  (`docker build -f backend/Dockerfile .`), not from inside `backend/`, so
  `shared/` is included in the build context.
- Validate all external input with Zod; request/response schemas shared
  with the frontend via `shared/` where practical.
- Storage and email are behind interfaces (`StorageService`, `MailService`)
  with local (filesystem/console+`.eml`) and AWS (S3/SES) implementations
  selected by env — write against the interface, not the AWS SDK directly.
- Every state-changing admin action that spec §9 calls out gets an
  append-only audit log entry.
- **Test cleanup is schema-driven** (`backend/src/lib/__tests__/cleanup.ts`):
  delete fixtures with `deleteEmployeesAndDependents` /
  `deleteWithDependents` (or the helpers built on them), never a
  hand-ordered list of `deleteMany` calls, and never swallow a cleanup
  error with `.catch(() => undefined)`. When a migration adds an optional
  FK or a new standalone table, `cleanup.test.ts` fails and tells you
  exactly what to classify.

## Commands

Local dev needs PostgreSQL 16 and Redis 7 **installed and running on the
machine** — not Docker (see README.md "Local setup" for OS-specific
install steps). `backend/Dockerfile` still exists and still matters: it's
the image CI builds and the one that runs on ECS Fargate (spec §15.2.3) —
just don't reach for `docker compose` in local dev.

```
npm run install:all    # npm install in the root, backend/, frontend/, biometric-agent/ and infra/
npm run check:services  # confirms Postgres + Redis are reachable; prints setup help if not
npm run dev              # backend + frontend together, via concurrently
npm run lint
npm run typecheck
npm run test
docker build -f backend/Dockerfile -t wellsure-hr-backend .   # from the repo root — CI/ECS image only
```

Local storage and mail need no service to install either — both are
file-based dev implementations behind the `StorageService`/`MailService`
interfaces (`backend/src/integrations/{storage,mail}`): uploads land in
`.storage/`, outgoing mail is logged to the console and written as
`.eml` files to `.mail/` (both gitignored). S3/SES are the AWS
implementations, selected by `STORAGE_DRIVER`/`MAIL_DRIVER` in
staging/production.

Business logic starts in Phase 1 — see `docs/PROGRESS.md` for what
Phase 0 already built (Express app, real-time layer, BullMQ skeleton, the
full app shell).
