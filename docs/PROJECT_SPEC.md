# HR Portal — Product Specification

Version 1.0 · Owner: (your name) · Target: replace greytHR module by module

---

## 1. Background

Our company has used **greytHR** for years for HR, attendance, leave and payroll. We are building our own portal that does everything greytHR does for us, with one major improvement: **real-time data**.

Today, attendance from our biometric punching machine only reaches greytHR when HR clicks a "view/sync" button, usually at month end. Employees cannot see their attendance daily. In the new portal, every punch must appear on the employee's screen within seconds, and so must leave approvals, kudos, joinings, birthdays, anniversaries and announcements.

**Company facts**
- ~150–500 employees (confirm), across locations: C-10 Panchsheel, Ajmer, SPN-Panchsheel, B-22 Panchsheel (seed these; configurable).
- One or more biometric punching machines (ZKTeco / eSSL family expected — confirm model).
- Default shift: **General (GEN) 10:00–19:00**.
- Leave year: **January–December**.
- Currency INR, timezone Asia/Kolkata, Indian statutory compliance (PF, ESI, PT, LWF, TDS).

**Migration strategy:** greytHR keeps running in parallel. We go live with attendance + leave first; payroll runs in parallel for at least 2–3 months before greytHR is switched off.

---

## 2. Users and roles

| Role | Scope |
|---|---|
| `EMPLOYEE` | Own data only |
| `MANAGER` | Own + direct and indirect reports; approves leave and regularizations |
| `HR_EXECUTIVE` | All employees; **no** salary or bank data |
| `HR_ADMIN` | All employees incl. salary, bank; all configuration |
| `PAYROLL_ADMIN` | Payroll run, statutory, bank file |
| `APPROVER` | Second approval (checker) for payroll and bank batches |
| `SUPER_ADMIN` | Everything, incl. user/role management and unlocking finalised periods |

Permissions are granular strings (e.g. `employee.view`, `employee.salary.view`, `employee.bank.view`, `attendance.override`, `attendance.finalise`, `leave.grant`, `payroll.run`, `payroll.approve`). Roles map to permission sets. A user can hold multiple roles. Every query applies a data scope: `SELF`, `TEAM`, `ALL`.

---

## 3. Employee onboarding and login flow (exact business process)

1. The new employee is first **registered on the biometric machine**, which assigns a **device user ID** (e.g. `1042`).
2. HR opens **Add Employee** in the admin portal and enters that ID as the **Employee Code**. This code is the employee's permanent username.
3. HR completes the onboarding wizard:
   - **Official:** employee code, date of joining, department, designation, location, reporting manager, shift, employment type, official email (optional)
   - **Personal:** full name, DOB, gender, personal email (Gmail, **required**), mobile, current/permanent address, emergency contact, blood group, photo
   - **Statutory:** PAN, Aadhaar, UAN / PF number, ESI number
   - **Bank:** account holder name, account number (entered twice), IFSC (validate format, auto-fill bank/branch if possible), bank name, branch
   - **Salary:** salary structure and CTC (Phase 6; field can be empty earlier)
   - **Review → Save → Send invite**
4. The system emails the employee a **set-password link** (single-use token, stored hashed, valid 48 h). HR can resend.
5. The employee opens the link, creates a password (min 8 chars, mixed; strength meter), and is logged in.
6. Thereafter login = **Employee Code + password**. "Forgot password" sends a reset link to the personal email on file.
7. Accounts lock for 15 min after 5 failed attempts. HR/Admin/Payroll roles must enable TOTP 2FA.
8. On separation, login is disabled automatically after the last working day.

Employees can edit limited personal fields (address, emergency contact, photo); changes to bank or statutory data by an employee create a **change request** that HR approves.

---

## 4. Biometric integration and real-time attendance

### 4.1 Ingestion (build both paths)

**Path A — Device push (ADMS / "cloud server" mode).** Many ZKTeco/eSSL devices can be configured with a server address and will push attendance logs over HTTP. Implement the device protocol endpoints under `/iclock/*` (`cdata` GET for handshake/options, `cdata` POST for ATTLOG/OPERLOG uploads, `getrequest`, `devicecmd`). Parse ATTLOG lines (user id, timestamp, status, verify type). Authenticate devices by serial number against the `devices` table. Respond in the plain-text format the device expects.

**Path B — LAN sync agent (`biometric-agent/`).** Runs on an office PC. Connects to each device IP on port 4370 using a ZKTeco library (e.g. `node-zklib` or `zkteco-js`), polls every 30 s (configurable), and POSTs new logs to `POST /api/biometric/agent/punches` using an agent API key over HTTPS. Keeps a local cursor (last synced timestamp) and retries with backoff when offline. Also sends a heartbeat. Can run as a Windows service (document using `node-windows` or NSSM).

