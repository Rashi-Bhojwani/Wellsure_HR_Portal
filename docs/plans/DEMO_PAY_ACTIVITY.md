# Demo pay history — written 2026-11-11 before the seed was finalised

The demo company (`scripts/demo/seedDemoCompany.ts`) gains a made-up pay history (`scripts/demo/seedDemoPayActivity.ts`), run by `npm run seed:demo-company` after the
company itself. Demo company only (it refuses otherwise); every name is "Demo …", every account begins 9999, every figure is labelled DEMO.

| What | Made of |
|---|---|
| Two finished runs | three months back and two months back, each submitted, approved, finalised and published (one director prepares, the other decides). The last full month is left for the demo test's own run. |
| Loans (type `DEMO_ADVANCE`) | **active** (DEMO006: one of six instalments recovered); **fully recovered** (DEMO007: one instalment); **recovery stopped** (DEMO008: remaining instalments cancelled by a two-director loan change, then the balance recovered at exit by the off-cycle settlement); **shortfall month** (DEMO002: instalment larger than net pay, skipped with a warning under the D-37 default); a leaver's loan (DEMO011, instalments still pending). |
| Claims (`DEMO_TRAVEL`, `DEMO_MEALS`) | paid, approved and waiting, submitted (with a long description), rejected with a reason, withdrawn; one approved for a leaver. |
| Held pay | DEMO009 held by a director in the second month; DEMO012 has no bank account in force for either month (the account starts last month), so both runs hold it. |
| Settlements | DEMO008 (paid by the off-cycle run) and DEMO011 (confirmed, unpaid); both leave at the end of this month. |
| Off-cycle run | the DEMO008 settlement: approved, finalised, DEMO bank file written, downloaded and marked sent. |

**The one step not through the screens:** a loan request cannot be for a month that has passed and a run cannot be for a month that has not ended, so no loan
requested today could be recovered by a run the demo can make. The demo writes the loan REQUEST rows dated in its past; their sanction, payment, recovery,
stopping and settlement all go through the real API as the demo directors.

**There is no "paused" loan state** in the system (a loan change is prepaid, waived or cancel-pending). The nearest real state, "recovery stopped" (cancel-pending), is
seeded instead; a pause feature is not invented.
