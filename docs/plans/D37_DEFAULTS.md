# D-37: three behaviours with a common default — written 2026-11-11 before the code

The owners allowed exactly three exceptions to "no preset values" (D-37). Each is a **behaviour**, not a money value or a statutory rate. Each:

- has a common default, shown everywhere as **"Default, change in settings"**;
- shows as an **informational (non-blocking) row** on the Ready for first real run list;
- is changed only by a director proposing a new value with a reason, **confirmed by a different director** (never the proposer; the database refuses it);
  proposals and confirmations are append-only (UPDATE and DELETE refused), each audited.

Store: `behaviour_setting_proposals` (key, value, reason, proposed by) and `behaviour_setting_confirmations` (one per proposal, by someone else). In force = the
latest confirmed proposal for the key; none = the default. Screen: System Settings → Default behaviours (directors only). HR, managers, employees and the
Developer role are refused the routes.

| Key | Options | Default |
|---|---|---|
| `loan.shortfall` | per loan type: `STOP_RUN` (the run cannot be submitted), `SKIP_AND_CARRY` (the instalment is not recovered this month and stays owed), `PARTIAL_AND_CARRY` (recover what net pay allows, carry the rest) | `SKIP_AND_CARRY`, with a warning naming the loan |
| `leave.leavingMonthAccrual` | `NONE`, `FULL_MONTH`, `PRO_RATA_DAYS_WORKED` (the policy's own rounding), `FULL_IF_MIN_DAYS` with N days (N has no default: Not set until chosen) | `PRO_RATA_DAYS_WORKED` |
| `access.developerSeesSwipes` | on / off | off: the Developer role does not see Employee Swipes |

## Item 4 detail: the loan instalment and net pay

Net pay is **never below zero** because of a loan instalment. In a run, after every other line, each loan instalment due is checked against the net pay left:
- enough → recovered in full;
- not enough → the type's rule: `STOP_RUN` adds a BLOCKING exception naming the loan; `SKIP_AND_CARRY` recovers nothing (the instalment stays PENDING for the next run)
  and adds a WARNING naming the loan; `PARTIAL_AND_CARRY` recovers what is left (never more) and carries the rest as a new pending instalment for the next month.

**Max total deduction percentage** (`loan.maxTotalDeductionPercent` in the same behaviour store — not a payroll rule, so the first-run rule checks are unaffected —
owner-entered with a source note, confirmed by a different director, **Not set**, and no D-37 default). When set, loan instalments are limited so that total deductions do not exceed that percentage of gross earnings; the shortfall rule then applies to what does
not fit. Not set → no percentage cap (the zero floor still applies). It is listed on the Ready screen's informational block, never blocking.

## Item 5 detail: leave accrual in the month of leaving

Applies to the month containing the last working day of a separation, through the leaver recalculation (Workforce → Leavers). The monthly job has usually
credited that month in full on the 1st; the recalculation brings it to the target with a correction entry (`LEAVING_MONTH`: a reversal of the excess, or a grant of
the shortfall), never editing the original row. Days worked = calendar days from the 1st (or the date of joining) to the last working day.
`PRO_RATA_DAYS_WORKED` = monthly accrual × days worked ÷ days in month, rounded by the policy's own accrual rounding. **Found while building:** the leave
policy has no rounding of its own, so a Not-set setting `leave.proRataRounding` (mode and 0–2 decimals, confirmed by a different director) is added: an exact result
(for example 1 × 15/30 = 0.5) is applied without it; a result that needs rounding is shown as waiting for that setting and nothing is changed for the month. `FULL_IF_MIN_DAYS` can only be proposed with an N
(no default N is offered). Zero days worked accrues nothing under every option except `FULL_MONTH`.

## Tests

Per option and the zero floor (item 4), per option including zero days worked (item 5), Developer-403 by default and allowed after the switch (item 6); a proposer
cannot confirm; the database refuses a self-confirmation and any UPDATE/DELETE; mutation checks for each.