Both paths feed the same ingestion service.

### 4.2 Data layers

- **`raw_punches`** — immutable: `device_id, device_user_id, punched_at (timestamptz), direction (IN/OUT/UNKNOWN), verify_type, source (PUSH|AGENT|IMPORT|MANUAL), raw_payload, received_at`. Unique `(device_id, device_user_id, punched_at)`.
- **`daily_attendance`** — one row per employee per business date: `shift_id, first_in, last_out, total_work_mins, break_mins, actual_work_mins, work_mins_in_shift, late_in_mins, early_out_mins, shortfall_mins, excess_mins, status, first_half_status, second_half_status, lop_days, exception_flags[], is_overridden, is_locked, processed_at`.
- **`attendance_overrides`**, **`shift_overrides`**, **`regularization_requests`** — corrections that never touch raw data.

### 4.3 Real-time pipeline

1. Punch arrives → insert into `raw_punches` (skip duplicates).
2. Resolve `device_user_id` → employee via `employees.employee_code` (and optional `device_user_mappings` for multiple devices). If unresolved → record in unmapped list for HR.
3. Enqueue BullMQ job `attendance.recompute { employeeId, date }` (debounced/deduplicated per employee-date).
4. Worker recomputes that day, saves, and emits Socket.IO events:
   - `attendance.updated` → room `user:{id}` and `manager:{managerId}`
   - `whoisin.updated` → room `role:hr`
5. **Nightly cron (02:00 IST)** recomputes the previous day for everyone; flags absentees and exceptions.
6. Manual "Process Attendance" for any date range (job with progress reporting).

### 4.4 Attendance rules engine

Evaluate in this order for each employee and date:

1. Employee not active on that date (before DOJ / after LWD) → no record.
2. Holiday for employee's location → `H` (if punches exist → eligible for comp-off).
3. Week-off per employee's week-off pattern → `O` (if punches exist → eligible for comp-off).
4. Approved leave → leave code; half-day leave combines with worked half.
5. Manual override → apply override status.
6. Otherwise compute from punches:
   - Shift = shift override for that date, else roster assignment, else employee default shift.
   - Pair punches within the shift window (shift start − 4 h to shift end + 6 h, configurable). **Night shifts crossing midnight** belong to the shift's start date.
   - Ignore duplicate punches within 2 minutes.
   - First punch = first in, last punch = last out. If directions are available, compute break time from OUT→IN gaps.
   - Late-in = first_in − (shift start + grace). Early-out = (shift end − grace) − last_out.
   - Full day if actual hours ≥ `full_day_min_hours`; half day if ≥ `half_day_min_hours`; else absent.
   - **Half-day minimum not met → 1 day LOP** (current greytHR rule; configurable).
   - Single punch only → exception `MISSING_PUNCH`, status `A` until regularized.
   - Late-coming penalty rules (e.g. N lates per month = half-day LOP) — configurable, off by default.
7. Save exception flags: `MISSING_PUNCH, SHORTFALL, LATE_IN, EARLY_OUT, HALF_DAY_MIN_NOT_MET, NO_SHIFT, UNMAPPED`.

Status codes: `P` present, `A` absent, `HD` half day, `H` holiday, `O` week-off, `L:<code>` leave (e.g. `PL`, `WFH`), `LOP`, and split days like `A:P` (first half absent, second present) as greytHR shows.

### 4.5 Period finalisation

HR finalises a payroll month's attendance. Finalised days are locked (`is_locked = true`); recompute, overrides and regularizations are blocked. Unlock requires `SUPER_ADMIN`, a reason, and is audit-logged. Payroll only reads finalised attendance.

---

## 5. Leave management

### 5.1 Leave types (seed)

| Code | Name | Notes |
|---|---|---|
| `PL` | Privilege / Earned Leave | The accruing leave (rules below) |
| `LOP` | Loss of Pay | Unpaid; no balance limit |
| `COF` | Comp-Off | Credited when employee works on holiday/week-off (min hours configurable); expires after 60 days (configurable) |
| `WFH` | Work From Home | Counts as present; granted balance configurable |
| `RH` | Restricted Holiday | Choose from RH list; yearly quota configurable |

### 5.2 Our company's PL policy (must be exact)

