# Checkpoint 1 follow-up (2026-10-30)

What the owners asked for after Checkpoint 1, in the order they asked. Plain, short, no real data.

## 1. Four more keys hard-locked to the directors (`828a06b`)
`user.security.manage` (reset 2FA / unlock / password link for other people), `import.manage` (the Import Center), `letters.generate` (a letter can carry the CTC, and per-type grants are not built, so the whole key is locked), `leave.yearend.manage`.
HR cannot hold them by default, by a role edit, by a personal grant, by any of the HR switches, or in the database. Migration `20261030090000` copies what it removes into the append-only `role_permission_removals` first.
Tests: `hrHardLockFourKeys.test.ts` (each key on each of its routes as HR Admin, HR Executive, a manager, an employee, a director; every HR switch on; role edit; personal grant; database triggers; resolver with the triggers off) and the extended persona matrix (a crawl and an explicit route list). **Consequence to know:** HR can no longer reset 2FA, use the Import Center (bulk import, invitations), issue any letter or run the year-end; a director does these until narrower keys exist. The menu hides "Bulk Import" and the whole Payroll group from HR (found in the walkthrough; before this the Payroll group was listed to HR and every page behind it was refused by the server).

## 2. The payroll / payslip GET routes (`828a06b`)
I could not find, in the record or by running the crawl, **two** payroll/payslip GET routes that answer 200 for HR. The crawl (HR Admin and HR Executive, every GET route without parameters) finds exactly one: `GET /api/payslips/mine`, HR's *own* payslips, which is correct. The three routes that return a person's own payslips are `GET /api/payslips/mine`, `GET /api/payslips/mine/:id` and `GET /api/payslips/mine/:id/pdf`. A new test (`hrMatrix.test.ts`, "every GET route under /api/payroll and /api/payslips…") takes **every** such GET route in the route inventory (40, including the ones with ids, filled in with a made-up id) and asserts both HR roles get 403 on all of them except those three own-payslip routes, and asserts that those three are the only payslip routes the code has. If you have the names of the two routes you saw, tell me and I will add them to the test by name.

## 3. The second-director choice has no default (`dd236f5`)
See `DIRECTOR_AUTHORITY.md`, "Amendment after Checkpoint 1".

## 4. "See leave counts" (`4180402`)
The twelfth HR switch (the eleven before it plus this one). Governs `leave.view`: other people's balances, ledgers, the leave dashboard and the org-wide leave calendar. Default as today (HR holds it). Approving leave stays its own switch. The Workforce Overview now shows the "not switched on for you" state instead of "Something went wrong".

