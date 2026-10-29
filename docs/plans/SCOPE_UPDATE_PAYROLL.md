# Scope update — HR/payroll separation, Monthly Inputs and four new features

**Status: DRAFT for the owner's review. Nothing in this document is built, and nothing in it is decided
beyond what section 1 quotes from the owner.** Everything marked *Proposal* is mine and needs approval.
Everything in section 6 is an open question; none has a default and none has been guessed.

Written 2026-10-29 against branch tip `60132e0` (P7-0 done, CI green). It amends
[PHASE_7.md](PHASE_7.md); PHASE_7.md is **not** edited until this document is approved.

---

## 1. The decisions (from the owner, verbatim in substance)

1. **Muster holds attendance only.** Incentives, bonuses, deductions, loans and arrears are entered *after*
   attendance is finalised, in a separate **Monthly Inputs** grid. Shown to payroll roles only. Filters:
   branch, department, designation, manager, status, PF-covered, not entered yet, changed this month.
   Imports Excel in the greytHR `Bulk_Salary_Overrides` layout, with a preview.
2. **HR Admin and HR Executive have no Admin Tools access and no payroll or payment function:** no salary,
   bank, PAN, UAN, ESI, tax or declaration amounts; no salary revisions, payroll runs, payslip publishing,
   bank file, statutory files, loans, reimbursements, settlement; no letters carrying CTC. Admin Tools belong
   to the owners. HR keeps: employee records without pay data, attendance and muster, finalising a month,
   regularizations, leave, helpdesk (not Payroll tickets), Engage, documents, people reports.
3. **Also wanted:** loss-of-pay reversal with a 6-month look-back; Hold Salary and release; a "Raise a
   query" button on payslips; a work-from-home Check in / Check out button (time only).

## 2. (a) What HR holds today that must come off

Source of truth: `backend/src/lib/systemRoles.ts` (`HR_EXECUTIVE_PERMS`, `HR_ADMIN_PERMS`). HR_ADMIN =
HR_EXECUTIVE + extras. **Important mechanical fact:** `ensureAccessCatalog` never overwrites existing roles,
so editing `systemRoles.ts` only changes brand-new databases. Existing databases need a **migration that
deletes the `role_permissions` rows** (the grants came in through the migrations listed in §2.5, and the
removal must be written as its own migration, not by editing those).

### 2.1 Pay-data permissions — remove (explicit in decision 2)

| Permission | Held by | What it gives today |
|---|---|---|
| `employee.statutory.view` | HR_ADMIN | Masked PAN/Aadhaar/UAN/ESI/PF in profile Statutory tab |
| `employee.statutory.edit` | HR_ADMIN | Edit identifiers; **also the gate on approving statutory change requests** (`changeRequests.ts`) |
| (reveal) | HR_ADMIN via `.view` | `GET /api/employees/:id/statutory/reveal` — full PAN, Aadhaar, **UAN and ESI** (ESI added in P7-0). Audited, but must not be reachable by HR |
| `employee.bank.view` | HR_ADMIN | Masked bank, bank-account reveal, bank history |
| `employee.bank.edit` | HR_ADMIN | Edit bank; gate on approving bank change requests |
| `payroll.salary.view` | HR_ADMIN | Salary structures, CTC, per-employee salary |
| `payroll.salary.edit` | HR_ADMIN | Prepare salary revisions (maker) |
| `payroll.rules.view` | HR_ADMIN | Payroll/statutory rules (rates, slabs, limits) |
| `documents.pay.view` | HR_ADMIN | Contents of PAY-category documents (every issued letter is filed here) |
| `reports.liability.view` | HR_ADMIN | Leave liability report (salary-derived since Phase 6) |
| `helpdesk.sensitive.view` | HR_ADMIN | Payroll & Salary **and** Grievance tickets (one key covers both — see Q5) |
| `leave.yearend.manage` | HR_ADMIN | Year-end run incl. encashment **amounts** (money) — see Q9 |

### 2.2 Admin Tools-gated permissions — remove (explicit in decision 2: "no Admin Tools access")

Which of these HR's retained duties depend on is unresolved (Q8); the list below is what the Admin Tools
menu is gated by, not a decision to remove each. I will not remove any of these until Q8 is answered.

