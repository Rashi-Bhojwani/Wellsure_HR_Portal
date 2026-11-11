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
