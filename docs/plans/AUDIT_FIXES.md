# Audit fixes: leave, hidden defaults, Developer personal data (2026-11-18)

Source: the read-only audit `HARDCODED_VALUES_AUDIT.md` (commit `14ff0adf`). The audit file was not in this session's machine or in any branch; the owner is
sharing it. Items 1 to 4 and 7 below are built from the brief alone; items 5 and 6 (the 42 hidden defaults, the remaining small class A items) are built from the
audit's own lists once it is available. Not touched: the attendance engine's lateness, missing-punch and half-day logic (`feat/lateness-rule`), the statutory
defaults, the roles, the employee-number login, and everything in `OWNER_EMPTY_SETTINGS.md`.

## 1. Leave days follow the attendance week-off and holiday settings

`resolveDayCountContext` (leave/dayCountContext.ts) now reads, for each date, the person's own attendance assignment's week-off pattern (shared `isWeekOff`, so
"2nd and 4th Saturday" patterns work), a branch weekend override if one applies, and the holidays that apply at their location. Where a person has no assignment
on a date, the company's default pattern (Attendance Settings, the one a new hire gets) is used; if it is missing the request is refused
(`WEEK_OFF_PATTERN_MISSING`). The built-in Saturday-and-Sunday stub (`leave/weekOff.ts`, setting `leave.defaultWeekOffDays`) is removed. Attendance already shows
every date of an approved request as leave after its own week-off check, so a working Saturday inside a leave reads as leave.

## 2. Leave type roles

Two director settings (Default behaviours; one director proposes, the other confirms; audited): **Earned / paid leave type** (`leave.earnedLeaveType`: monthly
accrual and year-end) and **Comp-off leave type** (`leave.compOffType`: grants, consumption, release, imports). Each holds a leave type id; the type must exist and be
active, and the two must differ. Not set: accrual, year-end and comp-off grants refuse naming the setting (`SETTING_NOT_SET`), never skip. The checks on the codes
"PL" and "COF" are gone, so type codes and names are free. The development seed sets both (PL and COF) the same way the screens would.

## 3. Honour what the leave policy screen says

- **Year-end** (earned leave type only): carries at most the policy's carry-forward cap into the new year; the rest is encashed if the policy's year-end encashment
  is on, or lapses (a LAPSE entry) if it is off. "No limit" carries everything. Both must be chosen: new column `carry_forward_rule` (`CAPPED` with
  `carry_forward_cap_days`, or `UNLIMITED`; null = Not set) and `year_end_encashment` becomes nullable (null = Not set). Not set: the preview refuses naming the
  missing setting and never cashes out everything. Spec §5.2 (encash all and reset) is cap 0 with encashment on, which the development seed uses.
  Year-end run items record carried and lapsed days.
- **WFH monthly / yearly limits and the restricted-holiday yearly quota**: enforced on apply for any leave type whose policy sets them (pending and approved days of
  that type in the month / year); empty means no limit and the screen says "No limit".

## 4. One leave-day value

The one setting is Default behaviours, **Leave encashment amount** (`payroll.leaveEncashment`: the per-day basis heads and divisor), already used for mid-year and
exit encashment; year-end now uses it too (one day = basis heads of the salary in force on 31 December / divisor, with the setting's rounding). The flat-rupee
fallback (`leave.encashment.defaultDailyRate`) and the formula-rule provider are removed; Not set refuses naming the setting. The leave liability report reads the
same value.

## 7. The Developer sees no personal data

Personal email, phone, home addresses and the emergency contact (and date of birth, gender and blood group, which support needs no more than the rest) join the fields the Developer never sees, through the same access resolver and `DEVELOPER_FORBIDDEN_KEYS` mechanism as
pay, bank and identity, and are masked on the profile and in every list, search and export that returned them. The Developer keeps employee number, name, role and
status.

### What the Developer still sees on an employee profile (2026-11-18)

Employee number, name, official email, status, employment type, date of joining and last working day, attendance capture (device or manual), account status and
whether two-factor sign-in is on, the invitation's delivery status (not the address), photo version, and the job (department, designation, location, grade, cost
centre, reporting manager, effective date). Withheld: personal email, mobile, current and permanent address, emergency contact (name, phone, relation), date of
birth, gender, blood group, the invitation address; bank and statutory sections are omitted (as before); pay is behind its own route (as before).

When `feat/employee-number-login` merges, its four new profile fields need a decision each. Recommendation: `deviceUserId` (the machine ID, needed to diagnose
punches), `loginIdMatchesMachine` (true/false), `noEmailOnRecord` (true/false) and `emailMissingRequestedAt` (a time) carry no personal contact data, so the
Developer keeps all four; none goes in `PERSONAL_CONTACT_FIELDS`.
