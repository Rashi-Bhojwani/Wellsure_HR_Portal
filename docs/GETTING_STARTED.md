# Getting Started

A complete setup and day-to-day guide for the Wellsure HR Portal, written
for someone who has never seen this repository before. Follow it top to
bottom on a clean machine and you'll have the app running locally with
seed data. For *what* the product does, see
[`docs/PROJECT_SPEC.md`](PROJECT_SPEC.md); for screen-by-screen layout,
[`docs/UI_REFERENCE.md`](UI_REFERENCE.md); for working conventions,
[`../CLAUDE.md`](../CLAUDE.md); for delivery status,
[`PROGRESS.md`](PROGRESS.md).

---

## 1. Prerequisites

| Tool | Version | Check it's installed |
|---|---|---|
| Node.js | ≥ 22 (Node 20 is end-of-life and crashes the argon2 password library) | `node -v` |
| npm | ≥ 10 (ships with Node 22) | `npm -v` |
| PostgreSQL | 16 | `psql --version` |
| Redis | 7 | `redis-cli --version` |
| git | any recent version | `git --version` |

If any command isn't found, install that tool before continuing — Node
first (Postgres/Redis installers are OS-specific, covered next).

---

## 2. Install and start PostgreSQL 16 and Redis 7

Pick your OS below. If you already have Postgres/Redis running some other
way (Homebrew, a system package, WSL2), you can skip straight to
[§3](#3-create-the-database-and-role) as long as both are reachable on
their default ports (`5432`, `6379`).

### macOS (Homebrew)

```bash
brew install postgresql@16 redis
brew services start postgresql@16
brew services start redis
```

### Linux (Debian/Ubuntu)

```bash
sudo apt update
sudo apt install postgresql-16 redis-server
sudo systemctl start postgresql
sudo systemctl start redis-server
sudo systemctl enable postgresql redis-server   # optional: start on boot
```

Other distros: use your package manager's PostgreSQL 16 and Redis
packages, or see the official
[PostgreSQL](https://www.postgresql.org/download/linux/) and
[Redis](https://redis.io/docs/latest/operate/oss_and_stack/install/install-redis/)
install docs.

### Windows

- **PostgreSQL** — install the official installer from
  [postgresql.org/download/windows](https://www.postgresql.org/download/windows/)
  (pick version 16). It installs and starts a Windows service
  automatically, and includes `psql`.
- **Redis** — Redis has no official Windows build. Either:
  - **WSL2** (recommended) — install a Linux distro under WSL2, then
    follow the Linux steps above *inside it*. `localhost` in `.env`
    resolves correctly from Windows either way.
  - **[Memurai](https://www.memurai.com/)** — a Redis-compatible Windows
    service (free tier available), if you'd rather not use WSL2.

---

## 3. Create the database and role

These exact commands match the defaults in `.env.example` — adjust both
if you use different credentials.

```bash
psql -U postgres -c "CREATE ROLE wellsure LOGIN CREATEDB PASSWORD 'wellsure';"
psql -U postgres -c "CREATE DATABASE wellsure_hr OWNER wellsure;"
```

`CREATEDB` is required, not just `LOGIN` — Prisma's `migrate dev` creates
a throwaway shadow database to compute each migration's diff, so the role
needs permission to create databases, not just connect to one.

On Linux, PostgreSQL usually needs `sudo -u postgres psql -c "..."`
instead of `psql -U postgres -c "..."`, unless you've set up peer/password
auth for your own user.

---

## 4. Clone, install, and configure

```bash
git clone <repo-url> wellsure-hr-portal
cd wellsure-hr-portal
npm run install:all
cp .env.example backend/.env
```

`install:all` runs `npm install` in the repo root and in each of
`backend/`, `frontend/`, `biometric-agent/` and `infra/` — this repo is
**plain folders, not a workspace** (CLAUDE.md), so each has its own
`node_modules`.

### Environment variables

Edit `backend/.env` if you used different Postgres credentials, or want
to point `MAIL_DRIVER`/`STORAGE_DRIVER` at AWS. Everything else works
out of the box for local dev — every variable below has a safe default
except the two marked **required**.

| Variable | What it does | Required? | Local dev value |
|---|---|---|---|
| `APP_ENV` | `development` \| `staging` \| `production` — also gates destructive scripts (`npm run db:seed` refuses to run unless this is `development`) | No | `development` |
| `APP_MODE` | Which of the backend's four entrypoints to run: `api` \| `worker` \| `scheduler` \| `migrate` | No | `api` (`npm run dev` sets this itself) |
| `PORT` | Backend HTTP port | No | `4000` |
| `WEB_BASE_URL` | Frontend origin — used to build links in emails (set-password, reset-password) | No | `http://localhost:5173` |
| `API_BASE_URL` | Backend origin, informational | No | `http://localhost:4000` |
| `CORS_ORIGIN` | Allowed browser origin(s), comma-separated | No | `http://localhost:5173` |
| `TZ_BUSINESS` | Business timezone for date logic | No | `Asia/Kolkata` |
| `DATABASE_URL` | Postgres connection string | **Yes** | `postgresql://wellsure:wellsure@localhost:5432/wellsure_hr` |
| `REDIS_URL` | Redis connection string | **Yes** | `redis://localhost:6379` |
| `JWT_ACCESS_SECRET` | Signs short-lived access tokens | No (has a placeholder default) | change it before staging/production |
| `JWT_REFRESH_SECRET` | Not itself used to sign anything (refresh tokens are opaque, DB-tracked), reserved for future use — must differ from `JWT_ACCESS_SECRET` | No | change it before staging/production |
| `JWT_ACCESS_TTL` | Access token lifetime | No | `15m` |
| `JWT_REFRESH_TTL` | Refresh token lifetime | No | `30d` |
| `KMS_FIELD_KEY_ID` | **Encryption key** for bank account/PAN/Aadhaar/UAN (AES-256-GCM). Local dev derives a static key from this string; staging/production use real AWS KMS envelope encryption | No locally | see warning below |
| `FIELD_HASH_PEPPER` | **Blind-index pepper** — a *separate* secret used to compute a searchable hash of the same encrypted fields, so duplicates can be detected without decrypting | No locally | see warning below |
| `STORAGE_DRIVER` | `local` \| `s3` | No | `local` |
| `STORAGE_LOCAL_DIR` | Where uploaded files land in local dev | No | `.storage` |
| `STORAGE_SIGNED_URL_SECRET` | Signs simulated local "signed URLs" | No | any string |
| `S3_BUCKET` | Required only when `STORAGE_DRIVER=s3` | Conditional | — |
| `MAIL_DRIVER` | `console` \| `ses` | No | `console` |
| `MAIL_DEV_DIR` | Where outgoing mail is written as `.eml` files | No | `.mail` |
| `SES_FROM` | Required only when `MAIL_DRIVER=ses` | Conditional | — |
| `AGENT_API_KEYS` | Biometric agent authentication (Phase 2 — not yet wired up) | No | placeholder |
| `AWS_REGION` | Used by the S3/SES clients when those drivers are active | No | `ap-south-1` |

> [!WARNING]
> **`KMS_FIELD_KEY_ID` and `FIELD_HASH_PEPPER` must never be equal to
> each other**, and once real data has been encrypted or hashed with a
> given value, **changing either one makes that data unreadable/
> unmatchable** — there is no way to recover a bank account number, PAN,
> Aadhaar or UAN encrypted under a key you've since changed, and existing
> duplicate-detection hashes stop matching. This is harmless while the
> database only holds seed data (just re-seed), but treat both as
> permanent, back-them-up secrets the moment real employee data exists.
> For local dev, generate a real random value instead of typing one:
> ```bash
> node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"
> ```
> Run it twice (once per variable) so they're different. In staging/
> production these come from Secrets Manager / real KMS, never a `.env`
> file (see `docs/PROJECT_SPEC.md` §15.3).

---

## 5. Run migrations and seed the database

```bash
npm run db:migrate --prefix backend   # applies all migrations (safe, non-destructive)
npm run db:seed --prefix backend      # WIPES the database, reapplies migrations, seeds demo data
```

`db:seed` is destructive by design (it's how you get back to a known-good
demo state) — it refuses to run unless `APP_ENV=development`. Use
`db:migrate` alone if you just want the schema without touching existing
data.

---

## 6. Check services and start the app

```bash
npm run check:services   # confirms Postgres + Redis are reachable, with setup help if not
npm run dev               # backend + frontend together
```

A healthy startup looks like:

```
[backend] api listening on :4000 (development)
[frontend] VITE ready in ... ms
[frontend] ➜  Local:   http://localhost:5173/
```

- **Frontend:** [http://localhost:5173](http://localhost:5173)
- **Backend API:** [http://localhost:4000](http://localhost:4000) (try
  `/health` and `/ready`)

Open `http://localhost:5173` and you should land on the login page.

---

## 7. Seeded test accounts

Every account below uses the password **`Wellsure@123`**. The full seed
also creates ~30 employees across 7 branches with realistic Indian
demo data (see `backend/prisma/seed.ts`) — this table is the useful
subset for manual testing.

| Employee Code | Name | Role | Useful for testing |
|---|---|---|---|
| `1000` | Aditi Sharma | Super Admin | Full admin access; **2FA required** — first login walks you through enrolment |
| `1001` | Rohan Mehta | HR Admin | Employee management, bank/statutory data, Admin Tools → Import Center/Audit Log/System Settings; **2FA required** |
| `1002`–`1005`, `1024` | Karan Kapoor, Priya Nair, Vikram Rao, Neha Verma, Rajesh Kumar | Manager | Team-scoped (`TEAM` data-scope) views on the All Employees grid and employee profiles — see only your own reports. Every manager reports to Admin (`1000`); the seed enforces the three-level structure (Admin → Managers → Employees) and refuses to run if it's broken |
| `1006`+ | various | Employee | Plain employee-portal access, no 2FA; View My Info at `/app/profile` (upload a photo there) |
| `1006` | Arjun Singh | Employee (Engineering) | Document Center fixture: has a visible Appointment Letter and an HR-only Address Proof he can't see |
| `1010` | Rahul Malhotra | Employee (Sales) | Sees the Sales-only "Sales Incentive Plan 2026" in Document Center, which Arjun doesn't |
| `1090` | Gaurav Singh | Employee (separated) | Device-ID reuse fixture — enter `1090` as the Device User ID in Add Employee to see the collision message and `1090-2` suggestion |

A few accounts are deliberately seeded in non-active states to exercise
those code paths: some are `INVITED` (never activated — try
`POST /api/auth/forgot-password` or the resend-invite flow once built),
one is locked out (5 failed attempts), two are separated. Check
`backend/prisma/seed.ts`'s `specs` array for exact employee codes if you
need a specific state.

The **DEV quick-login panel** (bottom-right corner, local dev only) logs
you in as a few of these accounts with one click — it goes through the
real login flow, it just fills in the known demo password for you.

---

## 8. Where things land locally

- **Outgoing email** — never actually sent in local dev. Logged to the
  console and written as a real `.eml` file (openable in any mail client)
  to `backend/.mail/` (gitignored).
- **Uploaded files** — written to `backend/.storage/` (gitignored), served
  back through a signed-URL-simulating dev route. The seed writes its demo
  Document Center PDFs under `.storage/seed/`; employee photos land under
  `.storage/employees/<id>/photo/` (only the re-encoded WebP copies — the
  uploaded original is never stored) and documents under
  `.storage/employees/<id>/documents/` and `.storage/company-documents/`.

---

## 9. Everyday commands

Run from the repo root unless noted.

| Command | What it does |
|---|---|
| `npm run dev` | Backend + frontend together, with live reload |
| `npm run db:seed --prefix backend` | Wipe and reseed the database (dev only) |
| `npm run db:migrate --prefix backend` | Apply pending migrations without touching data |
| `npm run lint` | ESLint across backend, frontend, biometric-agent |
| `npm run typecheck` | `tsc --noEmit` across every project |
| `npm run test` | Vitest, backend + frontend — backend is an integration suite against your real local Postgres/Redis, not mocks; frontend covers route-config wiring (`frontend/src/routes/__tests__/`) |
| `npm run check:services` | Confirms Postgres/Redis are reachable |

**Prisma Studio** (a GUI for browsing/editing the database):

```bash
cd backend && npx prisma studio
```

---

## 10. Troubleshooting

**"Postgres not running" / `ECONNREFUSED` on `DATABASE_URL`**
Start it: `brew services start postgresql@16` (macOS) or
`sudo systemctl start postgresql` (Linux), or check the Windows service
is running. `npm run check:services` tells you exactly what's unreachable.

**`password authentication failed for user "wellsure"`**
The password in `DATABASE_URL` doesn't match what you created the role
with in [§3](#3-create-the-database-and-role). Either fix `backend/.env`
to match, or drop and recreate the role with the password you want.

**Redis not reachable**
Same idea as Postgres: `brew services start redis` / `sudo systemctl
start redis-server`, or confirm the Windows/WSL2/Memurai service is up.
`redis-cli ping` should print `PONG`.

**Port 4000 or 5173 already in use**
Something else is bound to it (maybe a previous `npm run dev` that didn't
exit cleanly). Find and stop it (`lsof -i :4000` / `lsof -i :5173` on
macOS/Linux), or override the port: `PORT=4001` for the backend, or
`npx vite --port 5174 --prefix frontend` for the frontend (remember to
also update `CORS_ORIGIN`/`WEB_BASE_URL` if you do).

**Migrations "out of sync" / schema doesn't match what you expect**
Run `npm run db:migrate --prefix backend` to apply anything pending. If
the database has drifted in a way migrations can't reconcile (e.g. you
edited tables by hand), the reliable fix in local dev is
`npm run db:seed --prefix backend` — it wipes and rebuilds from the
migrations themselves, so there's no ambiguity.

**`REFUSING TO START: APP_ENV is "development" but DATABASE_URL points at a non-local database`**
With `APP_ENV=development`, the backend (every mode), `npm run db:seed`,
`npm run db:migrate` and `npm run test` all refuse to run unless
`DATABASE_URL` is on this machine (`localhost`, `127.0.0.1`, `::1` or a
Unix socket), because seeding drops the database and tests write and
delete rows. The usual cause: `backend/.env` is loaded with
`process.loadEnvFile()`, which never overrides a variable already
exported in your shell, so a `DATABASE_URL` from another project or a
cloud dev container's defaults silently wins over `.env`. The message says
which one it was. Fix: `unset DATABASE_URL` so `.env` is used, or export
a local URL. There is deliberately no override flag: a remote database
isn't a development environment, so set `APP_ENV` to match instead.

**The backend starts on the wrong port (e.g. `api listening on :3000`)**
Same cause as above: a `PORT` exported in your shell wins over
`backend/.env`. The frontend expects the API on `:4000`
(`VITE_API_BASE_URL`), so `unset PORT` or start with `PORT=4000`.

**Stale Prisma Client after a schema change**
If TypeScript complains about fields/models that clearly exist in
`schema.prisma`, regenerate the client:
```bash
cd backend && npx prisma generate
```
`npm run db:migrate`/`db:seed` already do this automatically; you only
need it standalone if you've edited `schema.prisma` without running a
migration yet (e.g. mid-review, before generating one).

**`Prisma Migrate has detected that it was invoked by Claude Code` /
similarly-worded refusal**
This is Prisma's own safety gate against an AI agent running a
destructive command unattended — it only fires on `prisma migrate
reset`, which `npm run db:seed` wraps. It's not a bug; it means the
action needs a human's explicit go-ahead first.

---

## 11. How the project is laid out

Plain folders, **not** an npm/pnpm workspace — each of the four below is
its own standalone project with its own `package.json` and
`package-lock.json`.

```
backend/          REST API, Socket.IO, BullMQ workers/scheduler
frontend/          Employee portal (ESS) + HR/Admin portal
biometric-agent/    LAN sync agent for on-prem biometric devices (Phase 2)
shared/              Shared TypeScript (types, Zod schemas, constants, utils) —
                      imported via @shared/*, no package.json of its own
infra/                AWS CDK app (staging + production, Phase 1.5+)
docs/                  This file, plus PROJECT_SPEC.md, UI_REFERENCE.md,
                        PROGRESS.md, DEPLOYMENT.md
```

**Where to look when changing something:**

- Adding/changing an API endpoint → `backend/src/modules/<module>/`
  (`routes.ts` → `controller.ts` → `service.ts`, Zod schemas in
  `validators.ts`). Cross-cutting concerns (auth, RBAC, rate limiting,
  error handling) live in `backend/src/middleware/`; shared helpers
  (Prisma client, encryption, logging) in `backend/src/lib/`.
- Adding/changing a screen → `frontend/src/pages/<area>/`. The left
  sidebar (employee portal) and app switcher + top menus (admin portal)
  are both generated from `frontend/src/routes/employeeMenu.config.tsx`
  and `adminMenu.config.tsx` — add a screen there and its route/nav entry
  follow automatically.
- A type, Zod schema, constant or pure utility used by **both**
  `backend/` and `frontend/` → `shared/`, imported via `@shared/*`.
- Database schema → `backend/prisma/schema.prisma`, then
  `npx prisma migrate dev --name <description>` from `backend/`.
- Local dev accounts/demo data → `backend/prisma/seed.ts`.
- AWS infrastructure (from Phase 1.5) → `infra/`.

For the *business rules* behind any of this (attendance engine, leave
policy, RBAC model, security requirements), see
[`docs/PROJECT_SPEC.md`](PROJECT_SPEC.md) — this file is only about
running the code, not what it should do.
