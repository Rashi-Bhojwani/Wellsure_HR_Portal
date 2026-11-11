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
- [ ] RP-13 Scheduled reports by email — medium
- [ ] NT-10 Phone push notifications — medium
- [ ] full backend suite alone; CI per job on the final code commit; browser walk (director, HR, manager, employee, Developer; desktop + 390 dark)
- [ ] M_STAGE_REPORTS.md final report
