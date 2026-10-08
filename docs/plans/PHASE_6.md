# Phase 6 — Payroll (plan in progress)

The full Phase 6 plan is not written yet. It will be written, and shown to
the user, before Phase 6 is built (CLAUDE.md: plans live in the repo). This
file starts with the part that must exist first: the contract payroll
builds on. It was written with effective dating EF4 (2026-10-08) so that no
payroll code can be built on "current rows".

Related, already decided:
- **Maker-checker:** purpose-built for the payroll run and the bank
  transfer file, never a general approval chain (spec §7.8, §12).
- **Payroll and bank-file permissions are never manager-grantable**
  (spec §2.2). A test fails if one ever becomes grantable.

## Effective-dating contract (EF4)

Everything payroll reads that changes over time is effective-dated: the
placement (branch for PT/LWF state, cost centre, grade, department), the
name on the payslip, the bank account for the transfer file, and the device
mapping behind attendance (paid days, LOP).

The model is in `backend/src/lib/effectiveDating.ts` and
`docs/plans/EFFECTIVE_DATES.md`:
- a row covers its start date up to but not including its end;
- history is only ever appended at the end;
- the database forbids overlaps and rows that run backwards.

**Payroll (and attendance) use only these readers, always with an explicit
day:**

| Question | Reader |
|---|---|
| Where was this person placed on day D? | `placementOn(employeeId, day)` |
| Every placement across a pay period, split on change days (a transfer on the 16th gives two segments) | `placementSegments(employeeId, from, to)` |
| Everyone's placement on one day (reports, bulk) | `placementsOn(employeeIds, day)` |
| The name on a payslip or letter dated D | `nameOn(employeeId, day)` |
| The account a payment dated D goes to | `bankAccountOn(employeeId, paymentDate)` |
| Whose punch is this (device ID on day D)? | `employeeForDeviceUserOn(deviceUserId, day)` |
| Was this person employed on D? | `employedOn(day)`, a Prisma `where` on Employee built from `dateOfJoining` / `lastWorkingDate`, never `status` |

**Rules:**
- **Never query a history table directly from payroll or attendance.**
  `backend/src/lib/__tests__/currentRowGuard.test.ts` fails on any
  `employeeJobHistory` / `employeeNameHistory` / `employeeBankAccount` /
  `deviceUserMapping` access in `modules/payroll`, `modules/attendance` or
  `modules/biometric`.
- **Never use "today" inside a pay run.** Every reader takes the day.
  `businessToday()` (IST) is only for deciding what "now" is.
- **A leaver is in force on their last working day** (history ends the
  day after). The last month is paid through `lastWorkingDate`.
- **The payroll lock.** When a pay period is finalised, Phase 6 registers
  `setPayrollLockCheck(day => …)`. From then on, every history change,
  cancellation and separation dated inside a locked period is refused
  (`PAYROLL_LOCKED`). The hook is already called by every writer and
  tested (`payrollContract.test.ts`). Until Phase 6 registers a check,
  nothing is locked.
- **Salary itself will be effective-dated the same way**: salary
  revisions, arrears and structure changes. It goes through the same
  writer rules (append-only, constraints, no overlaps), not a copy of the
  old job-history pattern.
- **Money stays `Decimal` until it's rendered** (Phase 5 review §5.3):
  no JavaScript numbers for rupees, and maker-checker hashes are computed
  over canonical decimal strings.

**Pinned by tests** (`backend/src/lib/__tests__/payrollContract.test.ts`):
- a transfer on the 16th gives two segments split on the day;
- a leaver is placed and employed on their last working day and not the
  day after;
- a bank change dated the 10th sends a payment dated the 25th to the new
  account, and the 9th to the old one;
- a name change takes effect on its own date;
- a reused device ID gives a punch on the leaver's last day to the
  leaver, and after it to the new holder;
- the lock refuses changes and leavings dated inside a finalised period.
