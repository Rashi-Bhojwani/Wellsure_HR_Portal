# modules/dev

Read-only helpers for the punch simulator (Phase 2 P2-G, `docs/plans/PHASE_2.md`
"P2-G, commit G2 build design"). **Mounted only when `APP_ENV` is not
`production`** (`apiMountsFor` in `app.ts`): in a production build the router
does not exist and every path under `/api/dev` is a plain 404. Both endpoints
need `attendance.devices.manage`.

- `GET /api/dev/simulator/roster?from&to&seed`: the employees who punch on a
  device, with the shift, policy, week-off pattern, approved leave and holidays
  that apply, in the simulator's vocabulary. People the simulator's model cannot
  describe (a policy with break pairing or penalty rules, an assignment or
  mapping that changes inside the range) are returned under `skipped` with the
  reason, never planned wrongly.
- `GET /api/dev/simulator/days?from&to&codes`: the stored `daily_attendance` for
  those people, in the fields the replay compares.

`simulatorService.ts` holds both; `observedDay` is also what the backend's own
replay tests use to read a stored day.
