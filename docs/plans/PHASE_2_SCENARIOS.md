# Phase 2 — the punch simulator's scenarios, and what the engine is held to

*Generated from the code by `npm run catalogue --prefix biometric-agent`. Do not edit by hand: a test fails if this file is stale.*

Each scenario builds an employee-day's punches (or manual entry) from seeded parameters and **declares what should happen**. The month replay (`npm run test:replay --prefix backend`, and a 40-employee version in every CI run) feeds a month of these through the real ingestion service and the real recompute path, then fails if any stored employee-day differs from its scenario's expected outcome.

**If you disagree with an outcome below, that is a finding about the rule, not a test to quiet.** The tests can only check the engine against these statements; whether the statements are right is what reading this page is for.

## The test organisation

The simulator runs a made-up organisation. Its masters are round numbers of its own, deliberately *not* HR's policy (whose grace and thresholds are HR's to confirm).

| | |
|---|---|
| **SIM-DAY** | 10:00–19:00; work 10:00–14:00 and 14:45–19:00, lunch 14:00–14:45; grace 10 min in and 10 min out (so on time means in by 10:10 and out from 18:50); punch window 4 h before the start to 6 h after the end |
| **SIM-NIGHT** | 22:00–06:00 (crosses midnight, belongs to its START date); work 22:00–02:00 and 02:30–06:00, break 02:00–02:30; same grace and window |
| **SIM-STD** | a full day needs 7 h of work, a half day 4 h; under the half-day minimum is absent with 1 day's loss; punches within 120 s count once |
| **SIM-STRICT** | a full day needs 8 h, a half day 5 h; under the half-day minimum costs 0.5 day |
| **Week-offs** | Sunday for most; Sunday and the 2nd and 4th Saturday for some |
| **Leave** | `SIMPL` (paid) and `SIMLOP` (unpaid), full days and either half |

The punch window decides which date a punch counts toward; a night shift's punches after midnight stay on the date the shift **started**.

## The scenarios

### `normal-day`

**What it does.** In up to the grace limit, out at or after the end less grace, a full day's work.

**What should happen.** Present (`P`), not late, not early, no loss of pay, no flags; hours are the span less the scheduled break.

Worked examples (SIM-DAY, SIM-STD):

- in 09:35:31 (by the 10 min grace) and out 19:21:39: a full day → **P**, loss of pay 0, no flags, work 9h 01m, 2 punches

On the night shift: in 21:35:31 (by the 10 min grace) and out 06:21:39: a full day → **P**, loss of pay 0, no flags, work 8h 16m, 2 punches

### `late-arrival`

**What it does.** In `k` minutes (and `s` seconds) after the grace limit, still a full day's work.

**What should happen.** Present, late by ⌈k + s/60⌉ minutes, flag `LATE_IN`, no loss of pay.

Worked examples (SIM-DAY, SIM-STD):

- in 38 min 0 s after the grace limit, full day: late by 38 min → **P**, loss of pay 0, flags LATE_IN, late 38 min, work 7h 40m, 2 punches

On the night shift: in 38 min 0 s after the grace limit, full day: late by 38 min → **P**, loss of pay 0, flags LATE_IN, late 38 min, work 7h 00m, 2 punches

### `early-exit`

**What it does.** Out `k` minutes (and `s` seconds) before the end less grace, still a full day's work.

**What should happen.** Present, early by ⌈k + s/60⌉ minutes, flag `EARLY_OUT`, not late, no loss of pay.

Worked examples (SIM-DAY, SIM-STD):

- out 1 min 58 s before the end less grace, still a full day: early by 2 min → **P**, loss of pay 0, flags EARLY_OUT, early 2 min, work 8h 31m, 2 punches

On the night shift: out 1 min 58 s before the end less grace, still a full day: early by 2 min → **P**, loss of pay 0, flags EARLY_OUT, early 2 min, work 7h 46m, 2 punches

### `late-and-early`

**What it does.** Both: in after the grace limit and out before the end less grace, still a full day.

**What should happen.** Present, late and early by their own minutes, flags `LATE_IN` and `EARLY_OUT`, no loss of pay.

Worked examples (SIM-DAY, SIM-STD):

