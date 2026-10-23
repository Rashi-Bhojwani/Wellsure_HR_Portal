# Phase 6 review (2026-10-22)

Written at the end of Phase 6 (commit P6-6), before your own testing. Per-commit detail is in [`PHASE_6.md`](PHASE_6.md) (plans and as-built notes, §14A to §14K) and [`../PROGRESS.md`](../PROGRESS.md) (what was verified). The procedure for the first real payroll, written for the people who will run it, is [`../FIRST_REAL_PAYROLL_RUN.md`](../FIRST_REAL_PAYROLL_RUN.md); who can see what is [`../SENSITIVE_DATA.md`](../SENSITIVE_DATA.md).

**How to read the URLs:**
- `/app/...` is the employee portal; `/admin/...` is the HR/Admin portal. Locally they are on `http://localhost:5173`.
- Seeded accounts are in `GETTING_STARTED.md` §7 (password `Wellsure@123`). The **demo company** (`npm run seed:demo-company --prefix backend`) adds `DEMO001` to `DEMO005` and others (owner, payroll admin, payroll approver, HR admin, developer); everything in it is made up and says so on every screen.

## 1. What Phase 6 delivered, in one paragraph

A payroll that is prepared by one person and approved by another at every step that matters, that cannot be run on anything unchecked, that cannot touch a closed month, that produces payslips and a bank file in whatever layout the bank specifies (none is built in, none is guessed), and that is built so the people who build it never need to see a salary, a bank account, the company's registration numbers or the bank layout: the owners enter those, a second person confirms them, and a screen says exactly what is still missing before a first real run.

## 2. Screens delivered in Phase 6

