# Lateness rule — plan and checklist (branch `feat/lateness-rule`)

An additive module (`backend/src/modules/lateness/`) plus two configurable attendance outcomes (missing punch, half-day thresholds).
Everything is a director setting confirmed by a second director; the whole module is **off by default** and, while off, nothing changes anywhere.
Report: `docs/plans/LATE_REPORT.md`.

## 1. Settings (two-director store, effective-dated)

Stored in the existing D-37 two-director store (`behaviour_proposals` / `behaviour_confirmations`), which already refuses, in the database, a proposer
confirming their own proposal. Keys `late.rule`, `late.missingPunch`, `late.halfDay`; each value carries `effectiveFrom` (always the 1st of a month).
A month uses the confirmed version with the latest `effectiveFrom` on or before its 1st (a later confirmation wins a tie). A proposal (and its confirmation)
is refused for a month that overlaps a finalised attendance period: a finalised month is never recomputed except through the existing correction path.

| Key | Value | With nothing confirmed |
|---|---|---|
| `late.rule` | `active`, three cutoffs (`HH:MM` + edge INCLUSIVE/EXCLUSIVE), three bands (outcome NOT_SET / NONE / MARK / CUT days / PENALTY rupees; applies EVERY_TIME or AFTER_FREE N a month), penalty pay head | Off. The screen shows the proposed starting values: 10:10, 10:20, 10:30 (edge inclusive); band 1 Not set; band 2 three free a month then a 0.5-day cut; band 3 a 0.5-day cut every time |
| `late.missingPunch` | ABSENT_FULL_DAY / HALF_DAY / PRESENT_FLAGGED | "Default in use: absent, a full day of loss of pay" (today's engine) |
| `late.halfDay` | full-day minutes, half-day minutes, LOP when the half-day minimum is not met | "Default in use: each attendance policy's own thresholds" (today's engine) |

## 2. The rule (pure: `lateness/evaluate.ts`)

- Arrival minute = the day's first-in, Asia/Kolkata, to the minute (seconds dropped). `past(cutoff)` = minute ≥ cutoff (inclusive edge) or > cutoff (exclusive).
  Band = the highest cutoff passed (0 = on time).
- An arrival counts only on a day with a first-in whose first half is a working half (not holiday, week-off or first-half leave), whose in is known to be an in
  (the engine's own test: a second punch, or the day still open), on a shift that starts before the first cutoff.
- Per employee, per calendar month, per band: non-waived arrivals are numbered in date order. AFTER_FREE N: arrivals 1..N use an allowance (late mark, no
  consequence); from N+1 the band's outcome applies. EVERY_TIME: the outcome applies each time and uses no allowance. NOT_SET behaves as no consequence.
- Higher-of with insufficient hours (same day): a salary cut adds `max(0, cut − hoursLop)` to the day's loss of pay (so the day loses the higher of the two, never
  both). A penalty is compared with the rupee value of the day's hours LOP (from the month's calculated run, the same arithmetic as a loss-of-pay reversal): the
  penalty line is `max(0, penalty − value)`, so the day costs the higher of the two.
- A waived arrival is not counted at all: its consequence goes and its allowance comes back (later arrivals renumber).

## 3. Where money flows (no parallel pay path)

- **Salary cut** → `daily_attendance.lop_days` through ONE additive hook in `attendance/compute.ts` (the engine itself is untouched). Payroll already reads loss of
  pay only from locked attendance days, so the cut reaches the payslip, PF NCP days and every report exactly as any other loss of pay.
- **Penalty** → a PENDING `payroll_adjustments` row (DEDUCTION, the directors' chosen deduction head, source MANUAL, `source_ref` `late:<employee>:<date>:<amount>`),
  posted by a director (preview + fingerprint, never their own pay) and read by the next run like any other deduction. One labelled line per arrival.
- The rupee comparison for the penalty happens only on the director-only posting screen; nothing HR can see depends on pay.

## 4. Hook point (the only engine-side change)

`attendance/compute.ts`: an import, `const dayHook = await loadAttendanceDayHook(...)` before the loop, and `dayHook ? dayHook(emp.id, input, evaluateDay) : evaluateDay(input)`.
`loadAttendanceDayHook` returns `null` when no month in the range has the rule on or a missing-punch/half-day choice confirmed, so results are byte-for-byte the
same as before. When an earlier day's arrival changes, the later days of that month are re-requested (they may renumber).

## 5. Waivers (maker-checker)

`late_waivers`: the employee's current reporting manager asks (reason) for one late arrival; HR (holds `attendance.override.manage`) approves or rejects with a note.
Refused: the requester or the employee deciding (also a database check), a date in a finalised period, a day that is not a late arrival, a second open waiver.
Approval recomputes the rest of the month at once. Audited; requests notify HR, decisions notify the manager and the employee.

## 6. Who sees what (`/api/lateness`, Developer refused on every route)

| | Sees |
|---|---|
| Employee | own late marks, allowances left, consequences, waiver status |
| Manager | their direct reports' (no rupee amounts); asks for waivers |
| HR (`attendance.override.manage`) | the waiver queue (dates, times, band, reason): no pay data |
| Director | settings, proposals, penalties posting (amounts) |
| Developer | nothing (403) |

## 7. Ready for First Run (non-blocking rows)

Lateness rule on/off; "Lateness band 10:10 to 10:20: owner to decide" while that band is Not set; the penalty owner-review row (Payment of Wages Act / Code on Wages:
the directors confirm the penalty option is allowed for their case; the portal gives no legal advice); missing punch and half-day thresholds "Default in use: …".

## 8. Checklist

- [ ] Plan (this file)
- [ ] Migration `late_*` + schema inside `LATE-BEGIN` / `LATE-END`
- [ ] Settings, evaluator, hook, waivers, penalties, routes, Ready rows, route inventory
- [ ] Goldens: OFF byte-for-byte; boundaries 10:09/10:10/10:19/10:20/10:29/10:30/10:31; 3rd vs 4th; month reset; higher-of; waiver returns allowance; both edges;
      half-day + lateness; every outcome in every band
- [ ] Mutation checks (script `backend/scripts/late-mutation-check.sh`)
- [ ] Security: permission matrix, Developer 403, IDOR, HR no pay, self-approval refused; migrations on a fresh database
- [ ] Screens: employee/manager, HR waivers, director rule; browser walk (desktop light, 390 dark, keyboard)
- [ ] Full backend suite once; ops section; report; push; CI read once