- **Accrual:** 1.0 day credited **every month**.
- **Eligibility:** accrual starts only after the employee completes **3 months** from date of joining. Make the exact rule configurable: `ACCRUE_FROM_NEXT_MONTH_AFTER_ELIGIBILITY` (default) vs `PRORATE`.
- **Carry forward:** unused balance rolls over month to month with no cap (cap configurable).
- **Year-end (31 Dec):** remaining PL balance is **encashed** — paid as money in the next payroll — and the balance resets for the new year. Encashment per-day rate formula is configurable (default: monthly Basic ÷ 30) and must be confirmed by our CA.
- Negative balance not allowed by default (configurable).
- Half-day leave allowed.

### 5.3 Leave ledger

Balances are never stored as a mutable number. Table `leave_ledger`: `employee_id, leave_type_id, leave_year, entry_date, entry_type (OPENING|ACCRUAL|CONSUMED|REVERSAL|GRANT|DEBIT|CARRY_FORWARD|ENCASHMENT|LAPSE|EXPIRY), days (±Decimal(5,2)), reference_type, reference_id, remarks, created_by`. Balance = sum of entries. Provide a materialised/cached balance for speed but always recomputable.

### 5.4 Flows and screens

- **Apply leave** (employee): type, from/to, half-day options, reason, attachment; live balance check; shows team members already on leave those days.
- **Approve/reject** (manager, HR can override); bulk approve; comments. On approval → ledger `CONSUMED` → recompute attendance for those dates → notify employee in real time + email. Cancelling approved leave → `REVERSAL`.
- **Leave Calendar** (team/org), **Holiday Calendar** (per location), **Leave Balances** (employee view, cards per type with granted/consumed/balance, downloadable).
- **Admin — Employee Leave:** all requests, filters, apply on behalf.
- **Admin — Leave Granter:** bulk grant/debit with remarks, Excel upload.
- **Admin — Leave Recalculator:** replay accruals for selected employees/date range after a policy change or backdated joining.
- **Admin — Year End Process:** preview (per-employee closing balance, encashment days, amount) → approve → commit (creates `ENCASHMENT` entries, pushes earnings to next payroll, opens new year). Downloadable report. Re-runnable safely.
- **Admin — Leave Overview dashboard:** leaves taken by type for a selected month (donut), total leaves by month (bar), employees on leave per RH.

### 5.5 Scheduled jobs

- 1st of month 00:30 IST: monthly PL accrual (idempotent per employee-month).
- Daily: comp-off expiry.
- 31 Dec: reminder to HR to run Year End Process (the process itself is manual with preview).

---

## 6. Employee portal (ESS) — screens

Match the greytHR layout employees already know: left sidebar, header with Quick Links, notifications bell, logout.

- **Home:** greeting + quote, Review (pending approvals if manager), Upcoming Holidays, Payslip widget (latest month, paid days, gross/deduction/net masked until "Show Salary"), Quick Access (reimbursement payslip, IT statement, YTD, loan statement), IT Declaration & POI status, Track (my pending requests).
- **Engage:** feed of posts, kudos, polls, auto-posts for joinings, birthdays, work anniversaries; filters (activity type, groups, location, department); reactions and comments; Give Kudos, Create Poll. **Real-time.**
- **My Worklife:** Kudos received, Feedback.
- **To do:** Tasks, Review (approvals).
- **Salary:** Payslips (month picker, earnings/deductions, net in words, PDF download), Reimbursement payslip, YTD Reports, IT Statement, IT Declaration, Loans & Advances, Reimbursement claims, Proof of Investment, Salary Revision history. *(Phase 6+; show "coming soon" earlier.)*
- **Leave:** Apply, Balances, Leave Calendar, Holiday Calendar.
- **Attendance → Attendance Info:** month calendar with status per day and shift code; stats cards (avg work hrs, avg actual work hrs, penalty days, insights); exception-day banner with **Regularize**; day detail panel (shift, first in, last out, late in, early out, total/break/actual hrs, shortfall, excess, status details, session details); list/grid toggle; **My Regularizations**. **Real-time.**
- **Document Center:** company policies, forms, my letters, payslips, Form 16.
- **People:** employee directory (name, photo, designation, department, location, contact per privacy settings), org chart.
- **Helpdesk:** raise ticket to HR by category, track status, chat-style replies.
- **Request Hub:** all my requests (leave, regularization, profile change, reimbursement) in one place.
- **Workflow Delegates:** manager delegates approvals to someone while away (date range).
- **Profile (View My Info):** all personal, official, statutory (masked), bank (masked) details; request changes.

---

## 7. HR / Admin portal — screens

Top bar with **app switcher**, **Payroll Month selector** (global context sent with every request), employee filter (All / location / department), search, settings, logout.

