# Lateness rule — report (branch `feat/lateness-rule`)

Plan and checklist: `docs/plans/LATE_CHECKLIST.md`. Branched from `feat/hr-payroll-separation` at `9350060` (clean tree). Pushed to `feat/lateness-rule` only; no PR.

## Commits

| Commit | What |
|---|---|
| `ca27e3f` | Backend module (`backend/src/modules/lateness/`), the `late_waivers` migration, the one attendance hook, Ready rows, route inventory, tests, mutation script, the plan |
| `ce0add6` | Screens: Late Arrivals (employee and manager), Lateness Waivers (HR), Lateness Rule (directors, with penalties) and menu entries |
| `2e6ae80` | Keyboard walk fix: the waiver reason box takes focus when the drawer opens |
| (this commit) | Ops guide section, this report, checklist ticked |

## The hook point (the only attendance-side change)

`backend/src/modules/attendance/compute.ts`, three added/changed lines, all marked `// LATE`; the engine (`attendance/engine/*`) is untouched:

- line 19: `import { loadAttendanceDayHook } from "../lateness/dayHook";`
- line 201: `const dayHook = await loadAttendanceDayHook(employees.map((e) => e.id), from, last, { dryRun: !!opts.dryRun });`
- line 289: `const r = dayHook ? dayHook(emp.id, input, evaluateDay) : evaluateDay(input);` (was `const r = evaluateDay(input);`)

The loader returns `null` unless a month in the range has the rule switched on, or a missing-punch or half-day choice confirmed. Then compute calls the engine exactly as before.

## How it works (decisions)