- late by 16 and early by 1, still a full day → **P**, loss of pay 0, flags EARLY_OUT, LATE_IN, late 16 min, early 1 min, work 7h 38m, 2 punches

On the night shift: late by 1 and early by 2, still a full day → **P**, loss of pay 0, flags EARLY_OUT, LATE_IN, late 1 min, early 2 min, work 7h 07m, 2 punches

Not buildable under SIM-STRICT (its minimums leave no room for this case), so those employees get a normal day instead.

### `half-day-first`

**What it does.** Between the half-day and full-day minimum, having covered more of the first half.

**What should happen.** The first half present, the second absent (`P:A`), half a day's loss of pay, flag `SHORTFALL`.

Worked examples (SIM-DAY, SIM-STD):

- 352 min of work, between the half-day (240) and full-day (420) minimums, covering more of the first half → **P:A**, (first half P, second A), loss of pay 0.5, flags EARLY_OUT, SHORTFALL, early 133 min, work 5h 52m, 2 punches

On the night shift: 352 min of work, between the half-day (240) and full-day (420) minimums, covering more of the first half → **P:A**, (first half P, second A), loss of pay 0.5, flags EARLY_OUT, SHORTFALL, early 88 min, work 5h 52m, 2 punches

### `half-day-second`

**What it does.** Between the half-day and full-day minimum, having covered more of the second half (a late start).

**What should happen.** The second half present, the first absent (`A:P`), half a day's loss of pay, flag `SHORTFALL`.

Worked examples (SIM-DAY, SIM-STD):

- 352 min of work, between the half-day (240) and full-day (420) minimums, covering more of the second half → **A:P**, (first half A, second P), loss of pay 0.5, flags LATE_IN, SHORTFALL, late 123 min, work 5h 52m, 2 punches

On the night shift: 352 min of work, between the half-day (240) and full-day (420) minimums, covering more of the second half → **A:P**, (first half A, second P), loss of pay 0.5, flags LATE_IN, SHORTFALL, late 78 min, work 5h 52m, 2 punches

### `half-day-tie`

**What it does.** Between the half-day and full-day minimum, having covered exactly the same fraction of both halves.

**What should happen.** Plain half day (`HD`, neither half named), half a day's loss of pay, flag `SHORTFALL`.

Worked examples (SIM-DAY, SIM-STD):

- covered 642/900 of each half (11:08–17:46): a tie, so a plain half day → **HD**, loss of pay 0.5, flags EARLY_OUT, LATE_IN, SHORTFALL, late 59 min, early 64 min, work 5h 53m, 2 punches

On the night shift: covered 1411/1800 of each half (22:51–05:14): a tie, so a plain half day → **HD**, loss of pay 0.5, flags EARLY_OUT, LATE_IN, SHORTFALL, late 42 min, early 36 min, work 5h 52m, 2 punches

### `below-half-day`

**What it does.** Under the half-day minimum of work.

**What should happen.** Absent (`A`), the policy's not-met loss of pay, flag `HALF_DAY_MIN_NOT_MET`.

Worked examples (SIM-DAY, SIM-STD):

- 153 min of work, under the half-day minimum (240 min) → **A**, loss of pay 1, flags EARLY_OUT, HALF_DAY_MIN_NOT_MET, early 387 min, work 2h 33m, 2 punches
- 178 min of work, under the half-day minimum (240 min) → **A**, loss of pay 1, flags EARLY_OUT, HALF_DAY_MIN_NOT_MET, LATE_IN, late 23 min, early 320 min, work 2h 58m, 2 punches

On the night shift: 153 min of work, under the half-day minimum (240 min) → **A**, loss of pay 1, flags EARLY_OUT, HALF_DAY_MIN_NOT_MET, early 327 min, work 2h 33m, 2 punches

### `threshold-edges`

**What it does.** Work of exactly the full-day or half-day minimum, and one second either side of it.

**What should happen.** At or over a minimum counts as meeting it; one second under does not: full minimum → `P` / half day; half minimum → half day / `A` with the not-met loss.

Worked examples (SIM-DAY, SIM-STD):

