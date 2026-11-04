# workforce

A-10: the Workforce Management functions that were missing or partial (docs/plans/GREYTHR_PARITY_WORKFORCE.md). Each file extends the attendance or leave
module through that module's own functions. Every router here refuses the Developer role (`middleware/refuseDeveloper.ts`).

* `settings.ts` — append-only Workforce settings (latest row in force; no row = Not set), set by a director with a reason.