1. **Settings** live in the existing two-director store (`behaviour_proposals` / `behaviour_confirmations`, keys `late.rule`, `late.missingPunch`, `late.halfDay`). The database already refuses a proposer confirming their own proposal. I added no new settings table and did not touch `behaviours/service.ts`, which Session A edits.
2. **Effective dating:** each value starts on the 1st of a month, and a month uses the version in force on its 1st. A proposal, or a confirmation, is refused for a month that overlaps a finalised attendance period. Locked days are never written by compute anyway. A confirmation asks for open days from the start date up to today to be worked out again.
3. **Arrival** = the day's first-in in Asia/Kolkata, to the minute (10:09:59 counts as 10:09). Each cutoff has its own edge setting. These are **not** arrivals: a closed day with a single punch (the engine's own rule: a lone punch may be the out), holidays, week-offs, leave days, a first-half leave, and a shift that starts at or after the first cutoff (so a night or afternoon shift is never "late" by a morning clock time). **The shift rule is my decision → owner-review row.**
4. **Allowances** are counted per employee, per calendar month, per band, in date order. With "after N free", arrivals 1 to N use an allowance and get a late mark only; from N+1 the band's outcome applies. "Every time" never uses an allowance. "Not set" behaves as no consequence.
5. **Salary cut → the existing loss-of-pay path.** The hook adds `max(0, cut − the day's own hours LOP)` to `daily_attendance.lop_days`, so the day loses the higher of the two, never both. Payroll already reads loss of pay only from locked days, so the cut reaches the run, the payslip, PF NCP days and the reports without any payroll change.
6. **Penalty → the existing deductions path.** A director posts it from the Lateness Rule screen, with a preview and a fingerprint. It becomes one PENDING `payroll_adjustments` row per arrival: a DEDUCTION on the directors' chosen deduction head, source `MANUAL`, `source_ref` `late:<employee>:<date>:<amount>`, reason "Lateness penalty: arrived 10:35 on … (after 10:30)". The next run reads it like any other deduction. A director never posts their own; the other director does. When a waiver or a correction means a penalty is no longer due, its pending line is cancelled on the next posting. A line a final run has paid is left alone (correction path).
7. **Higher-of for a penalty** (rupees): on a day that also loses pay for short hours, that loss is valued from the month's **calculated** run with the same arithmetic as a loss-of-pay reversal (prorating earning heads × days ÷ the run's divisor, each head to the paisa). The line charged is `max(0, penalty − value)`, so the day costs the higher of the two. Posting is refused until such a day can be valued. **Why not take the hours loss of pay off instead:** attendance loss of pay is visible to HR, so changing it on the basis of a rupee comparison would let HR infer pay. The comparison therefore happens only on the director-only screen. **→ owner-review row.**
8. **Missing punch:** ABSENT_FULL_DAY (the default, today's behaviour), HALF_DAY (0.5 day; a day with only one working half stays absent for that half), or PRESENT_FLAGGED (no loss of pay; the MISSING_PUNCH flag stays so it is regularised). **Half-day thresholds:** full-day minutes, half-day minutes, and the loss of pay when the half-day minimum is not met. When chosen, they replace every attendance policy's own figures (the engine input is overridden in the hook; Attendance Settings is not changed). Both screens show "Default in use: …" until chosen.
9. **Waivers:** only the employee's current reporting manager can ask, never for themselves. HR decides, meaning a holder of `attendance.override.manage` (Manual Override): in the seed that is HR_ADMIN; HR_EXECUTIVE does not hold it and gets 403. The decider can never be the requester or the employee. This is checked in the service and in the database (`late_waivers_not_own`). A decided waiver never changes (trigger). There is at most one open or approved waiver per day (partial unique index). Approval recomputes the rest of the month at once. Requests notify HR; decisions notify the manager and the employee. Every step is audited.
10. **Within-month renumbering:** when an earlier day's arrival changes (a regularization, a late punch), the hook asks for the later days of that month to be recomputed, never a finalised day. The nightly run and Process Attendance catch anything else.
11. **Peeps nudge catalogue:** not on this branch, and nothing was added to it. No attendance or performance tag anywhere.

## Tests

| What | Result |
|---|---|
| `lateness/__tests__/evaluate.test.ts` (pure goldens) | 30/30. Boundaries 10:09/10:10/10:19/10:20/10:29/10:30/10:31; exclusive edges; per-cutoff edges; seconds dropped; 3rd vs 4th arrival; a waiver returning the allowance; every outcome (Not set, none, late mark, salary cut, penalty) in every band; higher-of for cut and for penalty; arrival rules; missing punch and half-day thresholds |
| `lateness/__tests__/lateness.test.ts` (database, real engine) | 22/22. **Golden OFF:** with nothing confirmed the hook is not loaded; a confirmed-but-off rule with every band a 1-day cut, and an ON rule with every band "no consequence" or "late mark", leave `daily_attendance` byte-for-byte identical (snapshot compare, `changed: 0`). ON: every boundary through the engine, the higher-of on a half day and on half-day-minimum-not-met, the month change resetting the counter, missing punch and half-day choices with effective dating. Settings maker-checker (service and database). Finalised month refused. Who sees what: employee, manager, other manager, HR_ADMIN, HR_EXECUTIVE (403), Developer (403 on all 12 routes), no amounts for managers or HR. Waiver flow with self-approval refused (service and database); a finalised day refused. Penalty posting: idempotent, labelled, cancelled by a waiver, own pay refused. Ready rows |
| `lateness/__tests__/latenessPayroll.test.ts` (payroll end to end) | 2/2. The cut reaches the run's loss of pay (item LOP 1 = 0.5 cut + 0.5 short hours); penalty lines ₹1,000 and ₹219.36 (₹1,000 − ₹780.64 already lost that day: hand-checked 322.58 + 161.29 + 296.77); the penalty never touches loss of pay |
| Mutation checks (`backend/scripts/late-mutation-check.sh`) | **8/8 killed:** allowance off by one; edge flipped; penalty added instead of higher-of; salary cut added instead of higher-of; waiver not returning the allowance; module active while off; "no consequence" deducting; a penalty line and a salary cut on one arrival. Files restored (checked by the script) |
| Existing goldens (OFF regression) | The whole backend suite, including the engine, payroll golden run and full-month rehearsal tests, run once at the end: see "Full suite" below |
| Migrations on a fresh database | A new local PostgreSQL 16: all 117 migrations applied, `db:drift` reports no difference. The test run also drops, recreates and migrates its database every time |
| Frontend | `npm run lint` (ESLint and token check) OK; `npm run typecheck` OK; vitest 135/135; build OK; `check:bundle`: login 232.3 KB (budget 250), shell + employee home 348.1 KB, shell + admin home 367.8 KB (budget 400) |
| Cleanup | Each lateness test file purges the `late.*` proposals it made, removes the period locks it created (and checks at the start that no Sep–Nov 2026 lock exists), locks attendance row by row (no period lock in the payroll test), and removes its employees with their attendance, waivers and adjustments, plus the payroll rows its users made |

### Full suite

Run once, alone, at the end (local, Node 22, PostgreSQL 16, Redis 7): **268 files, 2,356 tests: 2,355 passed, 1 failed** (1,150 s). The one failure is `src/lib/__tests__/dbRoles.test.ts` ("a new password takes effect while the old one stops working"). It happened because my scratch PostgreSQL was created with `trust` authentication, which accepts any password. After switching localhost to `scram-sha-256`, that file passed 10/10. It has nothing to do with this branch, and CI (password authentication) passes it. Every existing golden (engine, attendance replay, payroll golden run, full-month rehearsal) passed with the module present and off.

### Browser walk (local dev servers, seeded demo data, Playwright Chromium)

Personas: employee 1006, manager 1002, HR Admin 1001, director 1000, and Developer (the Developer role given to 1027 in my local database only; the seed has no Developer account). Each was walked at desktop 1440 light and at 390 dark (phone emulation).

- No horizontal scroll on any page. The only console errors were the login page's expected 401 (session probe before sign-in) and, for the Developer, the 403s the API returns.
- **Employee:** the rule this month, allowances left ("0 of 3"), and each arrival with its consequence in words. **Manager:** "Mine / My team"; no rupee figure on the team view. **HR:** waiver queue with no pay figure; the Lateness Rule page shows "This is not switched on for you". **Director:** the three settings ("Default in use" for missing punch and half day), a pending proposal with Confirm for the other director, the penalty law banner, and penalties to payroll. **Developer:** every API call 403; the pages show the forbidden state.
- **Keyboard only** (manager at 390 dark, then HR at desktop light): Tab reaches every action with a visible focus ring, and buttons are 44 px tall on the phone. The Mine/My team switch is a radio group: Tab into it, then use the arrow keys. Enter opens the waiver drawer, Esc closes it, and focus returns to the button. The reason box now takes focus on open (fixed in `2e6ae80`). Ask was sent, and HR then waived it with Enter (database: APPROVED).

## CI

CI run 430 (https://github.com/Rashi-Bhojwani/Wellsure_HR_Portal/actions/runs/44247778409) on `ece5dbb`, which contains every code commit (code identical to `2e6ae80`; only docs followed). I read it once, to the end of each job: **all 12 jobs succeeded**. They are install-lint-typecheck-test (lint, typecheck, design tokens and bundle budgets, migrate, schema matches migrations, seed, frontend and agent tests, demo company tests), backend-tests shards 1–4, backend-tests-complete (each test exactly once), attendance-replay, latency, docker-build, sensitive-ui (employee portal), sensitive-ui (admin portal) and agent-windows.

## Not verified

- No real biometric device or real month of data; the walk used seeded demo staff and synthetic punches.
- The within-month follow-up recompute (decision 10) goes through the recompute job queue. The tests call compute directly and do not run the worker.
- The Developer's employee-portal menu still lists "Late Arrivals" (the page shows the forbidden state). Other self-service pages (Work From Home, Overtime) behave the same way.
- The payroll end-to-end test uses a calculated run, not a published payslip PDF. The deduction line is checked on the run's stored lines.
- A director proposing a setting in a month that has a *finalised payroll run* but an *unlocked* attendance period. Payroll reads only locked days, so this cannot arise through the screens, but I did not test it.

## Files where we may meet at merge (Session A works on leave day counting and payroll settings)

| File | My change | Risk |
|---|---|---|
| `backend/src/modules/payroll/setup/status.ts` | one added line before `const sections` (lateness Ready rows, via dynamic import) | Session A edits Ready rows here: likely adjacent, trivial |
| `backend/prisma/schema.prisma` | `lateWaivers` relation on `Employee` after the M block, and the `LateWaiver` model at the end, both inside `LATE-BEGIN` / `LATE-END` | trivial if both append at the end |
| `backend/src/modules/attendance/compute.ts` | the three hook lines | only if Session A's leave day counting changes compute |
| `backend/src/app.ts` | import and mount `/api/lateness` | trivial |
| `backend/src/modules/managers/__tests__/routeInventory.ts` | 12 entries before the LV-23 block | trivial |
| `frontend/src/routes/employeeMenu.config.tsx`, `adminMenu.config.tsx` | lazy imports and menu entries in Attendance | trivial |
| `docs/ops/DAILY_AND_MONTHLY_GUIDE.md` | appended section at the end | trivial |

I did not touch the access resolver (`lib/permissions.ts`, read-only calls only), the HR switch framework, CI files, payroll rule files (`payroll/rules/*`, `run/rules.ts`, `shared/constants/payrollRules.ts`), `behaviours/service.ts` or any leave file. `payroll/salary/lopReversal.ts` (its `reversalAmounts`) and `payroll/money.ts` are imported, not edited.

## Owner-review rows

1. **Penalty and the law.** Fines deducted from wages are regulated by law (the Payment of Wages Act, 1936, and its replacement, the Code on Wages, 2019). The directors should confirm the penalty option is allowed for their case before using it. The portal does not give legal advice. (This is shown on Ready for First Run and on the Lateness Rule screen.)
2. **Lateness band 10:10 to 10:20: owner to decide.** It is Not set and behaves as no consequence. Non-blocking row on Ready for First Run.
3. **Edge of each cutoff.** The proposed starting value is "inclusive" (10:10 itself is late). Please confirm or change it.
4. **Which shifts the rule applies to.** I chose: only shifts that start before the first cutoff. Please confirm.
5. **Penalty against short hours.** The day costs the higher of the two: the penalty line is reduced by the value of that day's short-hours loss of pay, rather than that loss of pay being removed. Please confirm.
6. **Lone punch.** A closed day with a single punch is never a late arrival (it may be the out punch). The missing-punch outcome applies to it instead.
7. **Who decides waivers.** HR = holders of Manual Override (`attendance.override.manage`): HR Admin today, not HR Executive.
8. **Missing punch and half-day thresholds.** Today's behaviour is the default ("Default in use"). Once chosen, the half-day thresholds replace every attendance policy's own figures.