HR_EXECUTIVE: `org.manage`, `import.manage`, `role.view`, `helpdesk.manage` (categories/queue admin).
HR_ADMIN additionally: `settings.manage`, `audit.view`, `user.security.manage`, `delegation.manage`,
`manager.appoint`, `manager.team.assign`, `manager.permissions.manage`, `letters.template.manage`,
`leave.policy.manage`, `leave.recalculate`, `attendance.config.manage`, `attendance.devices.manage`,
`announcements.manage`, `engage.moderate`, `engage.groups.manage`, `engage.autopost.manage`.
(The last four are Engage/People features HR is told to keep, so they are *not* Admin Tools in the owner's
sense — flagged in Q8 so I don't conflate them.)

Mechanical note: `frontend/src/routes/adminMenu.config.tsx` has **no per-item permission filtering** — only
the API gates. Hiding Admin Tools from HR needs a menu change (a `permission` field like the employee menu
leaves already support), not just a role change.

### 2.3 HR-reachable screens and exports that show salary, bank or statutory data

| Where | What shows | Fix needed |
|---|---|---|
| Employee profile → Statutory tab | PAN/Aadhaar/UAN/ESI masked + reveal | Gate by permission; HR sees tab absent |
| Employee profile → Bank tab and History | Masked bank, history, reveal | Same |
| Employee profile → Documents tab | PAY-category docs (letters with CTC), Statutory-category ID proofs | Q3, Q4 |
| Change Requests page and **Tasks inbox** | Pending "Bank details change" / "Statutory details change" titles and (for approvers) the proposed values | HR must not see these; who approves instead is Q2 |
| Import Center | `bank`, `statutory` datasets and templates; employee import columns | Remove pay datasets from HR; owner-only (Q8) |
| Payroll app (Setup checklist, Rules, Salary structures, Runs, Payslips, bank file, statutory files) | everything | Whole app is payroll roles only |
| Year End (leave) | encashment amounts | Q9 |
| Reports → Leave liability | ₹ liability | Remove |
| Letters / issuing | Offer letter has typed field `ctcAnnual`; every issued letter lands in PAY category | Q3 |
| Helpdesk | Payroll & Salary tickets (HR_ADMIN) | Q5 |
| Employee list / export (`employee.export`) | **Verified: no salary columns** in grid today; export column set to be re-checked in the build | Re-verify in build; add a test that sentinel pay values never appear in HR exports |
| Docs: `SENSITIVE_DATA.md` tables, `FIRST_REAL_PAYROLL_RUN.md`, `GETTING_STARTED.md` role tables, `PHASE_6.md` role matrix | state HR_ADMIN sees salary | Regenerate/update |
| Seed accounts `1001`, `1021–1023`, demo `DEMO004` | HR accounts that currently have HR_ADMIN reach | Re-check what each seeded user can reach after the change |

### 2.4 Guards that make the removal stick (*Proposal*)

- Add the pay-data keys to a **"never grantable to HR roles"** ceiling (same mechanism as the Manager-grantable
  and Developer ceilings in `resolveAccess` / `shared/constants/sensitiveData.ts`), enforced by a DB trigger
  as the Developer ceiling is. Whether this is wanted at all, and what it does to an owner who is also doing
  HR work, is **Q1**.
- Tests: for each removed key, a named test that an HR_ADMIN and an HR_EXECUTIVE token gets 403 on every route
  that key gates; the route-inventory test must classify every route; sentinel-crawl test extended so pay
  sentinels never appear in any HR-reachable response/export. Mutation-check each by re-adding the key.

### 2.5 Migrations that granted these keys (the removal migration reverses them)

`20261002061248_e2_manager_management_permissions`, `20261002191517_e3_workflow_delegates`,
`20261003090000_f_reports_permissions`, `20261003130000_document_sensitivity`,
`20261008100000_attendance_config`, `20261011090000_regularization_missing_punch`,
`20261013090100_regularization_generalised`, `20261014090000_manual_override_shift_override_swipes`,
`20261015090000_period_finalisation`, `20261016090000_payroll_foundations`
(`payroll.rules.view`, `payroll.salary.view`, `payroll.salary.edit`).

### 2.6 Side effect to be aware of

`employee.view` for HR must stay (employee records without pay data). Anything that today shows pay inside an
otherwise-HR screen (e.g. Separation shows settlement figures once P7-6 lands) must be split so HR sees the
non-money fields only.

## 3. (b) How each Phase 7 step changes

| Step | Today (PHASE_7.md) | Change |
|---|---|---|
| **P7-1** tax foundations | Tax rules/slabs, openings; HR_ADMIN sees rules via `payroll.rules.view` | Payroll roles only; HR has no view. Mid-year opening figures are pay data → payroll roles enter them |
| **P7-2** declarations / POI | Employee declares; verifier is a non-employee (HR could be one); HR can reopen a declaration (never edit) | **HR cannot see declaration amounts, so HR cannot verify or reopen.** Verifier = payroll roles (not the declaring employee). "HR included in the different-people rule" becomes moot but the rule stays for payroll staff who declare. Reopen moves to payroll. Audit of every verification with amount stays |
| **P7-3** TDS, IT Statement, YTD, Salary Revision page, revision letters, offer-letter figures | HR prepares revisions (maker); letters generated by `letters.generate` (HR) | Revision maker is payroll maker role; checker a different payroll/owner person. **Revision letters and offer letters with CTC are issued by payroll roles/owners** (who issues is Q3). HR cannot see the Salary Revision page |
| **P7-4** loans | Payroll creates/approves; disbursement via next/off-cycle run | Unchanged for HR (none). New: loan **instalments are entered through Monthly Inputs** (Q6 asks whether Monthly Inputs *is* the loan screen or reads from it) |
| **P7-5** reimbursements | Payroll alone approves; employees submit | Unchanged; confirm HR gets no queue entry/amounts |
| **P7-6** off-cycle runs, "pay what this run held", F&F | HR owns the Separation record; resignation date + notice fields added | HR keeps the **non-money** Separation fields (resignation date, notice required/served, exit status); recovery formula and settlement are payroll-only. "Pay what this run held" is the release half of Hold Salary (§4) |
| **P7-7** Form 16, challans, quarterly data | Payroll | Unchanged; confirm HR has no Form 16 access (leavers' read window is for the employee themselves) |
| P7-0 (done) | ESI encrypted, `employee.statutory.*` reveal incl. ESI | The reveal route moves behind a payroll-only gate (§2.1) — the one already-built thing this reopens |

## 4. (c) Where the new items slot in — *Proposal, needs approval*

The order below is mine. Each is its own reviewable commit with the usual verification, pausing after each.

| # | Commit | Why here |
|---|---|---|
| **S-1** | **HR/payroll separation** (§2: role migration, ceiling, menu gating, tests, docs) | Everything after assumes it; the Phase 7 steps otherwise get built against the wrong role model |
| **S-2** | **Raise a query** on payslips (needs only P6 payslips + helpdesk) | Small, independent; needs Q5 answered first |
| **S-3** | **Monthly Inputs** grid + Bulk_Salary_Overrides import (before P7-1, because TDS, loans and one-offs all need an input surface) | Needs the sample file (Q6) and a schema plan approved separately |
| **S-4** | **Check in / Check out** (attendance module; independent of payroll) | Can move earlier or later freely; Q10 decides |
| P7-1 → P7-3 | as revised in §3 | |
| **S-5** | **Loss-of-pay reversal** (after S-3, since the money part flows to a run through Monthly Inputs/arrears; after P7-3 if TDS must be re-computed) | Needs Q7 |
| P7-4, P7-5 | as revised | |
| **S-6** | **Hold Salary / release**, built *with* P7-6 (release = "pay what this run held" + off-cycle run) | Hold is meaningless without a release path; Q8b |
| P7-6, P7-7 | as revised | |

Each of S-3, S-5, S-6 adds new schema → each gets its own plan in `docs/plans/` and waits for approval before
building. **This document does not contain those plans.**

### Facts found while researching (not assumptions)

- No `Bulk_Salary_Overrides` layout exists anywhere in the repo; I have not seen the file and will not invent its columns.
- No Check-in feature exists. A `WFH` leave type exists and is referenced by the attendance engine types and auth service.
- Per-day LOP is stored in run item inputs (`lopByDay`); held people (`HELD`) exist in runs, but held pay is not carried forward anywhere.
- A self-marking attendance guard exists (people cannot mark their own attendance); Check in/out must be reconciled with it.
- Attendance backdate limit defaults to one cycle.
- `origin/main` has a docs-only commit `a1b558a` ("ui/ux", `docs/design/*.png`) that this branch does not contain.

## 5. Docs that change when this is approved

PHASE_7.md (steps above), PROGRESS.md, GETTING_STARTED.md (role tables, seeded accounts),
SENSITIVE_DATA.md (regenerated), FIRST_REAL_PAYROLL_RUN.md (who does which step), PHASE_6.md role matrix,
LOCAL_ASSUMPTIONS.md (any local-environment assumption in S-4, e.g. time source).

## 6. (d) Open questions — no defaults, none guessed

**Role model**
1. **Ceiling or just defaults?** Should pay-data keys be made *impossible* to grant to HR_ADMIN/HR_EXECUTIVE (DB-enforced ceiling), or only removed from the defaults so a Super Admin could re-grant? And can a person hold both an HR role and a payroll role (an owner doing both)? If yes, the ceiling must be per-role, not per-person.
2. **Employee bank/statutory data:** who enters and who approves these now? Today HR_ADMIN edits them and approves change requests. Options for you to choose between or replace: payroll roles; owners only; employee self-service with payroll approval. Also: does HR still *see that* a change request exists (without values)?
3. **Letters:** all letters are filed in the PAY category. Which letters count as "carrying CTC" (Offer, Revision, Appointment? others)? Who issues those — payroll roles, owners? Should non-CTC letters (experience, relieving, address proof) move to a non-PAY category so HR can issue and view them? Do offer letters leave HR's hands entirely, or does HR draft and a payroll role fills in the figure?
4. **ID-proof documents** (Aadhaar/PAN scans, STATUTORY category) are employee documents but contain statutory numbers. May HR see/upload them, given "documents" is HR's to keep and "PAN/Aadhaar" is not?
5. **Helpdesk:** `helpdesk.sensitive.view` covers Payroll & Salary *and* Grievance. HR is to lose Payroll but is Grievance HR's? That needs the key split in two. Who then answers Payroll tickets and payslip queries — payroll roles (who today hold no helpdesk keys) — and do owners want to be assigned automatically?
8a. **Admin Tools line by line:** which of these do HR's retained duties actually need, and who does them if HR loses access: Org Setup, Manager Management, Import Center / Invitations / employee import, Devices, Attendance Settings / Shift Master, Holiday Calendars, Leave policies, Delegates, Helpdesk categories, Audit Log, Letter Templates, Roles (view), user security, manager permissions? And are announcements/Engage moderation/groups/auto-posts "Admin Tools" (owner-only) or "Engage" (HR keeps)?
9. **Leave year-end:** encashment amounts are money. Does HR still run the year-end leave reset (days only) with payroll roles computing/paying encashment? Is the leave liability report payroll-only?

**Monthly Inputs**
6. a) Please share a sample `Bulk_Salary_Overrides` file (headers, row key such as employee number, one row per employee or per component, how deductions/arrears are signed). b) What does the **"status"** filter mean — employment status, input-entry status (draft/submitted/approved), or something else? c) Does Monthly Inputs replace the existing Adjustments screen and loan/arrears entry, or sit above them? d) Does a changed input need a second person (maker-checker) or only audit? e) Who enters vs approves? f) What happens to inputs when the month is re-run or unlocked? g) Is "not entered yet" per employee or per component?

