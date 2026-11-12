# M stage reports (second session on `feat/hr-payroll-separation`)

Progress and decisions of the session working the non-payroll rows of `docs/plans/PARITY_COVERAGE.md`. Checklist: `M_CHECKLIST.md`.
Public repository: no real data, no real person's name.

## Rows taken, skipped and why

Taken (no owner decision, not Peeps-owned, outside the payroll folders): ER-12, LC-14, ER-11, SS-15, AU-04, LT-08, NT-09, NT-08, RP-13, NT-10.

Skipped because they need an owner decision (the audit's "Owner decision: yes"):
AD-08 more than one company · NT-11 SMS/WhatsApp · AT-18 late-mark penalties (also Peeps "lateness") · AT-19 overtime · AT-22 regularization rules (A-5) ·
AT-36 work-from-home eligibility · ER-18 policy acknowledgement · ER-26 probation · OE-04 onboarding checklist · ER-28 custom fields ·
IE-07 update importer and IE-08 HR import rules (A-2) · LV-19 leave policy limits · LV-20 sandwich rule · LV-23 employee encashment request ·
LT-09 electronic signature · ER-27 divisions · ST-28 statutory registers · AD-07 data retention · SS-13 feedback.

Skipped because Peeps builds them on another branch: ER-29 assets · OE-03 recruitment · OE-07 resignation, OE-08 clearance, OE-09 notice period,
OE-10 exit interview, RP-11 exit report (exits) · LV-18 leave document and LV-21 leave privacy (leave extension).

Left to Session A (payroll reports, Stage 6 in `MASTER_CHECKLIST.md`, which reads pay data): RP-09 payroll summary · PY-42 cost by cost centre ·
RP-08 PF/ESI/PT reports in the gallery · RP-10 CTC report · RP-12 directors' query builder.

Not needed (owner decision: the portal is a PWA, no native app): MP-04 native store app.

## Requests to Session A (changes needed in protected areas)

1. **Payroll readiness should name held identity changes** (decision b: "the payroll run's Readiness list shows unconfirmed changes"). The table is
   `identity_change_requests` (status `PENDING`; kinds BANK / STATUTORY). A run, or the BANK_ACCOUNTS / STATUTORY_IDS setup sign-off, could show
   "N bank or statutory changes wait for a director" with a link to `/admin/employee/change-requests`. Not built here: it is in `modules/payroll/`.
2. **New behaviour row on Ready for First Run.** `identity.directorConfirmsHrChanges` (default ON) was added to `BEHAVIOURS` in
   `modules/behaviours/service.ts`; `payroll/setup/status.ts` lists every key, so it now appears as an information row. No change is needed unless
   you want it left off that screen (it is not a payroll setting).

## Changed tests

None weakened: each still pins its refusal, on a subject that really has the property now.

| Test | Before | After | Why |
|---|---|---|---|
| `employee/__tests__/profileAndReveal.test.ts` "HR_EXECUTIVE is blocked from bank and statutory endpoints" | HR Executive gets no bank/statutory section and 403 on both reveals and bank history; the test revoked the four keys from the shared HR_EXECUTIVE role | The same refusals pinned on a **manager** (no bank/statutory key) reading their own report; a new case pins HR Executive's sections as **masked** (last four, no whole number). The revoke is gone | Owner decision: HR Admin and HR Executive both enter bank and identity details, masked and audited (task 1) |
| `employee/__tests__/effectiveDatedUpdates.test.ts` "via PATCH /:id/bank" | HR's PATCH → 200 and the row is written | HR's PATCH → **202 held**, masked, nothing written; a director confirms (200, masked); then the original assertions (old row closed, one open row) | Decision b: HR's change waits for a director |
| `employee/__tests__/changeRequestsAndSeparations.test.ts` "approving a bank change request applies it" | HR's approval writes the bank row | HR's approval holds it (row unchanged, held payload has no raw number), a director confirms, then the original assertions | Decision b |
| `documents/__tests__/sensitivity.test.ts` HR Executive sees GENERAL only; HR Exec cannot upload STATUTORY | HR Executive: no STATUTORY documents | HR Executive reads STATUTORY documents as HR Admin does; PAY stays closed to both; the manager's STATUTORY refusal (earlier case) is unchanged | Follows from giving HR Executive `employee.statutory.view` (decision b) |

## Log

### Task 1 — ER-12 (HR's bank and statutory changes wait for a director)

Built: the director setting `identity.directorConfirmsHrChanges` (behaviours store, ON by default, "Default, change in settings", proposed by one
director and confirmed by another); table `identity_change_requests` (migration `20261112090000_m_identity_change_requests`, forward-only; database
CHECKs: decider ≠ person who entered it, a withdrawal only by the person who entered it, a decided row never changes, no delete outside the test
purge); held from four paths (HR's PATCH bank / statutory, Add Employee, HR approving an employee's own request); confirm / reject (reason
required) / withdraw routes; notifications to directors (never the one who entered it, never on their own record) and to the person who entered it;
audit rows `employee.identity_change.{held,confirmed,rejected,withdrawn}`; held ciphertext counted by `field-keys status`; HR Executive given the
four masked keys (`systemRoles.ts` + the migration). Screens: Change Requests "Bank and statutory changes waiting for a director" panel, a notice on
the profile's Bank and Statutory tabs, a notice after Add Employee, the Default behaviours entry.

Decisions made here (owners may change): a director's change to their **own** record always waits for the other director (Q-DA-2, "a director's own
details always wait for the other director" in `shared/constants/directorAuthority.ts`); a director's entry for someone else is written at once
unless the director switch `IDENTITY_DIRECTOR_ENTRY` is "a different director"; one held change per person and kind at a time (409 for a second);
a held bank change keeps the date entered (or today, or the joining date for Add Employee); an employee's own request approved by HR is marked
APPROVED and the held row names it; HR Executive reads STATUTORY documents as HR Admin does.

Tests: `employee/__tests__/identityChanges.test.ts` (11 cases: hold, masking, audit, notifications, key-rotation count, 409 on a second, HR / employee /
manager / Developer refused, director other than the enterer confirms, reject with reason, withdraw, director's own record, Add Employee, database
refusals, setting off = as before, two directors at once). Mutation checks (each reverted): HR entries never held → 8 failed; own record not held →
1 failed; the enterer may decide → 1 failed; own record may be decided → 1 failed; a non-director may decide → 1 failed; the pending-only claim
removed → **survived** (the second decision is refused by the database trigger instead, which the "database refuses" case pins; the claim is defence
in depth). Suites run: employee (8 files), access, hrCapabilities, behaviours, lib, documents, managers (route inventory), payroll setupChecklist,
directorAuthority, releases (the sensitive scan, which signs in as an HR Executive) — all green. Frontend: typecheck, lint + tokens, 75 tests.

### Task 2 — stale text

Docs and one comment only: spec §7.5 (a director uploads the bank file; bank payments are manual, no return file, rejections by hand), spec §7.6
(leave liability: directors only; "until the owners confirm it"), spec §5.2 and §14 ("confirmed by the owners … there is no CA"),
`STAGE_5B_PLAN.md` (the `BANK_RETURN_TEMPLATE` passage marked superseded by D-33/D-34), `CLAUDE.md` (HR sees no salary or pay figure; both HR
roles enter bank and identity details masked; the bank file is for a director to upload), `HR_CAPABILITIES.md` and the comment above
`HR_FORBIDDEN_KEYS` in `shared/constants/sensitiveData.ts` (per-template letter grants are built; the director's confirmation of HR's bank and
statutory entries is built). Mismatches M3, M5, M6 and M7 of the audit are closed; M4 (`PORTAL_READY_REPORT.md`) is Session A's report and is left
as a request: **Request 3 to Session A:** `PORTAL_READY_REPORT.md` §6 item 3 still says the Developer reaches Employee Swipes; since D-37 default 3 it
does not unless a director switches it on.

### LC-14 — claims in the Tasks inbox: **Missing → Built**

Two inbox sources in `modules/tasks/service.ts`, both directors only: `CLAIM_DECISION` (a reimbursement claim with no decision, never the director's
own, as `reimbursements/service.ts decide` enforces; title, claim type and date only, no amount) and `IDENTITY_CONFIRMATION` (task 1: a held bank or
statutory change the director may decide: not entered by them, not on their own record; masked, the kind only). Types and labels in
`shared/types/inbox.ts`; icons in `components/inbox/TasksInbox.tsx`. The inbox route is self-only (it lists what waits on the caller). Test
`tasks/__tests__/directorSources.test.ts` (director sees others' claims, not their own, and no amount; held change offered to a director who may
decide it, not on their own record; HR, manager, employee and Developer see neither). Mutation checks: own claim offered → caught; claims to everyone
→ caught; held change on own record offered → caught; held changes to everyone → caught.

### ER-11 — statutory ID history: **Missing → Partial (masked change history built; payroll reading a past ID is not)**

Table `employee_statutory_history` (migration `20261112100000_m_statutory_history`), written by a database trigger on `employee_statutory` (insert or
a change of a number), so every path is covered: HR edits, a director's confirmation of a held entry, an employee's request, Add Employee, the Import
Center, the seed. Each row: which numbers changed (PAN, Aadhaar by keyed hash; UAN, ESI by last four), the last four digits after the change, who wrote
the row (`updated_by_user_id`), when. **No ciphertext and no hash** are copied: the history cannot reveal a number. Existing rows were recorded once as
"on file when the history began". Append-only (trigger; delete only through the test purge). Route `GET /api/employees/:id/history/statutory`
(statutory view key, data scope in the service); the profile's History tab shows "Statutory numbers history". Test
`employee/__tests__/statutoryHistory.test.ts` (4 cases: what changed, last four, who; nothing for a write that changes no number; a held entry is
recorded only when a director confirms it; manager / employee (own record too) / Developer refused; history cannot be changed or removed).
Mutation checks (temporary edits to the migration; the test database is rebuilt from migrations each run): writes that change nothing recorded →
caught; a PAN change not seen → caught; history editable → caught.

**Not built (why Partial):** "effective-dated, like bank" in the payroll sense: payroll still reads the one current row (`employee_statutory`), so a
past month cannot show the ID that was in force then. That needs payroll to read a dated value (and the history to hold ciphertext): payroll is
Session A's area and storing more ciphertext is a choice for the owners. **Request 4 to Session A** if payslips or statutory files must show the ID in
force on their own date. Known limit: a new UAN or ESI number with the same last four digits as the old one is not recorded (they have no keyed hash).

### SS-15 — download my own data (DPDP): **Missing → Built**

`GET /api/employees/me/data-export` (self only: the record is the signed-in person's, a query naming anyone else is ignored), built in
`employee/selfExport.ts`: employment, personal details, names and jobs over time, bank accounts and statutory numbers **masked to the last four**,
leave requests and ledger, daily attendance, attendance corrections, documents shared with the person (titles, not files), helpdesk tickets, kudos
given and received, own posts, and payslips listed by month (their content stays under Salary → Payslips). Sent as a JSON file, `no-store`, audited
(`employee.self_export.downloaded`). Button "Download my data" on My Info. Test `employee/__tests__/selfExport.test.ts` (own data only, masked, no
ciphertext or hash, audited; someone else's id in the query ignored; HR and the Developer get only their own; signed out 401). Mutation checks: no
audit → caught; the raw bank row in the file → caught.

Decided here: identifiers stay masked in the file (the full numbers are on the person's own documents; a file on a home computer should not carry them);
payslip figures are not in the file (the payslip itself is the record and is downloadable). Owners may want either changed.

### Full backend suite, run alone (after LC-14, ER-11, SS-15)

223 files, 2,067 tests: 2,064 passed, 3 failed. Causes, all fixed and re-run green (36 files, 260 tests):
* `access.test.ts` "the Manager role is locked empty": **my** new tests (`identityChanges`, `statutoryHistory`) granted `employee.view` to the shared
  MANAGER role and left it there. They did not need it; the grant was removed. (No product change: the role itself was never changed by code.)
* `preflight.test.ts` and `routeInventory.test.ts`: new migration files and routes were added to the working tree while the suite was running
  (the next rows were being written). Both pass on the finished tree.
Lesson kept: nothing is edited in the working tree while the suite runs.

### AU-04 — audit log export: **Missing → Built**

`GET /api/audit-logs/export` (same filters as the screen, strict query) → Excel, newest 10,000 rows, the footer says how many matched and which
filters were used; the payroll rows and money fields stay hidden from anyone without the salary key, exactly as on the screen. **Directors only:** the
route also refuses the Developer role, which holds `audit.view` to read the screen but must not take a file of other people's before/after values.
The export is itself audited (`audit.exported`). Button "Export to Excel" on Audit Log (directors). Test `auditLog/__tests__/auditExport.test.ts`.
Mutation checks: Developer not refused → caught; export not audited → caught.

Noted, not changed (not pay data, and not this row): the Developer role can read the audit **screen**, whose before/after values include personal
details such as a changed mobile number (identity numbers are redacted at write time). Owners may want the screen limited the same way.

### LT-08 — an employee asks for a letter: **Missing → Built**

A director setting `letters.employeeMayAsk` (behaviours store, a list of template codes, **empty by default**: nobody can ask until a director lists a
template; changed by one director, confirmed by another). An employee asks from Document Center → "Ask for a letter" with a purpose (one open ask per
template); the directors and holders of the template's PREPARE grant are told. Whoever may prepare the template (the existing `assertMayAct` rule,
data scope, never their own ask) sees it on Letters → "Asked for by employees", prepares the letter through the existing workflow, then marks the ask
done naming that letter (same person, same template, not void) or declines with a reason; the employee is told either way; withdraw while it waits.
Table `letter_asks` (migration `20261112110000_m_letter_asks`): one open ask per person and template (partial unique index), a decline needs a
reason, a decided ask never changes (trigger). Test `letters/__tests__/letterAsks.test.ts` (6 cases). Mutation checks: own ask offered → caught;
any letter accepted as "done" → caught; an unlisted template askable → caught.

### NT-09 — notification preferences: **Missing → Built**

A person may switch off three categories for themselves (Account & security → Notifications): documents shared with me, changes to my reporting line
or team, someone asks for a letter I can prepare (`shared/constants/notificationPreferences.ts`). Approvals, decisions, security, payroll and helpdesk
notices cannot be switched off (the API refuses any other category). A switched-off notice is not stored (`notifyEmployee`). Table
`notification_preferences` (migration `20261112120000_m_notification_preferences`). Test `notifications/__tests__/preferences.test.ts`. Mutation
check: the mute ignored → caught. Decided here: which categories are switchable (owners may add or remove any).

### NT-08 — editable email templates: **Missing → Partial (sign-in emails editable; the other emails keep fixed wording)**

Directors edit the subject, heading and paragraphs of the invitation, password-reset and welcome emails (System Settings → Sign-in emails;
`settings.manage`, which HR and the Developer do not hold). Plain text only (escaped; a blank line = a new paragraph); placeholders `{{fullName}}`,
`{{employeeCode}}` checked per email; the greeting, the link button and its validity are always added by the code, so an edit cannot remove or replace
the link. Built-in wording is the default ("Default, change in settings"; "go back to the built-in wording" restores it). Audited
(`settings.email_template.updated`). The security-change notice is deliberately not editable. Stored in `system_settings` (`email.templates`), no
migration. Test `auth/__tests__/emailTemplates.test.ts`. Mutation checks: wording not escaped → caught; an unknown placeholder accepted → caught.
**Not built (why Partial):** the payslip email (payroll, Session A's), the device alert and director-notice emails keep fixed wording.

### RP-13 — scheduled reports by email: **Missing → Built ("email me this report")**

A person schedules a report **for themselves** (Report screen → "Email me this report": weekly on Mondays or monthly on the 1st), only one they
may open now (`reports.view` plus the report's own key). A daily job (`report-subscriptions`, 07:41 IST) runs each due report **with the person's
access as it is then** (data scope included) and emails the title, the row count and a link to open it in the portal. **The rows are never in the
email**, so no personal data or pay figure travels by email. Someone who lost the access, or whose account is no longer active, is stopped with the
reason shown. At most once a day per schedule. Table `report_subscriptions` (migration `20261112130000_m_report_subscriptions`). Test
`reports/__tests__/subscriptions.test.ts` (who may schedule; Monday weekly sent once with a count and a link and no rows; monthly covers the last
calendar month; stopped for lost access and for a suspended account). Mutation checks: `reports.view` not required → caught (this found a real bug
while writing it: the report catalogue assumes the route checked `reports.view`, so the scheduled send now checks it itself); sent more than once a
day → caught; a suspended account still sent → caught; rows in the email → caught.

Decided here: the email carries a link and a count, not an attachment (an attachment would put personal data in mailboxes); only one's own schedule
(nobody schedules a report to someone else). The owners may want attachments for some reports.

### NT-10 — phone push notifications: **skipped (needs real values)**

Web push needs a VAPID key pair (a secret, generated and kept in the environment's secrets) and outbound access to the browsers' push services
(their hosts must be allowed by the network policy). Neither can be chosen or tested here, and a push that cannot be delivered would only look built.
The PWA already shows in-app notices in real time while open. To build: keys as secrets (`VAPID_PUBLIC_KEY`, `VAPID_PRIVATE_KEY`), a
`push_subscriptions` table, the service worker's `push` handler, and the same category choices as NT-09.

### Browser walk (dev stack, made-up seed data)

Five roles (director `1000`, HR Admin `1001`, manager `1002`, employee `1006`, Developer `DEMO005`) × desktop light (1280) and phone dark (390): 56
visits of every new or changed screen (Change Requests, a profile, Default behaviours, System Settings → Sign-in emails, Audit Log, Letters, a
report, Tasks, Document Center → Ask for a letter, My Info, Account & security), with content made first through the API (an HR bank change waiting
for a director, a listed letter and an employee's ask, a report schedule). Checked on each: no error boundary, no console error, no horizontal scroll,
the whole account number never on screen. Seen in the screenshots: the director has Export to Excel on Audit Log and the Developer has not; HR sees
only Withdraw on its own held change. **One defect found and fixed:** the desktop "waiting for a director" table pushed the Confirm/Reject column off
the right edge; the "From" column is now a second line under the change. Not walked: keyboard-only paths and tablet width.

## Final (2026-11-11)

**Gates.** Full backend suite run alone on the finished tree: 228 files, 2,085 tests, all passed. Frontend: typecheck, lint + design tokens, 75
tests, build, bundle budgets (login 231.9 KB, shell + employee home 339.3 KB, shell + admin home 359.0 KB, all within budget). CI run 305 on
`0a7b4fc` (the last backend code commit): all seven jobs green (install-lint-typecheck-test incl. drift and the demo tests, sensitive-ui employee
portal, sensitive-ui admin portal, latency, attendance-replay, agent-windows, docker-build). Run 306 on `cfe5c07` (frontend-only walk fix): see the
session's final message. Every migration was applied to a fresh test database by each test run (the suite rebuilds it from migrations).

**Rows and commits.**

| Row | Was | Now | Commit |
|---|---|---|---|
| ER-12 HR's bank/statutory changes wait for a director | Missing | Built | `0e288f1` (+ walk fix `cfe5c07`) |
| Stale text (M3, M5, M6, M7) | — | Fixed (M4 is a request to Session A) | `af2c394` |
| LC-14 claims (and held identity changes) in the directors' Tasks inbox | Missing | Built | `9659cda` |
| ER-11 statutory ID history | Missing | Partial: masked change history; payroll reading a past ID not built | `adc4605` |
| SS-15 download my own data | Missing | Built | `039060a` |
| AU-04 audit log export | Missing | Built | `06d2350` |
| LT-08 employee asks for a letter | Missing | Built | `06d2350` |
| NT-09 notification preferences | Missing | Built | `06d2350` |
| NT-08 editable email templates | Missing | Partial: sign-in emails only | `06d2350` |
| RP-13 scheduled reports by email | Missing | Built (a link and a count, never the rows) | `0a7b4fc` |
| NT-10 phone push | Missing | Skipped: needs a VAPID key pair and network hosts | — |

**Pay-data check.** No path found for HR, a manager or the Developer to see pay data. New routes that could carry a figure keep it out: the claims inbox
item has no amount; scheduled report emails carry no rows (leave liability stays directors-only through `reports.liability.view`); the audit export
keeps payroll rows and money fields from anyone without the salary key and refuses the Developer; the data export lists payslips by month only.
