# Independent audit: fix report

Audit: `FINAL_AUDIT.md` (independent pre-go-live audit of `peeps/foundation` at `5649ec3`; findings C1–C4, H1–H6, M1–M10, L1–L11, T1, T2).
Fixes: on `peeps/foundation`, commits `7cdad24` to the last commit listed in §6, in three phases (Critical/High, then Medium/Low, then repository hygiene).
No history was rewritten and no other branch was touched.

**Rule for every fix:** a test that reproduces the audit's case and failed before the fix, a mutation check (the fix undone, the test catches it), Developer-403 and
permission checks on every changed route, and a record of every changed test with its reason (`CHANGED_TESTS.md`, "Independent audit fixes").

## 1. Every finding

| ID | Finding (short) | Status | Commit(s) | Test that reproduces it | Mutation |
|---|---|---|---|---|---|
| C1 | HR takes over any account via personal email + forgot password | **Fixed** | `d7c7196`, `b4233a6`, `789941c`, `3466f8e` | `backend/src/modules/employee/__tests__/fixC1AccountTakeover.test.ts` | 7 caught |
| C2 | One director alone makes or removes a director | **Fixed** | `cbc1875`, `b4233a6` | `backend/src/modules/access/__tests__/fixC2DirectorChanges.test.ts` | 4 caught |
| C3 | HR Executive / Developer grant themselves paid leave | **Fixed** | `cbc1875`, `b4233a6`, `ba191ce` | `backend/src/modules/leave/__tests__/fixC3LeaveChanges.test.ts`, `backend/src/modules/access/__tests__/fixC3DeveloperSweep.test.ts` | 7 caught |
| C4 | Real-looking payroll, bank and punch files in git | **Guarded; history not rewritten (as instructed)** | `7f80175` | `scripts/__tests__/check-real-data.test.mjs` | 3 caught |
| H1 | Refresh token in the API log | **Fixed** | `7cdad24` | `backend/src/lib/__tests__/fixH1RequestLog.test.ts`; plus a scan of the full-suite log (§4) | 2 caught |
| H2 | One office IP locks out the whole office | **Fixed** (corrected in `abe6b50`, see §5) | `929eb3c`, `b4233a6`, `abe6b50`, `3466f8e` | `backend/src/modules/auth/__tests__/fixH2OfficeLockout.test.ts`; `backend/src/middleware/__tests__/trustProxy.test.ts` | 5 caught |
| H3 | `leave_ledger` not append-only in the database | **Fixed** | `c59faeb` | `backend/src/modules/leave/__tests__/fixH3LedgerAppendOnly.test.ts` | 2 caught |
| H4 | Two-director rule optional; own pay changeable | **Fixed** | `b818d19`, `b4233a6` | `backend/src/modules/payroll/__tests__/fixH4SingleDirector.test.ts` | 5 caught |
| H5 | Developer reads personal and bank details through Import | **Fixed** | `cbc1875` | `fixC3DeveloperSweep.test.ts` ("H5: the Developer reads no import batch…") | with C3 |
| H6 | No production infrastructure, backups, restore or key backup | **Deferred** (§3) | — | — | — |
| M1 | Access token survives a password reset; no change password | **Fixed** | `d7c7196`, `21ad644`, `6527b2e` | `fixC1AccountTakeover.test.ts` ("a password reset ends every other session… (M1)"); `frontend/src/pages/account-security/__tests__/ChangePasswordPanel.test.tsx` (the screen) | 4 caught |
| M2 | Suspended user's socket stays connected | **Fixed** | `33146b0` | `backend/src/realtime/__tests__/fixM2Disconnect.test.ts` | 2 caught |
| M3 | Redis down: `/ready` and sign-in hang | **Fixed** | `d925427` | `backend/src/lib/__tests__/fixM3RedisDown.test.ts` | 3 caught |
| M4 | A `DEMO` employee number stops production | **Fixed** | `57f49dd` | `backend/src/lib/__tests__/fixM4DemoPrefix.test.ts` | 3 caught |
| M5 | PT / LWF Not set: payroll deducts nothing instead of refusing | **Fixed** | `c567cdf`, `6929582`, `276805e`, `171a559` | `backend/src/modules/payroll/__tests__/fixM5StatutoryAnswers.test.ts`; `payslipNotSet.test.ts` (run refused) | 5 caught |
| M6 | One director resets / unlocks the other alone | **Fixed** | `f3e7fb5`, `30f7c48` | `backend/src/modules/access/__tests__/fixM6DirectorSecurity.test.ts` | 2 caught |
| M7 | Developer changes attendance policy, rosters, processing | **Fixed** | `cbc1875` | `fixC3DeveloperSweep.test.ts` (every write route) | with C3 |
| M8 | Lateness waivers decided by HR alone | **Fixed** | `72ef064` | `backend/src/modules/lateness/__tests__/fixM8WaiverDirector.test.ts` | 3 caught |
| M9 | Dependency advisories | **Fixed, 4 high left (Prisma 7 only)** | `9dfe103` | `scripts/__tests__/check-audit.test.mjs`; CI "Dependency advisories" | 2 caught |
| M10 | Apply leave: focus trapped in "From" | **Fixed** | `e482aa2` | `frontend/src/components/leave/__tests__/DateRangeFields.test.tsx`; `frontend/e2e/keyboard-leave-apply.mjs` | 1 caught |
| L1 | Developer offered "Late Arrivals" | **Fixed** | `4f06ec7` | `frontend/src/routes/__tests__/fixL1LateArrivals.test.ts` | 1 caught |
| L2 | No toggle for personal email in the directory | **Fixed** (directors' setting, default off) | `7c69f5f` | `employee/__tests__/developerPersonalData.test.ts`, `people/__tests__/fieldPolicy.test.ts` | 1 caught |
| L3 | Redis dumps committed | **Already fixed on this branch** (not in the tree; `*.rdb` ignored); other branches listed in §2 | earlier `22379d3`, `b3a6538` | `check-real-data` does not cover `.rdb`; `.gitignore` does | — |
| L4 | Real public mail domains in tests | **Fixed** | `62f3b99` | `backend/src/lib/__tests__/fixL4MailDomains.test.ts` | 1 caught |
| L5 | `peeps_*` migrations sort after dated ones | **Documented, not renamed** (renaming breaks existing databases) | `30598d3` | fresh-database and upgrade checks (§4) | n/a |
| L6 | Export file names use the UTC date | **Fixed** | `a8f2949` | `backend/src/lib/__tests__/fixL6FileDates.test.ts` | 1 caught |
| L7 | Developer and own pay pages, inconsistent | **Fixed** (403 on every "mine" pay page) | `65f032a` | `backend/src/modules/payroll/__tests__/fixL7DeveloperOwnPay.test.ts` | 2 caught |
| L8 | A single-punch day is never late | **Deferred** (§3) | — | — | — |
| L9 | September 2026 PF ceiling | **Deferred** (§3) | — | — | — |
| L10 | Employee contact details in plaintext | **Deferred** (§3) | — | — | — |
| L11 | Public letter-check parses PDFs | **Deferred** (§3) | — | — | — |
| T1 | Tests lock in "a director may change their own pay" | **Fixed** (tests now assert the two-director rule) | `b818d19` | `fixH4SingleDirector.test.ts`; changed tests listed | with H4 |
| T2 | No tests behind C1, C2, C3, H3 | **Fixed** | as C1, C2, C3, H3 | the four test files above | — |

Mutation totals: 70 mutations, 69 caught. The one not caught (`INT-onpanel`) removes a second, redundant check in recruitment: every read already goes
through `interviewWhere`, whose own mutation (`INT-list-scope`) is caught. It is defence in depth, not a gap.

### Extra work the fix block asked for

| Item | Result | Commit | Test |
|---|---|---|---|
| Statutory answers: Professional Tax, LWF, minimum wages each "Does not apply to us" / "Applies" / Not set, reference values beside the form | Done. Not set, or "Applies" with no values, is a **blocking** row on Ready for First Run and blocks every real monthly run; the demo company is exempt | `c567cdf` | `fixM5StatutoryAnswers.test.ts` |
| Seed interviews + interviewer-panel isolation test | Done. The demo company has a second candidate with a different panel | `3e4b49e` | `backend/src/modules/recruitment/__tests__/fixInterviewerIsolation.test.ts` |
| Email and notification templates: pay values reaching anyone not entitled | **None found.** Every path reviewed (payslip delivery, director notices, report subscriptions, mass email, payroll socket events). A new test drives a month to delivered payslips and finds no figure in any mail or notification; payroll notices reach only directors or the payee | `f870889` | `backend/src/modules/payroll/__tests__/fixPayNoticesNoFigures.test.ts` |
| `seed:demo-company` on a fresh database | **Did not work; fixed.** It failed from about the 12th of each month (the paid settlement went negative). This predates the fixes: the audited commit fails the same way today. Also fixed: the demo answers "Applies" for PT and LWF | `276805e` | CI demo tests; fresh-database run (§4) |
| Permission matrix and Developer-403 sweep over every route | Done. Found the Developer firewall refusing five of the person's **own** acts (now allowed); the 14 new routes classified | `ba191ce` | `peeps/__tests__/permissionMatrix.test.ts`, `managers/__tests__/routeInventory.test.ts`, `fixC3DeveloperSweep.test.ts` |

### Found by the final checks, and fixed

| Found by | What | Commit |
|---|---|---|
| Full backend suite (339 files) | Seven tests in files the phase checks did not run asserted the behaviour before C1, C2 and C3; updated, each with its reason (`CHANGED_TESTS.md`) | `abe6b50` |
| Full backend suite (`trustProxy.test.ts`) | **My H2 fix had opened a hole:** an address over its limit still let in any number with no failures of its own, so a password spray (one guess per number) was never limited. Removed (§5) | `abe6b50` |
| Browser walk | **System Settings, Security could not be saved at all:** the API refused any save carrying the sign-in limit (the form always sends it), and a refused save was half-applied. The page also still offered the old one-director two-step sign-in switch with "optional for directors" copy | `3466f8e` |
| Browser walk | Ready for First Run still said that with PT and LWF Not set nothing is deducted and the run goes on | `171a559` |
| Review of the fixes' screens | M1's Change password screen had never been built (only its API) | `6527b2e` |

**Stop condition checked:** no other way was found for HR, a manager, an interviewer or the Developer to see pay data.

## 2. C4 and L3: where the files still are (paths and commits only, no values)

History was **not** rewritten and no branch other than `peeps/foundation` was touched, as instructed. Removing these files from history rewrites every branch
that holds them and is the directors' decision.

**C4, the six exports** (added in commit `31168e93`): `docs/samples/Salary (38).xls`, `docs/samples/ORTHO (14).xls`, `docs/samples/Payroll-Repository.xls`,
`docs/samples/Attendance Swipes (2).xls`, `docs/samples/Bulk Salary Overrides (4).xlsx`, `docs/samples/1_attlog (1).dat`.

| Branch | At the tip | In history |
|---|---|---|
| `origin/main` | yes (all six) | yes |
| `origin/ui/design-pass` | yes (all six) | yes |
| `origin/peeps/foundation` | no (removed by `63dc34e9`; the five files there now are synthetic `*_template` / `*_sample` files) | yes |
| every other branch | no | no |

**L3, `dump.rdb` and `backend/dump.rdb`**: added or changed in `093de72`, `1ac7998`, `f4f052a`, `08336b1`, `f636922`, `74c1496`, `2bdaaf2`, `c5448d5`, `171aab5`,
`dd236f5`, `4180402`, `828a06b`, `f55ef49`, `2bf05cc`, `a49c4c2`, `d1c0b9a`, `0e3ad1b`, `26c2d87`, `3c9b521`; untracked on this line by `22379d3` and `b3a6538`.
Still at the tip of `origin/main`, `origin/master`, `origin/ui/design-pass`, `origin/claude/loving-ramanujan-80mbc1` and `origin/claude/optimistic-sagan-9xw3y9`.
In the history of those and of `docs/parity-audit`, `feat/employee-number-login`, `feat/hr-payroll-separation`, `feat/lateness-rule`, `feat/wellsure-theme`,
`integration/trial` and `peeps/foundation`.

**The guard** (`scripts/check-real-data.mjs`, run by CI and `scripts/peeps-check.sh`) refuses a new export-like file or a PAN, Aadhaar or bank-account-shaped
value outside the fake fixtures. The rule is in `docs/ops/README.md`, "Never commit real data", and in `CLAUDE.md`.

## 3. Deferred, with reasons and estimates

| ID | Why it is not done here | Estimate |
|---|---|---|
| H6 | Production infrastructure (CDK stacks for the database, Redis, ECS, KMS), the backup plan, the restore guide with a tested restore, and the key-backup procedure. It needs the AWS account structure, region and static IP, all still open questions (spec §14). It is a project of its own, not a fix | 6–8 days once the AWS questions are answered |
| L8 | How a closed day with one punch should count (late from the single punch? flagged for HR?) is a policy decision for the owners | half a day once decided |
| L9 | Which PF ceiling applies to a month that contains 17 September 2026 (split the month, or one ceiling for the whole month) is a decision. The code already says "review needed" | half a day once decided |
| L10 | Encrypting mobile, personal email, date of birth and addresses changes search, the directory, exports and imports, and needs a data migration. Not required by spec §9 | 2–3 days |
| L11 | The public letter-check could parse PDFs in the worker with size and time limits, or require sign-in. Already rate-limited | half a day to one day |

M9 leftovers (also in `scripts/check-audit.mjs` with reasons): the Prisma 6 CLI chain (`prisma`, `@prisma/config`, `deepmerge-ts`, `effect`; high) is fixed
only by Prisma 7, a major upgrade with new configuration and driver adapters, estimated 1–2 days. `uuid` under `exceljs` (moderate) is not reachable
(the advisory needs a caller-supplied buffer).

## 4. Checks

| Check | Result |
|---|---|
| Phase 1 check script (lint, typecheck, changed tests) | passed: 28 backend files, 319 tests |
| Phase 2 check script | passed: 35 backend files, 296 tests; 2 frontend files |
| Migrations, fresh database | passed (`migrate deploy`, then the development seed, then `seed:demo-company`) |
| Migrations, upgrade | passed: the audited commit's migrations and seed, then the seven `fix_` migrations on top; `db:drift`: no difference |
| Permission matrix, route inventory, Developer write sweep | passed after `ba191ce` (13 tests) |
| First full backend suite (on `c5e2c99`) | 2,808 passed, 8 failed in 7 files: all fixed in `abe6b50` (table above) |
| Full backend suite, alone, on the final code (`171a559`; later commits are documents only) | **passed: 336 files, 2,817 tests**, 41 minutes. Also passed locally: lint, typecheck (all four projects), frontend 34 files / 182 tests, biometric agent 17 files / 171 tests, build and bundle budgets (login 233.1 KB, shell + admin home 375.7 KB), demo company tests 7/7, both repository guards |
| H1 log scan | the walk's API, worker and frontend logs: 0 tokens, cookies, authorization headers or passwords, 0 PAN, Aadhaar or account-shaped values, 0 pay fields with values (scanner checked against a planted sample first); the final full-suite log (2,817 tests): the same, 0 of each |
| Browser walk (6 roles × 1280 light and 390 dark, keyboard only; `frontend/e2e/audit-fix-walk.mjs`) | passed on the final code: 156 stops (13 screens), every role sees exactly its screens and the forbidden state elsewhere; no console error; Tab always lands on an element with a visible focus ring; no rupee figure for any role except the directors (the reference values on Default behaviours). It found the two defects above (`3466f8e`, `171a559`). A keyboard-only save of System Settings, Security passed as a director at both widths |
| `npm run check:keyboard-leave` (M10) | passed at 1280 light and 390 dark |
| CI on the final code commit | runs once, on the push of this report's commit (code identical to `171a559`); not re-committed here, so that CI runs only once. The result is in the hand-over message |

## 5. Decisions I made (not in the prompt; each is the safer choice)

- **Not set means two directors.** A director step with no confirmed choice is decided by two directors (the default). "One director alone" needs both directors to choose it, is never allowed on one's own pay, and shows as a red row on Ready for First Run and the Audit Log.
- **A director's own pay:** a director may *propose* (revision, monthly inputs, override); every one-person act on their own pay is refused; the other director decides.
- **Directors:** a third director needs every other director; removing a director's status is a proposal the other confirms; a director is never separated directly (status removed first). With only one director left, only the break-glass command line can act.
- **Leave changes (C3):** the confirmer is a director other than the proposer and not one of the people affected. The accrual recalculator and the year-end are unchanged (they are not grants).
- **The Developer** keeps view, diagnostics and the support queue (`helpdesk.manage`), never opens other people's sensitive helpdesk files, and keeps their own self-service (leave, profile, own requests, kudos and badges).
- **M6 with exactly two directors:** the person affected is the only "other" director, so resetting or unlocking a director then needs break-glass.
- **Development seed only:** records the directors turning compulsory two-step sign-in off, and "Does not apply to us" for the three statutory answers. Real databases start with two-step sign-in compulsory and the statutory answers Not set (blocking).
- **L4:** outside production a personal email may use the reserved test domains; in production only `gmail.com` is accepted, as before.
- **H2, corrected after the full run:** an office address over its limit makes everyone at it wait, correct passwords included, because exempting numbers with no failures of their own let a password spray run unlimited. The office is protected instead by the higher limit (100 in 15 minutes, the directors' setting), by a director or HR Admin seeing and clearing a blocked address, and by unlocking an account clearing its addresses.
- **npm 10** hit an internal resolver error on these dependency trees, so the lockfiles were written with npm 11 (lockfile version unchanged; checked with npm 10 `npm ci`).

## 6. Commits

On `peeps/foundation`, oldest first (this report's own final commit and the CI note follow):

- `7cdad24` Audit fix H1: no refresh token, cookie, authorization header or password in the logs
- `c59faeb` Audit fix H3: the leave ledger is append-only in the database
- `cbc1875` Audit fixes C2, C3, H5, M7: director roles and leave changes need a second director; Developer is view-only
- `d7c7196` Audit fixes C1 and M1: no account takeover through the sign-in email; a reset ends every session
- `929eb3c` Audit fix H2: one office address never locks out the whole office
- `b818d19` Audit fixes H4 and T1: two directors by default; never the only approver of your own pay
- `b4233a6` Audit fixes C1, C2, C3, H2, H4: the screens
- `789941c` Audit fix C1: drop the unused import the phase check flagged
- `e482aa2` Audit fix M10: Apply leave dates no longer trap keyboard focus
- `4f06ec7` Audit fix L1: the Developer is not offered Late Arrivals
- `30598d3` Audit fix L5: migration order note (no renames)
- `33146b0` Audit fix M2: suspend, deactivate, separate or a role change disconnects live sockets
- `d925427` Audit fix M3: a Redis or database outage fails fast; sign-in fails closed
- `57f49dd` Audit fix M4: the DEMO employee-number prefix is reserved outside development
- `f3e7fb5` Audit fix M6: resetting or unlocking a director needs a second director and alerts outside
- `30f7c48` Audit fix M6: the confirmations page names the two new director security actions
- `72ef064` Audit fix M8: lateness waivers need a director's confirmation (default on)
- `7c69f5f` Audit fix L2: personal email in the colleague directory is a directors' setting (default off)
- `21ad644` Audit fix M1 follow-up: a photo URL carrying an access token is refused with 401, not 400
- `a8f2949` Audit fix L6: export file names carry the IST business date
- `65f032a` Audit fix L7: the Developer is refused (403) on every 'mine' payroll page
- `62f3b99` Audit fix L4: only reserved mail domains in tests and development data
- `c567cdf` FIX-M5: professional tax, LWF and minimum wages need the directors' explicit answer
- `3e4b49e` Audit follow-up: interviewer-panel isolation with real interviews
- `f870889` Audit follow-up: no pay figure in any email or notification of a payroll month
- `9dfe103` FIX-M9: upgrade vulnerable dependencies; CI fails on a new high or critical advisory
- `276805e` Demo company: works on a fresh database again, on any day of the month
- `6929582` FIX-M5: drop an import the removed PT/LWF row used (lint)
- `7f80175` FIX-C4: a guard against committing real data, in the check script and CI
- `ba191ce` Audit follow-up: permission matrix and route inventory over the fixes' routes
- `6527b2e` FIX-M1: Change password in Account & security
- `c5e2c99` Audit fix report (draft) and the browser walk script
- `abe6b50` FIX-H2 correction and the tests the final full run found
- `3466f8e` FIX-C1/H2 follow-up: System Settings, Security saves again
- `171a559` FIX-M5 follow-up: Ready for First Run and the setup guide say what Not set now means
- `5582444` Audit fix report: what the full run and the browser walk found; changed tests