| Commit | Screen | URL | Who sees it |
|---|---|---|---|
| P6-1 | Rules and Setup: every statutory figure and company choice, Placeholder or Confirmed, history, confirm with retype | `/admin/payroll/rules` | `payroll.rules.view`; edit with `payroll.rules.manage`; confirm with `payroll.rules.confirm` |
| P6-2 | Salary Components | `/admin/payroll/components` | `payroll.rules.view` (edit/confirm as for rules) |
| P6-2 | Salary Structures | `/admin/payroll/structures` | same |
| P6-2 | Employee Salaries (current salary, history, scheduled changes) | `/admin/payroll/salaries` | `payroll.salary.view` |
| P6-2 | Salary Revisions (preview, create, approve by a second person, apply) | `/admin/payroll/revisions` | `payroll.salary.view`; make with `payroll.salary.edit`; approve with `payroll.approve` |
| P6-2 | Adjustments (one-off pay or deduction for a run) | `/admin/payroll/adjustments` | `payroll.adjust` |
| P6-3 | Payroll Run: the list, "Start a payroll run" | `/admin/payroll/run` | `payroll.salary.view`; start with `payroll.run` |
| P6-3 | A run: totals, people, who is left out, variance against last month, how each figure was worked out, the register workbook | `/admin/payroll/run/:id` | `payroll.salary.view` |
| P6-4 | Run step: Submit for approval (left-out people at the top) | `/admin/payroll/run/:id/step/run` | prepare: `payroll.run`; approve: `payroll.approve` |
| P6-4 | Run step: Close the payroll period | `/admin/payroll/run/:id/step/finalise` | same |
| P6-4 | Run step: Unlock the payroll period (Super Admin asks, a second person approves, someone other than the approver carries it out) | `/admin/payroll/run/:id/step/unlock` | Super Admin / `payroll.approve` |
| P6-5 | Run step: Publish payslips (**who will get none, and why, at the top**) | `/admin/payroll/run/:id/step/publish` | same |
| P6-5 | Run step: Bank file; record that it was paid; statutory files; salary register | `/admin/payroll/run/:id/step/bank-file` and the run page | `payroll.bank.view`, `payroll.run` |
| P6-5 | Bank and Statutory Layouts (bank, PF, ESI, PT, LWF) | `/admin/payroll/layouts` | `payroll.banklayout.manage` for the bank layout; `payroll.rules.manage` for the statutory ones |
| P6-5 | My Payslips (employee) | `/app/salary/payslips` | everyone (their own only) |
| P6-6 | **Setup Checklist** (everything to enter before a real run; Not set / Placeholder / Confirmed, who, when, where to enter it; **who can see and change each kind of secret, from live access**) | `/admin/payroll/setup` | `payroll.rules.view` |
| P6-6 | **Ready for First Run** (red until every required item is Confirmed by someone other than who entered it) | `/admin/payroll/ready` | `payroll.rules.view` |
| P6-6 | **Compare Registers** (two registers by employee code; per-person and per-component differences; tolerance) | `/admin/payroll/compare` | `reports.salary.view` |
| P6-6 | **Payroll Audit Trail** (payroll's own audit rows) | `/admin/payroll/audit` | `payroll.salary.view` |
| P6-6 | DEMO COMPANY banner on every screen while the demo company exists | all pages | everyone (development only) |

Screens from earlier phases that Phase 6 touched:

- **Roles & Permissions** (`/admin/admin-tools/users-roles`) shows the four new permissions (group "Sensitive data") and the Developer / operator role.
- **Audit Log** (`/admin/admin-tools/audit-log`) never shows payroll rows to someone without `payroll.salary.view`, and now records every invitation email's outcome (`auth.invitation.email`).
- **Bulk Import** (`/admin/employee/import`): the statutory dataset now needs `employee.statutory.edit`, as the bank dataset needs `employee.bank.edit`.
- **Account Security** (`/app/security`): a code is now accepted from the neighbouring 30-second step, and a used code cannot be used again within 90 seconds.
- **Profile change requests**: approving a change to a bank account or PAN/Aadhaar/UAN/ESI number needs the same edit permission as making that change directly.

## 3. Permissions and roles added or changed

| Permission | Meaning | Default holders |
|---|---|---|
| `payroll.identifiers.manage` | enter and reveal the company's PF/ESI/PT/LWF/TAN numbers | Payroll Admin, Super Admin |
| `payroll.identifiers.confirm` | confirm them (by retyping, never shown) | Payroll Approver, Super Admin |
| `payroll.banklayout.manage` | enter and reveal the bank layout and the debit account | Payroll Admin, Super Admin |
| `payroll.banklayout.confirm` | confirm them | Payroll Approver, Super Admin |
| (earlier in Phase 6) `payroll.rules.*`, `payroll.salary.*`, `payroll.run`, `payroll.approve`, `payroll.adjust`, `payroll.payslip.view`, `payroll.bank.view` | see `PHASE_6.md` §11 | Payroll Admin / Approver / Super Admin |

New role **Developer / operator**: everything needed to build and run the system, and none of the permissions the registry names as sensitive. The ceiling is applied where access is worked out, so no role edit, per-user exception or raw database row can give a developer a secret, and a developer cannot also be a Super Admin. The full table, generated from the code, is in `SENSITIVE_DATA.md`.

## 4. What is built and what is deliberately not

**Built:** governed rules, components, structures and layouts (versioned, Placeholder vs Confirmed, sealed where sensitive); salary timeline with maker-checker revisions, arrears and scheduled changes; the calculation (attendance, loss of pay, joiners and leavers, proration, PF, ESI, PT, LWF, leave encashment, arrears, adjustments) with explainability and variance; run approval, closing and a real lock enforced for attendance, leave, job, salary and bank changes; payslips (immutable, one per payable person, PDF, in-app and email notice); the bank-file template engine, batches, mark-paid; statutory-file engine; the salary register; sealed company secrets; setup sign-offs; the Ready screen; the demo company and its fences; the register comparison tool; the scans that look for secrets in logs, errors, responses, tables and pages.

**Not built, on purpose or because it waits for something:**

| Not built | Why / when |
|---|---|
| Any real bank's file layout, any government portal layout (PF ECR, ESI, PT, LWF) | Not guessed (spec §14). Typed by the owners from the bank's and the portals' own specifications; unproven until a bank or portal accepts a file |
| The greytHR register **parser** (the comparison tool itself is built; GENERIC and our own register work) | Needs a sample register (anonymised); the code path answers `PARSER_WAITING_FOR_SAMPLE` until then |
| Parsing the bank's response file | The file is stored; its format is not known |
| A salary spreadsheet import | Would create one approval per person; your decision (rule 89) |
| TDS, declarations, Form 16 data, loans and advances, reimbursements, full and final settlement, revision letters | Phase 7 (the menu entry "Loans & Advances" is still a "coming" stub) |
| TEAM-scoped payroll | Payroll data scope is ALL only (rule 19) |
| ESI "half-year" coverage rule as a Confirmable value | Open question for your CA (`PHASE_6.md` §16) |
| Re-encrypting sealed payroll values during a data-key rotation | They live in append-only history; they are counted and block retiring a key, and the owners re-enter them (see §7, `DEPLOYMENT.md`) |
| Encryption of salary amounts at rest | Rule 11: SQL needs the numbers; protected by permissions, not encryption. Anyone with direct database access can read them; this is an infrastructure control (`SENSITIVE_DATA.md`) |
| ESI numbers encrypted at rest | **Answered yes (2026-10-22) and built in P7-0.** Correction: they were not masked on every view; the HR profile, View My Info and payslips showed them whole |

## 5. What the developer's login can and cannot see (checked, not assumed)

- `developerCeiling.test.ts` proves: every permission is classified; the Developer role holds no sensitive permission; a per-user grant, a role edit and a raw SQL row cannot give one; the API refuses to assign Developer and Super Admin together and the database refuses the row.
- The sentinel scan (`releases.test.ts`) signs in as a developer, an HR executive without the rights and an employee, calls **every GET route** with real ids, and fails if a sentinel salary, account number, PAN, Aadhaar, UAN, ESI number, identifier, debit account or layout constant appears in any JSON response, any cell of an Excel export, any log line or any error body. `demoCompany.demo.test.ts` does the same for the demo company as its developer.
- `npm run check:sensitive-ui --prefix frontend` drives a browser as the developer and as an employee through every page of both portals.
- What it **cannot** prove: what someone with AWS or database access can read (an infrastructure control: who holds database credentials and who may call `kms:Decrypt`; `SENSITIVE_DATA.md` §"What the application cannot protect").

## 6. Measured at a full headcount

`npm run measure:payroll --prefix backend -- 500` (development machine, local Postgres, a made-up company of 500 people; source: `backend/scripts/measure-payroll.ts`). It adds made-up people, gives them salaries through the real revision flow, locks a month of attendance, then times the work. "Peak memory" is the whole process (the first rows include the script, the database client and the people it just created, so read the growth between rows, not the totals).

| What | Time | Peak memory |
|---|---|---|
| Add 458 made-up people (as the seed does) | 11 s | 268 MB |
| Salary revisions for 458 people (three revisions, each previewed, approved by a second person, applied) | 8 s | 294 MB |
| Calculate: the preview for 500 people | 0.9 s | 510 MB |
| **Calculate: the job for 500 people** | **6.5 s** | **538 MB** |
| The re-check that every approval step repeats (`liveHashOf`) | 0.7 s | 486 MB |
| One more full calculation in memory (what a screen read can cost) | 0.8 s | 511 MB |
| The run's people list, one page | 0.1 s | 514 MB |
| **The register workbook, built in the API process** | **1.1 s** | **552 MB** |
| Build the payslip content for all 500 | 0.5 s | 552 MB |
| Render 15 payslip PDFs with Chromium, one at a time | 3.7 s (**0.25 s each; 500 take about 2 minutes**) | 567 MB |

What this says, and what it does not:

- **Row 25 (keeping an approval true re-calculates the whole run):** at 500 people one re-check is under a second, so doing it at every step that consumes an approval is cheap enough. The "cache the live hash" and "move it to the worker" fallbacks in the assumption are not needed at this size. They would be at several thousand people.
- **Row 21 (everything held in memory):** the process grew from 294 MB to 538 MB during the calculation (about 250 MB for 500 people) and by 15 MB more for the workbook. My reading: a 1 GB task would be comfortable at this size and 512 MB would be tight. This is a development machine, so repeat on the real task size before relying on it (row 36).
- **Row 31 (payslip PDFs):** Chromium on this machine renders a payslip in a quarter of a second; 500 take about two minutes in the worker, one at a time. The worker's behaviour when ECS stops the task mid-batch is by design resumable and idempotent, and is tested; it has not been tried on ECS.
- It does not say anything about a loaded database, RDS Proxy, or two people clicking at once. Those are for staging.


## 7. Found while building, and fixed

| Found | Fixed in |
|---|---|
| Voluntary 2FA users were **not** challenged at login (only users whose role required it were) | `auth/service.ts` `login()`: a challenge whenever 2FA is required or the user has turned it on; test added |
| A code typed in the last second of its 30-second step failed (the library's default tolerance was zero) | Previous and next step accepted; replay protection added so a captured code cannot be reused (rule 90) |
| The Import Center's statutory dataset (PAN, Aadhaar, UAN, ESI) was not gated by `employee.statutory.edit` | Gate at upload and commit |
| An HR executive could approve a change request to a bank account | Approving needs the same edit permission as editing directly |
| Rule values went into `audit_logs` in full, including what are now secrets | Sealed values are replaced by a marker in every audit row, response and event |
| The "next build step" wording on the publish and bank-file approval banner was stale after P6-5 | Text corrected |
| The Payroll audit trail had an endpoint (P6-1) but no screen | `/admin/payroll/audit` (the Audit Log viewer restricted to payroll's rows) |
| **A data-key rotation could strand the sealed values** (and a pending change request or an uncommitted upload): `field-keys reencrypt` only knew the encrypted columns, so `retire` would have allowed removing a key that something still needed | These are now counted by `field-keys status` and block `retire`; a test pins it. Moving them is by deciding/discarding the request or upload and entering the sealed value again |
| The role matrix listed `profile.changerequest.approve` as editing bank and statutory data | Removed from the registry's edit lists (it was misleading; the actual gate is the edit permission) |

## 8. What is unproven until real data exists

These are the things I cannot know from here. Each has an owner-run check in `FIRST_REAL_PAYROLL_RUN.md` §7 or a row in `LOCAL_ASSUMPTIONS.md`.

1. **That your bank accepts a file** in the layout you type (LA 28). Nothing about any real bank is in the system.
2. **That each government portal accepts** the PF, ESI, PT and LWF files (LA 28).
3. **That the statutory figures are right.** The arithmetic is checked against an independent rational-arithmetic model that agrees to the paisa; the *values* (rates, ceilings, slabs, the ESI coverage rule, encashment treatment) are your CA's word, and the ones shipped are labelled "recalled, unverified".
4. **That the numbers match greytHR.** The comparison tool is built and tested on registers I generated; it has never seen a greytHR file. The parallel run is the proof.
5. **The first real salary load.** The revision flow was run on 458 people in one go (8 seconds), but the salaries have only ever been made-up ones.
6. **Real email, real storage, real PDF rendering at the real task size** (LA 29, 30, 31, 36).
7. **A key rotation with real KMS** (LA 33).
8. **The scans against the deployed environment** (log shipping, snapshots, error reporting: LA 34).
9. **Two-factor sign-in with a real cache failing over** (LA 35).
10. **That the owners can actually use the Setup Checklist unaided.** It was written for them and checked against the demo company, but not by them; the first real session is the test, and the findings should come back as changes to the wording.

## 9. Open questions (nothing here was guessed)

Unchanged from `PROGRESS.md` §Open questions plus: the ESI coverage period rule (`PHASE_6.md` §16), the bank's file specification, the PF/ESI/PT/LWF portal formats, the greytHR register sample, whether to build a salary spreadsheet import (rule 89), whether to add ESI numbers to the encrypted-field list, and who the first Payroll Approver is (there must be two people).

## 10. Decisions to veto

Rules 1 to 81 are in `PHASE_6.md` §15 and the as-built sections. This commit's are **82 to 90** (§14J) and **91 to 97** (§14K):

91. ESI numbers stay unencrypted (as in the spec) and masked everywhere; recommended to encrypt.
92. A voluntary-2FA user is challenged at login (a bug fix, not a policy).
93. Approving a bank or statutory change request needs the edit permission for it.
94. The Import Center's statutory dataset needs `employee.statutory.edit`.
95. Sealed values are counted in key rotation and block retiring a key; they are moved by re-entering them, not by a tool.
96. The Payroll audit trail is the Audit Log viewer restricted to payroll rows, behind `payroll.salary.view`.
97. The measurement script adds made-up `DEMO` people and refuses outside development.

## 11. Risks I will keep watching

- The Setup Checklist becoming long and daunting for non-technical owners; it is grouped, and items that cannot affect the first run are marked, but a real owner's first reaction is the test.
- A new permission added in Phase 7 that is not classified (a test fails the build if so, but the classification is a human decision).
- A new log line, error message or export in Phase 7 that carries a figure (the scans catch the routes and tables that exist; they need re-running and extending as Phase 7 adds them).
- Memory: the calculation and the workbook hold the whole headcount in memory (LA 21, 25).
