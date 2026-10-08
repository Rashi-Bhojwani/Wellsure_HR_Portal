# attendance

Daily attendance computation, the attendance rules engine, shifts /
week-offs / rosters, overrides, regularization, muster, exceptions and
period finalisation. Consumes raw punches from the `biometric` module.
See spec §4, §7.3 — Phase 2–3.

Layout (Phase 2, docs/plans/PHASE_2.md):
- `engine/` — the pure rules engine, one employee-day at a time (P2-C).
- `compute.ts` — loader → engine → writer for `daily_attendance`; `jobs.ts`,
  `recompute.ts`, `wiring.ts` — live, nightly and Process Attendance runs.
- `config*.ts` — Attendance Settings (P2-A).
- `finalisation.ts` — what blocks finalising a period, and `finalisePeriod`,
  the only writer of `is_locked`.
- `manual/` — manual entry and the Attendance Muster (P2-D): `entries.ts`
  (append-only entries, the engine's loader), `scope.ts` (who may see and
  mark which branch), `muster.ts` (grid, totals, save, mark all present,
  export), `upload.ts` (template, preview, commit), `reminder.ts`.