- work of exactly the half-day minimum minus 1 second → **A**, loss of pay 1, flags EARLY_OUT, HALF_DAY_MIN_NOT_MET, early 293 min, work 3h 59m, 2 punches
- work of exactly the half-day minimum plus 1 second → **P:A**, (first half P, second A), loss of pay 0.5, flags EARLY_OUT, SHORTFALL, early 294 min, work 4h 00m, 2 punches
- work of exactly the full-day minimum → **P**, loss of pay 0, flags EARLY_OUT, early 69 min, work 7h 00m, 2 punches

On the night shift: work of exactly the half-day minimum minus 1 second → **A**, loss of pay 1, flags EARLY_OUT, HALF_DAY_MIN_NOT_MET, early 233 min, work 3h 59m, 2 punches

### `missing-punch`

**What it does.** One punch only (an in, or an out: the device doesn't say which).

**What should happen.** Absent (`A`) with flag `MISSING_PUNCH` and a day's loss of pay until regularised; never called late.

Worked examples (SIM-DAY, SIM-STD):

- a single punch at 17:50:19: absent, MISSING_PUNCH, a day's loss → **A**, loss of pay 1, flags MISSING_PUNCH, 1 punch

On the night shift: a single punch at 04:50:19: absent, MISSING_PUNCH, a day's loss → **A**, loss of pay 1, flags MISSING_PUNCH, 1 punch

### `duplicate-seconds`

**What it does.** A normal day where each of the in and out is punched twice, a few seconds apart (the sample's user 113).

**What should happen.** Each pair counts once: two punches, `collapsed` as many as the extra punches; otherwise exactly a normal day.

Worked examples (SIM-DAY, SIM-STD):

- 2 duplicate punch(es) seconds apart, counted once (last out 19:21:49) → **P**, loss of pay 0, no flags, work 9h 01m, 2 punches (2 duplicates collapsed)
- 1 duplicate punch(es) seconds apart, counted once (last out 19:39:18) → **P**, loss of pay 0, no flags, work 8h 55m, 2 punches (1 duplicate collapsed)
- 0 duplicate punch(es) seconds apart, counted once (last out 19:07:00) → **P**, loss of pay 0, no flags, work 8h 35m, 2 punches

On the night shift: 2 duplicate punch(es) seconds apart, counted once (last out 06:21:49) → **P**, loss of pay 0, no flags, work 8h 16m, 2 punches (2 duplicates collapsed)

### `near-duplicate-edge`

**What it does.** A second punch exactly at the near-duplicate window after the first, and one second beyond it.

**What should happen.** At the window it is the same punch (counted once); one second beyond it is a separate punch (three punches). Nothing else about the day changes.

Worked examples (SIM-DAY, SIM-STD):

- a second punch 120 s after the first (window 120 s): the same punch → **P**, loss of pay 0, no flags, work 9h 01m, 2 punches (1 duplicate collapsed)
- a second punch 121 s after the first (window 120 s): a separate punch → **P**, loss of pay 0, no flags, work 9h 01m, 3 punches

On the night shift: a second punch 120 s after the first (window 120 s): the same punch → **P**, loss of pay 0, no flags, work 8h 16m, 2 punches (1 duplicate collapsed)

### `never-punches`

**What it does.** A mapped employee with no punches on a working day.

**What should happen.** Absent (`A`), a day's loss of pay, no flags.

Worked examples (SIM-DAY, SIM-STD):

- no punches on a working day → **A**, loss of pay 1, no flags

On the night shift: no punches on a working day → **A**, loss of pay 1, no flags

### `stray-flagged`

**What it does.** A normal day plus one extra punch inside the day that reaches the server far too late to be plausible (so it is flagged).

**What should happen.** The late punch is left out until HR decides on its time: the day is computed without it, with flag `CLOCK_FLAGGED`.

Worked examples (SIM-DAY, SIM-STD):

- an implausibly late punch at 14:28:35 is excluded; the rest is a normal day → **P**, loss of pay 0, flags CLOCK_FLAGGED, work 9h 01m, 2 punches

On the night shift: an implausibly late punch at 01:58:35 is excluded; the rest is a normal day → **P**, loss of pay 0, flags CLOCK_FLAGGED, work 8h 16m, 2 punches

### `stale-day`

**What it does.** A normal day whose every punch reaches the server beyond the plausibility window.

**What should happen.** All the punches are flagged and left out: absent (`A`), a day's loss, flag `CLOCK_FLAGGED`, until HR accepts them.

Worked examples (SIM-DAY, SIM-STD):

- every punch reached the server too late to be plausible: excluded until HR decides → **A**, loss of pay 1, flags CLOCK_FLAGGED

On the night shift: every punch reached the server too late to be plausible: excluded until HR decides → **A**, loss of pay 1, flags CLOCK_FLAGGED

### `outside-window`

**What it does.** A normal day plus one stray punch in the gap between one day's punch window and the next.

**What should happen.** The stray belongs to no day: it is counted (never silently lost) and the day is exactly a normal one.

Worked examples (SIM-DAY, SIM-STD):

- a stray punch at 05:52:24, between two days' windows, counted and used by neither → **P**, loss of pay 0, no flags, work 9h 01m, 2 punches

On the night shift: a stray punch at 17:51:16, between two days' windows, counted and used by neither → **P**, loss of pay 0, no flags, work 8h 16m, 2 punches

### `works-past-midnight`

**What it does.** Stays long after the shift ends, with the out after the end (and, on a day shift, after midnight).

**What should happen.** Present, not early, the long hours counted on the shift's START date; the next date is unaffected by this punch.

Worked examples (SIM-DAY, SIM-STD):

- out at 21:00:39, hours after the end: still the shift's own date → **P**, loss of pay 0, no flags, work 10h 24m, 2 punches

On the night shift: out at 08:00:39, hours after the end: still the shift's own date → **P**, loss of pay 0, no flags, work 9h 39m, 2 punches

### `catch-up`

**What it does.** A normal day delivered days late (after an outage), inside the plausibility window, in a shuffled order.

**What should happen.** Exactly the same day as if delivered live.

Worked examples (SIM-DAY, SIM-STD):

- delivered days late but inside the plausibility window: the same day → **P**, loss of pay 0, no flags, work 9h 01m, 2 punches

On the night shift: delivered days late but inside the plausibility window: the same day → **P**, loss of pay 0, no flags, work 8h 16m, 2 punches

### The other scenarios

- **`off-day-quiet`** — A holiday or week-off with no punches. **Should:** `H` or `O`, not worked, no loss of pay, no flags.
- **`holiday-work`** — Punches on a company holiday. **Should:** `H` or `O` still (never present or absent), recorded as worked on an off day, never an exception, no loss of pay.
- **`weekoff-work`** — Punches on the employee's week-off. **Should:** `H` or `O` still (never present or absent), recorded as worked on an off day, never an exception, no loss of pay.
- **`leave-full`** — Approved full-day leave, paid or unpaid. **Should:** The leave code for the day; a day's loss of pay only if the leave is unpaid; punches are not needed.
- **`leave-half-worked`** — Half-day leave, the other half worked. **Should:** A split status like `PL:P`; loss of pay only for an unpaid half; the working half has to meet the half-day minimum.
- **`leave-half-no-show`** — Half-day leave, the other half absent. **Should:** A split status like `PL:A`; half a day's loss for the absent half, plus half for an unpaid leave half.
- **`not-employed`** — Before the joining date or after the last working day (sometimes with a stray punch from a card still in use). **Should:** No record at all.
- **`manual-nothing`** — A manual-capture employee with nothing entered. **Should:** `NM`: never absent, no loss of pay, never an exception.
- **`manual-status`** — A manual-capture employee with a status-only entry. **Should:** The status as entered (`P`, `A`, first or second half, worked).
- **`manual-timed`** — A manual-capture employee with a timed entry. **Should:** Goes through the punch rules exactly like device punches (late minutes, hours).
- **`manual-in-only`** — A timed entry with an in and no out. **Should:** Counts like a single punch: `A` with `MISSING_PUNCH`.
- **`unmapped`** — Punches from a device user ID nobody has. **Should:** They land in the unmapped queue and change no one's day.

### Worked examples of the rest

- First-half paid leave, second half worked: first-half leave (SIMPL), the other half worked 14:33–18:50 → **SIMPL:P**, (first half SIMPL, second P), loss of pay 0, no flags, work 4h 05m, 2 punches
- Full-day unpaid leave → **SIMLOP**, loss of pay 1, no flags
- Manual capture, nothing entered → **NM**, loss of pay 0, no flags
- Not employed on the date → **no record**
