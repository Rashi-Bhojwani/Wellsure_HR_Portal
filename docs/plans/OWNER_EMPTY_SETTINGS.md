# Owner-decided settings ship empty, no silent zero (2026-11-17)

Owner decision: the owners decide these themselves, so they ship **Not set** and are configurable. This narrows the Standard statutory defaults pack
(`STATUTORY_DEFAULTS_PLAN.md`). PF, ESI and income tax standard values, the PF ceiling dating, PY-43, the PF ECR export and the directors' acknowledgement are
unchanged. Commit `14ff0ad` (a missing salary head refuses, never 0) stays and is extended here.

## 1. What ships empty

| Setting | Before | Now |
|---|---|---|
| `payroll.gratuity` (Default behaviours) | standard: s.53 figures, head BASIC | **Not set** |
| `payroll.noticeRecovery` | standard: 30 days, BASIC / 30 | **Not set** |
| `payroll.leaveEncashment` | standard: BASIC / 30, PL at exit, head LEAVE_ENCASHMENT | **Not set** |
| `statutory.state` | RAJASTHAN | **Not set** (blank; a state from the list of states and union territories) |
| Rajasthan PT, LWF ("not levied") | in force from the pack | removed from the code |
| Rajasthan minimum wages (4 rows) | used where no director rate | removed from the code |

The researched values and their sources stay in `docs/STATUTORY_DEFAULTS.md` under **Reference values, not loaded**; the settings drawer shows the statutory reference
for gratuity as text only, never as a pre-filled value. Existing director-entered values (confirmed proposals, PT/LWF tables, minimum wage rates) are never touched: no
migration, no data change. The pack version goes from 1 to 2 so a run calculated on a removed state value is stale and is calculated again.

## 2. Configurable

- Gratuity, notice pay and leave encashment: System Settings, Default behaviours, section **Final settlement rules** (anchors `#payroll.gratuity`,
  `#payroll.noticeRecovery`, `#payroll.leaveEncashment`). Head choices list only salary heads that exist (salary components); the server refuses any other
  (`UNKNOWN_SALARY_HEAD`, from `14ff0ad`).
- State: the same page, anchor `#statutory.state`, a select that starts blank. PT and LWF tables stay the director-entered rules `PT_SLABS` / `LWF_TABLE`
  (Rules and setup); minimum wage rates, categories and compared heads stay on Payroll, Minimum Wages.
- Every change: proposed by one director, confirmed by a different one, audited (`settings.behaviour.proposed` / `.confirmed`), as before.

## 3. No silent zero

- A final settlement (prepare, and its guide screen) is refused while any of the three settlement settings is not in force on the last working day, naming each:
  "Gratuity salary head is not set. Choose it in settings." / "Notice pay salary head is not set. …" / "Leave encashment salary head is not set. …"
  (409 `SETTING_NOT_SET`). `exitGratuity`, `exitNoticeRecovery`, `exitEncashment` refuse the same way; they never return 0 and never fall back to a hidden default.
- A configured head missing from the person's salary: refused, naming the head (`SALARY_HEAD_NOT_FOUND`, from `14ff0ad`).
- In-year encashment pay: already refused while Not set (`NOT_SET`); unchanged.
- Professional tax and LWF with no director table: **no deduction**, and the run, the payslip ("Professional Tax: not set", "Labour Welfare Fund: not set") and Ready
  for First Run say so, so nobody reads it as "not levied". The run records a `NOT_SET` pin (in force, so a monthly run is **not** made a test and not blocked; stale once
  a director enters the table).
- Minimum wages with no director rate: the check says Not set (as before the pack); it never changes pay.

## 4. Ready for First Run (information rows, never blocking)

- "Final settlement rules: not set" (lists which of the three) → Default behaviours, Final settlement rules. Once all three are set: "Gratuity, notice and encashment
  salary head matches your structures" with the count of active employees that do not match.
- "Professional Tax and LWF: not set" → Default behaviours, state (and the PT/LWF tables under Rules and setup). Set once both tables are entered.
- "Minimum wages: not set" → Payroll, Minimum Wages. Set once a rate and the compared heads exist.
- `PT_SLABS` and `LWF_TABLE` themselves are not required for the first run (they never block it).

## 5. Tests

Refusal for each setting Not set; correct amounts once set with a differently named head; PT/LWF Not set gives no deduction and the label on run and payslip; mutation
checks (refusal replaced by 0; a hidden default used when Not set); golden PF/ESI/tax tests unchanged; Developer-403 and permission tests on the changed routes; browser
walk of Default behaviours and Ready for First Run as director, HR, manager, employee and Developer (desktop light, 390 dark, keyboard). Every changed test in
`CHANGED_TESTS.md`.
