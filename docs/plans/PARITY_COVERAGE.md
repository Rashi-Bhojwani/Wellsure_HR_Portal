# Parity coverage: what a greytHR-style HR and payroll system does, against this portal

Read-only audit, written 2026-11-11 on branch `docs/parity-audit`, cut from `feat/hr-payroll-separation` at `64d3246`. No code was changed.
Public repository: no real data and no real person's name appear here. `docs/samples/` was not opened (it is not on this branch).

This is the file that `MASTER_CHECKLIST.md` names for Stage 6 and Stage 9 ("Tier 1 MISSING items of `PARITY_COVERAGE.md`"). It lists **functions**,
never the other product's screens, wording or artwork. It covers what a company of 150 to 500 people expects from an HR and payroll system,
and records, for each function, whether this portal has it.

## How to read it

* **Status.** **Built** = a real route or screen **and** at least one test that exercises it. **Partial** = some of it exists (often the API
  without a screen, data without an output, or a manual step where the system is expected to work it out). **Missing** = no route, screen or
  test found; the Evidence column says where I looked. **Not needed** = an owner decision (or the spec's own recorded decision) says we do not
  build it; the Notes column names that decision.
* **Tier.** 1 = needed for go-live of attendance and leave, or before payroll leaves its parallel run with greytHR. 2 = expected by a
  company of this size; needed for full parity. 3 = useful, not expected. Not-needed rows have no tier.
* **Evidence.** `be/` = `backend/src/modules/`, `fe/` = `frontend/src/pages/`. "test x/y" = `backend/src/modules/x/__tests__/y.test.ts`
  (frontend tests are named with `.tsx`). Routes are shown with their `/api/...` mount where it is known. `D-n` = row n of
  `DECISIONS_FOR_OWNERS.md` (the same numbers as `OWNER_REVIEW_SHEET.md`). "Decision a" to "decision f" = `HR_PAYROLL_SEPARATION.md` §1,
  the shared decision log.
* **Size** (work list only): small = a day or two, a route or a screen; medium = several routes and a screen, or a schema change; large =
  a new module or a format that must be matched to an official file.

## Method

1. Read `PROJECT_SPEC.md`, `UI_REFERENCE.md`, `UI_SCREEN_MAP.md`, `MASTER_CHECKLIST.md`, `STAGE_REPORTS.md`, `PORTAL_READY_REPORT.md`,
   `DECISIONS_FOR_OWNERS.md`, `OWNER_REVIEW_SHEET.md`, and the earlier function audits `GREYTHR_PARITY_EMPLOYEE_ADMIN.md` (A-9) and
   `GREYTHR_PARITY_WORKFORCE.md` (A-10), plus `HR_PAYROLL_SEPARATION.md` §1 (decisions a to f).
2. Listed every route (`backend/src/modules/**/routes.ts`, 588 route definitions), every menu entry with a real page
   (`frontend/src/routes/adminMenu.config.tsx`, `employeeMenu.config.tsx`; only **Assets Management** and **Feedback** fall back to the
   placeholder page) and every test file per module.
3. For each function, searched the code (routes, services, screens, `schema.prisma`, tests) by name and by keyword. Where nothing was
   found, the row is Missing and the Evidence column names what was searched.

**Limits.** Correctness was not re-tested here: a Built row means the function exists and a test covers it, not that every edge was
checked again. The `peeps/foundation` branch was not read: functions the earlier audits say are planned there (assets, recruitment,
exits, leave extension, the leave privacy rule) are recorded as Missing **on this branch**, with a note. The items A-1, A-4, A-6, A-7 and
A-8 are undefined in every plan file, so they are one row (AD) and are not guessed. Stage 6 asks for report "layouts in this file": no
layout is defined here, because the layouts would have to come from the owners or from `docs/samples/`, which this audit did not open.

## (a) Summary

**297 rows.** Built 199, Partial 19, Missing 65, Not needed 14.
Tier 1 rows that are Missing or Partial: 19 (Missing 7, Partial 12).

| Area | Built | Partial | Missing | Not needed | Total |
|---|---:|---:|---:|---:|---:|
| Employee records (ER) | 22 | 1 | 6 | 0 | 29 |
| Attendance (AT) | 36 | 1 | 3 | 4 | 44 |
| Leave (LV) | 16 | 3 | 3 | 1 | 23 |
| Payroll (PY) | 29 | 4 | 7 | 4 | 44 |
| Statutory (ST) | 9 | 6 | 14 | 2 | 31 |
| Loans and claims (LC) | 10 | 2 | 4 | 0 | 16 |
| Letters (LT) | 7 | 0 | 2 | 0 | 9 |
| Onboarding and exit (OE) | 5 | 0 | 6 | 0 | 11 |
| Reports (RP) | 9 | 1 | 5 | 0 | 15 |
| Roles and approvals (RA) | 12 | 0 | 0 | 1 | 13 |
| Notifications (NT) | 7 | 0 | 4 | 0 | 11 |
| Audit (AU) | 7 | 0 | 1 | 0 | 8 |
| Mobile and PWA (MP) | 3 | 0 | 1 | 0 | 4 |
| Imports and exports (IE) | 9 | 0 | 4 | 0 | 13 |
| Self-service (SS) | 12 | 1 | 2 | 0 | 15 |
| Admin tools (AD) | 6 | 0 | 3 | 2 | 11 |
| **All** | **199** | **19** | **65** | **14** | **297** |

## (b) Full table

### Employee records

| ID | Feature | Status | Tier | Evidence | Notes |
|---|---|---|---|---|---|
| ER-01 | Employee master record (official and personal details) | Built | 1 | be/employee/routes.ts `POST /api/employees`, `GET /api/employees/:id`; fe/admin/employee profile; tests employee/create, profileAndReveal | — |
| ER-02 | Add Employee with invitation to sign in | Built | 1 | `POST /api/employees`, `POST /api/employees/invitations/send`; Employee → Add Employee; tests employee/create, invitations, e2eOnboarding | — |
| ER-03 | All Employees grid: search, filters, column chooser, saved views, export (audited) | Built | 1 | be/employee/grid.ts `GET /api/employees`, `/export`, `/saved-views`; be/parity/gridColumns.ts; Employee → All Employees; tests employee/export, parity/segments | — |
| ER-04 | Saved filters and segments (shared filters resolve in the viewer's own scope) | Built | 2 | be/parity/segments.ts `/api/employee-segments`; Employee → Filters & Segments; test parity/segments | — |
| ER-05 | Profile tabs (Official, Personal, Statutory, Bank, Documents, History, Access, Position, Pay for directors) | Built | 1 | fe/admin/employee profile; be/parity/pay.ts, position.ts; tests employee/profileAndReveal, parity/position | — |
| ER-06 | Effective-dated job history (department, designation, location, grade, cost centre, manager) | Built | 1 | `PATCH /api/employees/:id/job`, `/:id/history/job`; tests employee/effectiveDatedUpdates, scheduledChanges | — |
| ER-07 | Position history cards per attribute with reason | Built | 2 | be/parity/position.ts `/api/employee-extras/:id/position`; Position tab; test parity/position | — |
| ER-08 | Name change history (past documents keep the old name) | Built | 2 | `PATCH /api/employees/:id/name`, `/:id/history/name`; test employee/effectiveDatedUpdates | — |
| ER-09 | Bank account: encrypted, masked, effective-dated, audited reveal | Built | 1 | `PATCH /api/employees/:id/bank`, `/:id/bank/reveal`, `/:id/history/bank`; tests lib/fieldEncryption, employee/profileAndReveal | — |
| ER-10 | Statutory IDs (PAN, Aadhaar, UAN, ESI): encrypted, masked, audited reveal | Built | 1 | `PATCH /api/employees/:id/statutory`, `/:id/statutory/reveal`; test employee/profileAndReveal | Stored as one row per person with no history (see next row). |
| ER-11 | Statutory ID history (effective-dated, like bank) | **Missing** | 2 | `EmployeeStatutory` in backend/prisma/schema.prisma:609 is one mutable row; no history route in be/employee/routes.ts | Payroll reads the current row; a past month cannot show the ID in force then. |
| ER-12 | HR's bank and statutory changes wait for a director's confirmation (decision b) | **Missing** | 1 | be/employee/service.ts:677 `updateBank` writes at once; `EmployeeBankAccount` (schema.prisma:636) has no pending state; STAGE_REPORTS.md:43 says not built | See Mismatch M1. The payroll setup sign-off (`payroll/setup/signoffs.ts`, area BANK_ACCOUNTS) checks the whole set before a run, which limits the risk. |
| ER-13 | Contact numbers masked with audited reveal | Built | 2 | be/parity/contact.ts `/api/employee-extras/:id/contact`; test parity/segments | — |
| ER-14 | Photo upload, single and in bulk (file name = employee code) | Built | 3 | `PUT /api/employees/:id/photo` (be/people/photos.ts); be/parity/bulk.ts `/api/employee-extras/bulk/photos`; Employee → Bulk Upload; tests people/photos, parity/bulk | — |
| ER-15 | Employee documents: categories, sensitivity, archive, audited download | Built | 1 | be/documents/routes.ts `/employees/:employeeId`, `/employee-documents/:id/*`; tests documents/employeeDocuments, sensitivity, permissions | — |
| ER-16 | Bulk document upload | Built | 2 | be/parity/bulk.ts `/bulk/documents`; Employee → Bulk Upload; test parity/bulk | — |
| ER-17 | Company documents and policies (publish, archive, download log) | Built | 2 | be/documents/routes.ts `/company*`; Employee → Company Documents; test documents/companyDocuments | — |
| ER-18 | Policy acknowledgement by employees | **Missing** | 3 | no acknowledge route in be/documents/routes.ts; listed "NOT SHOWN YET" in GREYTHR_PARITY_EMPLOYEE_ADMIN.md §I | Not shown to the owners yet. |
| ER-19 | Profile change requests (employee asks, HR approves) | Built | 1 | `POST/GET /api/employees/change-requests`, be/employee/changeRequests.ts; test employee/changeRequestsAndSeparations | — |
| ER-20 | Future-dated (scheduled) changes | Built | 2 | be/employee/scheduledChanges.ts; test employee/scheduledChanges | — |
| ER-21 | Directory (People) and org chart | Built | 2 | be/people/routes.ts `/api/people`, `/org-chart`; fe/employee/people (PeoplePage, OrgChart); tests people/directory, fieldPolicy | — |
| ER-22 | Global search (pages, actions, employees, favourites star) | Built | 2 | frontend/src/layouts/shell/CommandPalette.tsx; test paletteCategory.test.ts | — |
| ER-23 | Emergency contact and addresses | Built | 2 | captured on create and import (be/employee/validators.ts, be/import/rowValidators.ts); tests employee/create, parity/segments | No update importer (see Imports). |
| ER-24 | Employee code and device user ID mapping | Built | 1 | be/employee/deviceCode.ts `GET /api/employees/device-code-check`; test lib/deviceMappingWriter | Default pre-fill rule is open (spec §14). |
| ER-25 | Disable / enable portal access | Built | 2 | `POST /api/access/employees/:id/portal-access`; test parity/accountAndSeparation | — |
| ER-26 | Probation tracking and confirmation due list | **Partial** | 2 | employment type only (be/employee/grid.ts); confirmation letter starter `STARTER_CONFIRMATION` (shared/constants/letterStarters.ts); no due list, reminder or confirm action | Probation length per company is an owner value. |
| ER-27 | Divisions | **Missing** | 3 | no division master (GREYTHR_PARITY_EMPLOYEE_ADMIN.md open question; be/parity/position.ts has none) | Open question to owners: does the company use divisions? |
| ER-28 | Custom fields on the employee record | **Missing** | 3 | no custom-field model or route (searched schema.prisma, be/employee, be/parity) | — |
| ER-29 | Assets issued to employees | **Missing** | 3 | admin menu `assets` has no element (PlaceholderPage, Phase 8) in frontend/src/routes/adminMenu.config.tsx | Planned on peeps/foundation (GREYTHR_PARITY_WORKFORCE.md); not on this branch. |

### Attendance

| ID | Feature | Status | Tier | Evidence | Notes |
|---|---|---|---|---|---|
| AT-01 | Biometric punches through the LAN sync agent | Built | 1 | be/biometric/routes.ts `POST /api/biometric/punches`, `/heartbeat`; tests biometric/ingestion, agentDevices | Real device not connected yet (spec §14). |
| AT-02 | Device push route (ADMS) | Built | 2 | be/biometric/admsRoutes.ts `/iclock/cdata`; test biometric/attlog | — |
| AT-03 | Devices and agents: registry, heartbeat, incidents, alerts | Built | 1 | `/api/biometric/devices`, `/agents`, `/incidents`, health/*; Admin Tools → Devices; tests biometric/health, healthMessages | — |
| AT-04 | Unmapped punches mapped to an employee | Built | 1 | `/api/biometric/unmapped`, `/unmapped/map`; test biometric/ingestion | — |
| AT-05 | Flagged punches review and bulk accept | Built | 2 | `/api/biometric/flagged*`; test biometric/flaggedBulk | — |
| AT-06 | Historical punch import | Built | 2 | `/api/biometric/import/preview`, `/import/:id/commit`; test biometric/attlog | — |
| AT-07 | On-demand device re-sync for a date range | Built | 2 | be/workforce `/sync-requests`; Admin Tools → Device Sync Requests; test workforce/swipesSync | — |
| AT-08 | A punch reaches the screen within seconds (Socket.IO rooms) | Built | 1 | backend/src/realtime/socket.ts, emit.ts; tests realtime/socket, workerEmitter | — |
| AT-09 | Who Is In? live board | Built | 1 | `GET /api/attendance/who-is-in`; Workforce → Who Is In?; test attendance/attendanceInfo | — |
| AT-10 | Shift master (timings, grace, night shifts) | Built | 1 | `/api/attendance/config/shifts`; Admin Tools → Shift Master; tests attendance/config, engine | — |
| AT-11 | Week-off patterns | Built | 1 | `/api/attendance/config/week-off-patterns`; test attendance/config | — |
| AT-12 | Attendance scheme assignment, effective-dated, in bulk | Built | 1 | `/api/attendance/config/assignments*`; Attendance Settings; test attendance/config | — |
| AT-13 | Shift roster planner with rotation | Built | 2 | `/api/attendance/roster/preview`, `/roster`; Shift Roster; tests attendance/roster, rotation | — |
| AT-14 | Roster month grid and export | Built | 2 | be/workforce `/roster/grid`, `/roster/grid/export`; test workforce/rosterGrid | A TEAM-scope viewer not verified (PORTAL_READY_REPORT §3). |
| AT-15 | Shift override for dates | Built | 2 | `/api/attendance/shift-overrides*`; Shift Override; test attendance/shiftOverride | — |
| AT-16 | Rules engine in spec order; night shift belongs to its start date | Built | 1 | be/attendance/compute.ts, engine/engine.ts; tests attendance/compute, engine, golden, month500.replay | — |
| AT-17 | Late in, early out, shortfall, excess per day | Built | 1 | be/attendance/engine/engine.ts `computeFigures`; test attendance/engine | — |
| AT-18 | Late-mark penalty rules (for example N late marks = half-day loss of pay) | **Missing** | 2 | engine computes lateness only (engine.ts:58); no penalty rule in schema or settings | Policy is the owners'. |
| AT-19 | Overtime: rules, approval and paid overtime | **Missing** | 2 | only the Excess hours report; shared/constants/reports.ts:40 says "overtime is not defined yet" | Needs the owners' overtime policy, then a pay head link. |
| AT-20 | Regularization: employee request, manager decision | Built | 1 | `/api/attendance/me/regularizations`, `/regularizations/:id/approve`; test attendance/regularization | — |
| AT-21 | Regularization in bulk | Built | 2 | `/api/attendance/regularizations/bulk`; test attendance/regularizationBulk | — |
| AT-22 | Regularization rules module (A-5) | **Missing** | 2 | MASTER_CHECKLIST.md: A-5 "UNDEFINED in detail" | Owners to define A-5. |
| AT-23 | Correction window setting | Built | 2 | be/settings `/api/settings/regularization`; test settings/settings | — |
| AT-24 | Manual override with reason and allowed statuses | Built | 1 | `/api/attendance/overrides*`; Manual Override; tests attendance/manualOverride, workforce/musterAndSettings | — |
| AT-25 | Status catalogue with director-set labels | Built | 2 | be/workforce `/statuses`, `/settings/:key`; test workforce/musterAndSettings | — |
| AT-26 | Attendance muster grid, totals and export | Built | 1 | `/api/attendance/muster`, `/muster/export`; Attendance Muster; tests attendance/manual, workforce/musterAndSettings | — |
| AT-27 | Manual attendance entry and upload (branches without a device) | Built | 2 | `/api/attendance/muster/entries`, `/muster/upload`; test attendance/manual | — |
| AT-28 | Attendance Info (calendar and day detail) for self and others | Built | 1 | `/api/attendance/me/month`, `/employees/:id/month`; test attendance/attendanceInfo | — |
| AT-29 | Process attendance for a range (background job) | Built | 1 | `/api/attendance/process`; Process Attendance; test attendance/jobs | — |
| AT-30 | Period finalisation lock and unlock | Built | 1 | `/api/attendance/finalisation*`; tests attendance/finalisation, periodFinalisation | — |
| AT-31 | Configurable attendance cycle (for example 26th to 25th) | Built | 1 | `/api/attendance/config/cycle`; test lib/attendanceCycle | — |
| AT-32 | Attendance activity locks by date range and segment | Built | 2 | be/workforce `/locks`; Admin Tools → Attendance Locks; test workforce/locks | Only leave apply exercised over a route (PORTAL_READY_REPORT §3). |
| AT-33 | Exceptions list and bulk resolve | Built | 1 | `/api/attendance/exceptions*`; Attendance Exception; test attendance/exceptions | — |
| AT-34 | Swipes viewer: filters, export, shift column, reject and reinstate | Built | 1 | `/api/attendance/swipes*`, be/workforce `/swipes/decide`; tests attendance/swipes, workforce/swipesSync | — |
| AT-35 | Remote check-in/out with director decisions, and its report | Built | 1 | `/api/attendance/me/remote/*`, `/remote/*`, `/remote/report`; Mark Attendance, Remote Attendance; tests attendance/remoteAttendance, remoteRules | Reminder threshold Not set (D-18). |
| AT-36 | Work-from-home eligibility and approval policy | **Partial** | 2 | leave policy has `wfhMonthlyLimit`, `wfhYearlyLimit` (schema.prisma LeavePolicy); remote marks by directors (`/remote/marks`) | MASTER_CHECKLIST "WAITING ON": WFH eligibility and approval. |
| AT-37 | Holiday calendar and restricted holidays | Built | 1 | be/leave `/holidays`, `/restricted-holidays`; Admin Tools → Holiday Calendars; test leave/adminCatalog | — |
| AT-38 | Holidays limited to some locations | Built | 2 | be/workforce `/holidays/:id/locations`; test workforce/calendar | D-52. |
| AT-39 | Weekend overrides for chosen people | Built | 2 | be/workforce `/weekend-overrides`; Calendar Adjustments; test workforce/calendar | D-53: leave counting not affected. |
| AT-40 | Paid days and loss of pay feed payroll; no money in attendance | Built | 1 | be/payroll/run/days.ts; tests payroll/runIntegrations, attendance/noMoney | — |
| AT-41 | Automatic loss-of-pay reversal from an attendance correction | Not needed | — | `/api/payroll/lop-corrections` (director enters it) | D-5: a director types the correction; stands until the owners overrule. |
| AT-42 | GPS or map location on remote attendance and swipes | Not needed | — | — | Owner answer in GREYTHR_PARITY_WORKFORCE.md: no GPS, device identifiers or map links. |
| AT-43 | IP-address restricted attendance | Not needed | — | — | Owner answer (GREYTHR_PARITY_WORKFORCE.md item 12: NOT WANTED). |
| AT-44 | Shift rotation calendar view | Not needed | — | — | Owner answer (GREYTHR_PARITY_WORKFORCE.md item 6: NOT WANTED); the roster planner's rotation stays. |

### Leave

| ID | Feature | Status | Tier | Evidence | Notes |
|---|---|---|---|---|---|
| LV-01 | Leave types and policies | Built | 1 | be/leave `/types`, `/types/:id/policy`; Admin Tools → Leave Types & Policies; test leave/adminCatalog | — |
| LV-02 | Append-only ledger; balance = sum of entries | Built | 1 | be/leave/ledger.ts, `/balances`, `/ledger`; test leave/ledgerBalance | — |
| LV-03 | Monthly accrual with eligibility from joining | Built | 1 | be/leave/accrual.ts `computeEligibilityDate`; test leave/accrual | PL eligibility boundary is configurable; the value is open (spec §14). |
| LV-04 | Apply leave (full day, half day) | Built | 1 | `POST /api/leave/requests`; Leave Apply; tests leave/requests.integration, halfDay | — |
| LV-05 | Approve, reject, bulk approve | Built | 1 | `/api/leave/requests/:id/approve`, `/bulk-approve`; test leave/requests.integration | — |
| LV-06 | Cancel leave | Built | 1 | `POST /api/leave/requests/:id/cancel`; test leave/requests.integration | — |
| LV-07 | Leave with no team approver goes to HR | Built | 1 | be/leave/noTeamApprover.ts; test leave/noTeamApprover | — |
| LV-08 | Leave type reviewers (extra decider) | Built | 2 | be/workforce `/leave-reviewers`; Admin Tools → Leave Reviewers; test workforce/calendar | D-54. |
| LV-09 | Negative balance allowed per type | Built | 2 | LeavePolicy `negativeBalanceAllowed`; test leave/negativeBalance | — |
| LV-10 | Comp-off grant, expiry and use | Built | 2 | `/api/leave/comp-off*`; test leave/compOff | — |
| LV-11 | Restricted holiday quota | Built | 2 | LeavePolicy `rhYearlyQuota`, `/api/leave/restricted-holidays`; tests leave/adminCatalog, dashboard | — |
| LV-12 | Manual leave grants | Built | 1 | `POST /api/leave/grants`; Leave Granter; test leave/adminGrants | — |
| LV-13 | Year-end: carry forward, encashment, reset | Built | 1 | `/api/leave/year-end*`; Year End Process; tests leave/yearEnd, yearEndMoney | Directors only (`leave.yearend.manage` HR-locked). |
| LV-14 | Encashment formula (per-day rate) | **Partial** | 1 | be/leave/encashmentRate.ts flat setting; be/payroll/run/providers.ts:53 `SalaryBasedEncashmentRateProvider` | Formula and tax treatment open (spec §14). |
| LV-15 | Leave recalculator | Built | 2 | `/api/leave/recalculate/*`; test leave/recalculator | — |
| LV-16 | Leavers: leave recalculated to the leaving date; leaving-month rule | Built | 1 | be/workforce `/leavers`; be/leave/leavingMonth.ts; tests workforce/leavers, leave/leavingMonth | D-37 default 2 (pro-rata); rounding Not set (D-73). |
| LV-17 | Team leave calendar and leave overview dashboard | Built | 2 | `GET /api/leave/calendar`, `GET /api/leave/dashboard`; Leave Calendar; tests workforce/calendar, managers/managerReach, leave/dashboard | — |
| LV-18 | Supporting document on a leave request | **Partial** | 2 | `LeaveRequest.attachmentStorageKey` (schema.prisma:1019), be/leave/validators.ts; no "required after N days" rule | Leave extension planned on peeps/foundation. |
| LV-19 | Policy limits: maximum consecutive days, minimum notice, document after N days | **Missing** | 2 | LeavePolicy fields (schema.prisma) have none of these | — |
| LV-20 | Sandwich rule (week-offs between leave days counted) | **Missing** | 2 | no code (only an unrelated poll test matches) | Policy is the owners'. |
| LV-21 | Privacy rule for sensitive leave types | **Partial** | 2 | shared/leave/display.ts `displayLeaveForViewer` hook (D-59), nothing hidden | Planned on peeps/foundation. |
| LV-22 | Leave counting follows each person's own week-offs | Not needed | — | — | D-53: weekend overrides change attendance only; stands until the owners overrule. |
| LV-23 | Employee-requested encashment during the year | **Missing** | 3 | no route in be/leave/routes.ts | — |

### Payroll

| ID | Feature | Status | Tier | Evidence | Notes |
|---|---|---|---|---|---|
| PY-01 | Pay heads (earning or deduction, taxable, PF/ESI flags) | Built | 1 | `/api/payroll/components*`; Payroll → Salary Components; tests payroll/payHeadOptions, payHeadStructure | — |
| PY-02 | Salary structures with formulas | Built | 1 | `/api/payroll/structures*`; Salary Structures; tests payroll/formula, breakup | — |
| PY-03 | Employee salary (CTC and breakup) | Built | 1 | `/api/payroll/salary/employees*`; Employee Salaries; test payroll/salary | — |
| PY-04 | Salary revisions, effective-dated, second director decides | Built | 1 | `/api/payroll/salary/revisions*`; Salary Revisions; tests payroll/revisionAuthority, salaryTimeline, salaryCancel | — |
| PY-05 | Arrears on back-dated revisions | Built | 1 | be/payroll/salary/arrears.ts; test payroll/arrears | — |
| PY-06 | One-off adjustments | Built | 1 | `/api/payroll/adjustments*`; Adjustments; test payroll/runCalculation | — |
| PY-07 | Monthly inputs grid, import, second-director confirmation | Built | 1 | `/api/payroll/monthly-inputs*`; Monthly Inputs; tests payroll/monthlyInputs, monthlyInputsImport, monthlyInputsRules, inputHeadChoices | D-6 (Override From/Till) unconfirmed. |
| PY-08 | Rules, statutory parameters and overrides (all Not set) | Built | 1 | `/api/payroll/rules*`, `/rule-overrides*`; Rules and Setup, Rule Overrides; tests payroll/rules, ruleHierarchy, salaryRules32 | — |
| PY-09 | Setup checklist and Ready for First Run | Built | 1 | `/api/payroll/setup*`; Setup Checklist, Ready for First Run; test payroll/setupChecklist | — |
| PY-10 | Payroll run: create, calculate, items, void | Built | 1 | `/api/payroll/runs*`; Payroll Run; tests payroll/runCalculation, runPure, payrollProperties | — |
| PY-11 | Approvals on run, finalise, publish, bank file, unlock (maker never checker) | Built | 1 | `/api/payroll/runs/:id/approvals/*`; tests payroll/runAuthority, approvals, selfConfirmLayers, runClosing | — |
| PY-12 | Director authority switches (second director per step) | Built | 1 | be/director/routes.ts `/api/director/switches`; tests payroll/directorAuthority, directorChoices; DirectorAuthorityCard.test.tsx | — |
| PY-13 | Variance against last month | Built | 1 | `GET /api/payroll/runs/:id/variance`; test payroll/runCalculation | — |
| PY-14 | Loss-of-pay correction entered by a director | Built | 1 | `/api/payroll/lop-corrections`; test payroll/lopReversal | D-5. |
| PY-15 | Hold salary and release | Built | 1 | `/api/payroll/holds*`; Held Salaries; tests payroll/salaryHolds, heldPeople | D-4. |
| PY-16 | Not on payroll (two directors) | Built | 2 | `/api/payroll/exclusions*`; Not on Payroll; test payroll/payrollExclusions | D-30, D-31. |
| PY-17 | Payslip: PDF, amount in words, "Why?" explanation | Built | 1 | be/payroll/run/payslip.ts, `/api/payroll/payslips/:id/pdf`, `/why`; tests payroll/inWords, releases; PayslipWhy.test.tsx | — |
| PY-18 | Publish payslips with notification | Built | 1 | `POST /api/payroll/runs/:id/payslips/publish`; test payroll/releases | — |
| PY-19 | Payslip email with time-limited link | Built | 2 | be/payroll/run/payslipLinks.ts; Payslip Links; test payroll/payslipLinks | Lifetime Not set (D-27): no link until set. |
| PY-20 | Password-protected payslip PDF | Not needed | — | be/payroll/run/payslipLinks.ts:70 refuses to enable it | D-28: off until the owners approve. |
| PY-21 | Year to date on the payslip | Built | 2 | be/payroll/run/ytd.ts; tests payroll/releases, taxOpenings | D-62. |
| PY-22 | Raise a query on a payslip | Built | 2 | `POST /api/payslips/mine/:id/query`; test payroll/payslipQuery | D-29. |
| PY-23 | Payslip layout set by the company | **Missing** | 2 | Stage 8.2 unticked in MASTER_CHECKLIST.md | Needs the owners' payslip sample. |
| PY-24 | Reimbursement payslip / statement per run | **Missing** | 3 | P7-5 "not built: per-run statement layout" (MASTER_CHECKLIST.md) | — |
| PY-25 | Off-cycle runs (settlements, held pay) | Built | 1 | be/payroll/offcycle/routes.ts; Off-cycle runs; test payroll/offCycle | — |
| PY-26 | Full and final settlement | Built | 1 | be/payroll/settlements/routes.ts; Settlements; test payroll/settlements | Automatic lines: held pay, adjustments, loan owed, leave days. |
| PY-27 | Gratuity calculation | **Missing** | 1 | typed as a manual settlement line (fe/admin/payroll/SettlementsPage.tsx:76); no calculation in be/payroll | Needs the owners' rule and source. |
| PY-28 | Notice pay or notice recovery | **Partial** | 1 | manual settlement line only (SettlementsPage.tsx:76) | No notice-period data exists (see Exit). |
| PY-29 | Leave encashment in the settlement | **Partial** | 1 | days only (be/payroll/settlements/service.ts:49) | Amount waits for the encashment formula (spec §14). |
| PY-30 | Statutory bonus calculation | **Missing** | 2 | no calculation; a director can only create a bonus pay head | — |
| PY-31 | Compare our register with greytHR's (parallel run) | Built | 1 | `POST /api/payroll/compare`; Compare Registers; test payroll/compare | — |
| PY-32 | Parallel-run kit and statement reader (Stage 8.1, 8.4) | **Partial** | 1 | compare tool only; Stage 8 blocked: docs/samples not on this branch (MASTER_CHECKLIST.md) | Needs the samples on this branch. |
| PY-33 | Bank transfer file from the owners' layout | Built | 1 | `POST /api/payroll/runs/:id/bank-file/generate`, `/layouts*`; Bank and Statutory Layouts; tests payroll/layout, layoutAuthorConfirm, releases | .xls question open. |
| PY-34 | Bank file "sent" note, manual rejections, repayment file | Built | 1 | `/api/payroll/bank-batches/:id/sent`, `/rejections`, `/repayment-plans*`; test payroll/bankRepayment | D-26, D-32. |
| PY-35 | Bank response file import | Not needed | — | layout keys in be/payroll/run/validators.ts:30 have no return template | D-33, D-34: bank payments are manual. |
| PY-36 | Masked TEST bank file from a test run | Not needed | — | — | D-23. |
| PY-37 | Bank summary PDF (spec §7.5) | **Missing** | 2 | no generator in be/payroll/run/bank.ts, bankBatches.ts | — |
| PY-38 | Payment modes (NEFT, RTGS, cheque, cash) as a list | Not needed | — | — | D-24: a constant column typed in the bank layout until the bank's codes are known. |
| PY-39 | Payroll audit trail | Built | 1 | `GET /api/payroll/audit`; Payroll Audit Trail; tests payroll/access, access/developerCeiling | — |
| PY-40 | Demo company rehearsal | Built | 1 | test payroll/demoCompany.demo | D-36. |
| PY-41 | Accounting journal export | **Missing** | 2 | no code (searched journal, ledger export, accounting) | Needs the owners' chart of accounts. |
| PY-42 | Payroll cost by cost centre or department | **Missing** | 2 | cost centre is a label only (GREYTHR_PARITY_EMPLOYEE_ADMIN.md §C) | Part of Stage 6 reports. |
| PY-43 | Employer PF and ESI contributions inside CTC | **Partial** | 1 | statutory rules exist (be/payroll/run/statutory.ts); treatment listed "WAITING ON" in MASTER_CHECKLIST.md | — |
| PY-44 | Maximum share of gross that deductions may take | Built | 2 | behaviour store, Not set (D-72); test payroll/loanShortfall | — |

### Statutory

| ID | Feature | Status | Tier | Evidence | Notes |
|---|---|---|---|---|---|
| ST-01 | PF calculation from owner-entered rates | Built | 1 | be/payroll/run/statutory.ts; tests payroll/ruleHierarchy, runCalculation | Rates Not set until entered. |
| ST-02 | PF ECR file | **Partial** | 1 | output `PF_ECR` (be/payroll/run/outputs.ts:23) from an owner-typed layout; test payroll/layout | Official format not verified ("WAITING ON"). |
| ST-03 | PF challan record | **Missing** | 2 | only TDS challans exist (be/payroll/tax/routes.ts `/challans`) | — |
| ST-04 | ESI calculation with contribution period rule | Built | 1 | rules `ESI`, `ESI_PERIOD_RULE`, `ESI_ROUNDING`; test payroll/runCalculation | — |
| ST-05 | ESI upload file | **Partial** | 1 | output `ESI` (outputs.ts:61); test payroll/layout | Official format not verified. |
| ST-06 | ESI challan record | **Missing** | 2 | none (as PF challan) | — |
| ST-07 | Professional tax by state slabs | **Partial** | 1 | rule `PT`, output `PT` (outputs.ts:70) | Applicability per state open (spec §14). |
| ST-08 | PT returns and challans | **Missing** | 2 | none | — |
| ST-09 | Labour welfare fund | **Partial** | 2 | rule and output `LWF` (outputs.ts:23) | Applicability open (spec §14). |
| ST-10 | Tax year (slabs, rebate, cess, sections) entered by directors | Built | 1 | `/api/payroll/tax/years*`; Tax Years; test payroll/taxEngine | D-38, D-46. |
| ST-11 | TDS projection, both regimes side by side | Built | 1 | be/payroll/tax/engine.ts, projection.ts; tests payroll/taxEngine; RegimeCompare.test.tsx | D-41, D-44. |
| ST-12 | IT declaration windows and declarations | Built | 1 | `/api/payroll/tax/windows`, `/me/declaration`; Tax Declarations, IT Declaration; test payroll/taxDeclarations | — |
| ST-13 | Proof of investment with director verification | Built | 1 | `/api/payroll/tax/me/proofs`, `/proofs/:id/decision`; test payroll/taxDeclarations | D-42, D-43. |
| ST-14 | Opening figures (pay and tax before this system) | Built | 1 | `/api/payroll/tax/openings*`; Opening Figures; test payroll/taxOpenings | D-60, D-61. |
| ST-15 | HRA exemption | **Missing** | 1 | "HRA, LTA and perquisites" not built (DECISIONS_FOR_OWNERS.md, Stage 7 note) | — |
| ST-16 | LTA exemption | **Missing** | 2 | as above | — |
| ST-17 | Perquisites, including cheap loans | **Missing** | 2 | as above; D-67 | — |
| ST-18 | Marginal relief | **Missing** | 2 | D-45: not worked out | — |
| ST-19 | Form 12BB output | **Missing** | 3 | no generator (searched 12BB) | — |
| ST-20 | TDS challans and reconciliation | Built | 1 | `/api/payroll/tax/challans*`; TDS and Form 16; test payroll/form16 | — |
| ST-21 | Quarterly TDS return data | **Partial** | 1 | `GET /api/payroll/tax/quarterly`; Quarterly TDS data; test payroll/form16 | Not in the official return format (P7-7). |
| ST-22 | Quarterly return file in the official format | **Missing** | 2 | not built (MASTER_CHECKLIST.md P7-7) | Needs the official format. |
| ST-23 | Form 16 Part B data (draft until confirmed) | **Partial** | 1 | be/payroll/tax/form16.ts, `/form16*`; test payroll/form16 | DRAFT only. |
| ST-24 | Form 16 PDF for employees | **Missing** | 1 | not built (MASTER_CHECKLIST.md P7-7) | — |
| ST-25 | Form 16 Part A pairing | **Missing** | 2 | not built (MASTER_CHECKLIST.md P7-7) | — |
| ST-26 | Refund of over-deducted TDS in a run | Not needed | — | — | D-44. |
| ST-27 | One-off pay spread over the months left | Not needed | — | — | D-40: taxed in the month paid; stands until the owners overrule. |
| ST-28 | Statutory registers (wages, deductions, fines) | **Missing** | 2 | none (searched register names) | Which registers apply is the owners'. |
| ST-29 | Minimum wages check | **Missing** | 3 | none | — |
| ST-30 | Compliance due-date reminders | **Missing** | 3 | none | — |
| ST-31 | Employer registration numbers (PF, ESI, TAN) sealed | Built | 1 | be/payroll/sealed.ts; test payroll/sealedIdentifiers | — |

### Loans and claims

| ID | Feature | Status | Tier | Evidence | Notes |
|---|---|---|---|---|---|
| LC-01 | Loan types (limits, rate, pay heads) | Built | 1 | `/api/loans/types`; Loan and claim types; test payroll/loans | D-74. |
| LC-02 | Employee asks for a loan or advance | Built | 1 | `/api/loans/mine`; Loans and Advances; test payroll/loans | An advance is a loan type. |
| LC-03 | Two-director sanction, never one's own | Built | 1 | `/api/loans/:id/sanction*`; test payroll/loans | D-64. |
| LC-04 | Instalment schedule (reducing balance) | Built | 1 | be/payroll/loans/schedule.ts; test payroll/loans | D-65. |
| LC-05 | Pay out and recover through payroll runs | Built | 1 | be/payroll/run/gather.ts; tests payroll/loans, runIntegrations | — |
| LC-06 | Shortfall rule per loan type | Built | 1 | be/payroll/run/loanShortfall.ts; test payroll/loanShortfall | D-37 default 1. |
| LC-07 | Loan changes (stop remaining instalments, reschedule) on a screen | **Partial** | 2 | `POST /api/loans/:id/changes` and decision exist; no screen (MASTER_CHECKLIST.md P7-4) | — |
| LC-08 | Loan statement for the employee | Built | 2 | `/api/loans/mine/:id`; Loans and Advances; test payroll/loans | — |
| LC-09 | Loan recovery in full and final | **Partial** | 1 | code path in be/payroll/settlements/service.ts (`LOAN_OWED`); not exercised by a test (PORTAL_READY_REPORT §3) | — |
| LC-10 | Claim types (who may claim, bills, caps) | Built | 1 | `/api/reimbursements/types`; Loan and claim types; test payroll/reimbursements | — |
| LC-11 | Employee claims with bills | Built | 1 | `/api/reimbursements/mine`; Reimbursement; test payroll/reimbursements | — |
| LC-12 | Director decision on claims, paid through payroll | Built | 1 | `/api/reimbursements/:id/decision`; test payroll/reimbursements | — |
| LC-13 | Manager step before the director on a claim | **Missing** | 2 | P7-5 "not built: manager step" (MASTER_CHECKLIST.md) | — |
| LC-14 | Claims in the Tasks inbox | **Missing** | 2 | P7-5 "not built: Tasks inbox source" | — |
| LC-15 | Travel advance and expense settlement | **Missing** | 3 | none | — |
| LC-16 | Flexible benefit plan | **Missing** | 3 | none | — |

### Letters

| ID | Feature | Status | Tier | Evidence | Notes |
|---|---|---|---|---|---|
| LT-01 | Templates with versions, letterhead and serial | Built | 1 | be/letters `/templates*`, `/letterhead`, `/serial`; Email & Letter Templates, Letter Settings; tests letters/letters, template | — |
| LT-02 | Starter templates loaded by a director | Built | 2 | `POST /api/letters/starters/:code/load`; shared/constants/letterStarters.ts; test letters/letters | — |
| LT-03 | Letter requests: batch, signatories, issue, void, reissue | Built | 1 | be/letters/workflow.ts `/requests*`, `/:id/reissue`; Employee → Letters; test letters/letterWorkflow | — |
| LT-04 | Per-template issue grants | Built | 2 | `/api/letters/grants`; test letters/letterWorkflow | — |
| LT-05 | HR can issue only letters proven free of pay figures | Built | 1 | be/letters/template.ts pay-free proof; test letters/payFreeProof | — |
| LT-06 | Offer and revision letters with salary figures | Built | 2 | letter figure fields from the salary (A-3); test letters/letterPayFigures | D-63. |
| LT-07 | Issued letter filed in the employee's documents | Built | 2 | be/letters/service.ts → documents; test documents/employeeDocuments | — |
| LT-08 | Employee asks for a letter (for example address proof) | **Missing** | 3 | letters routes only for issuers (be/letters/routes.ts:79-80) | — |
| LT-09 | Electronic signature | **Missing** | 3 | none | — |

### Onboarding and exit

| ID | Feature | Status | Tier | Evidence | Notes |
|---|---|---|---|---|---|
| OE-01 | Invitation, first sign-in, privacy notice | Built | 1 | be/auth `/invitations/:token`, `/privacy-notice/accept`; tests auth/invitation, totpAndPrivacy, employee/e2eOnboarding | — |
| OE-02 | Joining post on the feed | Built | 3 | be/engage/autoPosts.ts; test engage/joiningEvent | — |
| OE-03 | Candidate pre-joining portal and offer acceptance | **Missing** | 3 | none on this branch | Recruitment planned on peeps/foundation. |
| OE-04 | Onboarding checklist and tasks | **Missing** | 2 | none (searched onboarding) | — |
| OE-05 | Separation with mode and last working day | Built | 1 | be/employee/separations.ts, be/parity/separationModes.ts; Separations; tests employee/changeRequestsAndSeparations, parity/accountAndSeparation | Modes Not set. |
| OE-06 | Access ends after the last working day | Built | 1 | `processScheduledSeparations` (be/employee/separations.ts:101); test employee/changeRequestsAndSeparations | — |
| OE-07 | Employee submits a resignation | **Missing** | 2 | separations are started by HR only (`employee.separate`) | Exits planned on peeps/foundation. |
| OE-08 | Exit clearance checklist (spec §7.2) | **Missing** | 2 | no checklist in be/employee/separations.ts | Exits planned on peeps/foundation. |
| OE-09 | Notice period tracking | **Missing** | 2 | none (searched notice period) | Needed for notice pay in settlements. |
| OE-10 | Exit interview | **Missing** | 3 | none | — |
| OE-11 | Relieving and experience letters | Built | 2 | starters `STARTER_RELIEVING`, `STARTER_EXPERIENCE`; test letters/letters | — |

### Reports

| ID | Feature | Status | Tier | Evidence | Notes |
|---|---|---|---|---|---|
| RP-01 | Headcount, joiners, leavers and attrition, birthdays and anniversaries | Built | 1 | `/api/reports/headcount`, `/joiners`, `/leavers`, `/celebrations`; Reports → People; test reports/reports | — |
| RP-02 | Leave balance | Built | 1 | `/api/reports/leave-balance`; test reports/reports | — |
| RP-03 | Leave liability (directors) | Built | 2 | `/api/reports/leave-liability`; tests reports/reports, reportsPermissions | — |
| RP-04 | Loss of pay | Built | 1 | `/api/reports/lop`; test reports/reports | — |
| RP-05 | Attendance summary, late coming, excess hours, exceptions | Built | 1 | `/api/reports/attendance-muster`, `/late-coming`, `/excess-hours`, `/exception-summary`; Reports → Attendance; test reports/attendanceReports | Excess hours is not overtime (AT row on overtime). |
| RP-06 | Report export to Excel, audited | Built | 1 | `/api/reports/:key/export`; test reports/reportsPermissions | — |
| RP-07 | Salary register | Built | 1 | output `SALARY_REGISTER` (be/payroll/run/outputs.ts:93); test payroll/releases | A run file, not a report in the gallery. |
| RP-08 | PF, ESI and PT reports in the report gallery | **Partial** | 2 | files only (outputs.ts); no report keys in shared/constants/reports.ts | Stage 6. |
| RP-09 | Payroll summary and department cost (Stage 6) | **Missing** | 1 | Stage 6 unticked; REPORT_KEYS (shared/constants/reports.ts:18) has no payroll report | Layouts need the owners or the samples. |
| RP-10 | CTC report | **Missing** | 2 | none in REPORT_KEYS | — |
| RP-11 | Exit report (spec §7.6) | **Missing** | 3 | none in REPORT_KEYS | — |
| RP-12 | Custom report / query builder for directors | **Missing** | 2 | spec §7.6 Phase 8; Stage 6 in MASTER_CHECKLIST.md | — |
| RP-13 | Scheduled reports by email | **Missing** | 3 | none | — |
| RP-14 | Admin dashboard widgets | Built | 2 | `GET /api/admin/dashboard`; Homepage dashboard tab; test admin/dashboard | — |
| RP-15 | YTD reports for the employee | Built | 2 | `GET /api/payroll/tax/me/ytd`; YTD Reports; test payroll/taxOpenings | — |

### Roles and approvals

| ID | Feature | Status | Tier | Evidence | Notes |
|---|---|---|---|---|---|
| RA-01 | Roles and permissions editor, per-user grants and revokes | Built | 1 | be/access `/roles`, `/employees/:id/overrides/:key`; Roles & Permissions; test access/access | — |
| RA-02 | Data scope SELF / TEAM / ALL on every query | Built | 1 | backend/src/lib/dataScope.ts; tests lib/dataScope, leave/idor | — |
| RA-03 | HR capability switches (role or person, effective-dated) | Built | 1 | be/hrCapabilities `/api/hr-capabilities`; What HR Can Do; tests hrCapabilities/* | — |
| RA-04 | HR never sees pay data (hard lock) | Built | 1 | `HR_FORBIDDEN_KEYS` (shared/constants/sensitiveData.ts:185); tests access/hrHardLock, hrHardLockFourKeys | — |
| RA-05 | Developer role ceiling | Built | 1 | backend/src/lib/permissions.ts; tests access/developerCeiling, behaviours/developerSwipes | D-37 default 3. |
| RA-06 | Manager hierarchy and teams | Built | 1 | be/managers routes; Manager Management; tests managers/managers, lib/reportingHierarchy | — |
| RA-07 | Workflow delegates | Built | 2 | be/delegations; Workflow Delegates; test delegations/delegations | — |
| RA-08 | Review and Monitor queues with bulk decisions | Built | 1 | be/workforce `/workflow/*`; Workflow; test workforce/workflow | D-58. |
| RA-09 | Tasks inbox | Built | 1 | be/tasks `/api/tasks/mine`, be/admin/tasks.ts; tests tasks/inbox, admin/tasks | — |
| RA-10 | Director notices (seen, acknowledged) | Built | 2 | be/director `/notices*`; test payroll/directorAuthority | — |
| RA-11 | Default behaviours store, other director confirms a change | Built | 2 | be/behaviours; System Settings → Default behaviours; tests behaviours/developerSwipes, payroll/loanShortfall | — |
| RA-12 | Request Hub (all my requests in one place) | Built | 2 | be/requestHub `GET /api/request-hub`; Request Hub; tests tasks/inbox, attendance/attendanceInfo | — |
| RA-13 | Configurable multi-level approval chains | Not needed | — | — | Spec §7.8 (decided 2026-10-03): no general approval-chain engine. |

### Notifications

| ID | Feature | Status | Tier | Evidence | Notes |
|---|---|---|---|---|---|
| NT-01 | In-app notifications, bell, unread count | Built | 1 | be/notifications routes; test notifications/notifications | — |
| NT-02 | Email through the mail interface (console, SMTP, SES) | Built | 1 | backend/src/integrations/mail; test integrations/mail/__tests__/smtp | — |
| NT-03 | Leave, regularization, remote attendance and payslip notices | Built | 1 | types `leave.decided`, `regularization.decided`, `attendance.remote.decided`, `payslip.published`; tests leave/requests.integration, attendance/regularization, remoteAttendance, payroll/releases | — |
| NT-04 | Security alerts to the owners | Built | 1 | be/access security events; test access/securityAlerts | — |
| NT-05 | Device health alerts | Built | 1 | be/biometric/health/notify.ts; test biometric/health | — |
| NT-06 | Mass email | Built | 3 | be/parity/massEmail.ts `/api/mass-email`; Mass Email; test parity/massEmail | — |
| NT-07 | Announcements | Built | 2 | be/announcements; Engage → Announcements; test announcements/announcements | — |
| NT-08 | Editable email templates | **Missing** | 3 | the "Email & Letter Templates" page edits letters only; sign-in emails are fixed text in be/auth/emails.ts | — |
| NT-09 | Per-person notification preferences | **Missing** | 3 | none (searched preference) | — |
| NT-10 | Phone push notifications | **Missing** | 3 | frontend/public/sw.js caches the shell only; no push | — |
| NT-11 | SMS or WhatsApp | **Missing** | 3 | none | — |

### Audit

| ID | Feature | Status | Tier | Evidence | Notes |
|---|---|---|---|---|---|
| AU-01 | Append-only audit log enforced by the database | Built | 1 | be/auditLog; tests auditLog/auditLog, lib/dbRoles | — |
| AU-02 | Redaction of identifiers before write | Built | 1 | backend/src/lib/redact.ts; test lib/redact | — |
| AU-03 | Audit log viewer with filters | Built | 1 | `GET /api/audit-log`; Audit Log; test auditLog/auditLog | — |
| AU-04 | Audit log export | **Missing** | 3 | only `GET /` in be/auditLog/routes.ts | — |
| AU-05 | Every reveal of an identifier audited | Built | 1 | `/:id/bank/reveal`, `/:id/statutory/reveal`; test employee/profileAndReveal | — |
| AU-06 | Security events and acknowledgement | Built | 1 | `/api/access/security-events*`; test access/access | — |
| AU-07 | Break-glass tools (bootstrap, recover) | Built | 1 | be/access/bootstrap.ts, recovery.ts; test access/access | — |
| AU-08 | Sign-in sessions, sign out everywhere | Built | 1 | be/auth `/sessions`, `/logout-all`; test auth/session | — |

### Mobile and PWA

| ID | Feature | Status | Tier | Evidence | Notes |
|---|---|---|---|---|---|
| MP-01 | Installable app, offline app shell | Built | 2 | frontend/public/manifest.webmanifest, sw.js, components/mobile/InstallAppBanner.tsx; test routes/__tests__/mobile.test.tsx | — |
| MP-02 | Phone tab bar and phone layouts | Built | 1 | employeeMenu.config.tsx phone tabs; test mobile.test.tsx | — |
| MP-03 | Remote check-in from a phone | Built | 1 | RemoteCheckCard.tsx; RemoteCheckCard.test.tsx | — |
| MP-04 | Native store app | **Missing** | 3 | none | The PWA covers phones today. |

### Imports and exports

| ID | Feature | Status | Tier | Evidence | Notes |
|---|---|---|---|---|---|
| IE-01 | Import Center: templates, staging, row errors, single commit | Built | 1 | be/import `/api/import/:dataset/*`, `/batches*`; Data Import/Export; test import/import | — |
| IE-02 | Organisation masters import | Built | 1 | dataset `org-masters` (be/import/validators.ts:4); test import/import | — |
| IE-03 | Employee import (new and past employees) | Built | 1 | dataset `employees`; test import/import | — |
| IE-04 | Bank and statutory import | Built | 1 | datasets `bank`, `statutory`; test import/import | Directors only. |
| IE-05 | Opening leave balances and grants import | Built | 1 | dataset `leave-grants`; test import/leaveGrants | — |
| IE-06 | Reconciliation report against greytHR | Built | 1 | `GET /api/import/reconciliation`; test import/import | — |
| IE-07 | Update importer for existing employees | **Missing** | 2 | datasets are new rows only (GREYTHR_PARITY_EMPLOYEE_ADMIN.md item 14) | Part of A-2 (undefined). |
| IE-08 | HR's import rules (A-2) | **Missing** | 2 | MASTER_CHECKLIST.md: A-2 "UNDEFINED in detail" | — |
| IE-09 | Salary structure and salary assignment import (spec §10 item 7) | **Missing** | 1 | no salary dataset in be/import/validators.ts:4 | Needs a layout from the owners or the samples. |
| IE-10 | Opening tax figures import | Built | 1 | `/api/payroll/tax/openings/import/*`; test payroll/taxOpenings | — |
| IE-11 | Monthly inputs import | Built | 1 | `/api/payroll/monthly-inputs/import*`; test payroll/monthlyInputsImport | D-12: 1,000 rows. |
| IE-12 | greytHR attendance and salary file readers (Stage 8) | **Missing** | 1 | Stage 8 blocked: docs/samples not on this branch | — |
| IE-13 | Invitations sent in batches by HR | Built | 1 | `POST /api/employees/invitations/send`; test employee/invitations | — |

### Self-service

| ID | Feature | Status | Tier | Evidence | Notes |
|---|---|---|---|---|---|
| SS-01 | Home: payslip widget, holidays, review, quick access | Built | 1 | fe/employee/home; `/api/payslips/mine`, `/api/leave/holidays`; tests payroll/releases, routes.test.tsx | — |
| SS-02 | View my profile and ask for changes | Built | 1 | `GET/PATCH /api/employees/me`, `/change-requests`; test employee/changeRequestsAndSeparations | — |
| SS-03 | Payslips list and PDF | Built | 1 | `/api/payslips/mine*`; Payslips; test payroll/releases | — |
| SS-04 | IT statement | Built | 1 | `GET /api/payroll/tax/me/statement`; IT Statement; test payroll/taxDeclarations | D-48. |
| SS-05 | Form 16 download | **Partial** | 1 | `GET /api/payroll/tax/me/form16`; Form 16; test payroll/form16 | Data only, no PDF. |
| SS-06 | Salary revision history | Built | 2 | `GET /api/payroll/tax/me/salary-revisions`; Salary Revision; test payroll/taxOpenings | — |
| SS-07 | Leave balances, apply, calendar, holiday calendar | Built | 1 | be/leave routes; Leave menu; tests leave/* | — |
| SS-08 | Attendance info, regularize, remote check-in | Built | 1 | be/attendance `/me/*`; Attendance menu; tests attendance/attendanceInfo, regularization | — |
| SS-09 | Document Center (policies, my letters, payslips) | Built | 2 | `GET /api/documents/me`; Document Center; test documents/employeeDocuments | — |
| SS-10 | Helpdesk tickets with replies and attachments | Built | 2 | be/helpdesk `/tickets*`; Helpdesk; tests helpdesk/helpdesk, attachments, autoClose | Payroll category directors only (decision f). |
| SS-11 | My workflow delegates | Built | 2 | `/api/delegations/mine`; Workflow Delegates; test delegations/delegations | — |
| SS-12 | Engage feed: posts, kudos (given and received), polls, reactions, comments, groups | Built | 3 | be/engage; Engage, My Worklife → Kudos; tests engage/posts, kudos, polls, reactions, comments, groups | — |
| SS-13 | Feedback | **Missing** | 3 | employee menu `my-worklife/feedback` has no element (PlaceholderPage, Phase 8) | — |
| SS-14 | Two-step sign-in and backup codes | Built | 1 | be/auth `/2fa/*`; tests auth/totpAndPrivacy, totpTolerance | Go-live condition for directors. |
| SS-15 | Download my own data (DPDP) | **Missing** | 2 | no route (searched data export, DPDP); spec §9 | — |

### Admin tools

| ID | Feature | Status | Tier | Evidence | Notes |
|---|---|---|---|---|---|
| AD-01 | Organisation setup: cities, branches, departments, designations, grades, cost centres | Built | 1 | be/org routes; Organisation Setup; tests org/org, scopedContent | — |
| AD-02 | Helpdesk categories (sensitive, directors-only) | Built | 2 | `/api/helpdesk/categories*`; Helpdesk Categories; test helpdesk/helpdesk | — |
| AD-03 | Engage admin: moderation, groups, auto-posts | Built | 3 | be/engage `/moderation/*`, `/groups*`, `/autopost-settings*`; tests engage/moderation, groups, autoPostSettings | — |
| AD-04 | System settings (security, leave, helpdesk, devices, regularization, excess hours) | Built | 1 | be/settings routes; System Settings; tests settings/settings, settingsNotice | — |
| AD-05 | Homepage favourites and dashboard layout | Built | 2 | be/admin `/favourites*`, `/dashboard-layout`; tests admin/favourites, layout | — |
| AD-06 | Punch simulator for development | Built | 2 | be/dev, be/attendance/__tests__/simulator; tests golden, month500.replay | — |
| AD-07 | Data retention for former employees (DPDP) | **Missing** | 2 | no retention setting in be/settings/routes.ts; spec §9 | Retention period is the owners'. |
| AD-08 | More than one company (legal entity) | **Missing** | 3 | one company plus the demo company only | Whether a second entity exists is the owners'. |
| AD-09 | Undefined items A-1, A-4, A-6, A-7, A-8 | **Missing** | — | MASTER_CHECKLIST.md: "UNDEFINED in every plan file" | Cannot be audited until the owners define them. |
| AD-10 | Vendor news feed and vendor help links | Not needed | — | — | Owner answer in GREYTHR_PARITY_EMPLOYEE_ADMIN.md §A: NOT WANTED. |
| AD-11 | Tax and payroll sign-off by an outside accountant | Not needed | — | — | STAGE_7_PLAN.md: no CA; the owners enter and verify every tax value. |

## (c) Mismatches: where what is built does not follow an owner decision

Checked: every row of `DECISIONS_FOR_OWNERS.md` (1 to 74) and decisions a to f in `HR_PAYROLL_SEPARATION.md` §1. Rows not listed here
were found to match the code (spot-checked where a single line decides it: for example D-12 `MAX_IMPORT_ROWS = 1000` in
`payroll/inputs/importParse.ts:7`, D-28 `payslipLinks.ts:70`, D-37 default 3 `lib/permissions.ts:66`, decision f's directors-only
helpdesk category `helpdesk/service.ts:50`, the "no GPS" answer in `attendance/remote`).

**Code against a decision**

| # | Decision | What the code does | Evidence | Fix | Owner decision needed |
|---|---|---|---|---|---|
| M1 | **Decision b** (and `DIRECTOR_AUTHORITY.md` item 11, §5.4): bank and statutory changes entered by HR are PENDING until a director confirms them. | An HR Admin's change writes at once; there is no pending state. Only the payroll setup sign-off (area BANK_ACCOUNTS / STATUTORY_IDS) checks the whole set before a run. `STAGE_REPORTS.md:43` already records "not built yet". | `be/employee/service.ts:677` `updateBank`, `be/employee/routes.ts:110` and `:113`; `EmployeeBankAccount` (`schema.prisma:636`) has no status | Build the pending change and the director's confirmation (plan H2). Row ER-12. | No (decided). |
| M2 | **Decision b** read with plan §3.2: HR Executive also gains masked bank and statutory view and entry. | HR Executive is refused bank and statutory data; only HR Admin holds the keys. A test pins the refusal. | `backend/src/lib/systemRoles.ts:19-24`, `:73-76`; `employee/__tests__/profileAndReveal.test.ts:127` | None until answered: `CLAUDE.md` and spec §2 say the HR Executive never sees bank data, so the documents disagree with each other. | **Yes**: should the HR Executive enter bank and statutory changes? |

**Documents against a decision (the code follows the decision; the text is stale)**

| # | Decision | Stale text | Fix |
|---|---|---|---|
| M3 | D-33, D-34: bank payments are manual; no bank response file. | `PROJECT_SPEC.md` §7.5 "marks the batch paid or imports the bank response"; `STAGE_5B_PLAN.md:22` still describes a `BANK_RETURN_TEMPLATE` layout (the code has none: `payroll/run/validators.ts:30`). | Amend both texts. |
| M4 | D-37 default 3: the Developer role does not see Employee Swipes unless a director switches it on. | `PORTAL_READY_REPORT.md` §6 item 3: "the Developer still reaches Employee Swipes". | Amend the report. |
| M5 | Decision a: HR (HR Admin too) sees no salary. | `CLAUDE.md` "Core domain rules": "only HR_ADMIN/PAYROLL_ADMIN/SUPER_ADMIN do" see salary or bank data. `HR_FORBIDDEN_KEYS` (`shared/constants/sensitiveData.ts:185`) takes every `payroll.*` key from HR. | Amend `CLAUDE.md` (and settle M2 at the same time). |
| M6 | Decision e and A-9 G3: per-template letter grants exist. | Comment above `HR_FORBIDDEN_KEYS` (`sensitiveData.ts:195-196`) and `HR_CAPABILITIES.md:17` say per-type grants are not built. | Amend the comment and the plan. |
| M7 | No CA (`STAGE_7_PLAN.md`): the owners enter and verify every tax value. | `PROJECT_SPEC.md` §7.6 and §14 still say a rate or formula waits "until the CA confirms it". | Amend the spec to say "until the owners confirm it". |

## (d) Proposed work list (every Missing and Partial row)

Grouped by the folder where most of the work lands, so two sessions can work side by side. **Session A** takes everything under
`backend/src/modules/payroll/` and `frontend/src/pages/admin/payroll/` (plus `frontend/src/pages/employee/salary/`). **Session B** takes
everything else. Rows with folder "—" wait on the owners before either session can start.

Files both sessions will touch, to be changed by one session at a time (or in a small separate commit agreed between them):
`backend/prisma/schema.prisma` and new migrations (use distinct timestamps), `shared/constants/permissions.ts`,
`shared/constants/sensitiveData.ts`, `frontend/src/routes/adminMenu.config.tsx`, `frontend/src/routes/employeeMenu.config.tsx`,
`backend/src/modules/managers/__tests__/routeInventory.ts` and `backend/src/lib/__tests__/cleanup.test.ts`.

"Owner decision: yes" means the row needs a value, a rule or a format from the owners before it is built; per the standing rules such a
value is never guessed and starts as Not set.

### Session A (payroll): 38 rows

**`backend/src/modules/leave + payroll/run`**

| ID | Feature | Status | Tier | Size | Owner decision |
|---|---|---|---|---|---|
| LV-14 | Encashment formula (per-day rate) | Partial | 1 | small | yes |

**`backend/src/modules/payroll`**

| ID | Feature | Status | Tier | Size | Owner decision |
|---|---|---|---|---|---|
| PY-30 | Statutory bonus calculation | Missing | 2 | medium | yes |
| LC-16 | Flexible benefit plan | Missing | 3 | large | yes |
| ST-30 | Compliance due-date reminders | Missing | 3 | small | yes |

**`backend/src/modules/payroll/compare`**

| ID | Feature | Status | Tier | Size | Owner decision |
|---|---|---|---|---|---|
| IE-12 | greytHR attendance and salary file readers (Stage 8) | Missing | 1 | large | yes |
| PY-32 | Parallel-run kit and statement reader (Stage 8.1, 8.4) | Partial | 1 | large | yes |

**`backend/src/modules/payroll/reimbursements`**

| ID | Feature | Status | Tier | Size | Owner decision |
|---|---|---|---|---|---|
| LC-13 | Manager step before the director on a claim | Missing | 2 | small | yes |
| LC-15 | Travel advance and expense settlement | Missing | 3 | medium | yes |
| PY-24 | Reimbursement payslip / statement per run | Missing | 3 | small | no |

**`backend/src/modules/payroll/rules`**

| ID | Feature | Status | Tier | Size | Owner decision |
|---|---|---|---|---|---|
| ST-07 | Professional tax by state slabs | Partial | 1 | small | yes |
| ST-09 | Labour welfare fund | Partial | 2 | small | yes |

**`backend/src/modules/payroll/run`**

| ID | Feature | Status | Tier | Size | Owner decision |
|---|---|---|---|---|---|
| PY-43 | Employer PF and ESI contributions inside CTC | Partial | 1 | small | yes |
| ST-02 | PF ECR file | Partial | 1 | small | yes |
| ST-05 | ESI upload file | Partial | 1 | small | yes |
| PY-23 | Payslip layout set by the company | Missing | 2 | medium | yes |
| PY-37 | Bank summary PDF (spec §7.5) | Missing | 2 | small | no |
| PY-41 | Accounting journal export | Missing | 2 | medium | yes |
| ST-29 | Minimum wages check | Missing | 3 | small | yes |

**`backend/src/modules/payroll/salary`**

| ID | Feature | Status | Tier | Size | Owner decision |
|---|---|---|---|---|---|
| IE-09 | Salary structure and salary assignment import (spec §10 item 7) | Missing | 1 | medium | yes |

**`backend/src/modules/payroll/settlements`**

| ID | Feature | Status | Tier | Size | Owner decision |
|---|---|---|---|---|---|
| LC-09 | Loan recovery in full and final | Partial | 1 | small | no |
| PY-27 | Gratuity calculation | Missing | 1 | medium | yes |
| PY-28 | Notice pay or notice recovery | Partial | 1 | medium | yes |
| PY-29 | Leave encashment in the settlement | Partial | 1 | small | yes |

**`backend/src/modules/payroll/tax`**

| ID | Feature | Status | Tier | Size | Owner decision |
|---|---|---|---|---|---|
| SS-05 | Form 16 download | Partial | 1 | medium | yes |
| ST-15 | HRA exemption | Missing | 1 | medium | yes |
| ST-21 | Quarterly TDS return data | Partial | 1 | medium | yes |
| ST-23 | Form 16 Part B data (draft until confirmed) | Partial | 1 | small | no |
| ST-24 | Form 16 PDF for employees | Missing | 1 | medium | yes |
| ST-03 | PF challan record | Missing | 2 | small | no |
| ST-06 | ESI challan record | Missing | 2 | small | no |
| ST-08 | PT returns and challans | Missing | 2 | small | yes |
| ST-16 | LTA exemption | Missing | 2 | small | yes |
| ST-17 | Perquisites, including cheap loans | Missing | 2 | medium | yes |
| ST-18 | Marginal relief | Missing | 2 | small | yes |
| ST-22 | Quarterly return file in the official format | Missing | 2 | large | yes |
| ST-25 | Form 16 Part A pairing | Missing | 2 | small | yes |
| ST-19 | Form 12BB output | Missing | 3 | small | yes |

**`frontend/src/pages/admin/payroll`**

| ID | Feature | Status | Tier | Size | Owner decision |
|---|---|---|---|---|---|
| LC-07 | Loan changes (stop remaining instalments, reschedule) on a screen | Partial | 2 | small | no |

### Session B (HR and platform): 44 rows

**`backend/prisma (cross-cutting)`**

| ID | Feature | Status | Tier | Size | Owner decision |
|---|---|---|---|---|---|
| AD-08 | More than one company (legal entity) | Missing | 3 | large | yes |

**`backend/src/integrations`**

| ID | Feature | Status | Tier | Size | Owner decision |
|---|---|---|---|---|---|
| NT-11 | SMS or WhatsApp | Missing | 3 | medium | yes |

**`backend/src/modules/attendance`**

| ID | Feature | Status | Tier | Size | Owner decision |
|---|---|---|---|---|---|
| AT-18 | Late-mark penalty rules (for example N late marks = half-day loss of pay) | Missing | 2 | medium | yes |
| AT-19 | Overtime: rules, approval and paid overtime | Missing | 2 | large | yes |

**`backend/src/modules/attendance/regularization`**

| ID | Feature | Status | Tier | Size | Owner decision |
|---|---|---|---|---|---|
| AT-22 | Regularization rules module (A-5) | Missing | 2 | medium | yes |

**`backend/src/modules/attendance/remote`**

| ID | Feature | Status | Tier | Size | Owner decision |
|---|---|---|---|---|---|
| AT-36 | Work-from-home eligibility and approval policy | Partial | 2 | medium | yes |

**`backend/src/modules/auditLog`**

| ID | Feature | Status | Tier | Size | Owner decision |
|---|---|---|---|---|---|
| AU-04 | Audit log export | Missing | 3 | small | no |

**`backend/src/modules/documents`**

| ID | Feature | Status | Tier | Size | Owner decision |
|---|---|---|---|---|---|
| ER-18 | Policy acknowledgement by employees | Missing | 3 | small | yes |

**`backend/src/modules/employee`**

| ID | Feature | Status | Tier | Size | Owner decision |
|---|---|---|---|---|---|
| ER-12 | HR's bank and statutory changes wait for a director's confirmation (decision b) | Missing | 1 | medium | no |
| ER-11 | Statutory ID history (effective-dated, like bank) | Missing | 2 | medium | no |
| ER-26 | Probation tracking and confirmation due list | Partial | 2 | medium | yes |
| OE-04 | Onboarding checklist and tasks | Missing | 2 | medium | yes |
| OE-07 | Employee submits a resignation | Missing | 2 | medium | yes |
| OE-08 | Exit clearance checklist (spec §7.2) | Missing | 2 | medium | yes |
| OE-09 | Notice period tracking | Missing | 2 | small | yes |
| SS-15 | Download my own data (DPDP) | Missing | 2 | medium | no |
| ER-28 | Custom fields on the employee record | Missing | 3 | large | yes |
| OE-10 | Exit interview | Missing | 3 | small | yes |

**`backend/src/modules/import`**

| ID | Feature | Status | Tier | Size | Owner decision |
|---|---|---|---|---|---|
| IE-07 | Update importer for existing employees | Missing | 2 | medium | yes |
| IE-08 | HR's import rules (A-2) | Missing | 2 | medium | yes |

**`backend/src/modules/leave`**

| ID | Feature | Status | Tier | Size | Owner decision |
|---|---|---|---|---|---|
| LV-18 | Supporting document on a leave request | Partial | 2 | small | yes |
| LV-19 | Policy limits: maximum consecutive days, minimum notice, document after N days | Missing | 2 | medium | yes |
| LV-20 | Sandwich rule (week-offs between leave days counted) | Missing | 2 | medium | yes |
| LV-23 | Employee-requested encashment during the year | Missing | 3 | medium | yes |

**`backend/src/modules/letters`**

| ID | Feature | Status | Tier | Size | Owner decision |
|---|---|---|---|---|---|
| LT-08 | Employee asks for a letter (for example address proof) | Missing | 3 | small | no |
| LT-09 | Electronic signature | Missing | 3 | large | yes |

**`backend/src/modules/notifications`**

| ID | Feature | Status | Tier | Size | Owner decision |
|---|---|---|---|---|---|
| NT-08 | Editable email templates | Missing | 3 | medium | no |
| NT-09 | Per-person notification preferences | Missing | 3 | small | no |

**`backend/src/modules/org`**

| ID | Feature | Status | Tier | Size | Owner decision |
|---|---|---|---|---|---|
| ER-27 | Divisions | Missing | 3 | small | yes |

**`backend/src/modules/reports`**

| ID | Feature | Status | Tier | Size | Owner decision |
|---|---|---|---|---|---|
| RP-09 | Payroll summary and department cost (Stage 6) | Missing | 1 | large | yes |
| PY-42 | Payroll cost by cost centre or department | Missing | 2 | medium | no |
| RP-08 | PF, ESI and PT reports in the report gallery | Partial | 2 | medium | no |
| RP-10 | CTC report | Missing | 2 | small | no |
| RP-12 | Custom report / query builder for directors | Missing | 2 | large | no |
| ST-28 | Statutory registers (wages, deductions, fines) | Missing | 2 | medium | yes |
| RP-11 | Exit report (spec §7.6) | Missing | 3 | small | no |
| RP-13 | Scheduled reports by email | Missing | 3 | medium | no |

**`backend/src/modules/settings`**

| ID | Feature | Status | Tier | Size | Owner decision |
|---|---|---|---|---|---|
| AD-07 | Data retention for former employees (DPDP) | Missing | 2 | medium | yes |

**`backend/src/modules/tasks`**

| ID | Feature | Status | Tier | Size | Owner decision |
|---|---|---|---|---|---|
| LC-14 | Claims in the Tasks inbox | Missing | 2 | small | no |

**`frontend/src (pwa)`**

| ID | Feature | Status | Tier | Size | Owner decision |
|---|---|---|---|---|---|
| NT-10 | Phone push notifications | Missing | 3 | medium | no |

**`frontend/src/pages/admin (new module)`**

| ID | Feature | Status | Tier | Size | Owner decision |
|---|---|---|---|---|---|
| ER-29 | Assets issued to employees | Missing | 3 | large | yes |

**`frontend/src/pages/employee/my-worklife`**

| ID | Feature | Status | Tier | Size | Owner decision |
|---|---|---|---|---|---|
| SS-13 | Feedback | Missing | 3 | medium | yes |

**`new module`**

| ID | Feature | Status | Tier | Size | Owner decision |
|---|---|---|---|---|---|
| OE-03 | Candidate pre-joining portal and offer acceptance | Missing | 3 | large | yes |

**`shared/leave + backend/src/modules/leave`**

| ID | Feature | Status | Tier | Size | Owner decision |
|---|---|---|---|---|---|
| LV-21 | Privacy rule for sensitive leave types | Partial | 2 | small | yes |

### Waiting on the owners before any session: 2 rows

**`—`**

| ID | Feature | Status | Tier | Size | Owner decision |
|---|---|---|---|---|---|
| MP-04 | Native store app | Missing | 3 | large | yes |
| AD-09 | Undefined items A-1, A-4, A-6, A-7, A-8 | Missing | — | — | yes |

## Suggested order

1. **Owners first (no code):** M2; the A-items; the encashment formula, gratuity rule and notice period (they block LV-14 and PY-27 to PY-29);
   PF, ESI, PT and LWF formats and applicability; the HRA rule; the payslip and greytHR samples on this branch (they unblock Stage 8 and
   the Stage 6 layouts).
2. **Session B, Tier 1:** ER-12 (M1, pending bank and statutory changes), then the Tier 1 import of salary structures with Session A.
3. **Session A, Tier 1:** the Form 16 PDF, gratuity, notice pay and encashment in settlements, loan recovery in a settlement under test,
   the statutory file formats once they arrive, Stage 6 reports once their layouts exist.
4. Tier 2 next, Tier 3 last. Each row is planned in `docs/plans/` before its code, as the standing rules require.
