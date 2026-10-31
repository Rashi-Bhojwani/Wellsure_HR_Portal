# Decisions the build made for the owners to confirm

Nothing here changes by itself. Each row is something the developer decided because the specification did not say, with what it does today and what changing it would involve. The owners confirm or overrule each; until then it stands as built. (Stage 3, listed at the owners' request on the Stage 3 review.)

| # | Decision | What it does today | If you want it the other way |
|---|---|---|---|
| 1 | A department or person **override is judged on the last day of the payroll cycle** | An override that applies on the cycle's last day applies to the whole run; one starting the day after does not apply to that run. A mid-cycle start therefore applies to the whole cycle. | Judge by the first day, or split a run's figures at the start date (a larger change to the calculation). |
| 2 | **Counters and salary-master values are not built as selectable names** (days in month, workdays, LOP days; full basic, annual CTC...) | A salary structure is worked out once from CTC, where a day count has no meaning; the loss-of-pay reversal reads the run's own day record. Nothing in the product consumes a counter. | Say which calculation should read a counter (for example a head worked out per day) and it will be built for that. |
| 3 | **"Takes its value from Monthly Inputs" is a flag on the head**, not a calculation method | The Stage 4 grid builds one column for each head so flagged. Such a head can never be a salary-structure line (it is not worked out from CTC). | Make it a method of a structure line instead (a head could then be both fixed and input). |
| 4 | **Releasing a hold after the month's run is final pays the held net pay as one line** | The held month's PF, ESI, PT and other deductions stay in that month's run; the release pays what was held, nothing more is taken from it. Before the run is final a release just lifts the hold. | Recalculate deductions at release (needs your rule on which month the contributions belong to). |
| 5 | **A loss-of-pay correction is entered by a director** (month, person, reference, the days), not raised automatically from an attendance correction | There is no attendance "correction" event to hook yet, so the director records it; the month + person + reference makes it post once. | Build the automatic link when attendance corrections are given a reference (an attendance-engine change). |

## Stage 4 (Monthly Inputs): what the build decided, and what is still open

| # | Decision | What it does today | If you want it the other way |
|---|---|---|---|
| 6 | **"Override From / Override Till" are read as an inclusive range of payroll months** (the months that contain those two dates); the figures apply to each month in the range. **Unconfirmed by the owners.** | A row from 15 Jul to 20 Aug writes the same figures for July and for August. The screen and the file preview both say so. | Tell us the real meaning (for example "a single effective month"); it is one function (`monthsOf`). |
| 7 | **Principal Part and Interest Part are read and shown but posted to no month.** | They belong to loans, which is a later stage; the preview says "not posted". | Say where they should go when loans are built. |
| 8 | **A figure is zero or more**, never negative. The pay head says whether it is paid or taken off. | A negative figure in a file or on the screen is refused with a message. | Say if a correction may be negative; the head's direction would then not decide alone. |
| 9 | **A confirmation may be requested while some figures are still blank**; the run, not the confirmation, insists that every figure is entered (even as 0). | The preview warns how many are blank. | Say if confirming should wait until nothing is blank. |
| 10 | **A month is "open" only when attendance is final for everyone employed in it.** One person with a day not finalised keeps the whole month closed. | The screen says attendance is not finalised. | Say if a month may open for the people whose attendance is final. |
| 11 | **A zero figure prints no line** on the payslip: it counts as entered, and pays or takes nothing. | No empty "Incentive 0" line. | Say if zero lines should print. |
| 12 | **An import file holds at most 1,000 rows and a row at most 12 months.** | A larger file is refused with a message. | Say the real size. |

**Still open (never guessed):** what *Slab Salary Bonus*, *Training Exp* and *Old Month Discrepancy* mean. They are not built in: they exist only if a director creates a pay head with that name and flags it, and a file column of that name with figures is refused until then.

## Stage 5a (remote attendance): what the build decided

The owner's earlier D-10 list was not available to this session; these are the choices made where the instruction was silent.

| # | Decision | What it does today | If you want it the other way |
|---|---|---|---|
| 13 | **Absent and Loss of pay are the same outcome for attendance and payroll** (one day of loss of pay, through the engine's absent day); the record keeps which the director chose. | Both appear as Absent in the month view with a note saying which; payroll reads one loss-of-pay day either way. | Say what Loss of pay should do differently (for example a leave-without-pay entry in the leave ledger). |
| 14 | **A half day names its half** (first or second); nothing is preselected. | The other half is absent: half a day of loss of pay. | Say if the half should come from the check-in and check-out times instead. |
| 15 | **Bulk approve is full days only.** | A half day is decided one at a time. | Say if bulk approve should allow a half day. |
| 16 | **Check-in works only on the day itself**; a forgotten check-out is fixed by a correction request that a director accepts. | A past day cannot be checked into. | Say if a person may check out the next morning. |
| 17 | **Directors' routes use the existing Super-Admin-only permission `attendance.unlock`** plus a director check, instead of a new permission key. | HR, managers and the Developer role are refused; a Super Admin could in theory grant the key to a role, and the director check in the service still refuses anyone who is not a director. | A dedicated key (`attendance.remote.decide`) can be added with its catalogue entry and migration. |
| 18 | **The reminder threshold is whole hours (1 to 200) and Not set; the suggested rejection outcome is Not set.** | With no threshold nothing is sent; with none suggested nothing is suggested. | Say the real threshold and whether a suggestion is wanted. |

## Closing the gaps (remote attendance, the full list)

| # | Decision | What it does today | If you want it the other way |
|---|---|---|---|
| 19 | **A decision's reason is in the audit row** (who, when, outcome, reason), and a reopening keeps the replaced decision as well as the new state. | Only people who hold the audit-view key can read it; HR holds none. | Say if a reason should be kept out of the audit trail and only in the record. |
| 20 | **One review per remote day, and only after a rejection or a half day.** A full day cannot be reviewed. | A second request is refused with "one is allowed". | Say if a person may ask again after a reopening. |
| 21 | **A missed remote day may be recorded after the fact** on any past day the person was marked remote, with no limit on how far back; the day's attendance must not be finalised when a director decides it. | The request waits for a director like any correction. | Say how far back a person may ask. |
| 22 | **Every decision and reopening tells the other director(s)** with the outcome only (no reason); the person who decided is not told. | One notification each. | Say if the reason should be included. |