### 7.1 Homepage
- **Welcome:** My Favourites (configurable shortcut tiles, e.g. Add Employee), My Tasks split into *Things to review* (I am approver) and *Things to monitor* (pending with others) with counts by type (attendance regularization, leave, profile changes…) and a Monitor link; Latest Updates (internal announcements).
- **Dashboard:** editable widget grid — Years in Service distribution, Additions & Attrition (joined vs resigned, last 12 months), Employee Count by Location, Age Distribution, Gender split, Department headcount, **Today's attendance (live)**. Cached in Redis.

### 7.2 Employee app
- **All Employees master grid** — the single place to see everyone: code, name, photo, department, designation, location, manager, DOJ, status, shift, mobile, email, CTC/gross/net, PF/ESI flags, bank (masked), leave balance, today's status. Search, filters, column chooser, saved views, pagination, Excel/CSV export (export of salary/bank requires permission and is audit-logged).
- Add Employee wizard (§3), employee profile with tabs (Official, Personal, Statutory, Bank, Salary & Revisions, Documents, Leave, Attendance, Assets, History/audit), resend invite, reset password, deactivate.
- Bulk import (see §10), profile change-request approvals, separation/exit with checklist and last working day, letter generation from templates (offer, appointment, experience, relieving, address proof) to PDF.

### 7.3 Workforce Management — Attendance
- **Who Is In?** live board (present, in-time, late, not yet in, on leave, week-off) filterable by location/department — real-time via sockets.
- **Shift Roster** — define and assign shifts and rotation patterns in bulk.
- **Employee Swipes** — raw punch viewer with filters and export.
- **Attendance Muster** — month grid, employees × days, status codes, totals (P, A, HD, LOP, leaves, holidays, week-offs, paid days), Excel export.
- **Attendance Info** — any employee's calendar and day detail.
- **Process Attendance** — recompute for date range / employees, background job with progress.
- **Attendance Period Finalisation** — lock/unlock per payroll month.
- **Attendance Exception** — list of exception days with bulk resolve.
- **Manual Override** — set a day's status with reason (audited).
- **Shift Override** — change shift for specific dates.
- **Regularization queue** — approve/reject, bulk, comments.
- **Devices** — registered biometric devices, last heartbeat, last punch received, unmapped punches with "map to employee".

### 7.4 Workforce Management — Leave
Leave Overview dashboard, Leave Calendar, Employee Leave, Leave Granter, Year End Process, Leave Recalculator, leave type and policy configuration, holiday and RH lists per location.

### 7.5 Payroll app (Phase 6+)
Salary components (earning/deduction, taxable, PF/ESI applicability), salary structure templates with formulas (e.g. Basic = 40% of CTC), employee salary assignment and revisions (effective-dated, arrears), **Payroll Run** for the selected month (reads finalised attendance: paid days, LOP; leave encashment; arrears; reimbursements; loan EMIs), variance report vs previous month, **maker-checker approval**, publish payslips (PDF + real-time notification), statutory outputs (PF ECR file, ESI, PT, LWF, TDS), IT declaration and proof-of-investment review, Form 16 / quarterly TDS return data, loans & advances, reimbursements, full & final settlement.

**Salary disbursement:** after checker approval, generate the **bank bulk-transfer file** in our bank's exact format (configurable template: CSV/XLSX/fixed-width) + summary PDF. HR uploads it to corporate net banking where the authorised signatory releases payment. HR then marks the batch paid or imports the bank response. Every step audited. **No direct money transfer from the app.**

### 7.6 Reports
Headcount, joiners, leavers/attrition, birthdays & anniversaries, attendance muster, late-coming, overtime, exceptions, leave balance & leave liability, LOP, salary register, PF/ESI/PT, bank statement, exit report. Plus a **custom report builder** (choose fields, filters, grouping; save; export; schedule by email).

### 7.7 Engage admin
Post announcements (org / location / department), moderate posts, manage groups, configure auto-posts (joining, birthday, anniversary templates and time).

### 7.8 Admin Tools
Organisation setup (company, locations, departments, designations, grades, cost centres), holiday calendars, shift master, week-off patterns, leave types & policies, approval workflows (multi-level chains), workflow delegates, users/roles/permissions, email & letter templates, devices, data import/export, **audit log viewer**, system settings.

---

## 8. Real-time layer

Socket.IO with Redis adapter. Authenticate the socket handshake with the access token. Rooms: `user:{id}`, `manager:{id}`, `dept:{id}`, `location:{id}`, `role:{role}`, `org`.

