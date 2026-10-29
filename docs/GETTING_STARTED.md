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
psql -U postgres -c "CREATE ROLE wellsure LOGIN CREATEDB CREATEROLE PASSWORD 'wellsure';"
psql -U postgres -c "CREATE DATABASE wellsure_hr OWNER wellsure;"
```

`CREATEDB` is required, not just `LOGIN` — Prisma's `migrate dev` creates
a throwaway shadow database to compute each migration's diff, so the role
needs permission to create databases, not just connect to one.

`CREATEROLE` is needed by one test only (`lib/__tests__/dbRoles.test.ts`, which proves the production database-role setup by creating a
temporary role). If you created the role before this was added: `psql -U postgres -c "ALTER ROLE wellsure CREATEROLE;"`.

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
| `ADMS_PUSH_ENABLED` | `true` \| `false`. Whether ADMS push (`/iclock`, and creating a PUSH device) is served. Unset = on in development **only**; staging and production stay off until `/iclock` is restricted to the office address (`docs/DEPLOYMENT.md`, Phase 1.5 go-live checklist, item 1) | No | unset (on) |
| `APP_MODE` | Which of the backend's four entrypoints to run: `api` \| `worker` \| `scheduler` \| `migrate` | No | `api` (`npm run dev` sets this itself) |
| `PORT` | Backend HTTP port | No | `4000` |
| `WEB_BASE_URL` | Frontend origin — used to build links in emails (set-password, reset-password) | No | `http://localhost:5173` |
| `API_BASE_URL` | Backend origin, informational | No | `http://localhost:4000` |
| `CORS_ORIGIN` | Allowed browser origin(s), comma-separated | No | `http://localhost:5173` |
| `TZ_BUSINESS` | Business timezone for date logic | No | `Asia/Kolkata` |
| `DATABASE_URL` | Postgres connection string | **Yes** | `postgresql://wellsure:wellsure@localhost:5432/wellsure_hr` |
| `REDIS_URL` | Redis connection string | **Yes** | `redis://localhost:6379` |
| `REDIS_TEST_DB` | The Redis logical database the **test suite** uses instead of `REDIS_URL`'s, so a running dev server and a test run never share queues, caches or rate limits | No | `15` |
| `TEST_DATABASE_NAME` | The Postgres database the **test suite** uses instead of `DATABASE_URL`'s, on the same server. Dropped and rebuilt at the start of every test run, so never point dev at it | No | `<dev database>_test`, e.g. `wellsure_hr_test` |
| `SOCKET_IO_REDIS_KEY` | Socket.IO's Redis pub/sub channel prefix. The test suite appends `-test`, because Redis pub/sub isn't separated by database number | No | `socket.io` |
| `CHROMIUM_PATH` | Chrome/Chromium binary used to render letter PDFs | No (auto-detected; set it if detection fails) | unset locally; `/usr/bin/chromium` in the Docker image |
| `JWT_ACCESS_SECRET` | Signs short-lived access tokens | No (has a placeholder default) | change it before staging/production |
| `JWT_REFRESH_SECRET` | Not itself used to sign anything (refresh tokens are opaque, DB-tracked), reserved for future use — must differ from `JWT_ACCESS_SECRET` | No | change it before staging/production |
| `JWT_ACCESS_TTL` | Access token lifetime | No | `15m` |
| `JWT_REFRESH_TTL` | Refresh token lifetime | No | `30d` |
| `FIELD_ENCRYPTION_DRIVER` | `local` \| `kms`. `local` (development only) derives one static key from `KMS_FIELD_KEY_ID`; `kms` keeps the data keys wrapped by an AWS KMS key. Staging and production refuse to start on `local` | No | `local` |
| `KMS_FIELD_KEY_ID` | **Encryption key** for bank account/PAN/Aadhaar/UAN (AES-256-GCM). Local dev derives a static key from this string; with `FIELD_ENCRYPTION_DRIVER=kms` it is the KMS key's ARN | No locally | see warning below |
| `FIELD_KEYRING` | JSON of the *wrapped* data keys (`kms` driver only; not secret, but useless without `kms:Decrypt`). Rotation: `docs/DEPLOYMENT.md` "Field encryption keys" | Conditional | — |
| `FIELD_HASH_PEPPER` | **Blind-index pepper** — a *separate* secret used to compute a searchable hash of the same encrypted fields, so duplicates can be detected without decrypting | No locally | see warning below |
| `STORAGE_DRIVER` | `local` \| `s3` | No | `local` |
| `STORAGE_LOCAL_DIR` | Where uploaded files land in local dev | No | `.storage` |
| `STORAGE_SIGNED_URL_SECRET` | Signs simulated local "signed URLs" | No | any string |
| `S3_BUCKET` | Required only when `STORAGE_DRIVER=s3` | Conditional | — |
| `MAIL_DRIVER` | `console` (default: writes `.eml` files, sends nothing) \| `smtp` (development only: sends real email through your own SMTP account, see section 8) \| `ses` (the only one staging and production accept) | No | `console` |
| `MAIL_DEV_DIR` | Where outgoing mail is written as `.eml` files | No | `.mail` |
| `SMTP_HOST` / `SMTP_PORT` / `SMTP_SECURE` / `SMTP_USER` / `SMTP_PASSWORD` / `MAIL_FROM` | Your SMTP account, used only when `MAIL_DRIVER=smtp`. Keep the real values in `backend/.env` (gitignored), never in a committed file | Conditional | port `587`, `SMTP_SECURE=false` |
| `SMTP_REQUIRE_TLS` | Leave `true` for any real provider. `false` only for a local catcher such as Mailpit, which has no TLS | No | `true` |
| `SES_FROM` | Required only when `MAIL_DRIVER=ses` | Conditional | — |
| `SECURITY_ALERT_EMAIL` | An inbox **outside** this system (e.g. the owners' shared mailbox). It also receives every break-glass alert (§12). Set it in staging and production | No | unset |
| `AGENT_API_KEYS` | Unused. Sync agent keys are created on Admin Tools → Devices → Sync agents (shown once, stored hashed) since Phase 2 P2-B | No | placeholder |
| `AWS_REGION` | Used by the S3, SES, KMS and CloudWatch clients when those drivers are active | No | `ap-south-1` |
| `METRICS_DRIVER` / `METRICS_NAMESPACE` | `local` (publishes nothing) \| `cloudwatch`. The worker publishes queue backlog, failed-job counts and a heartbeat for the alarms. Required `cloudwatch` outside development | No | `local` |
| `TRUST_PROXY_HOPS` | How many reverse proxies to believe about the client's address (`X-Forwarded-For`). Unset: 0 in development, 1 elsewhere (the ALB) | No | unset |
| `SHUTDOWN_DRAIN_SECONDS` / `SHUTDOWN_HARD_LIMIT_SECONDS` | On SIGTERM a task fails `/ready` for the drain period, then finishes in-flight requests; it exits anyway at the hard limit. Unset: 0 / 25 in development; 10 / 25 elsewhere | No | unset |
| `BREAKGLASS_ALARM_TOPIC_ARN` | The SNS topic `admin:preflight` checks has a confirmed subscriber | Staging/production | — |
| `DB_APP_ROLE` / `DB_APP_PASSWORD` | The database role the **migrate** task creates for the app (`DB_APP_PASSWORD`, 24+ characters, is the migrate task's alone). Required outside development; see `docs/DEPLOYMENT.md` "Database roles" | Staging/production | `wellsure_app` / unset |

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
npm run dev               # api + worker + frontend together
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
| `1000` | Aditi Sharma | Super Admin | Full admin access. 2FA enforcement is currently **off** in the seed (`auth.require2faRoles` = `[]`, chore 7f99cfd); re-enable it in System Settings and first login walks you through enrolment. Sees every helpdesk ticket, sensitive ones included |
| `1001` | Rohan Mehta | HR Admin | Employee management, bank/statutory data (masked), HR-held documents (ID proofs and other non-pay categories; **since Stage 1 HR never opens pay documents, i.e. a letter's contents with CTC, or any salary figure**), Admin Tools → Import Center/Audit Log/System Settings; the helpdesk queue including sensitive categories. Admin Home and Employee Leave flag leave requests **no manager can approve** (e.g. teams of managers with no permissions). 2FA currently off (see above) |
| `1002`–`1005`, `1024` | Karan Kapoor, Priya Nair, Vikram Rao, Neha Verma, Rajesh Kumar | Manager | Team-scoped (`TEAM` data-scope) views on the All Employees grid, employee profiles, leave and dashboards — see only your own reports. Managers (and HR Admin `1001`) have **no** reporting manager: they sit under the synthetic Admin root (model A, spec §2.1). The seed enforces the hierarchy and refuses to run if it's broken. A manager can only ever hold the manager-grantable keys (spec §2.2), and **starts with none of them** — the Manager role grants nothing; each power is granted per manager in Admin Tools → Manager Management. Seeded grants: Karan `1002` has leave approval + View employees + Reports + his team's forgot-to-punch requests (view and approve); Priya `1003` has leave approval and marks attendance by hand for SPN-Panchsheel and Wellsure 2 only (Phase 2: neither branch has a biometric machine, so their people — `1003`, `1008`, `1030` at SPN and `1010` at Wellsure 2 — are manual capture with no Device User ID); Vikram `1004`, Neha `1005` and Rajesh `1024` have **no permissions** (shown as such in Manager Management) |
| `1031` | Tara Bhandari | Super Admin (the second director) | D1 (docs/plans/DIRECTOR_AUTHORITY.md): the company has **two directors**, `1000` and `1031`. They hold every permission, payroll included; they check each other's work and each sets the other's pay. A director's action in director-authority mode takes effect at once and the other is told (bell, e-mail, Tasks inbox; a red banner after 3 days unacknowledged, or at once when a second-director check is switched). System Settings → Director authority shows the switches and what the other director did. Outside development two-step sign-in is required of every director |
| `1025`, `1027` | Anjali Desai, Shreya Bhatt | Employee | Used to be the Payroll Admin and Payroll Approver. The payroll roles (`PAYROLL_ADMIN`, `PAYROLL_APPROVER`) are for directors only now, so these are ordinary employees; payroll is done by `1000` and `1031` |
| `1029` | Farhan Qureshi | Manager (Operations) | A manager with **no team yet** — the org chart shows "Manager · No team yet". Assign someone to him from Admin Tools → Manager Management. Has **no permissions** until granted there |
| `1030` | Leela Menon | Employee (Sales, probation) | **Unassigned** — no reporting manager. Shows in Manager Management → Unassigned and as a count on the Admin home |
| `1006`+ | various | Employee | Plain employee-portal access, no 2FA; View My Info at `/app/profile` (upload a photo there) |
| `1006` | Arjun Singh | Employee (Engineering) | Document Center fixture: has a visible Appointment Letter and an HR-only Address Proof he can't see. Helpdesk fixture: a resolved comp-off ticket (carrying an HR internal note he never sees) and an open address-proof request |
| `1010` | Rahul Malhotra | Employee (Sales) | Sees the Sales-only "Sales Incentive Plan 2026" in Document Center, which Arjun doesn't. Has an in-progress **Payroll & Salary** helpdesk ticket, a sensitive category that HR Executives can't see |
| `1090` | Gaurav Singh | Employee (separated) | Device-ID reuse fixture — enter `1090` as the Device User ID in Add Employee to see the collision message and `1090-2` suggestion |

**Trying salary locally (Phase 6 P6-2).** Nothing about pay is seeded: a fresh database has no components, no structures and no salaries, and the
rule *Rounding of salary lines* is **Not set**, so the salary screens will tell you to set it first. In one browser sign in as `1000`, in another as `1031` (the two
directors; the payroll roles are directors' only). As `1000`: Payroll → Rules and Setup → set *Rounding of salary lines* (for example half up, 0 places) and, if you want to
try a percentage raise, *Rounding of a new CTC after a percentage increase*; then Salary Components (add Basic, HRA, Special allowance), then Salary
Structures (Basic 40% of CTC, HRA 50% of Basic, Special allowance the balance; the editor proves it adds up before it saves); then Employee Salaries →
*Prepare a revision* for somebody other than `1000` (you cannot change your own pay). As `1031`: confirm the components and the structure, open the
revision under Salary Revisions and approve it. Back as `1000`: *Apply*. (D2: by default a director acts on their own authority at every payroll step — the run steps, publishing, the bank file, unlocking, salary revisions, confirming a rule/component/structure/layout, and the setup sign-offs — and the other director is told. Switch a step's second-director check on in System Settings → Director authority and a different director must decide it, as before. Nobody can change their own pay, in either mode.) A date in the past is written with its true date; arrears only arise once a
payroll period has been finalised, which is a later commit, so locally you will see none yet.

**Trying a payroll run locally (Phase 6 P6-3).** `npm run dev` starts the worker, and a run is calculated by the worker, so use it (or start `npm run dev:worker` in `backend/`). A calculation needs a finished attendance cycle: the seed has no locked days, so for a walkthrough lock a past month for a few people (the finalisation screen does it for real: Attendance → Finalisation) or insert locked rows, and give those people a salary as above. As `1025`: set the company rules a run needs under Rules and Setup (pay days basis, loss-of-pay divisor, payment date, leavers, negative net, rounding of net pay, PF ceiling mode, ESI period rule, and the employment types PF and ESI cover; the list is shown when you start a run) and optionally the two variance thresholds; then Payroll → Payroll Run → Start a payroll run, choose the past cycle, read what stands in the way, create it, and Calculate (you see what it would do before you confirm). Everyone attendance has not finalised is listed as left out, with the reason. The run is marked TEST until a different person confirms every rule it used (`1027` can, a statutory figure by typing it again), and the register you download says so on every sheet. Open **Why?** on a person for the days, the shares and the basis of every line, and **Difference from last month** after a second cycle is calculated. **Submitting, approving and closing a run (P6-4).** On the run page the Approval panel says what is next. As `1025` choose *Review and submit for approval*: the page lists everyone the run leaves out (with the reason) at the top, and the run cannot be submitted while there is anyone, so for a walkthrough every person in the cycle needs a salary and finalised attendance, or must not be employed in it (the seeded staff have neither, so move their joining date past the cycle, or give them both). It also refuses a run on Placeholder rules, so confirm every rule, component and structure it used as `1027`; the half-year ESI value cannot be confirmed at all (an open question for your CA), so leave that rule on its monthly value. Tick the confirmation and submit; sign in as `1027` (a second browser) and open the run: *Review and decide*, approve with the hash shown. Back as `1025`, *Ask to close the period*; `1027` approves that too; then `1025` chooses *Close the period now*. The month is now locked: a job or bank change dated inside it is refused. Unlocking needs the Super Admin (`payroll.unlock`), a reason and `1027` to approve, and is refused once a payslip is published or a bank file exists. **Payslips, the bank file and the statutory files (P6-5).** On a final run's page, three cards appear. *Publish payslips* and *Generate the bank file* are each asked for by the maker (`1025`), approved by a checker (`1027`, or `1000`), and then carried out by somebody **other than the person who approved**: so as `1025` ask, as `1027` approve, as `1025` choose *Publish the payslips now*. Each payable person can then read their own payslip under the employee portal's Salary → Payslips (as `1001`, say), and the worker prepares each PDF and the in-app notice and email in the background (with the default `MAIL_DRIVER=console` the card says plainly *Not emailed (development)*: see "Sending real email in development" above; a failure shows in red with the reason, and *Prepare again* retries only what is not done). Publishing ends the possibility of unlocking the period. The bank file needs its **layout** first: Payroll → Bank and Statutory Layouts → *Enter…* for Bank file, typed from your bank's own specification (the columns in order, delimited or fixed width or Excel, header and trailer rows, date and amount formats, the narration pattern and the company's debit account, which is stored encrypted and never shown again), saved as a Placeholder by `1025` and confirmed by `1027`. **Nothing is pre-filled and no real bank's layout is built in**: for a walkthrough, make up a simple one (columns SERIAL, NAME, ACCOUNT_NUMBER, IFSC, AMOUNT, NARRATION). The bank-file page then lists exactly who is in the file, and by name anyone payable who has no bank account on the payment date; after the approval and the carry-out the card offers *Download the file* (every download is logged), *Record that it was paid…* (your own statement, with the bank's reference; it moves no money) and *Attach the bank's response…* (stored, never read). The PF, ESI, PT and LWF files each need their own confirmed layout in the same screen and are disabled until then; the **salary register** (Excel) needs none. **Draft payslip preview:** the payslip of a person in a draft run is at `GET /api/payroll/runs/:id/items/:employeeId/payslip-preview` (and `.pdf`), watermarked TEST while any rule is a Placeholder, and never stored.


**Manager Management.** Admin Tools → Manager Management (HR Admin,
Super Admin) appoints and removes managers, moves people between teams
(effective-dated, never in the future) and edits a manager's permissions.
A move shows up live on the managers' screens.

**What HR can do (Stage 1).** Two things, both in `docs/plans/HR_CAPABILITIES.md`:

- **A hard lock.** HR (HR Admin, HR Executive) can never hold salary, payroll, bank-file or tax data, leave liability in rupees,
  pay documents (a letter carrying CTC), or the Admin Tools keys for roles, the audit log, system settings and workflow
  delegates. It is enforced where access is worked out, refused by the Roles screen and by database triggers, and a director who
  is also HR is not affected. What is *not* locked yet, and is listed as open: HR *entering* a masked bank/statutory change (a director
  confirming it is D2), `letters.generate` (per-type grants are not built), `user.security.manage`, `import.manage`,
  `leave.yearend.manage`. Existing databases lose the locked rows through a migration that first copies them into
  `role_permission_removals` (append-only).
- **Switches.** Admin Tools → **What HR Can Do** (directors only; `/admin/admin-tools/hr-capabilities`). Eleven attendance and leave duties,
  each *As today / On / Off*, for the HR Admin role, the HR Executive role, or one named person. A named person beats the role; Off beats On
  between two roles. A change needs a reason, may start now or later, is in force on the person's very next click (their menu, counts,
  inbox and live screen follow without a reload) and stays in the history. Work HR can no longer decide waits for the directors with a
  note; nothing is approved or lost. In development try it as `1000` (director) and `1001` (HR Admin).

**Workflow Delegates.** A manager (e.g. `1002`) delegates their leave
approvals from the employee portal's **Workflow Delegates** page to someone
who can already approve leave (e.g. `1003`). For those dates the delegate's
**Review** queue also shows the manager's team's requests, tagged "On behalf
of …". HR (`1001`) sees and manages everyone's under Admin Tools → Workflow
Delegates. Super Admins and HR Admins don't delegate (spec §2.4).

**Reports.** The Reports app (`/admin/reports`) has headcount, joiners,
leavers & attrition, birthdays & anniversaries, leave balance, leave
liability and LOP, each with an Excel export. A manager (e.g. `1002`) sees
their own team. Leave liability (rupees) is for the directors only: it is on the HR hard-lock list (`docs/plans/HR_CAPABILITIES.md`).
- **The seed writes no leave ledger entries,** so every balance is 0 until
  you grant leave (Workforce → Leave Granter) or run the accrual job.
- **Liability needs a daily rate** (System Settings → Leave), which is
  provisional until the CA confirms it.

**Phone layout and installing the app.**
- Narrow the browser below 768px (or use the device toolbar in Chrome
  DevTools) and the employee portal switches to the bottom tab bar (Home,
  Action, Explore, Engage), generated from
  `frontend/src/routes/employeeMenu.config.tsx`.
- The service worker that makes it installable only runs in a
  **production build**. Check it with
  `npm run build --prefix frontend && npx --prefix frontend vite preview --port 5173`
  (stop `npm run dev`'s Vite first: the API only allows the
  `localhost:5173` origin). Chrome DevTools → Application then shows the
  manifest and service worker.

**Helpdesk.** Six categories are seeded. **Payroll & Salary** and
**Grievance** are *sensitive*: only roles holding `helpdesk.sensitive.view`
(HR Admin, Super Admin) see their tickets, and HR Executives don't. Toggle
the flag per category under Admin Tools → Helpdesk Categories. The admin
queue is Employee → Helpdesk. Resolved tickets close automatically after
the days set in System Settings → Helpdesk (default 7). That check is an
hourly background job. `npm run dev` runs the API and the **worker** (which
runs jobs), but not the **scheduler** (which registers timed jobs). So to
see auto-close happen locally, also run the scheduler once from
`backend/`: `node_modules/.bin/tsx src/index.ts scheduler`. The same applies
to every other timed job (accrual, comp-off expiry, separations, Engage
auto-posts). On-demand jobs, such as generating a letter, need only the
worker.

**Letters (PDF).** Admin Tools → Email & Letter Templates has five seeded
starter letters (offer, appointment, experience, relieving, address
proof), all marked "draft wording — HR to review". Issue one from an
employee's profile → Documents → "Issue a letter". It renders in the worker
and lands in their Document Center under Letters.
- The seeded letterhead is an obvious placeholder. Set the real one in
  System Settings → Letters.
- **PDF rendering needs Chrome or Chromium on your machine.** The backend
  finds Google Chrome or Chromium in the usual places (Linux, macOS,
  Windows); otherwise set `CHROMIUM_PATH` in `backend/.env` to the browser
  binary.
- The backend tests that render PDFs need it too, and fail with a clear
  message if it's missing. They're never skipped.

A few accounts are deliberately seeded in non-active states to exercise
those code paths: some are `INVITED` (never activated — try
`POST /api/auth/forgot-password` or the Resend button on the employee's profile),
one is locked out (5 failed attempts), two are separated. Check
`backend/prisma/seed.ts`'s `specs` array for exact employee codes if you
need a specific state.

The **DEV quick-login panel** (bottom-right corner, local dev only) logs
you in as a few of these accounts with one click — it goes through the
real login flow, it just fills in the known demo password for you.

---

## 8. Where things land locally

- **Outgoing email** — by default never actually sent in local dev. Logged
  to the console and written as a real `.eml` file (openable in any mail
  client) to `backend/.mail/` (gitignored). To send real email to a real
  inbox, see "Sending real email in development" just below.
- **Uploaded files** — written to `backend/.storage/` (gitignored), served
  back through a signed-URL-simulating dev route. The seed writes its demo
  Document Center PDFs under `.storage/seed/`; employee photos land under
  `.storage/employees/<id>/photo/` (only the re-encoded WebP copies — the
  uploaded original is never stored) and documents under
  `.storage/employees/<id>/documents/` and `.storage/company-documents/`.

### Sending real email in development

Creating an employee emails them a link to set their password. With the
default `MAIL_DRIVER=console` that email is only written to `backend/.mail/`,
and the screens say so ("Nothing was emailed … development mode"). To see it
arrive in a real inbox, point the `smtp` driver at your own SMTP account.
This is a development tool: staging and production refuse to start on
anything but `MAIL_DRIVER=ses`, and that guard stays.

Put these in `backend/.env` (never in a committed file; the password is
never logged and is not shown on any screen):

```
MAIL_DRIVER=smtp
SMTP_HOST=smtp.gmail.com
SMTP_PORT=587
SMTP_SECURE=false
SMTP_USER=you@gmail.com
SMTP_PASSWORD=<the 16-character app password, see below>
MAIL_FROM=Wellsure HR <you@gmail.com>
```

Restart the backend (`npm run dev`). Then **Admin → Employee → Add Employee**:
after you create someone, the screen shows one of

- **Invitation email sent to …** — the mail server accepted it. That means
  accepted, not "reached the inbox": check spam if it is missing.
- **Nothing was emailed to …** — you are still on the `console` driver.
- **The invitation email … could not be sent**, with the reason in words
  (wrong password, server unreachable, address refused). The person has *not*
  been invited. Fix the cause and press **Try again**.

Each screen has a **Resend** button (here, on the employee's profile, and in
**Import Center → Invitations**). Resending replaces the earlier link, which
stops working.

**Gmail app password.** Gmail will not accept your normal password from an
app. You need 2-Step Verification on, then an app password:

1. Go to <https://myaccount.google.com/security> and turn on **2-Step
   Verification** if it is off.
2. Open <https://myaccount.google.com/apppasswords> (or search "App
   passwords" in your Google Account settings).
3. Name it (e.g. "Wellsure dev") and choose **Create**. Google shows a
   16-character password once; copy it without the spaces into
   `SMTP_PASSWORD`.
4. Use `SMTP_HOST=smtp.gmail.com`, `SMTP_PORT=587`, `SMTP_SECURE=false`
   (Gmail upgrades the connection with STARTTLS), `SMTP_USER` = your full
   Gmail address, and `MAIL_FROM` = the same address. Gmail rewrites any other
   From address.
5. If you stop needing it, delete the app password from the same page.

If sending fails you will see the reason on screen: "refused the sign-in" is
the wrong user or password (an app password is required, not your normal one);
"Could not reach <host>" is the host/port or your network. Gmail
limits free accounts to a few hundred emails a day, plenty for development.

**To try it without any account**, run a local catcher such as
[Mailpit](https://mailpit.axllent.org/) and set `MAIL_DRIVER=smtp`,
`SMTP_HOST=localhost`, `SMTP_PORT=1025`, `SMTP_REQUIRE_TLS=false`; the
emails show up in its web page (<http://localhost:8025>) and go nowhere else.

**Careful with the demo data.** The seeded accounts that are still `INVITED`
have made-up Gmail addresses that may belong to real strangers. With
`MAIL_DRIVER=smtp` do not use "Select everyone not yet sent" in
**Import Center → Invitations** on a seeded database: tick only the people
you created yourself with an address you own.

**Imported employees are never emailed automatically.** After an Excel import
HR opens **Import Center → Invitations**, chooses who to invite (up to 100 at
a time) and presses **Send invitations**; each person gets their own result,
and a failure is shown against their name, never counted as sent.

---

## 9. Everyday commands

Run from the repo root unless noted.

| Command | What it does |
|---|---|
| `npm run dev` | API, background worker and frontend together, with live reload |
| `npm run db:seed --prefix backend` | Wipe and reseed the database (dev only) |
| `npm run db:migrate --prefix backend` | Apply pending migrations without touching data |
| `npm run db:drift` | Fail if `prisma/schema.prisma` and the migrations describe different databases (CI runs it; run it after changing the schema) |
| `npm run lint` | ESLint across backend, frontend, biometric-agent |
| `npm run typecheck` | `tsc --noEmit` across every project |
| `npm run test` | Vitest, backend + frontend + biometric-agent — backend is an integration suite against your real local Postgres/Redis, not mocks; frontend covers route-config wiring (`frontend/src/routes/__tests__/`). Safe to run while `npm run dev` is up, with no interaction either way: the suite uses its own Postgres database (`<dev database>_test`), Redis database and Socket.IO channel (`REDIS_TEST_DB`), and `.storage-test/`/`.mail-test/` folders. Each run drops, recreates, migrates and seeds that database first (about 10 s), so every run starts from the same state |
| `npm run check:popovers` (in `frontend/`) | Opens a real browser at 390px and 1280px and checks every popover and dropdown (Your Apps, notification bell, settings menu, Leave/Attendance menus, Quick Links): opaque, above the page, inside the screen, closes on Escape and on a click outside. Needs the API, the worker and `npm run dev` running and the seeded accounts; CI runs it too and keeps screenshots as an artifact |
| `npm run test:replay --prefix backend` | The month replay: 500 simulated employees for a month through the real ingestion and recompute, diffed field by field against what each named scenario says should happen (about 75 s, needs the same local Postgres/Redis; not part of `npm run test`; CI runs it as `attendance-replay`). Writes `backend/perf/last-run.json`; see `backend/perf/README.md`. Override size with `REPLAY_EMPLOYEES` / `REPLAY_SEED` |
| `npm run test:clock --prefix backend` | The whole backend suite run as if the wall clock read each of several instants (00:10 IST, a new year, a leap day, years ahead; or `-- <ISO instant>` for one), to find tests that depend on the hour or date they run in. About 7 minutes per instant on CI-class hardware; uses its own database and Redis db, so it can run beside `npm test`. Only JavaScript's clock moves (the database's `now()` stays real). Not part of `npm run test`, but CI runs it weekly (the "Clock audit" workflow: Tuesday 03:00 IST, or on demand with your own instants); run it yourself after adding a test with fixed dates or one that sends "now" punches. See `backend/vitest.fakeClock.ts` |
| `npm run simulate --prefix biometric-agent -- <command>` | The punch simulator CLI (see "The punch simulator" above): `setup`, `scenarios`, `scenario <name>`, `replay`, `drip` |
| `npm run test:latency --prefix biometric-agent` | Punch-to-screen latency in a real browser, by every route (see "Measuring punch-to-screen latency" above) |
| `npm run catalogue --prefix biometric-agent` | Regenerates `docs/plans/PHASE_2_SCENARIOS.md`, the plain-words list of every simulator scenario and its expected outcome. A test fails if you change a scenario and forget to run this |
| `npm run check:services` | Confirms Postgres/Redis are reachable |
| `npm run agent --prefix biometric-agent -- <run\|status\|diagnose\|check-config\|quarantine\|version> --config <file>` | The biometric sync agent (Phase 2 P2-F); see "Running the sync agent locally" below |
| `npm run fake-device --prefix biometric-agent -- --serial <s> --port <p>` | A fake biometric device speaking the real protocol, for local development |
| `npm run fake-api --prefix biometric-agent -- --key <k> --serial <s>` | A stand-in for the agent's two API endpoints, to run the agent with no backend (also what the Windows CI job uses) |
| `npm run build:exe --prefix biometric-agent` | Builds the agent as a single executable for this OS (the Windows release is built by CI) |
| `npm run admin:bootstrap --prefix backend` | Create the **first** real Super Admin on a fresh staging/production database — see §12. Refuses once any active Super Admin exists, so it does nothing locally (seeded `1000` is one) |
| `npm run admin:preflight --prefix backend` | Read-only readiness check for the first administrator (migrations, catalog, encryption, database role, SES, alert inbox, break-glass alarm subscriber). `admin:bootstrap` runs its alerting part itself and refuses if it fails — `docs/DEPLOYMENT.md` |
| `npm run field-keys --prefix backend -- <status\|add\|promote\|reencrypt\|retire>` | Field-encryption key rotation, in four phases — `docs/DEPLOYMENT.md` "Field encryption keys". `status` is safe anywhere |
| `npm run seed:demo-company --prefix backend` | **Development only.** Adds the fictional *demo company* (made-up people, salaries, a fictional bank file format; a DEMO COMPANY banner on every screen) on top of the seeded database, so payroll can be shown and tested end to end without a real figure. Refuses outside development, and the app refuses to start anywhere else if it has been run there. To start again: `npm run db:seed --prefix backend`. See "The demo company" below |
| `npm run test:demo --prefix backend` | The demo company's own test (builds it in the test database and drives a month through every payroll step as its users, then crawls it as the developer). Its own run on purpose: it is excluded from `npm test` because it fills the test database with a whole company |
| `npm run check:sensitive-ui --prefix frontend` | Opens every page of both portals in a real browser as the demo company's developer and as an employee, and fails if any made-up secret is on a page or the DEMO COMPANY banner is missing. Needs the stack up and the demo company seeded (CI does both) |
| `npm run measure:payroll --prefix backend -- 500` | **Development only, on a seeded demo database.** Adds made-up people up to the headcount and times the payroll calculation, the approval re-check, the register workbook and payslip PDFs. Numbers are in `docs/plans/PHASE_6_REVIEW.md` §6 |
| `npm run docs:sensitive --prefix backend` | Prints the generated tables in `docs/SENSITIVE_DATA.md` (who can see, change and confirm each kind of secret). A test fails if the document and the code disagree: paste the output between the markers |
| `npm run admin:recover --prefix backend` | Break-glass recovery for a Super Admin who lost their password or 2FA device — see §12 |
| `npm run history:repair --prefix backend` | **Preview** history rows that don't fit the effective-dating model (e.g. a leaver whose placement was never closed) — every fix, current → new value, and why, plus rows a person must decide. Changes nothing. To apply, get the preview approved, then run the exact command it prints (`--apply --fingerprint … --approved-by … --operator …`); a changed list is refused. `db:migrate` warns when this is needed. See `docs/plans/EFFECTIVE_DATES.md` |

**Trying punch ingestion locally (Phase 2).** No device is needed. Sign in as
`1001`, open Admin Tools → Devices → Sync agents, add an agent and copy its key
(shown once). Then register a device (route *Sync agent*, that agent, *Simulated*
on) and post ATTLOG lines as the agent would:

```bash
curl -s -X POST localhost:4000/api/biometric/agent/punches \
  -H "Authorization: Bearer <agent key>" -H "Content-Type: application/json" \
  -d '{"device":"<serial>","lines":["1006\t2026-10-08 10:02:11\t1\t255\t1\t0"]}'
```

The response gives the counts (new / duplicate / unmapped / rejected / flagged).
Recent batches, Unmapped and Flagged show the result. With `npm run dev`
running (the worker is part of it), each punch's day is recomputed about a
second later into `daily_attendance`. To compute a range from scratch — say
the month so far — use Workforce → Attendance → Process Attendance. The punch
simulator (below) does all of this at scale.

**The punch simulator (Phase 2 P2-G).** Sends a day, a week or a month of
made-up punches through the three real routes (the real agent reading a
simulated device, ADMS push, or HR's file upload) and checks that the server
stored every day exactly as its scenario says. Development servers only; it
never writes to the database, only sends punches.
```bash
export SIM_USER=1000 SIM_PASSWORD='<that account\'s password>'   # who signs in; never a command-line argument
npm run simulate --prefix biometric-agent -- setup                # once: registers its agent and one simulated device per route
npm run simulate --prefix biometric-agent -- scenarios            # the scenario names (what each should do: docs/plans/PHASE_2_SCENARIOS.md)
npm run simulate --prefix biometric-agent -- scenario late-arrival --route push --employee 1006,1007 --date 2026-10-05 --verify
npm run simulate --prefix biometric-agent -- replay --route agent --from 2026-09-01 --to 2026-09-07 --verify
npm run simulate --prefix biometric-agent -- drip --route push --rate 6    # a punch every 10 s, to watch Who Is In? and the calendar update; Ctrl-C stops
```
`--verify` asks the server to recompute the range (as Process Attendance does;
the worker must be running) and compares every day with its scenario. The
server must be this machine unless you pass `--allow-remote` (staging); a
production server has no simulator endpoints and is refused. The simulator
cannot remove punches, so it refuses to send to employee-days that already have
some: use other days, other employees, or a freshly seeded database. Signing in
is rate-limited by IP, so many quick runs in a row can be refused for a few
minutes. Days whose punches arrive late (`stale-day`, `stray-flagged`,
`catch-up`'s lateness) can't be sent through a real route and are left out; the
replay tests cover them.

**Flagged punches in bulk (P2-J).** Admin Tools → Devices → Flagged: filter by device, reason and dates, tick rows or choose *Accept all N that match…*,
read exactly what will be accepted, give a reason and tick the confirmation. Each punch gets its own audit row. Your own punches are left out (someone else
decides them). To try it locally, make some old punches: `simulate` days older than the policy's plausible age arrive flagged, or upload an old ATTLOG
file in Import Center.

**Device and agent health (Phase 2 P2-H).** The check runs every minute on the *scheduler*, which `npm run dev` does
not start: for the alerts to fire locally also run `npm run start --prefix backend -- scheduler` (the worker, which is part
of `npm run dev`, runs the job). Thresholds and recipients: System Settings → Attendance → Device alerts. To see an alert
end to end, with the API, worker and scheduler up and `simulate setup` done:
```bash
npm run simulate --prefix biometric-agent -- fault agent-silent --for 240     # the agent stops; alerts after the set minutes (inside the working window)
npm run simulate --prefix biometric-agent -- fault device-silent --for 420    # the device is switched off (inside the branch's working hours)
npm run simulate --prefix biometric-agent -- fault wrong-clock --for 240 --offset 600
```
Both alerts only fire during working hours (the shifts of the people expected at the branch, plus the *Agent hours margin* for the
agent), so run the faults on a working day within those hours, or the check will rightly stay quiet. Lower *Device quiet for*
(minimum 5) and *Agent heartbeat late by* (minimum 2) in Device alerts to wait less. Incidents,
health chips and the Volume chart are on Admin Tools → Devices.

**Measuring punch-to-screen latency (Phase 2 gate G1).** With the API, the worker and
the frontend running (`npm run dev`) on a **freshly seeded** database:
```bash
export SIM_USER=1000 SIM_PASSWORD='<that account\'s password>'
npm run test:latency --prefix biometric-agent
```
It signs HR and three employees into the real screens in a headless browser,
sends punches by each route and prints how long each took to show on each
screen; it fails past 5 seconds. Chromium comes from `PLAYWRIGHT_BROWSERS_PATH`
(or `PLAYWRIGHT_CHROMIUM_EXECUTABLE`); `npx playwright-core install chromium`
fetches one. It refuses to run if fewer than 8 people lack punches today (reseed),
and signing in is limited to 10 per 15 minutes per IP (a run uses 5; local Redis
key `ratelimit:auth.rateLimit.login:127.0.0.1` can be deleted to reset it). CI job
`latency` does the same on every push.

**The hour it runs at does not matter** (Phase 3 commit 3; the first CI run at 00:10 IST failed because "now" was outside the shift's punch window). For the
duration of a run the people it measures are given an all-day shift (code `LATENCY24`, 00:00 to 23:59) through Shift Override for yesterday and today, so
every punch sent at "now" is inside a window whatever the hour, and the run is never about whether an out-of-hours punch is filed correctly. It puts
everything back when it ends (overrides cleared, the shift made inactive). The one moment no all-day window covers is midnight itself, so a run that
starts within five minutes of it waits until just after. It does not skip, at any hour.

**Running the sync agent locally (Phase 2 P2-F).** The real agent and its
read-only device driver, against a fake device on this machine that speaks the
device's protocol. Nothing here touches a real device.
1. Sign in as `1000` or `1001`. In Admin Tools → Devices → Sync agents, add an
   agent and copy its key (shown once). Register a device: route *Sync agent*,
   that agent, *Simulated* on, serial e.g. `SIM-001`. "Sync punches from"
   defaults to today; the agent never sends a punch dated before it.
2. Start the fake device (TCP and UDP 4370, control on 4380):
   ```bash
   npm run fake-device --prefix biometric-agent -- --serial SIM-001 --port 4370
   ```
3. Give the agent a `config.json` (anywhere; no secrets in it):
   ```json
   { "apiUrl": "http://localhost:4000", "pollSeconds": 5, "dataDir": "./agent-data",
     "devices": [{ "serial": "SIM-001", "host": "127.0.0.1", "port": 4370 }] }
   ```
   and run it with the key in the environment (Windows uses Credential Manager
   instead, from P2-F commit F2):
   ```bash
   WELLSURE_AGENT_KEY=<key> npm run agent --prefix biometric-agent -- run --config /path/to/config.json
   ```
   `diagnose` instead of `run` prints what the device says (serial, firmware,
   log count and capacity, clock) and sends nothing; `check-config` validates
   the file and says whether the key is present. Only one agent runs per data
   folder: a second `run` exits with "already running". After a crash the
   lock is taken over within a minute. `quarantine` lists any punch batches
   the server refused (set aside on the PC, never deleted; HR sees a warning
   until they are dealt with).
4. Punch: `curl -X POST localhost:4380/punch -d '{"deviceUserId":"1006"}'`
   (Arjun's device ID). Within a poll his Attendance Info and Who Is In update.
   `curl -X POST localhost:4380/clock -d '{"offsetSeconds":300}'` makes the
   device clock drift: the Devices screen and Admin Home warn within a heartbeat.
   `/clear` clears its log; `/power` with `{"on":false}` stops it answering.

To try the **packaged** executable instead of `tsx` (same behaviour, one file):
`npm run build:exe --prefix biometric-agent`, then run
`biometric-agent/dist/wellsure-agent run --config <file>` with the same
environment variables. The Windows service, installer and release zip are built
and tested by the CI job `agent-windows`; installing on a real PC is
`biometric-agent/INSTALL.md`.

The Devices screen shows what the agent last reported per device (read OK or
why not, last read, clock offset, retention, log fill, punches waiting on the
PC). The thresholds are System Settings → Attendance → Device health.

**Trying the Attendance Muster and manual entry (Phase 2).** Sign in as `1001`
and open Workforce → Attendance → Attendance Muster. Days that have happened
are computed on first view. The SPN-Panchsheel and Wellsure 2 people (`1003`,
`1008`, `1030`, `1010`) have no device, so their days are `NM` and editable:
- click a day and type `10:45-19:00` (worked out like a punch: late 45m), `P`,
  `A`, `P:A`/`A:P`, `W` on an off day, or `-` to clear;
- Tab or Enter moves on; Save writes the batch (one bad cell saves nothing,
  and the bad cell turns red).

Device people's days are read-only. Nobody can mark their own attendance,
HR included.

Priya (`1003`) marks those two branches. Signed in as her, the employee portal
shows Attendance → Mark Attendance with only those people, plus "Mark all
present" and "Upload muster". The upload takes the template downloaded there,
or from Import Center → Manual attendance muster. Karan (`1002`) doesn't see
the item.

The "still not marked" reminder goes to whoever marks a branch at 18:00 IST.
That hour is the System Setting row `attendance.manualReminderHour` (not yet
on the System Settings screen), and a change applies when the scheduler
restarts.

**Trying Attendance Info and the forgot-to-punch request (Phase 2).**
1. Post a single punch for Arjun (`1006`) on a past weekday, as in "Trying
   punch ingestion" above.
2. Sign in as `1006` and open Attendance → Attendance Info. That day shows
   `A` with a red dot.
3. Click the day, then "Tell us the missing time", and give, say, 19:00 and
   a reason.
4. Karan (`1002`, Arjun's manager, seeded with the regularization keys) gets
   a notification, and the request appears in To do → Review → Attendance.
   HR sees every request in Workforce → Attendance → Regularizations.
5. Approve it. Arjun's open calendar turns the day into `P` with ✎
   (corrected) within a second or two.

Workforce → Attendance → Who Is In? shows today live.

**Prisma Studio** (a GUI for browsing/editing the database):

```bash
cd backend && npx prisma studio
```

---

### The demo company (Phase 6)

Payroll is built so that the people who build and run the system never need to see a real salary, bank account, registration number or bank layout: the owners enter those themselves ([`SENSITIVE_DATA.md`](SENSITIVE_DATA.md)). To work on payroll without any real figure, seed the **demo company** on a development database:

```
npm run db:seed --prefix backend            # a clean development database
npm run seed:demo-company --prefix backend  # the fictional company on top of it
```

It creates `DEMO001` Demo Owner (Super Admin), `DEMO004` Demo HR Admin, `DEMO005` Demo Developer, `DEMO013` Demo Second Owner (the second director) and more employees (`DEMO002` and `DEMO003`, who used to hold the payroll roles, are ordinary employees; the two directors `DEMO001` and `DEMO013` are not on the demo payroll until D2 lets one director set the other's pay), all with the password `Wellsure@123`; every rule, component, structure and the bank layout Confirmed by two different demo users (the two directors); salaries entered as revisions and approved by a second person; a month of attendance locked; and the people's pay details signed off. So **Payroll → Ready for First Run is green** and a run for the last month can be taken through every step. Everything is made up and says so (bank accounts begin `9999`, PANs `DEMOX`, the bank format is fictional), and every screen shows a **DEMO COMPANY** banner.

- **What the production developer login sees:** sign in as `DEMO005`. It holds the Developer / operator role: it can open Payroll → Setup Checklist and see where each item stands, but no salary, payslip, bank account, identifier, layout or debit account. The `1000` Super Admin of the ordinary seed sees everything of the *made-up* company, which is fine.
- **Fenced:** the seed command and the `demo.company` setting refuse outside `APP_ENV=development`; the API, worker and scheduler **refuse to start** elsewhere if the setting is on or any employee code begins `DEMO`; `admin:preflight` fails the same way.
- **To start again:** `npm run db:seed --prefix backend` (wipes the database).

## 10. Troubleshooting

**`REFUSING TO START: another test run is already using this test environment`**
Two test runs cannot share a test database (and Redis database): the second would drop and rebuild it under the first. The second run refuses
before touching anything. Wait for the first to finish; the lock is released the moment that run ends or is killed, so there is nothing to clean up.
To run two at once on purpose, give the second its own: `TEST_DATABASE_NAME=wellsure_hr_other REDIS_TEST_DB=13 npm test` (`npm run test:clock`
already does this).

**`P7-0 refuses to drop plain identifiers from a database that is not a development one`** (from `npm run db:migrate`)
Phase 7's first step encrypts employees' ESI numbers and moves the company's PAN and TAN into sealed payroll identifiers. SQL cannot encrypt with the
application's keys, so the migration drops the old plain columns only on a database the development seed built (their values there are made up), and
otherwise stops before changing anything. On a development database that was not seeded, re-seed (`npm run db:seed --prefix backend`); anywhere else,
re-enter each value through the employee profile (ESI) and Payroll → Rules and Setup (*Company PAN*, *TAN*), clear the old columns, and migrate again.

**`Encrypted value was made with data key …` / values that used to decrypt now fail, after pulling Phase 1.5 commit A**
Every encrypted value now starts with the id of the data key that made it. Values written before that (a local database seeded earlier) are
not in the new layout. Nothing real exists yet, so re-seed: `npm run db:seed --prefix backend`.

**`REFUSING TO START: APP_ENV is "staging" …`**
The configuration is not safe for that environment (a development default, a placeholder, a short or shared secret, a local driver, or an
unencrypted connection). The message lists each problem by variable name. `docs/DEPLOYMENT.md`, "What the app refuses to start without".

**"Postgres not running" / `ECONNREFUSED` on `DATABASE_URL`**
Start it: `brew services start postgresql@16` (macOS) or
`sudo systemctl start postgresql` (Linux), or check the Windows service
is running. `npm run check:services` tells you exactly what's unreachable.

**`password authentication failed for user "wellsure"`**
The password in `DATABASE_URL` doesn't match what you created the role
with in [§3](#3-create-the-database-and-role). Either fix `backend/.env`
to match, or drop and recreate the role with the password you want.

**`npm install` in `biometric-agent/` fails with `Cannot read properties of null (reading 'edgesOut')`**
This is a bug in npm 10 (the version that ships with Node 22): it can't resolve
the agent's test tool (vitest) *from scratch*, even in an empty project. It
only bites when the lockfile is being changed. `npm ci` and a plain
`npm install` work, because they install from `biometric-agent/package-lock.json`,
which was resolved once with npm 11. So: don't delete that lockfile, and to add
or upgrade a dependency there use npm 11 for that one command:
`cd biometric-agent && npx -y npm@11 install --save-dev <package>`, then check
that `npm ci` still works under npm 10 before committing.

**The login screen (or Quick login) says "The server can't be reached"**
The browser got no answer at all from the API, so nothing is wrong with the
sign-in details or the database. Start it (`npm run dev`, or `npm run dev
--prefix backend`), and check `curl localhost:4000/ready` answers. After a
machine or container restart Postgres, Redis and the API all need starting
again. A *refused* sign-in is different: it shows the server's own message
(and Quick login then also asks whether the seed has run).

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
`npm install` in `backend/` generates the client (its `postinstall`). If
TypeScript still complains about fields/models that clearly exist in
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

---

## 12. Super Admin accounts: first-time setup and recovery

Super Admin is guaranteed in code (Phase 5 commit E1, spec §2):

- it always holds **every** permission with data scope **ALL**. This is
  computed in `backend/src/lib/permissions.ts`, not read from the role's
  rows, so nobody (a Super Admin included) can revoke anything from it;
- the **last active Super Admin can never be lost**. Deactivating,
  removing the role from, or separating the only active Super Admin is
  refused, both by the API with a clear message and by database triggers
  for any other path.

Production is meant to have **two** real Super Admins, so either can be
removed or recover the other while one remains. The seeded accounts
(`1000` etc.) are fake and exist only in development. Real people's
details never go in the seed or anywhere else in the repo.

### Creating the first Super Admin (staging and production)

Staging and production are never seeded, so the first Super Admin is
created once with `scripts/admin-bootstrap.ts`. It:

- refuses if any **active** Super Admin already exists. After that, Super
  Admins are appointed in the app.
- takes the person's details **at runtime**: from prompts when run in a
  terminal, or from flags / `BOOTSTRAP_*` environment variables. The full
  list is at the top of the script.
- attaches the role to an existing employee by employee code, or creates
  a minimal employee record. The minimal record has identity and contact
  details only. Addresses and emergency contact are set to "To be updated
  in the portal"; job placement is added later from the profile once
  departments exist.
- **never handles a password.** The person gets the normal invitation
  email and sets their own password (and 2FA, where the
  `auth.require2faRoles` setting requires it) in the browser. Outside development that setting starts as Super Admin, HR Admin and Payroll Admin, so the first Super Admin is walked through 2FA enrolment as they accept the invitation.
- writes an audit-log entry (`access.super_admin.bootstrapped`) with no
  actor.
- **is loud** (E1.1). It needs `--operator "<your name>"`. Before anything
  is created, it:
  - writes a `security.breakglass` log line;
  - emails `SECURITY_ALERT_EMAIL`, when set;
  - raises a security event that the new Super Admin sees as a banner.

  If that email fails it stops, unless you add `--mail-is-down`; the alert
  is then queued and retried for 24 hours.

Steps:

1. Deploy as usual. The `migrate` task applies migrations **and** creates
   the permission catalog and system roles (`ensureAccessCatalog`). The
   bootstrap also runs it, in case it hasn't.
2. Make sure outgoing email works in that environment (SES), because the
   invitation goes to the person's personal Gmail. If email can't be
   relied on yet, add `--print-link`. The script then also prints the
   set-password link; hand it over in person and treat it like a password.
3. Run `npm run admin:preflight` first (same shell, read-only). `admin:bootstrap` then runs the
   alerting part of it itself and **refuses to create anything** in an environment that
   cannot tell anyone it happened (no confirmed subscriber on the break-glass alarm, SES
   cannot send, the alert inbox cannot receive). There is no flag to skip that.
   Run the script **inside the backend image**, in the target environment,
   from a shell on a running backend container (ECS Exec), so the details
   are typed at prompts and never stored anywhere:

   ```bash
   aws ecs execute-command --cluster <cluster> --task <api-task-id> \
     --container <backend-container> --interactive \
     --command "node_modules/.bin/tsx scripts/admin-bootstrap.ts --operator '<your name>'"
   ```

   The exact cluster and container names come from the CDK app stack once
   it's deployed. It prints the environment and the masked database URL
   first. Check them, answer the prompts, then type `yes`.

   *Avoid* passing the details as environment-variable overrides on a
   one-off `aws ecs run-task`. That works (add `--yes`), but the values
   are then kept in the ECS task definition/overrides, where anyone who
   can describe tasks can read a real person's details.
4. The person opens the invitation, sets a password, signs in with their
   employee code, and completes their profile (address, emergency
   contact, and job placement under Employee → profile → Job).
5. They appoint the **second** Super Admin in the app: create that person
   with Add Employee as usual (or open their existing profile), then go to
   profile → **Access** → Roles → add *Super Admin*. Only a Super Admin can
   assign that role.

If the invitation link expires before it's used, run the script again with
the **same** employee code. It sends a fresh link. It refuses any other
code while that invitation is outstanding.

### If a Super Admin loses their password or 2FA device

Work down this list and stop at the first step that applies. In every
case, **verify the person's identity out of band first** (in person or by
a call to a known number), never just on the strength of an email or
chat message.

1. **The other Super Admin does it in the app (normal path).**
   They open the person's profile → **Access** → Security:
   - *Reset 2FA*: clears the authenticator and backup codes and signs the
     person out everywhere. They enrol again at next sign-in.
   - *Send password reset*: emails a 1-hour reset link to their personal
     Gmail.
   - *Unlock*: clears a failed-login lockout.

   All three ask for a reason and are audit-logged. The person is emailed
   that it was done, by whom and why, so one admin account can't quietly
   take over another. Only a Super Admin can do these to a Super Admin.
   Nobody can do them to themselves, and HR staff with
   `user.security.manage` can do them only for non-Super-Admins.
2. **Lost password but still has 2FA and their Gmail:** they use *Forgot
   password* on the sign-in page. No admin needed.
3. **No other Super Admin can help** (the other one is unavailable or also
   locked out): use the **break-glass CLI**, run the same way as the
   bootstrap (ECS Exec into a backend container):

   ```bash
   node_modules/.bin/tsx scripts/admin-recover.ts --employee-code <code> \
     --reset-2fa --password-reset --unlock \
     --reason "<what happened, ticket ref>" \
     --operator "<your name>" \
     --confirm-no-other-admin "<why the other Super Admin can't do this in the app>"
   ```

   Pick only the actions needed. **It is loud by design, and that's the
   point:**
   - **Before** it changes anything it emails **every active Super Admin
     (the person being recovered included)** and `SECURITY_ALERT_EMAIL`:
     what, to whom, the reason, the justification, the operator and the
     machine.
   - It writes a `security.breakglass` log line, which goes to CloudWatch
     in AWS and is alarmed on.
   - It raises a red banner in the app for every Super Admin. The banner
     stays until a Super Admin **other than the person recovered**
     acknowledges it and says what they checked.
   - If the alert email can't be sent, it changes nothing. Only with
     `--mail-is-down` does it proceed; the alert is then queued and retried
     for 24 hours.

   It first lists the other active Super Admins and when each last signed
   in, so you can see whether step 1 was really unavailable. The reason
   (≥10 characters), operator and justification are required, and they are
   recorded on every action's audit entry, unlock included.
   - It works on Super Admin accounts only, and refuses everyone else.
   - It can only reset, unlock or re-issue. It never sets a password or
     grants a role.
   - If they've also lost access to their Gmail, add `--print-link` and
     hand the reset link over in person. It is valid for 1 hour and works
     once.

   **What it doesn't do:** stop someone with server access who chooses not
   to use it. See spec §9 "Break-glass access and its honest limit". The
   safeguard against that is the record kept outside the database
   (CloudWatch, ECS Exec session logs, CloudTrail), so keep server access
   limited to the owners.
4. **Last resort: the app can't run at all.** Connect to the database
   directly, through an SSM port-forward to RDS via the bastion/instance
   the infra stack provides, using the admin credentials from Secrets
   Manager. Then clear 2FA and the lockout for that one user:

   ```sql
   BEGIN;
   UPDATE users SET totp_enabled = false, totp_secret_encrypted = NULL, totp_verified_at = NULL,
                    failed_login_attempts = 0, locked_until = NULL
    WHERE employee_id = (SELECT id FROM employees WHERE employee_code = '<code>');
   DELETE FROM totp_backup_codes WHERE user_id = (SELECT u.id FROM users u JOIN employees e ON e.id = u.employee_id WHERE e.employee_code = '<code>');
   INSERT INTO audit_logs (id, actor_user_id, action, entity_type, entity_id, after, created_at)
   SELECT gen_random_uuid()::text, NULL, 'auth.2fa.reset_by_sql', 'User', u.id, '{"reason":"<why>"}'::jsonb, now()
     FROM users u JOIN employees e ON e.id = u.employee_id WHERE e.employee_code = '<code>';
   COMMIT;
   ```

   The person then uses *Forgot password* (step 2) once the app is back.
   Never write a password hash by hand.

   This path is **not** loud: no email and no banner. Tell the other
   Super Admin yourself, and record what was done and why outside the
   system. The only automatic trail is the RDS log export / pgaudit that
   Phase 1.5 sets up. The `INSERT` above is the one audit-log write that
   is allowed: rows can be added but never changed or deleted.

The database triggers still apply on this path: no SQL can leave the
system with zero active Super Admins.
