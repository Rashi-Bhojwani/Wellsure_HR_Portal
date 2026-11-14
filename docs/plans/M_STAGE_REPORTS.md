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

---

# Block 2 (2026-11-12 to 13): Developer audit view, the decision rows

## Rows and commits

| Row | Now | Commit | Default or state |
|---|---|---|---|
| B1 Developer audit view | Built | `ad5b3ca`, test `c536707` | — |
| Policy settings (shared two-director store, System Settings → Policy settings) | Built | `de0cfed` | — |
| ER-27 Divisions | Built | `de0cfed` | none defined (optional grouping of departments) |
| ER-18 Policy acknowledgement | Built | `9741815`, `fbf26e8` | off for every document unless asked |
| ER-26 Probation | Built | `371fd55` | 3 months; reminder 15 days before (Default, change in settings) |
| OE-04 Onboarding checklist | Built | `f9b1842` | six conventional steps (Default) |
| ER-28 Custom fields | Built | `c4f4b7b` | none defined |
| SS-13 Feedback | Built | `3bea7cb` | anonymous allowed (Default) |
| AT-22 Correction limits | Built, off | `cbaee81` | off; suggested 3 a month |
| LV-19 Leave request limits | Built, off (not "document after N days": Peeps LV-18) | `cbaee81` | off; suggested PL 15 days, 7 days' notice |
| LV-20 Sandwich rule | Built, off | `cbaee81` | off; no type listed |
| AT-19 Overtime | Built, off (paying it: Session A) | `f503dd7` | off; suggested 60 min minimum, 30 min steps, manager-with-key or director |
| AT-36 Work from home | Built, off | `fc14ed4` | off; suggested all departments, 5 days a request, a director approves |
| LV-23 Encashment requests | Built, off (paying it: Session A) | `c87fb08` | off; suggested PL, keep 15, at most 10 a year |
| IE-07 / IE-08 Update import and HR's import rules | Built | `1aedbb0` | HR updates contact/personal; job changes need a director; 500 rows (Default) |
| LT-09 Electronic signature | Built (check a letter; signing existed) | `96c908d` | — |
| AD-07 Data retention | Built, every period Not set | `048aed2` | Not set (nothing is ever due) |
| NT-11 SMS / WhatsApp | Built, provider Not set | `b9ec63c` | Not set (nothing is sent) |
| AD-08 More than one company | Built (payroll per company: Session A) | `c7f01a2` | one company |

Skipped: AT-18 late-mark penalty (Peeps owns the lateness rule); ST-28 statutory registers (built from payroll results: Session A);
NT-10 phone push (deferred to deployment by the owner).

## Defaults chosen, and why (for the owners' review)

All are in `shared/constants/policySettings.ts` with the reason beside each, and are changed by one director and confirmed by another.
* Probation 3 months, reminder 15 days before: the most common probation in Indian offer letters at this size; time for the manager's review.
* Onboarding: six first-month steps (offer letter and documents; invitation and first sign-in; team introduction; My Info complete; policies
  acknowledged; first-month check-in). No asset or payroll step (assets are Peeps'; payroll set-up is the directors').
* Feedback without a name allowed: a suggestion box is normally anonymous.
* Update import: HR may update contact and personal details; job changes need a director (they change who approves what); 500 rows.
* Suggested values offered on the form for the settings that change pay or leave (never in force until turned on): corrections 3 a month;
  overtime from 60 minutes in 30-minute steps; WFH up to 5 days a request for every department; PL at most 15 days a request with 7 days'
  notice; encashment of PL keeping 15 and at most 10 a year. Sandwich rule: no type suggested (many companies have none).