| Event | Rooms |
|---|---|
| `attendance.updated` | user, manager |
| `whoisin.updated` | role:HR_* |
| `leave.applied` / `leave.decided` | approver / applicant |
| `regularization.submitted` / `.decided` | approver / applicant |
| `tasks.counts` | affected approvers |
| `engage.post`, `engage.kudos`, `engage.reaction` | org (or scoped) |
| `engage.birthday`, `engage.joining`, `engage.anniversary` | org (daily 08:00 cron + on joining) |
| `payslip.published` | each employee |
| `notification.new` | target user |

Every notification is also persisted in `notifications` (bell icon, read/unread) and optionally emailed. Frontend uses socket events to invalidate TanStack Query caches.

---

## 9. Security and compliance

- HTTPS only; helmet; strict CORS; rate limiting (login, forgot-password, public endpoints); CSRF protection for cookie-based refresh.
- argon2id password hashing; token hashes for invites and resets; refresh-token rotation with reuse detection.
- AES-256-GCM encryption for bank account, PAN, Aadhaar, UAN; key via env/KMS; masked by default.
- Authorization on every route + data-scope filter; automated IDOR tests.
- Audit log (actor, action, entity, entity_id, before, after, ip, user agent, timestamp) — append-only.
- File uploads: type and size validation, private storage, signed URLs with short expiry.
- Daily automated Postgres backups (documented restore procedure).
- India **DPDP Act 2023**: privacy notice acknowledgement on first login, purpose limitation, data retention policy for ex-employees (configurable), export of an employee's own data, breach logging.

---

## 10. Data migration from greytHR

Build an **Import Center** (Admin Tools) with downloadable Excel templates:
1. Organisation masters (locations, departments, designations)
2. Employee master (official + personal)
3. Statutory details
4. Bank details
5. Opening leave balances as of cutoff date (become `OPENING` ledger entries)
6. Historical attendance / punches (optional, 6–12 months)
7. Salary structures and YTD figures (Phase 6)

Every import: upload → parse into staging table → validate (duplicates, missing required fields, PAN/IFSC/email/mobile formats, unknown department/location/manager, device ID collisions) → show row-level error report downloadable as Excel → HR fixes and re-uploads → commit in one transaction → summary. Provide a **reconciliation report** (headcount by location, leave balance totals) to compare with greytHR before sending invites. Invitations are sent in batches, HR-triggered, never automatically on import.

---

## 11. Core data model (starting point — refine in Prisma)

**Identity & org:** `users`, `roles`, `permissions`, `role_permissions`, `user_roles`, `refresh_tokens`, `invitation_tokens`, `password_reset_tokens`, `audit_logs`, `company`, `locations`, `departments`, `designations`, `grades`, `cost_centres`
**Employees:** `employees`, `employee_personal`, `employee_statutory` (encrypted), `employee_bank_accounts` (encrypted, effective-dated), `employee_job_history` (effective-dated dept/designation/location/manager), `employee_documents`, `profile_change_requests`, `separations`
**Attendance:** `devices`, `device_user_mappings`, `raw_punches`, `unmapped_punches`, `shifts`, `week_off_patterns`, `shift_assignments`, `shift_overrides`, `daily_attendance`, `attendance_overrides`, `regularization_requests`, `attendance_periods` (lock state)
**Leave:** `leave_types`, `leave_policies`, `leave_ledger`, `leave_requests`, `holidays`, `restricted_holidays`, `comp_off_credits`, `year_end_runs`
**Engage & workflow:** `posts`, `kudos`, `polls`, `poll_options`, `poll_votes`, `reactions`, `comments`, `groups`, `notifications`, `approval_workflows`, `approval_steps`, `approval_instances`, `workflow_delegates`, `helpdesk_tickets`, `helpdesk_messages`, `announcements`, `user_favourites`, `dashboard_layouts`
**Payroll (Phase 6):** `salary_components`, `salary_structures`, `employee_salaries`, `payroll_runs`, `payroll_run_items`, `payslips`, `payslip_lines`, `bank_transfer_batches`, `bank_file_templates`, `tax_declarations`, `tax_proofs`, `loans`, `loan_emis`, `reimbursement_claims`, `statutory_settings`

---

## 12. Delivery phases

Build strictly in this order. At the end of each phase: tests green, migrations applied, seed updated, `docs/PROGRESS.md` updated, committed.

