# perf

The punch-to-screen latency test (`npm run test:latency`, docs/plans/PHASE_2.md
"P2-G, commit G2 build design") writes `latency-last-run.json` here (not
committed) and compares each route's slowest sample with `latency-baseline.json`
(committed, recorded by the CI runner): a figure must be within 5 seconds (the
gate) and, against the baseline, not both more than double it and over 2
seconds. To re-record the baseline from a clean run:
`npm run test:latency --prefix biometric-agent -- --update-baseline`.