**Loss-of-pay reversal**
7. a) Who initiates (payroll, HR, a manager?) and who approves? b) Is it an *attendance* correction (HR, turns LOP days back into present, no money) followed by a *money* catch-up (payroll), or one combined action? c) The 6-month look-back: measured from the date of the reversal, or from the pay month being corrected? d) Paid via which run — next run as an arrear, or off-cycle? e) PF/ESI/TDS on the reversed amount? f) What if the cycle is locked/finalised? g) Does it need a reason and a document?

**Hold Salary**
8b. a) Who may hold and release (owners? payroll?) given HR has no payroll function? b) Whole net pay, or chosen components? c) Per run or standing until released? d) Maker-checker? e) Does the employee see a payslip, a notice, or nothing? f) Are PF/ESI/TDS still deducted and deposited for a held month? g) Release path: next run, or off-cycle only? h) Reason categories (absconding, pending clearance, query)?

**Raise a query**
5b. What the employee sees (a ticket in the existing helpdesk under Payroll & Salary, pre-linked to the payslip month)? May the ticket body contain figures, or should the payslip only be *referenced* (never copied)?

**Check in / Check out**
10. a) Who may use it — everyone, or only people with approved WFH for that day? b) Is it one check-in and one check-out per day, or multiple? c) Is it a punch (feeds the attendance engine like a device swipe) or a separate record that an HR person confirms? How does that sit with the self-marking guard? d) Source tag, and how it is shown on the muster/swipe log? e) Can it be edited or regularised, by whom? f) Time only — confirm no location, IP or photo is recorded, and what to do about someone checking in while at the office? g) Which people are device-captured vs manual-capture today? h) Where does it appear — dashboard card, mobile bar, both?

**Process**
11. Should I merge `origin/main`'s `a1b558a` (docs/design PNGs) into this branch, and should `main` be fast-forwarded to `60132e0` (CI green) now or after this scope settles?
12. May I amend PHASE_7.md only after you approve this document, with the per-feature plans (S-3, S-5, S-6) following as separate documents?