**Phase 0 — Foundation**
Plain folder structure (`backend/`, `frontend/`, `biometric-agent/`, `shared/`, `infra/`), each an independent npm project with its own `package.json`/`package-lock.json`, TS configs, ESLint/Prettier, docker-compose (postgres, redis, minio, mailpit), `.env.example`, Express app skeleton (helmet, cors, pino, error handler, Zod validation middleware, `/health` + `/ready`, graceful SIGTERM shutdown), config module that loads and validates all env vars with Zod, Prisma setup, React + Vite + AntD shell with routing and theming, `shared/` wired up via the `@shared/*` path alias, Vitest in both `backend/` and `frontend/`, **production multi-stage Dockerfile for `backend/`** (non-root user, includes Chromium for Puppeteer, built from the repo root so `shared/` is included) with one entrypoint that can start as `api`, `worker`, `scheduler` or `migrate` via an env var/argument, empty `infra/` CDK app, GitHub Actions CI (lint, typecheck, test, docker build), README.
✅ Done when `npm run dev` runs both `backend/` and `frontend/`, the Docker image builds and starts in all four modes locally, and CI passes.

**Phase 1 — Auth, RBAC, org, employees**
Users, roles, permissions, login (employee code + password), refresh rotation, logout, invite/set-password, forgot/reset password, lockout, TOTP 2FA for admin roles, audit log, encryption helper. Org masters. Employee CRUD, Add Employee wizard, profile tabs, All Employees grid with filters/export, Excel import with staging & validation. Employee "View My Info". Seed: company, locations, departments, roles, a super admin, 20 demo employees.
✅ Done when HR can create an employee, the employee receives the email in Mailpit, sets a password, and logs in; and IDOR tests pass.

**Phase 1.5 — AWS staging environment**
Implement the CDK stacks in §15 for `staging`: VPC, RDS, ElastiCache, S3 buckets, CloudFront, ECR, ECS cluster with api/worker/scheduler services, ALB, ACM, Route 53 records, Secrets Manager, KMS, SES domain identity, CloudWatch log groups and alarms, WAF, GitHub OIDC deploy role. Add the GitHub Actions deploy workflow (build → push to ECR → run migrate task → roll ECS services → upload web build to S3 → CloudFront invalidation). Write `docs/DEPLOYMENT.md` (first-time bootstrap, DNS, SES verification, how to deploy, how to roll back, how to restore a DB backup).
✅ Done when a merge to `main` automatically deploys to `staging.<domain>`, an invite email is delivered via SES, and file uploads land in S3.
From here on, every phase is verified on staging, not only locally.

**Phase 2 — Biometric ingestion + attendance engine + real-time**
Devices, `/iclock` push endpoints, agent API, `biometric-agent/`, raw punches, dedupe, mapping, unmapped queue, shifts, week-offs, rosters, rules engine (§4.4) with thorough unit tests (night shift, missing punch, half-day min, grace, holiday work), BullMQ recompute jobs, nightly cron, Socket.IO with Redis adapter, Who Is In? live board, employee Attendance Info calendar + day detail. A **punch simulator script** to generate fake device pushes for testing.
✅ Done when a simulated punch shows on the employee's calendar and HR's Who Is In? within 5 seconds.

**Phase 3 — Attendance administration**
Employee Swipes, Attendance Muster, Process Attendance (with progress), Exceptions, Manual Override, Shift Override, Regularization (employee request + approval queue + bulk), Period Finalisation/lock/unlock, attendance stats cards and insights, exports.

**Phase 4 — Leave**
Leave types/policies, ledger, monthly accrual job with our PL rules (§5.2), apply/approve/cancel, balances, leave calendar, holiday & RH calendars, comp-off credit/expiry, Leave Granter, Leave Recalculator, Year End Process (preview → commit), Leave Overview dashboard, attendance integration. Unit tests for accrual eligibility, carry-forward and encashment.

**Phase 5 — Homepage, dashboards, engage, notifications, documents, helpdesk, reports**
Employee Home widgets, Admin Welcome (favourites, my tasks), Admin Dashboard widgets, notifications center, Engage (posts, kudos, polls, reactions, auto birthday/joining/anniversary posts), Document Center, People directory + org chart, Helpdesk, Request Hub, Workflow Delegates, core reports + exports, PWA install.
➡ **Go-live for attendance + leave** after UAT and data migration.

**Phase 5.5 — AWS production environment and go-live hardening**
Production CDK stack (Multi-AZ RDS, deletion protection, longer backup retention, larger task sizes, ECS auto-scaling), production deploy workflow on git tag with manual approval, WAF rules tuned, CloudWatch dashboards and alarms (5xx rate, latency, CPU/memory, RDS storage/connections, queue backlog, **no punches received from a device for 30 minutes during working hours**), AWS Backup plan, restore drill documented and performed once, load test with 500 concurrent simulated users and punch bursts at 10:00, security checklist review.
✅ Done when production is live on the real domain, a restore drill has succeeded, and alarms reach the admin email.

**Phase 6 — Payroll (parallel run with greytHR)**
Components, structures, employee salaries, payroll run, LOP from finalised attendance, leave encashment, arrears, payslips (PDF), variance report, maker-checker, bank transfer file, PF/ESI/PT/LWF outputs, salary register.

