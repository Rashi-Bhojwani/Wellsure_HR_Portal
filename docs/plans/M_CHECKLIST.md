# M checklist: non-payroll gaps from the parity audit (second session on `feat/hr-payroll-separation`)

Written 2026-11-11 before any code. A new session reads this file and `M_STAGE_REPORTS.md`, then continues at the first unticked item.
Session A works on the same branch at the same time: this session edits only non-payroll, non-attendance-engine files and its own `M_` files;
migrations are named `m_…`; schema additions sit between `// M-BEGIN` and `// M-END`. Anything needed in a protected area is written as a
request in `M_STAGE_REPORTS.md` ("Requests to Session A"). Public repository: no real data, no real person's name.

Status: `[ ]` open, `[x]` done and verified (commit hash), `[-]` skipped (reason in M_STAGE_REPORTS.md).

## Setup
- [x] Clean tree; audit file brought onto the branch — `9f5dd5f`
- [x] Local Postgres 16 + Redis 7, dependencies, migrate, seed (no `migrate reset`: Prisma refuses it from an agent; seeded with `npx tsx prisma/seed.ts` + `seed:demo-company`)

## Task 1 — ER-12: HR's bank and statutory changes wait for a director (decision b)
Plan (written before the code):
- Director setting in the D-37 behaviours store: `identity.directorConfirmsHrChanges`, boolean, **ON by default** ("Default, change in settings"),
  changed by a director and confirmed by a different director (the store's own rules, audited).
- New table `identity_change_requests` (migration `m_…_identity_change_requests`): employee, kind BANK / STATUTORY, the entry already encrypted
  (same packed shape as `profile_change_requests.changes_json`), bank effective date, source (HR edit, Add Employee, an employee's own request
  approved by HR), entered by, status PENDING / CONFIRMED / REJECTED / WITHDRAWN, decided by, reason. Database: the decider is never the person who
  entered it; a decided row never changes; no delete outside the test purge. Pending payloads counted by `field-keys status` (`lib/fieldKeyRotation.ts`).
- Held when: the setting is ON and the person entering is not a director; or a director enters their **own** record (Q-DA-2); or the director
  switch `IDENTITY_DIRECTOR_ENTRY` is "a different director". Otherwise written at once (with the setting OFF, behaviour is as before).
- Confirm / reject: a director, never the person who entered it, never on their own record. Withdraw: the person who entered it, while pending.
  Notifications: directors when something waits; the person who entered it when decided. Every step audited.
- HR Executive gets the same masked entry as HR Admin (`employee.bank.view/edit`, `employee.statutory.view/edit`), via `systemRoles.ts` and an
  `m_` migration for existing databases. The test that pinned the refusal is changed and recorded in M_STAGE_REPORTS.md.
- Screens: Change Requests page gains "Waiting for a director"; the profile's Bank and Statutory tabs show a pending entry; Default behaviours renders the key.
- Mutation checks: the hold condition, the different-person check (service and database).
- [x] backend + migration + tests
- [x] screens (browser walk at the end, with the other rows)
- [x] mutation checks, lint, typecheck, changed tests (see M_STAGE_REPORTS.md)

## Task 2 — stale text (docs and one code comment)
- [x] spec §7.5 and `STAGE_5B_PLAN.md` (no bank response import); `CLAUDE.md` (HR sees no salary; HR Executive enters bank/identity masked);
      `sensitiveData.ts` comment and `HR_CAPABILITIES.md` (per-template letter grants are built); spec "until the CA confirms" wording

## Task 3 — work list (non-payroll, no owner decision, not Peeps)
Tier 1 first, then smallest first. Status per row is kept in M_STAGE_REPORTS.md.
- [x] LC-14 Claims in the Tasks inbox (directors) — small (+ held identity changes as a director source)
- [x] ER-11 Statutory ID history — medium (masked change history; see report)
- [x] SS-15 Download my own data (DPDP) — medium
- [x] AU-04 Audit log export — small
- [x] LT-08 Employee asks for a letter — small
- [x] NT-09 Notification preferences — small
- [x] NT-08 Editable email templates — medium
- [x] RP-13 Scheduled reports by email — medium
- [-] NT-10 Phone push notifications — medium (needs a VAPID key pair and the push services' hosts: real values, see report)
- [x] full backend suite alone (228 files, 2,085 tests, all passed); CI run 305 on `0a7b4fc` all seven jobs green; browser walk 56 visits, one defect fixed (`cfe5c07`)
- [x] M_STAGE_REPORTS.md final report

---

# Block 2 (2026-11-12): Developer audit view, the decision rows, walks

Same rules as above. Updated DEFAULTS RULE: conventional starting values directors can change (audited), shown "Default, change in settings";
Not set until a director chooses: tax and statutory figures, bank values, retention periods, any value that changes pay. Anything that changes
pay or leave is a director setting that has **no effect until a director turns it on and a different director confirms**.

## B1 — Developer audit view
- [x] Every audit-reading route gives the Developer role who, what, when, the record type and the changed field names; values (all fields), record id,
      IP and browser withheld; no file. Test walks every `GET …audit…` route of the route inventory as the Developer; mutation-checked — `ad5b3ca`

## B2 — the decision rows (plan written before the code)

**Shared mechanism: Policy settings** (`modules/policySettings`, screen System Settings → Policy settings). Each setting is a small typed form
(on/off, whole numbers with bounds, a choice, a list) described once in `shared/constants/policySettings.ts`, so the screen renders it without
per-key code. Values use the existing two-director store (`behaviour_proposals` / `behaviour_confirmations`, keys `policy.*`; not added to
`BEHAVIOURS`, so Session A's Ready for First Run list is unchanged): a director proposes, a different director confirms, both audited.
Two kinds: **plain** (in force from the start with a conventional default, labelled "Default, change in settings") and **activation** (anything
that changes pay or leave: off until turned on and confirmed; the screen offers the conventional values as a suggestion, never in force by itself).

| Row | Plan | Kind / default |
|---|---|---|
| ER-27 Divisions | Division master (code, name); a department may belong to one division (optional); an employee's division is their department's, so it follows the effective-dated job history. Org masters tab, Employees list column and filter, profile | No setting: unused until a division is created |
| ER-18 Policy acknowledgement | A company document can require acknowledgement (by `documents.manage`); people in the document's scope acknowledge once (append-only, time recorded); the uploader side sees acknowledged / waiting; a reminder notice | Per document, off unless asked |
| ER-26 Probation | Probation end = joining date + months (setting), or the latest extension; due list (ending within the reminder window or overdue), confirm or extend with a reason (append-only decisions); daily reminder to HR and the manager | plain: 3 months, reminder 15 days before |
| OE-04 Onboarding checklist | A checklist (setting: items with owner HR / manager / employee and days after joining); each new joiner gets the items on first view; tick done; progress list for HR; employee sees own items | plain: a conventional 6-item list |
| ER-28 Custom fields | Directors define fields (text, number, date, choice; who may see: HR only or also the employee; sensitive = encrypted and masked); HR fills values per employee within data scope; employee sees own visible ones | none defined |
| SS-13 Feedback | An employee sends feedback or a suggestion to HR, optionally without their name (then no author is stored at all); HR (`helpdesk.manage`) reads and replies; the sender sees replies to named feedback | plain: anonymous allowed |
| AT-19 Overtime | Reads finalised daily attendance (never the engine): overtime = worked beyond the shift by at least the minimum; the employee claims it; manager/director approves; report. Paying it is payroll's (request to Session A) | activation: off; suggested minimum 60 min, rounding 30 min, needs approval |
| AT-22 Regularization rules (A-5) | Limits on raising a correction: at most N per month per person; reason required. Applied in `regularization/service.ts raiseRequest` (not the engine) | activation: off; suggested 3 a month |
| AT-36 WFH eligibility and approval | Employees in eligible departments ask for work-from-home days; a director approves (as remote decisions today); approval writes remote marks for the days. Leave policy WFH limits enforced on the ask | activation: off; suggested all departments, director approves |
| LV-19 Leave policy limits | Per leave type: most consecutive days in one request, least notice in days (not for sick leave by choice of type). "Document after N days" is Peeps' leave extension (LV-18): not built | activation: off; suggested none listed |
| LV-20 Sandwich rule | When on for a leave type, week-offs and holidays between two leave days of one request are counted. Golden test: day counts unchanged while off | activation: off |
| LV-23 Encashment request | An employee asks to encash days of a type the directors list; a director approves; the approved days wait for payroll (Session A pays them and debits the ledger: request) | activation: off |
| IE-07 / IE-08 Update importer and HR import rules (A-2) | Excel update of existing employees' non-sensitive fields (contact, personal, job with an effective date); bank and statutory never through this importer (they go through task 1's hold); preview then apply, audited | plain: HR may update contact and personal fields; job changes need a director |
| LT-09 Electronic signature | A director's signature image (uploaded by that director) and a "signed electronically by …, on …, check code …" block on issued letters; a public check page confirms a code is genuine (no personal data) | plain: off per template until a signatory is chosen |
| AD-07 Data retention | Categories (former employees' personal and contact details, documents, attendance punches, helpdesk tickets); each period **Not set**; a daily job lists what is past its period; erasure needs a director and a second director; payroll records excluded (statutory retention, Session A) | Not set |
| NT-11 SMS / WhatsApp | A `MessageService` interface (like `MailService`) with a local driver (`.messages/`) and no provider chosen (**Not set**: needs an account and a secret); categories a person may receive by SMS; off | Not set (provider); plain: off |
| AD-08 More than one company | Legal entity master (the existing company is the first); an employee belongs to one (default the first); shown and filterable. Payroll per entity (registrations, bank file, statutory files) is Session A's: request | plain: one company |

Skipped: AT-18 late-mark penalty (Peeps owns the lateness rule); ST-28 statutory registers (built from payroll results: Session A's area, request);
NT-10 phone push (deferred to deployment by the owner).

Per row: Zod + authenticate + requirePermission + data scope on every route; route inventory entry; employee-cannot-read-others and Developer-403
tests; sensitive columns in the field-encryption registry; audit; design system, light / dark / phone; a mutation check on each new rule; the
migration applied to a fresh database; no existing test weakened; a golden test where attendance or pay could change.

- [x] Policy settings mechanism + ER-27 — `de0cfed`
- [x] ER-18 `9741815` (+`fbf26e8`) · [x] ER-26 `371fd55` · [x] OE-04 `f9b1842` · [x] ER-28 `c4f4b7b` · [x] SS-13 `3bea7cb`
- [x] AT-22, LV-19, LV-20 `cbaee81` · [x] AT-19 `f503dd7` · [x] AT-36 `fc14ed4` · [x] LV-23 `c87fb08`
- [x] IE-07/08 `1aedbb0` · [x] LT-09 `96c908d` · [x] AD-07 `048aed2` · [x] NT-11 `b9ec63c` · [x] AD-08 `c7f01a2`
- [~] full backend suite alone: run once after SS-13 (2,133 of 2,135; the 2 failures explained and fixed, see report); not run again at the end (owner: skip tests)

## B3 — walks
- [-] Keyboard-only paths, tablet (768), desktop light and 390 dark walks of block 2's screens: not done (owner: skip tests to save tokens)

## B5 — verify and finish
- [x] M_STAGE_REPORTS.md block 2 report · CI: see the report