* Not set (owners' values): retention periods; the SMS/WhatsApp provider and its notices.

## Decisions made here (owners may overrule)

* Developer audit view: the record id, IP address and browser are withheld too, not only the old and new values; the names of the fields
  that changed are shown (a key that looks like a code or an id is left out).
* Settings that change pay or leave are proposed "on" by one director and confirmed by another; off again the same way.
* Sandwich rule counts only days between two leave days of the same request (not across two requests); it changes the balance taken,
  not attendance (the engine still shows a week-off).
* Leave notice applies to one's own request; HR applying on someone's behalf is not held to it.
* Overtime is read from the engine's excess minutes on a non-provisional day and re-read at approval (never more than claimed).
* WFH approval writes remote marks through the existing director path; the leave policy's WFH monthly/yearly limits are not applied here.
* Encashment requests reserve days (asked or approved count against the minimum) but write nothing to the ledger; payroll does.
* Feedback without a name writes no audit row (it would carry the sender's account and address).
* Custom field values: the audit records which fields changed, never the values; only a director reveals a sensitive one.
* Retention erasure: contact details are replaced by a marker and the photo removed; only GENERAL documents' files are removed; helpdesk
  tickets are not covered yet.
* SMS/WhatsApp texts carry the notice's title only, never its body.
* More than one company: kept in new tables beside the main company, so nothing payroll reads changes.

## Requests to Session A (block 2)

5. **Overtime pay.** Approved minutes per person per month: `overtime_claims` (status APPROVED, `approved_minutes`), or
   `GET /api/overtime/totals?month=` (directors). A pay head and rate are needed (owners' values).
6. **Encashment during the year.** `leave_encashment_requests` with status APPROVED wait for payroll to pay them and write the leave
   ledger entry (the rate is spec §14's open question).
7. **Payroll per company.** `legal_entities` and `employee_legal_entities` (no row = the main company): registrations, statutory files
   and the bank file per entity.
8. **Statutory registers (ST-28)**: built from payroll results; not started here.
9. Session A's `payroll/reports/definitions.ts` read history tables directly (current-row guard); already fixed by Session A in `247096d`.

## Changed tests (block 2)

| Test | Before | After | Why |
|---|---|---|---|
| `leave/__tests__/yearEndMoney.test.ts` audit viewer case | The Developer sees the year-end row without the total, the rest intact | The Developer sees no value at all; the money rule for a non-salary viewer is kept by calling the audit service directly (mutation still caught) | Owner rule: the Developer never sees a value |
| `frontend/src/routes/__tests__/mobile.test.tsx` coming-soon case | Feedback was the example of a page still to come | Feedback is real; the rule is checked on a temporary phase-marked entry | SS-13 built the last placeholder |
| `managers/__tests__/managerReach.test.ts` | — | cases added for custom fields, overtime and companies (manager-grantable keys) | new routes |

## Verification

* Per row (until the owner asked to skip tests): the row's own test file, route inventory, cleanup engine; mutation checks on each new rule
  (all caught; two first survived and were closed by new cases: an approver deciding their own overtime claim, and a team-scoped importer).
  Rows built after that request (LT-09 check page only partly, AD-07, NT-11, AD-08) have **no test of their own run** beyond lint and
  typecheck: LT-09's test file was written and passed; AD-07, NT-11 and AD-08 have no test file.
* Full backend suite alone once (after SS-13): 2,135 tests, 2 failures: Session A's reports reading history tables (fixed by them) and the
  year-end audit test changed above. Not run again at the end.
* Every migration applied to the local database with no schema drift; each test run rebuilt the test database from migrations.
* Lint, design tokens and typecheck (both projects) pass on the final tree. The backend typecheck needs about 2.5 GB of Node heap
  (default here is 2 GB; CI passes as is).
* **Not done:** keyboard-only, tablet (768), desktop light and 390 dark walks of block 2's screens; a browser walk of any block 2 screen.

---

# Verification block (2026-11-13): no new features

## Commits
`20ce0125` (cherry-pick of `74ee229`), `1b51172a`, `03462da8`, `24e3af31`, `8c8522dc`, and this report.

## What was verified
* **Flaky tests (cherry-picked, not redone):** `profileAndReveal` + `customFields` in one run, both orders (seeds showing each order): 21 of 21
  each time; `immediacy.test.ts` 8 of 8.
* **Order failures of my own, found by the full suite and fixed:** `wfhRequests.test.ts` left remote-work marks (no foreign key), which broke
  `remoteAttendance.test.ts`'s "nobody is remote by default" (both orders now pass, 25 of 25); `resetPolicy` left a confirmed "cleared"
  row, so a Not set setting read as confirmed in a later file (it now removes the test's proposals). 13 related files pass under three
  shuffle seeds (96 of 96 each).
* **AD-07 data retention** (helpdesk tickets added; migration `m_data_erasures_helpdesk`): every period Not set and nothing can be proposed;
  signed out 401; HR, manager, employee, Developer 403 on every route; not past the period refused; one director proposes, a different one
  confirms (service and database); a proposal alone erases nothing; contact replaced, general documents erased, pay documents kept, helpdesk
  subject and messages replaced; audited (6 rows); records fixed. Mutants caught: 4 of 4.
* **NT-11 SMS/WhatsApp:** Not set sends nothing (the in-app notice is still stored); only directors choose, an unknown notice refused; the
  text read from the file driver is the title only, never the body (a confidential reason and figure asserted absent); other notices and
  provider NONE send nothing. Mutants caught: 3 of 3.
* **AD-08 more than one company:** signed out 401; HR, manager, employee, Developer cannot change it; employee and Developer cannot read
  it; a manager reads the team member's company, never an outsider's (manager-reach). GOLDEN: the main company's payroll run is byte-for-byte
  the same with one company and with extra companies defined. Mutants caught: 2 of 2.
* **Golden "off" regressions** for AT-22, LV-19, LV-20, AT-19, AT-36, LV-23: present since block 2 (each passes in the full suite).
* **Migrations on a fresh database:** every backend test run drops, recreates and migrates the test database; no schema drift locally or in CI.
* **Browser walk** (dev stack, seed data; AD-08 Companies skipped by the owner): 387 page visits, 5 roles (director, HR Admin, manager,
  employee, Developer) × desktop 1280 light, tablet 768 light, phone 390 dark, every screen of both blocks: no horizontal scroll, no console
  error, no crash. Error state (every data call failing, 29 screens): none crashed; 27 show "Try again"; **Update From File's directors' panel
  hid itself (fixed `24e3af31`)**; Account & security reads only sign-in and notification calls, which the check leaves working. Keyboard
  (desktop, 5 roles, 129 page visits): focus visible on all 1,548 tab stops; 21 dialogs opened by Enter, focus stayed inside all 21, Escape
  closed all 21.
* **Check script** (stops at the first failed step; 4 GB heap; Prisma client regenerated): lint, typecheck, migrate and drift, frontend lint
  + tokens + typecheck + 75 tests: all pass.
* **Full backend suite alone:** 254 files, 2,205 tests, all passed.
* **CI run 368 on `8c8522dc`, read to the end of every job:** 11 of 12 green (install-lint-typecheck-test with every step; backend-tests
  shards 1 to 4; backend-tests-complete; sensitive-ui admin and employee portals; latency; attendance-replay; docker-build). **agent-windows
  failed** at "Unit tests on Windows": 4 biometric-agent tests could not bind local UDP ports (`bind EACCES 127.0.0.1:609xx`, a refusal by
  the Windows runner). Neither M block touched `biometric-agent/`, and the same job was green on `cbaee81` (run 333). Not changed here (not
  this session's area); re-running that job, or making the agent tests pick ports outside Windows' reserved ranges, is for the agent's owner.

## Changed tests (verification block)
| Test | Before | After | Why |
|---|---|---|---|
| `employee/__tests__/profileAndReveal.test.ts` (cherry-pick `74ee229`) | left a grant on the shared Manager role | restores the shared roles at the end; every assertion kept | `customFields.test.ts` got 404 instead of 403 when it ran after it |
| `hrCapabilities/__tests__/immediacy.test.ts` (cherry-pick `74ee229`) | waited a fixed delay for the live update | waits for the room change itself; same checks | failed once in CI on timing |
| `wfhRequests/__tests__/wfhRequests.test.ts` | left remote-work marks | removes them | broke `remoteAttendance.test.ts` |
| `policySettings/__tests__/policyTestHelpers.ts` `resetPolicy` (+ overtime and manager-reach resets) | wrote a "cleared" confirmed proposal | removes the test's proposals (fresh state) | a Not set setting read as confirmed in a later file |
| `legalEntities/__tests__/legalEntities.test.ts` golden | "with extra companies and a person moved" | "with extra companies defined"; the move is checked in the access case | Session A's payroll per company (`6ebb4db6`) now pays a moved person in that company's run, by design |

## Still not verified
* agent-windows on the final commit (runner refused UDP ports; see above).
* AD-08 Companies screens in the browser (owner: skipped; the feature stays off).
* Payroll per company itself is Session A's (their tests).

## Decisions made here
* AD-07 helpdesk erasure replaces the subject and every message of the tickets the person raised and removes their attachment files; the
  ticket rows and numbers stay (counts and history keep adding up).
* The AD-08 golden follows Session A's payroll per company (see changed tests) rather than pinning a moved person in the main run.

---

# Operations documents (2026-11-14): docs only

Written in `docs/ops/`: FIRST_SETUP.md, DAILY_AND_MONTHLY_GUIDE.md, ACCEPTANCE_CHECKLIST.md, MOVE_FROM_GREYTHR.md and a README. Every screen name and menu
path was read from `frontend/src/routes/adminMenu.config.tsx` / `employeeMenu.config.tsx` and the pages; quoted messages from the backend services
(`lib/directorAuthority.ts`, `payroll/rules/context.ts`, `payroll/run`, regularization, leave). Demo examples only (DEMO accounts, DEMO branch names).

**Could not confirm from the code (worded generally in the documents):** what an employee sees if they open an `/admin` address (the employee
checklist row says only that no admin screen opens with their data); the exact menu path to View My Info (given as `/app/profile`); that the demo
company has a finished financial year for the Form 16 row (the row says to skip if not); live behaviour of a branch device punch (needs a machine).

**Mismatches between the code and existing docs (listed, not fixed):**
1. `docs/FIRST_REAL_PAYROLL_RUN.md` §0 gives the payroll work to "Payroll Admin" and "Payroll Approver" roles held by different people; the owners'
   decision and the seed make the two directors the payroll team (the roles still exist in `systemRoles.ts` with permissions).
2. `docs/FIRST_REAL_PAYROLL_RUN.md` §1.2 and §5 speak of "your CA"; the owners' decision is no CA (owners enter statutory values with source notes).
3. `docs/FIRST_REAL_PAYROLL_RUN.md` §1.6 says "There is no spreadsheet import for salaries"; Payroll → Salary Revisions has **Import from a file**
   (the portal's own template; each revision still approved by another director).
4. `docs/FIRST_REAL_PAYROLL_RUN.md` §4 says "There are no off-cycle runs yet"; Payroll → Off-cycle runs and Settlements exist.
5. `docs/FIRST_REAL_PAYROLL_RUN.md` closing section names the place as "Admin Tools, System Settings, Director authority"; it is a System Settings tab
   shown to directors only (correct), but `lib/directorAuthority.ts`'s message says "(Admin Tools, Director authority)" without "System Settings".
6. `docs/UI_SCREEN_MAP.md` is behind the menu: My Worklife → Feedback is listed as a Phase 8 placeholder (built); the Salary sub-pages
   (YTD Reports, IT Statement, IT Declaration, Loans and Advances, Reimbursement, Proof Of Investment, Salary Revision) are listed as Phase 7
   placeholders (built); Payroll → Loans as a placeholder (built); the roles column still names PA / PP; and these screens are missing:
   Employee → Filters & Segments, Bulk Upload, Letters, Update From File, Onboarding, Probation, Employee Feedback; Workforce → Work From Home,
   Overtime, Encashment Requests; Payroll → Monthly Inputs is present but Opening Figures, Reimbursements, Settlements, Off-cycle runs, Loan and claim
   types, Quarterly TDS data, TDS and Form 16, Statutory challans, Compliance calendar, Minimum wages, Accounting journal, Overtime and encashment pay,
   Company settings, Payroll reports, Held Salaries entries are missing; Engage → Mass Email; Admin Tools → What HR Can Do, Workforce Settings,
   Attendance Locks, Leave Reviewers, Calendar Adjustments, Device Sync Requests, Leavers, Workflow, Letter Settings, Default behaviours, Policy
   settings, Companies, Data retention, Custom fields; employee Leave → Encashment, Attendance → Work From Home and Overtime, To do → Onboarding,
   Salary → Form 16; the public `/check-letter` page. (Not updated: no screen *name* in it was wrong, only missing or stale status.)
7. The task asked for branches "as Divisions": in the portal branches are **Organisation Setup → Branches**; Divisions are an optional grouping of
   departments. FIRST_SETUP.md follows the code.

---

# Docs cleanup (2026-11-14): docs only

**Changed:** `docs/FIRST_REAL_PAYROLL_RUN.md` (rewritten to the owner decisions and the current portal; points to `docs/ops/FIRST_SETUP.md` for
setup), `docs/UI_SCREEN_MAP.md` (regenerated), `docs/ops/FIRST_SETUP.md` (Divisions wording).

**How the screen map was made.** The two menu configs were loaded through the frontend's own Vite setup and dumped (every app, group and item, its
path, its `needs`, whether it has a page or a `phase` mark). The default role permissions were read from `systemRoles.ts`, minus
`HR_FORBIDDEN_KEYS` for both HR roles and `DEVELOPER_FORBIDDEN_KEYS` for the Developer; manager-grantable keys from `MANAGER_GRANTABLE_KEYS`.
The routes outside the menus were read from `router.tsx` and `PortalRoutes.tsx`. Board frames were carried over from the old map for every URL it
already had (99 of 166). The four ops guides were re-checked against it: every screen and menu path they name is in the map.

**Could not confirm from the code:**
* "Who can open it" shows defaults: the directors can narrow HR at run time (What HR Can Do), and a manager's grants are per person.
* For a menu item with no `needs`, the map says the page's own API decides; the exact rule for each such page was not re-read.
* The payroll menu items list DEV because the Developer holds `payroll.rules.view` (to see the Setup Checklist's status); the payroll APIs refuse
  the Developer every figure (tested in earlier blocks), but whether each payroll list page shows the Developer an empty state or a forbidden state
  was not re-checked.
* The run pages (`/admin/payroll/run/:id`, `/step/:slug`) are recorded as directors only from the services' director checks, not from a menu `needs`.

## Requests to Session A (docs cleanup)

10. **The in-product message about Director authority.** `lib/directorAuthority.ts` says "(Admin Tools, Director authority)". It should say System
    Settings, the Director authority tab (Admin Tools → System Settings → Director authority).
11. **Payroll Admin and Payroll Approver roles.** They still exist in `systemRoles.ts` with payroll permissions, although the two directors are the
    payroll team and the roles are given to nobody. Should they be hidden from role assignment (Roles & Permissions, Manager Management), or removed?
12. **Payroll reports by branch.** Add a branch filter and a grouping by branch (Organisation Setup → Branches) to Payroll → Payroll reports.
    Payroll results must stay byte-for-byte identical: this is a view over finished runs only.

---

# Developer and payroll screens (2026-11-14)

**Found (browser walk as `DEMO005`, dev stack, demo company), before the fix:** of the 34 payroll menu pages, 29 already refused the Developer
(the shared forbidden page, or the page's own "You don't have access"); five opened and showed content: **Setup Checklist** (status lines),
**Ready for First Run** (status), **Rules and Setup** (62 rows, **with rupee figures**: the statutory and company rule values), **Bank and statutory
layouts** (6 layout rows) and **Compare Registers** (its upload form). Rule overrides showed one row. The run and its step pages had no gate of
their own (the API refused the data). Cause: the menu rule `PAYROLL_NEEDS` includes `payroll.rules.view`, which the Developer holds so that the
API can tell it the Setup Checklist's status.

**Fixed (frontend shared access layer only, no payroll page edited):** `AdminNeeds.noDeveloper` in `routes/adminMenu.config.tsx`, set on every
payroll menu item (`PAYROLL_NEEDS`, Monthly Inputs and the director-only ones); `adminNeedsMet` refuses it to the Developer (`isDeveloperOnly`: the
Developer role and not also a director), applied in `RequireAccess` (the forbidden page "This is not switched on for you"), the sidebar
(`layouts/shell/nav.ts`, `AdminLayout.tsx`) and the home favourites; the run and run-step routes in `PortalRoutes.tsx` are wrapped in the same gate.
`docs/UI_SCREEN_MAP.md` regenerated: every payroll row now says "never the Developer".

**Verified:** `frontend/src/routes/__tests__/payrollDeveloper.test.tsx` (41 cases: the whole payroll menu and both run pages refused by the rule and
rendered as the forbidden page, never the page; the Developer's sidebar has no payroll entry; the run routes are wrapped; a director opens every
page). Mutants caught 6 of 6 (rule removed; flag off `PAYROLL_NEEDS`; flag off Monthly Inputs; gate ignores the Developer; run page unwrapped;
sidebar ignores the Developer). Browser re-walk as `DEMO005`: 36 of 36 payroll pages show the forbidden page, no table row, no rupee figure. Check
script (lint, typecheck, migrate and drift, 116 frontend tests), build and bundle budgets (login 232.3 KB, shell + employee home 347.7 KB, shell +
admin home 367.4 KB): all pass. The backend was not changed (the demo test's Developer reads of `payroll/setup` and the restricted layout stay valid).

**Decision made here:** the Setup Checklist and Ready for First Run are now forbidden pages for the Developer too (the owner asked for every payroll
page); the API still answers the Developer's status read, so this can be reverted for those two screens alone if the owners want the Developer to
see where setup stands.

**Request 13 to Session A (protected payroll folder):** the payroll **APIs** still answer the Developer for `payroll.rules.view` reads: the rules
list with its values (statutory and company figures, sealed identifiers already hidden), the layouts list (sealed values already restricted) and
the setup checklist. The screens no longer show them, but a direct API call would. Consider refusing the Developer on the rules and layouts reads
(keeping the setup status read if the owners want it). These are company settings, not any person's pay.

**Question for the owners (not changed):** the Developer holds `reports.view`, so it opens the ten people and attendance reports (Headcount, Joiners,
Leavers & attrition, Birthdays & anniversaries, Leave balance, Loss of pay (LOP), Attendance summary, Late coming, Excess hours, Attendance
exceptions) with names and rows. No pay figure is in them (Leave liability and Payroll reports are closed to the Developer), but Loss of pay shows
LOP days per person. Should the Developer lose `reports.view`, or at least the LOP report?