**Phase 7 — Tax & benefits**
IT declarations (old/new regime), proof of investment, TDS projection, IT statement, YTD, Form 16 data, loans & advances, reimbursements, full & final settlement, salary revision letters.

**Phase 8 — Extras**
Assets management, performance/review cycles, custom report builder, scheduled reports, mobile app (React Native or keep PWA), multi-language.

---

## 13. Definition of done (every feature)

- Works for the correct roles and is **blocked** for others (tested).
- Validated inputs, helpful error messages, loading and empty states in UI.
- Responsive on mobile width.
- Real-time updates where §8 says so.
- Audit logging where §9 says so.
- Tests for business logic; no failing lint/typecheck.
- Documented in `docs/PROGRESS.md`.

## 14. Open questions (Claude Code: do not guess these — keep configurable and list in PROGRESS.md)

- Exact biometric device brand/model and whether ADMS push is supported.
- Exact PL eligibility boundary (credit on completing 3 months vs from next month) and pro-rating.
- Leave encashment formula and its tax treatment (to be confirmed by CA).
- Bank bulk-transfer file format (from bank).
- PT/LWF applicability per location's state.
- Actual headcount and full location list.
- Company domain name for the portal (e.g. `hr.company.com`) and whether DNS is on Route 53.
- Whether the office has a static public IP (needed to restrict device push traffic).
- AWS account structure (single account with two environments, or separate staging/production accounts).

---

## 15. AWS deployment architecture

### 15.1 Overview

Region **ap-south-1 (Mumbai)** for all resources that hold employee data (keeps data in India and gives low latency). CloudFront and ACM certificates for CloudFront live in `us-east-1` as AWS requires; no employee data is stored there.

```
Employees / HR (browser, PWA)
        │ HTTPS
        ▼
Route 53 ──► CloudFront (+ WAF) ──► S3 (web static build, private, OAC)
        │
        └──► api.<domain> ──► ALB (+ WAF, ACM TLS) ──► ECS Fargate: api service (REST + Socket.IO)
                                                     │
Office LAN                                           ├─► ECS Fargate: worker service (BullMQ)
  Biometric device(s) ──(push, see 15.4)──► ALB      ├─► ECS Fargate: scheduler service (1 task)
  Biometric agent PC ──HTTPS + API key────► ALB      │
                                                     ├─► RDS PostgreSQL 16 (private subnets)
                                                     ├─► ElastiCache Redis (private subnets, TLS)
                                                     ├─► S3 documents bucket (SSE-KMS)
                                                     ├─► SES (email), Secrets Manager, KMS
                                                     └─► CloudWatch Logs / Alarms → SNS email
```

### 15.2 CDK stacks (`infra/`)

Organise as separate stacks, parameterised by `-c env=staging|production`:

1. **NetworkStack** — VPC across 2 AZs; public subnets (ALB, NAT), private subnets (ECS tasks), isolated subnets (RDS, Redis). One NAT gateway in staging, two in production. VPC endpoints for S3, ECR, Secrets Manager, CloudWatch Logs to reduce NAT cost.
2. **DataStack** — RDS PostgreSQL 16 (staging: single-AZ small burstable instance; production: Multi-AZ, deletion protection, 14–30 day backup retention, Performance Insights), ElastiCache Redis (TLS, auth), S3 documents bucket (block public access, versioning, SSE-KMS, lifecycle rules), KMS keys (one for field encryption, one for S3/RDS), Secrets Manager secrets. All with `RemovalPolicy.RETAIN` in production.
3. **AppStack** — ECR repository, ECS cluster, Fargate task definitions and services:
   - `api`: min 2 tasks in production, auto-scale on CPU/request count; ALB target group with health check `/ready`; **stickiness enabled** and Socket.IO configured for websocket transport (Redis adapter handles cross-task broadcasts).
   - `worker`: 1–3 tasks, auto-scale on queue depth (custom CloudWatch metric published by the app).
   - `scheduler`: exactly 1 task, registers BullMQ repeatable jobs (monthly accrual, nightly attendance, daily engage posts, comp-off expiry). Repeatable-job registration must be idempotent.
   - `migrate`: task definition only (no service), run as a one-off task by CI before rolling the api.
   - ALB with HTTPS listener (ACM cert), HTTP→HTTPS redirect, WAF (AWS managed common rules, known bad inputs, IP rate limiting, stricter limit on `/api/auth/*`).
   - Task IAM roles with least privilege (S3 bucket prefix access, SES send, KMS encrypt/decrypt with the field key, Secrets Manager read of its own secrets, CloudWatch PutMetricData).
