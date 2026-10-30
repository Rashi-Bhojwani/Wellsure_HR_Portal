# Phase 5 review (2026-10-03)

> **Amendment, 2026-10-30 (owners' decision): there is no CA.** Wherever this document says CA, accountant or "CA confirmation", read: the owners enter and verify every statutory and tax figure themselves. Each carries a required source note (where the number came from) and an effective-from date, and a different director confirms it against that note. Nothing statutory is filled in by the system. See `CHECKPOINT_1_FOLLOWUP.md` §9.


Written at the end of Phase 5 (commit G), before the user's own testing.
Per-commit detail is in [`PHASE_5.md`](PHASE_5.md) (plans and as-built
notes) and [`../PROGRESS.md`](../PROGRESS.md) (what was verified).

**How to read the URLs:**
- `/app/...` is the employee portal; `/admin/...` is the HR/Admin portal.
- Locally they're on `http://localhost:5173`.
- Seeded accounts are in `GETTING_STARTED.md` §7 (password
  `Wellsure@123`).

## 1. Screens delivered in Phase 5

| Commit | Screen | URL | Who sees it |
|---|---|---|---|
| A | Employee Home (greeting, announcement banner, Review/Tasks, holidays, Who's on leave, Payslip/IT placeholders) | `/app/home` | everyone |
| A | Admin Homepage: Welcome (favourites, my tasks, the Unassigned count) and Dashboard (headcount, additions/attrition, age, gender, years in service) | `/admin` | admin portal users; the dashboard is team-only for managers |
| A | Notifications bell and panel (live) | every page header | everyone |
| A | Announcements (Home banner) | `/admin/engage/announcements` | `announcements.manage` |
| B | Engage feed: posts, kudos, polls, reactions, comments, groups, auto birthday/joining/anniversary posts | `/app/engage` | everyone |
| B | Kudos | `/app/my-worklife/kudos` | everyone |
| B | Moderation | `/admin/engage/moderation` | `engage.moderate` |
| B | Groups | `/admin/engage/groups` | `engage.groups.manage` |
| B | Auto-Post Settings | `/admin/engage/auto-posts` | `engage.autopost.manage` |
| C | People: directory and org chart (Manager, No team yet and HR Admin badges, Admin root) | `/app/people` | everyone (fields per System Settings) |
| C | Document Center: company documents, my documents, letters | `/app/document-center` | everyone (audience-targeted) |
| C | Company Documents | `/admin/employee/company-documents` | `documents.manage` |
| C | Employee profile → Documents tab | `/admin/employee/profile/:id` | `employee.documents.view` / `.manage`, in scope |
| C | View My Info, with photo upload | `/app/profile` | everyone (self) |
| D | Helpdesk: my tickets and a ticket | `/app/helpdesk`, `/app/helpdesk/:id` | everyone |
| D | Helpdesk queue and an admin ticket | `/admin/employee/helpdesk`, `/admin/employee/helpdesk/:id` | `helpdesk.manage` (+ `helpdesk.sensitive.view`) |
| D | Helpdesk Categories | `/admin/admin-tools/helpdesk-categories` | `helpdesk.manage` |
| D | Request Hub | `/app/request-hub` | everyone (self) |
| D | Tasks inbox | `/app/todo/tasks`, `/admin/tasks` | everyone (their own tasks) |
| D2 | Email & Letter Templates, and the template editor (TipTap, versions, typed fields) | `/admin/admin-tools/templates`, `/admin/admin-tools/templates/:id` | `letters.template.manage` |
| D2 | Issue a letter (from the profile's Documents tab); PDFs render in the worker | profile → Documents | `letters.generate`, in scope |
| E1 | Roles & Permissions (role matrix; Super Admin edits, others read-only) | `/admin/admin-tools/users-roles` | `role.view` |
| E1 | Employee profile → Access tab (roles, per-person overrides) | `/admin/employee/profile/:id` | Super Admin; `manager.permissions.manage` for managers |
| E1.1 | Security-event banner on admin pages (break-glass use and so on) | all `/admin` pages | Super Admins |
| E2 | Manager Management (managers, teams, Unassigned, per-manager permissions) | `/admin/admin-tools/managers` | `manager.*` keys |
| E3 | Workflow Delegates: mine, and "You're covering" | `/app/workflow-delegates` | managers delegate; anyone sees what they cover |
| E3 | Workflow Delegates (HR) | `/admin/admin-tools/delegates` | `delegation.manage` |
| E3 | Review shows "On behalf of …" for delegated requests | `/app/todo/review` | `leave.approve` |
| F | Reports landing page | `/admin/reports` | `reports.view` |
| F | Headcount, Joiners, Leavers & attrition, Birthdays & anniversaries, Leave balance, LOP | `/admin/reports/headcount`, `…/joiners`, `…/leavers`, `…/celebrations`, `…/leave-balance`, `…/lop` | `reports.view` (managers: their team) |
| F | Leave liability (provisional-rate warning) | `/admin/reports/leave-liability` | `reports.liability.view` |
| G | Phone bottom bar: Home, Action, Explore, Engage | `/app/action`, `/app/explore` (+ Home and Engage) | everyone, below 768px wide |
| G | Install the app (PWA) | the banner on phones; the browser's install menu | everyone |

Also changed in Phase 5, on screens from earlier phases:
- **System Settings** (`/admin/admin-tools/settings`) gained the People &
  Documents, Helpdesk and Letters sections.
- **Year End** (`/admin/workforce/leave/year-end`) gained the
  provisional-rate warning.
- **Audit Log** (`/admin/admin-tools/audit-log`) shows "X on behalf of Y".
- **Bulk Import** takes ex-employees with a last working day and an exit
  reason.

**Removed:** the Workflow app and Admin Tools → Approval Workflows (no
general approval chains, spec §7.8).

## 2. Permissions added in Phase 5

18 keys. Super Admin holds every key, always (computed in code).

| Key | Default holders | Manager-grantable? |
|---|---|---|
| `announcements.manage` | HR_ADMIN | no |
| `engage.moderate` | HR_ADMIN | no |
| `engage.groups.manage` | HR_ADMIN | no |
| `engage.autopost.manage` | HR_ADMIN | no |
| `documents.manage` | HR_ADMIN, HR_EXECUTIVE | no |
| `employee.documents.view` | HR_ADMIN, HR_EXECUTIVE | **yes** |
| `employee.documents.manage` | HR_ADMIN, HR_EXECUTIVE | no |
| `helpdesk.manage` | HR_ADMIN, HR_EXECUTIVE | no (the queue isn't team-scoped) |
| `helpdesk.sensitive.view` | HR_ADMIN | no |
| `letters.template.manage` | HR_ADMIN | no |
| `letters.generate` | HR_ADMIN, HR_EXECUTIVE | **yes** |
| `role.view` | HR_ADMIN, HR_EXECUTIVE | no |
| `manager.appoint` | HR_ADMIN | no |
| `manager.team.assign` | HR_ADMIN | no |
| `manager.permissions.manage` (meta) | HR_ADMIN | no |
| `delegation.manage` | HR_ADMIN | no |
| `reports.view` | HR_ADMIN, HR_EXECUTIVE, PAYROLL_ADMIN | **yes** (F) |
| `reports.liability.view` | HR_ADMIN, PAYROLL_ADMIN | no (salary-derived) |

**The manager-grantable list is now:**
- `employee.view`
- `leave.view`
- `leave.approve`
- `leave.apply.onBehalf`
- `employee.documents.view`
- `letters.generate`
- `reports.view`

It is enforced on the MANAGER role, on overrides, and at access
resolution. Every route reachable with one of these keys is
team-scoped, with an IDOR test (`managerReach.test.ts`, guarded by
`routeInventory.test.ts`).

No new roles.

**Correction (2026-10-03, user decision): the MANAGER role grants
nothing.** Its default permission set is now empty and locked (the Roles
& Permissions screen won't edit it; the API answers
`MANAGER_ROLE_LOCKED`). Being appointed a manager gives the same access
as a plain employee. Everything a manager can do is granted per manager,
within the list above, in Manager Management ("Grant leave approval" is
one deliberate click, never automatic) or on their Access tab. Managers
with nothing granted show **No permissions**. Payroll, bank-file and
salary keys can never join the list (a test guards it).

## 3. Incomplete, stubbed, or placeholder

**Must fix before go-live (shown to employees as if real) — all three fixed 2026-10-03, see the PROGRESS entry "go-live fixes":**
- **Payslips** (`/app/salary/payslips`) and **Attendance Info**
  (`/app/attendance/info`) are **Phase 0 mock-ups with hardcoded demo
  data**: fake BASIC/HRA figures and an invented attendance month. They
  have no phase marker, so desktop shows them as working pages. Mobile
  marks them "Coming soon" (G). **Recommendation:** add
  `phase: "Phase 6"` / `phase: "Phase 3"` now, so desktop shows the
  placeholder too, until the real data exists. greytHR runs in parallel,
  and an employee comparing payslips would see nonsense.
- **The employee header's Quick Links** (Company Policies, Org Chart,
  Raise a Helpdesk Ticket) have no click handlers: they do nothing.
- **The footer's** Privacy Policy and Terms of Service links (both
  portals) point at `#privacy` / `#terms`. We have no such pages, and
  §9's privacy notice text is a separate item.

**Placeholders, by design (phase-marked, shown as "coming in Phase N"):**
- Attendance (Phases 2–3): Who Is In?, Shift Roster, Swipes, Muster,
  Attendance Info (admin), Process, Finalisation, Exceptions, Manual and
  Shift Override, Shift Master, Week-off Patterns, Devices.
- Payroll app (Phase 6): eight screens.
- Salary pages (Phase 7): YTD Reports, IT Statement, IT Declaration,
  Loans & Advances, Reimbursement, Proof of Investment, Salary Revision.
- Feedback (Phase 8, with performance reviews); Assets Management
  (Phase 8).

**Built but waiting on someone else's answer:**
- **The leave encashment rate** is a flat HR-entered amount pending the
  CA. Year End and Leave liability flag it as provisional.
- **Offer letters** take CTC typed by HR until salary structures exist
  (revisit in Phase 6, spec §12).

**Built but thin:**
- **Reports** compute on demand, in memory, with per-employee queries in
  joiners and leavers. That's fine at about 300 people; no paging on the
  server.
- **LOP** is leave-LOP only until Phase 3.
- **The seed has no leave ledger entries** (accrual is a scheduled job),
  so every local balance is 0 until someone grants leave or runs the
  accrual. Walkthroughs had to grant leave first.
- **The PWA works offline only as a shell.** An offline reload lands on
  login, because the session can't refresh offline. There is no offline
  data, by design.
- **Workflow delegation covers leave approvals only.** Regularization
  (Phase 3) must plug into the same reach (`delegations/reach.ts`).

## 4. Open questions still outstanding

These are from `PROGRESS.md`; each stays configurable until answered.

- **Device and site** (non-blocking: Phases 2–3 are built against the
  simulator):
  - the eSSL model, and whether it supports ADMS push;
  - its LAN IP and admin password;
  - an always-on office PC for the sync agent, and the device count;
  - the office's static public IP.
- **Employee Code vs Device User ID default** (devices use 2–126; codes
  are 1000-series).
- **The device-silence alert's working hours and days.**
- **The leave encashment formula and its tax treatment** (CA).
- **Comp-off:** the minimum hours to earn a credit, and its expiry.
- **WFH limits** (default unlimited), **Restricted Holiday quota**
  (default 2), **RH lapse vs carry-forward**.
- **Leave advance notice**; **treatment of an unapproved absence** (LOP by
  default?).
- **The bank bulk-transfer file format** (needed in Phase 6).
- **PT/LWF applicability per state** (needed in Phase 6).
- **The actual headcount and the authoritative branch list.**
- **The company domain / Route 53**, and **the AWS account structure**
  (needed in Phase 1.5).

Resolved in Phase 5:
- the PL eligibility boundary (HR, 2026-09-28);
- hierarchy model A;
- the manager-grantable list;
- Super Admins don't delegate;
- Approval Workflows dropped (2026-10-03).

## 5. Honest assessment: what's weakest, and most likely to hurt in Phase 6

1. **"Current" means `effective_to IS NULL`, nearly everywhere.**
   - The open future-dated job-change bug is one symptom: a change dated
     next month applies today. The deeper issue is that team scope,
     approvals, the dashboard and most queries ask "what's current?", not
     "what was true on date D?". Only the reports (F) resolve placements
     as of a date.
   - Payroll is all "as of date D": the salary in force for each day of
     the month, mid-month revisions, arrears, and a leaver's last month.
   - If salary history copies the job-history convention, every arrears
     and revision calculation inherits the bug.
   - **Fix the effective-dating model (one as-of helper, used
     everywhere) before writing any payroll code.** It's already recorded
     as required before Phase 6.
2. **Phase 6 depends on phases that aren't built.** Payroll reads
   finalised attendance: paid days, and LOP from attendance (Phases 2–3).
   PROGRESS shows Phases 1.5, 2 and 3 not started (4 and 5 went first by
   decision). The real critical path is 1.5 → 2 → 3, not Phase 6's own
   complexity.
3. **Money is handled as JavaScript numbers at the edges.**
   - The ledger uses Prisma `Decimal` properly.
   - But report rows, the Excel helper, and parts of Year End's display
     convert to `number`. That's harmless for leave days. For payroll it
     isn't: rupee amounts summed as floats drift by paise, and
     maker-checker's content hash must be computed over a canonical
     decimal string, not floats.
   - Phase 6 needs a rule, ideally lint-enforced: money stays `Decimal`
     until rendering.
4. **The Phase 0 mock-ups** (§3) are exactly the screens payroll
   replaces. If Phase 6 work starts by editing them, the fake data could
   survive into a half-built state. Retire them first. **Done
   2026-10-03:** both pages deleted; the menu entries are phase-marked.
5. **Running in parallel with greytHR has no reconciliation tooling
   yet.** Spec §10 wants reconciliation before invites, and Phase 6 runs
   payroll in parallel for 2–3 months. Nothing yet imports greytHR's
   payroll output to compare it line by line. Without that, "parallel
   run" means eyeballing.
6. **Leave numbers have never been exercised on realistic data.**
   - Unit and integration tests cover accrual, Year End and the ledger
     well.
   - But no environment has run a full year of monthly accruals,
     carry-forward and encashment on real-shaped data. The dev seed has
     no ledger at all.
   - Encashment is a Phase 6 payroll input. **Phase 1.5's staging should
     get a realistic historical import** (opening balances via the Import
     Center) before payroll consumes it.
7. **Smaller but real:**
   - **Time zones.** The server uses the IST business date, while the
     browser uses its own date (seen in E3's walkthrough at midnight).
     Payroll month boundaries must be IST end to end.
   - **The CI suite takes about 4 minutes** and grows with each commit.
     The fresh test database adds about 10 s per run.
   - **The manager-grantable list** and route inventory will need care
     as payroll adds keys: none of them may ever be grantable.

**What's strong, for balance:**
- the append-only audit log, enforced by the database;
- a single access resolver, with the manager cap;
- the route inventory and IDOR guard, which caught classification
  mistakes by construction;
- test isolation from dev (Redis, Postgres, files);
- one permission catalog driving every screen;
- the plans recorded in the repo before each build.