## 5. Missing items from Stage 0
### 5a. The red `latency` job
It is a **test-harness problem, not a product defect**, but it means that since the UI redesign nothing automated proves the headline requirement (a punch on screen within seconds). Evidence: the harness (`biometric-agent/src/simulator/latency/run.ts`) was written against the old Ant Design screens. Run `07:42 UTC` on the branch base (before any of my work) failed waiting for `.ant-statistic` (fixed in `f23ff7b`). Every run since fails one step later: "Need at least 6 people on HR's Who Is In? board … found 0". I reproduced it on a fresh scratch database at midday (so it is not about the hour): the board lists all 31 people, but the harness looks for the text `1006 ·`, and the redesigned board prints the code on its own line, so it finds nobody. Behind that, two more watchers still look for the old `.ant-card` / `.ant-list-item` markup. Fixing it means re-deriving what the new board and the employee day panel render and rewriting those three selectors: not large, but not trivial and I have not done it. **Open question for you:** repair it now (recommended) or after Stage 4.
### 5b. Changed tests
`docs/plans/CHANGED_TESTS.md`.
### 5c. Same person never maker and checker, per payroll control
| Control | Where it is proven (second-director mode) |
|---|---|
| Run approval, period finalise, payslip publish, period unlock, bank file, salary revision, rule/component confirmation (all six approval subjects) | `approvals.test.ts` "%s: the checker is never the maker, even for someone who holds both payroll roles" (code and database CHECK), `runClosing.test.ts` (run approve, finalise decision, publish reject, unlock decision: 403 `CHECKER_IS_MAKER`), `releases.test.ts` (bank file), `salary.test.ts` (revision), `runAuthority.test.ts` ("the preparer cannot decide their own request"), `directorChoices.test.ts` (same, with the choice set to a different director) |
| Rule confirmation | `rules.test.ts`, `selfConfirmLayers.test.ts` (layer by layer: service, approval core, database) |
| Salary component, structure confirmation | `selfConfirmLayers.test.ts` (component, layer by layer), `salary.test.ts` (component and structure: the author's own confirmation is blocked), `confirmAuthority.test.ts` (component, both modes) |
| Bank and statutory file layouts | `layoutAuthorConfirm.test.ts` (the bank file layout, and PF, ESI, PT and LWF: the author is blocked in the preview and refused in the confirmation, the other director confirms). Mutation: letting the author through in the shared core fails both tests. |
| Company identifiers (sealed) | `sealedIdentifiers.test.ts` |
| Setup sign-off (salaries, bank accounts, PF numbers) | `setupChecklist.test.ts` (`SIGNER_ENTERED_THIS`) and its authority variant |
| A director's own pay | `directorAuthority.test.ts` (`MAKER_IS_AFFECTED`), `revisionAuthority.test.ts` |
| HR's bank/statutory change confirmed by a director | **not built yet** (planned with H2) |
**Important:** these hold in "a different director must decide" mode. In "the acting director decides alone" mode the same director may, by the owners' choice, prepare and decide in one act (recorded, the other told); only a change to their own pay is always refused.
### 5d. What the code did when a director approved a run they prepared
- **Before D2** (D1 and earlier): refused. `approvals.decide()` returned 403 `CHECKER_IS_MAKER` and the database CHECK `payroll_approvals_checker_not_maker` refused the row. Proven in Stage 0.3.
- **After D2 (c179e7c)**: depended on a switch that defaulted to "alone": by default the director could prepare and approve in one act (`authorise()`); with the check switched on it refused as before.
- **Now (`dd236f5`)**: there is no default. Until both directors have set and confirmed the choice for "Approving a payroll run" the step refuses (`DIRECTOR_CHOICE_NOT_SET`); once set, it is one of the two behaviours above.

## 6. CI (what I read; updated when the runs finish)
- `829e5dd` (Stage 1 close): everything green except `latency` (5a).
- `c179e7c` (D2): cancelled by the next push 21 seconds later. `69b4bfb` (same code): **red, and my fault**: (a) "Demo company tests" and (b) the `sensitive-ui` job both failed because the D2 change made the demo-company seed's two-person flow auto-approve ("This is not waiting for a decision"); (c) the failed seed then **hung** instead of exiting (open queue connections), so `sensitive-ui` sat for 40 minutes until cancelled. Fixed in `dd236f5` (the demo company ships DEMO-labelled choices) and in the seed script (it now exits with the error). `latency`: as 5a.
- `828a06b`: cancelled by the next push. `4180402`: red (tests job; fixed by the next commits: the demo seed and one test needed the changes below). `dd236f5`: tests, demo tests, docker, Windows agent, replay green; `latency` red as 5a; `sensitive-ui` cancelled after 39 minutes (the seed script's failure-hang, see above, fixed in `171aab5`).
- **`171aab5` (latest): every job green except `latency`.** `sensitive-ui` 12 min, tests 11 min, demo tests, bundle budget, schema drift, Docker, Windows agent, replay all pass.

## 7. Browser walkthrough (scratch database `wellsure_hr_lat`, development stack, headless Chromium)
As both directors, as HR with duties on and off, and as an employee. Screenshots are in the session scratchpad, not in the repo.
- **Director authority screen, Not set.** Eleven steps listed, ten Not set (eight payroll steps required, two optional) plus the one I had proposed; the "Recommended" banner names Payroll rules, Approving a payroll run, Salary revisions, The bank file; the amber banner says Ready for first real run stays red and the steps refuse.
- **Propose / confirm.** Director 1000 proposed a choice: the card showed "Waiting for the other director" and no Confirm button for the proposer. Director 1031 saw "proposed", one Confirm button, pressed it, and the card read "Confirmed: …". The Ready for First Run page, as the second director, still listed the remaining unset steps as red rows.
- **HR (1001).** The menu has no Bulk Import, Data Import/Export, Year End Process, What HR Can Do, Roles & Permissions, System Settings, Audit Log, and (after the fix made here) no Payroll group. Opening year-end, bulk import, payroll ready and system settings by typing the address each showed the "not switched on for you" state.
- **See leave counts, off then back.** With the switch off for HR Admin the Workforce Overview first showed "Something went wrong" (a defect I found and fixed: it now shows "This is not switched on for you"); back to "As today" the figures returned. The switch history shows both changes with their reasons.
- **Employee (1006).** Lands on the employee home and greets by name; payslips page opens; Payroll Ready for First Run shows the not-switched-on state. Typing `/admin` as this employee opens the admin shell with only the Employee, Workforce, Tasks, Reports and Engage groups (they manage a team): no Payroll, no Admin Tools.
- **Not done in the browser:** the director screens on a phone width; the dark theme of the new Director authority cards.
- Also run against the demo company: `check:sensitive-ui` (451 pages, no secret, DEMO banner on every page; 17 minutes) and `check:popovers`.

## 8. CI time limits and why `sensitive-ui` hung (after the owners' review)
Every CI job now has a time limit (20 minutes; 25 for the test job and the Windows agent), and the slow steps have their own: the demo seed 3 minutes, the secret scan 16, the test suite 18, the demo tests 5. A step that hangs fails as that step and the `if: always()` log uploads still run.
**Why `sensitive-ui` hung for 39 minutes (found, not guessed):** from D1 on, the demo-company seed enqueues director notices, which opens queue connections; the script finished its work but the Node process never exited, so the next command in the same step (the scan) never started. On `69b4bfb` it was a failed seed that hung the same way; on `dd236f5` the seed worked but still did not exit. `171aab5` makes the script exit explicitly (it had not run in CI before that). Splitting the seed and the scan into separate timed steps means this can no longer hide.

## 9. Amendments from the owners' second review
**5.1 Bank files.** The layout engine already writes `.xlsx` (spreadsheet format) and `.csv` (comma-delimited); it now also refuses a layout that asks for a legacy `.xls`/`.xlsm`/`.xlsb`, or whose extension does not match its format. No legacy writer exists or will. **`docs/samples/Bank_Transfer_template.xls` is not in the repository** (`docs/samples/` is on `main` with six other files, none of them that one, and there is no README), so I have not copied any column layout: the owners enter the layout, codes, date format and debit account, nothing preset, confirmed by a different director, as before. Send me the template (or the column list) and I will enter it as a DEMO layout in the demo company only.
