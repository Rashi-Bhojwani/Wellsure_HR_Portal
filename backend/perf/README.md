# perf

`baseline.json` is the committed baseline for the 500-employee month replay
(`npm run test:replay`, docs/plans/PHASE_2.md "P2-G build design", gate G2, D5):
each run is compared with it and **fails if ingest or recompute takes more than
twice the baseline**, even when still under the absolute limit (ingest ≤ 2 min,
recompute ≤ 5 min). It is a regression guard, not a target.

It is recorded by the **CI runner** (the `attendance-replay` job), not a laptop:
a number that only holds on one machine guards nothing. To re-record it, run the
job (or `REPLAY_UPDATE_BASELINE=1 npm run test:replay`) and commit the result.

`last-run.json` (not committed) is written by every run.