4. **WebStack** — private S3 bucket for the React build, CloudFront distribution with Origin Access Control, SPA fallback to `index.html`, security headers policy (CSP, HSTS), WAF, custom domain via Route 53 + ACM (us-east-1).
5. **EmailStack** — SES domain identity with DKIM, custom MAIL FROM, configuration set with bounce/complaint notifications to SNS. Document that SES starts in **sandbox** and production access must be requested from AWS before go-live.
6. **ObservabilityStack** — log groups with retention (staging 14 days, production 90+), dashboards, alarms → SNS topic → admin email: ALB 5xx, target response time, ECS CPU/memory, task restarts, RDS CPU/free storage/connections, Redis memory, BullMQ backlog and failed jobs, **device silence alarm**, SES bounce rate.
7. **CiStack** — GitHub OIDC identity provider and deploy role scoped to this repository and branch/tag conditions.
8. **BackupStack** (production) — AWS Backup plan for RDS and S3, cross-region copy optional.

### 15.3 Configuration and secrets

- The app reads everything from env vars validated at boot (fail fast on missing config).
- ECS injects secrets from Secrets Manager (`DATABASE_URL`, `REDIS_URL`, `JWT_ACCESS_SECRET`, `JWT_REFRESH_SECRET`, `AGENT_API_KEYS`) and plain config as env (`APP_ENV`, `S3_BUCKET`, `KMS_FIELD_KEY_ID`, `SES_FROM`, `WEB_BASE_URL`, `TZ_BUSINESS=Asia/Kolkata`).
- Field encryption uses **KMS envelope encryption**: a data key from KMS encrypts fields with AES-256-GCM; the encrypted data key is stored alongside. Locally, a static dev key from `.env` is used through the same interface.
- Storage and email are behind interfaces (`StorageService`, `MailService`) with local (MinIO/Mailpit) and AWS (S3/SES) implementations selected by env.

### 15.4 Biometric connectivity on AWS

- **Agent path (recommended, always build):** the office agent calls `https://api.<domain>/api/biometric/agent/punches` over TLS with an API key; outbound HTTPS only, no firewall changes at the office.
- **Push/ADMS path:** many ZKTeco/eSSL devices can only push over **plain HTTP** to an IP/port and do not support modern TLS. Therefore:
  - Expose `/iclock/*` on a dedicated ALB listener (e.g. port 8081 HTTP) that forwards **only** `/iclock/*` paths to the api service; all other paths return 404 on that listener.
  - Restrict that listener with a WAF IP set / security group rule to the **office static public IP(s)** only.
  - Authenticate every request by device serial number registered in the `devices` table; unknown serials are rejected and logged.
  - If the office has no static IP, do not expose the push path; use the agent only.
- Heartbeats from devices/agents update `devices.last_seen_at`; the observability stack alarms if a device is silent during working hours.

### 15.5 CI/CD (GitHub Actions)

- `ci.yml` on every PR: install, lint, typecheck, test (with Postgres and Redis service containers), docker build.
- `deploy-staging.yml` on push to `main`: assume AWS role via OIDC → build and push image to ECR (tag = git SHA) → build web → `cdk deploy` (if infra changed) → run `migrate` ECS task and wait for success → update api/worker/scheduler services to the new image → wait for stable → sync web build to S3 → CloudFront invalidation → smoke test `/health`.
- `deploy-production.yml` on tag `v*`: same steps, gated by a GitHub Environment with required reviewer; posts `cdk diff` for review.
- **Rollback:** redeploy the previous image tag (documented one-command workflow_dispatch). Migrations must be backward compatible (expand → migrate → contract) so rollback is safe.

### 15.6 Sizing and cost guidance

For ~150–500 employees, start small and scale on metrics: api 0.5 vCPU / 1 GB × 2 tasks (production), worker 0.5 vCPU / 1 GB (1 GB+ if Puppeteer PDFs), scheduler 0.25 vCPU / 0.5 GB, small burstable RDS instance, smallest ElastiCache node. Staging uses single tasks, single-AZ RDS and one NAT gateway, and can be scaled to zero outside office hours via a scheduled scaling action. Add AWS Budgets alerts for both environments. Document estimated monthly cost per environment in `docs/DEPLOYMENT.md`.

### 15.7 Compliance notes on AWS

- All employee data stored in ap-south-1; S3 and RDS encrypted with KMS; TLS everywhere including Redis.
- CloudTrail enabled for the account; S3 access logging for the documents bucket.
- No public access to RDS, Redis or S3 buckets; administrators access the DB only through SSM Session Manager port forwarding, never by opening the database to the internet.
