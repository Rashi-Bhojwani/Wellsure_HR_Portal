# Final merge report (2026-11-19)

Session A, on `feat/hr-payroll-separation`. This is the real merge; the rehearsal is `integration/trial` (`docs/plans/TRIAL_MERGE_REPORT.md` there), which was not
merged anywhere. Peeps merges after this branch.

## 1. Precondition

`origin/feat/employee-number-login` at `b058673` contains `2b47c1e` ("one over-limit reply for every number; no 423, no number-specific rate-limit reply on
sign-in"): a locked real account, an unknown number past the same count, and an IP over its limit all get **429 "Too many attempts. Try again later or ask HR
to unlock your account."**, padded like every failure. (The first attempt of this block stopped here: at `de435ac` a locked account still got 423 "Account is
locked".) The remaining number-specific 429 in `auth/service.ts` belongs to Forgot password, not sign-in.

## 2. Merge order and result

Normal `--no-ff` merge commits, no rebase, no squash. Starting point `7065c24`, working tree clean, up to date with origin.

| # | Branch | Head merged | Merge commit | Conflicts |
|---|---|---|---|---|
| 1 | `origin/feat/employee-number-login` | `b058673` | `09adb32` | none |
| 2 | `origin/feat/lateness-rule` | `940c58e` | `e6cc128` | 1: `backend/prisma/schema.prisma` |
| 3 | `origin/feat/wellsure-theme` | `f164eb7` | `6b0baf0` | none |
| 4 | `origin/docs/ops-and-decisions` | — | — | **skipped: the branch does not exist on origin** |

Files both sides edited that merged without conflict:
- merge 1: `schema.prisma`, `seed.ts`, `employee/service.ts`, `managers/__tests__/routeInventory.ts`, `settings/{service,types,validators}.ts`,
  `frontend/src/api/{employee,settings}.ts`, `EmployeeProfilePage.tsx`, `SystemSettingsPage.tsx`;
- merge 2: `routeInventory.ts`;
- merge 3: none.

Checked by meaning, not only by text, for the profile: the login branch's four new fields (`deviceUserId`, `loginIdMatchesMachine`,
`noEmailOnRecord`, `emailMissingRequestedAt`) sit beside this session's Developer masking in `getEmployeeProfile`; none is in `PERSONAL_CONTACT_FIELDS`
(owner decision, pinned by `developerPersonalData.test.ts`).

A local slip, corrected before anything was pushed: the first resolution of C1 was redone with `git checkout -m`, whose "ours/theirs" markers my script did not
remove, and that merge commit carried two marker lines. Nothing had been pushed, so the branch was reset to `09adb32` and merges 2 and 3 were redone cleanly
(the commits above are the clean ones).

## 3. Every conflict and its resolution

### C1: `backend/prisma/schema.prisma`, end of file (merge 2)
- **HEAD (Session A + login):** login appended `LoginEmailMissingNotice` (`login_email_missing_notices`) between `// LOGIN-BEGIN` and `// LOGIN-END`.
- **lateness:** appended `LateWaiver` (`late_waivers`) at the same place between `// LATE-BEGIN` and `// LATE-END`.
- **Resolution:** kept both models, login first, then lateness. Neither refers to the other. Their `Employee` back-relations
  (`loginEmailMissingNotice`, `lateWaivers`) had merged cleanly side by side. `prisma validate` passes. The same as the rehearsal.

No conflict touched the access resolver, the HR switch framework or CI files.

### Migrations
All kept. Order on a fresh database:
- `20261116150000_a_statutory_pack_reviews`
- `20261117090000_login_employee_number`
- `20261118090000_a_leave_policy_year_end`
- `20261118100000_a_employee_personal_view`
- `20261118120000_late_waivers`
- `20261119090000_a_developer_no_leave_policy` (new, item 3c)

No timestamps collide and no migration depends on a later one. Checked: the check script applies every migration to a fresh database and compares the result
with the schema (no difference). CI's migrate + drift + seed steps also run them. The scratch dev database took the three it lacked with the guarded
`npm run prisma:migrate:deploy`.

## 4. Post-merge fixes (`258f6c9`)

**a) Developer masking after the merge.**
- `developerPersonalData.test.ts` still passes. It pins the four login fields as visible and keeps every personal contact field hidden.
- `lateness.test.ts` "the Developer is refused on every route (403)" still passes (`latenessRouter.use(authenticate, refuseDeveloper)`).
- No code change was needed.

**b) Sign-in lifetimes (audit #13).**
- Two new Default behaviours, proposed by one director and confirmed by a different one, both audited:
  - `auth.passwordResetLinkMinutes`: 5 to 1,440; default 60;
  - `auth.staySignedInDays`: 1 to 90; default 30.
- Until confirmed, both are listed as "Default in use: 60 minutes (1 hour)" / "Default in use: 30 days", grouped under "Sign-in lifetimes".
- The refresh token's lifetime reads the setting. The cookie is now given the token row's own `expiresAt` on login, TOTP completion and refresh. Before, it
  was a hard-coded `Date.now() + 30 days` beside an env-driven token lifetime, so the two can no longer disagree.
- Removed: the single-director System Settings field `passwordResetTtlMinutes`, replaced by a pointer to Default behaviours. Also removed: the
  `JWT_REFRESH_TTL` env variable (`env.ts`, `.env.example`, `GETTING_STARTED.md`).
- A value already stored under the old key `auth.passwordResetTtlMinutes` is no longer read.
- Tests: `signInLifetimes.test.ts`, 5 tests:
  - the defaults and their labels;
  - who may propose and confirm, including the 403s for HR, an employee and the Developer;
  - out-of-range values refused;
  - a confirmed 7 days for a new and for a refreshed session, with the cookie equal to the token row;
  - a confirmed 15-minute link;
  - the old field gone.

**c) The Developer no longer manages leave policies (owner-optional item, done).**
- `leave.policy.manage` is out of `DEVELOPER_ROLE_PERMISSIONS`. It is added to `DEVELOPER_FORBIDDEN_KEYS` via `DEVELOPER_ALSO_FORBIDDEN`: it is not a
  sensitive data class, so it is listed by name.
- Effect: the access resolver removes it from a Developer whatever is stored, and the access service refuses to grant it (`DEVELOPER_CEILING`).
- Migration `20261119090000_a_developer_no_leave_policy` takes it off the stored DEVELOPER role, and off any personal grant to a Developer. Each removal is
  copied first into `role_permission_removals`.
- Test `developerLeavePolicy.test.ts`:
  - role defaults and the stored role;
  - the resolver;
  - a refused grant, and a grant stored behind the service's back that is ignored;
  - all 12 leave policy routes answer 403 to the Developer; HR reaches them.
- `docs/SENSITIVE_DATA.md` regenerated: unchanged.

**d) Lateness recompute through the job queue.** `latenessQueue.test.ts` (December 2026):
- uses the real wiring (`registerAttendanceEngine`: a request becomes a debounced BullMQ `attendance-recompute` job);
- runs a real BullMQ `Worker` with the worker's own processor (`processRecomputeJob`, as `jobs/worker.ts` does);
- a late 1 December punch, asked for alone, makes the hook queue the rest of the month. The worker turns 4 December's band-2 arrival (now the 4th) into a
  0.5 cut, with at least two jobs processed and nothing calling compute directly;
- a waiver of 1 December, approved through the API, puts it back to 0 at once, and draining the queue does not undo it;
- a later 7 December arrival through the queue is counted with the waiver respected (a cut).

**Recorded:** a waiver approval recomputes the rest of the month inline, not through the queue. The queue path is the follow-up when an earlier day's arrival
changes. Both are now proven.

### Mutation checks: 6 of 6 caught

| # | Mutant | Caught by |
|---|---|---|
| B1 | cookie back to a fixed 30 days | `signInLifetimes` |
| B2 | session lifetime ignores the setting | `signInLifetimes` |
| B3 | reset link fixed at 60 minutes | `signInLifetimes` |
| C1 | `leave.policy.manage` not in the forbidden keys | `developerLeavePolicy` (3 failed) |
| C2 | the policy routes opened to `leave.view` | `developerLeavePolicy` |
| D1 | the hook's queued follow-up removed | `latenessQueue` |

## 5. Checks

| Check | Result |
|---|---|
| Check script (once): backend + frontend typecheck, lint, design tokens, fresh-database migrations = schema, 25 backend files (the merged branches' tests, the new ones, hrCapabilities, sensitiveDocs, cleanup, managers, payrollGuards, payroll setup, settings), frontend tests | ✅ 25 files / 287 tests; frontend 19 files / 144 tests |
| Frontend build + bundle budgets | ✅ login 233.0 KB (budget 250), shell + employee home 348.7 KB, shell + admin home 368.5 KB (budget 400) |
| Full backend suite, alone, once | ✅ **276 files / 2,417 tests passed** (25.8 min) |
| CI on the final commit | see §7 |

Fixes for failures caused by the merge or the post-merge fixes:
- **None needed in code.** Every check passed at its first run after the fixes.
- Edited during writing (before any check ran):
  - the login branch's test of the old `auth.passwordResetTtlMinutes` key, rewritten for the new setting (`CHANGED_TESTS.md`);
  - my own new test, whose last case first assumed the System Settings validator refuses an unknown field (it strips it).

## 6. Browser walk (keyboard only)

**Setup:**
- `npm run dev` on the scratch dev database, made-up seed people: employee `1006`, manager `1002`, HR `1001`, director `1000`, Developer `DEMO005` (the demo
  company's Developer).
- Desktop 1280 light and phone 390 dark. Sign-in by keyboard: type the number, Tab, type the password, Enter.
- On each page: 20 Tab stops, checking each stop for a focus ring and that it is on screen; no sideways scroll; no crash; no 5xx; no pay figure.
- A lateness rule was confirmed by two directors through the API, and three band-3 late arrivals were created for `1006` on 16 to 18 November (0.5 each), in
  the scratch database only.

**Public screens (both modes):**
- **Login:** the first-time hint is shown. An unknown number and a wrong password give the identical reply ("The employee number or password is not
  correct."). No sideways scroll.
- **Forgot password:** submitted by Enter, the neutral reply ("If that account exists, a link has been sent to the email on record."). The link was read from
  the `.mail/` file, and the reset page shows its form.
- **Reset / set password:** reached through that link. It is the reset page, because 1006 already has a password; the invitation set-password page itself was
  not opened.
- **Focus rings:** the only ring-less stops my script reported were the password inputs. Their ring is drawn on the Ant Design wrapper (a 3 px shadow,
  checked separately): a false positive.

**Signed-in screens: 100 page loads (5 roles × 2 modes × 10 screens).** 0 crashes, 0 server errors, 0 sideways scroll.

| Screen | Content for | Forbidden state for |
|---|---|---|
| HR employee screen (Login ID panel) | manager (team), HR, director, Developer | employee |
| Late Arrivals | employee, manager, HR, director | Developer |
| Lateness Waivers | HR, director | employee, manager, Developer |
| Lateness Rule | director | everyone else |
| Apply leave, Balances | everyone | — |
| Leave Types and Policies | HR, director | employee, manager, **Developer (new, item 3c)** |
| Year End | director | everyone else |
| Ready for First Run | director | everyone else |
| Default behaviours, Sign-in lifetimes | director | everyone else |

- The Developer sees no personal email on the HR employee screen.
- Pay figures: none on any page for HR, a manager or the Developer. The director's only matches were the setting title "CTC includes the employer's PF and ESI
  (PY-43)", a name, not a figure.
- Sign-in lifetimes reads "DEFAULT IN USE: 60 MINUTES (1 HOUR)" (the chip's CSS shows the label in capitals).

**Waiver drawer (both modes, manager 1002):**
- "My team" chosen with the arrow keys; two Tabs reach "Ask HR to waive Arjun Singh's late arrival on 2026-11-16", with a ring;
- Enter opens the drawer and the reason box takes focus;
- **Esc closes it and focus returns to the same button**;
- no waiver was created (`late_waivers` count 0).

**Found and left alone, because it predates the merge** (`LeaveApplyPage.tsx` last changed in `2bdaaf2`; antd version unchanged):
- On Apply leave, Tab from the "From" box of the dates range picker stays on "From", at 1280 and at 390, and Esc does not release it either.
- A person using the keyboard alone cannot get past the dates field to the rest of the form.
- Recommended next fix: small. Use two DatePickers, or check the RangePicker's own keyboard handling in the antd version in use.
- Listed in §8.

## 7. CI

CI run 445 (`44491794853`) on `25e3b91`, the final code-and-report commit, read once with every job to the end: **all 12 jobs green**.
- install-lint-typecheck-test: lint, typecheck, tokens + bundle budgets, migrate, schema = migrations, seed, frontend + agent tests, demo company tests;
- backend-tests (1) to (4), and backend-tests-complete (the shards add up to the suite, each test exactly once);
- docker-build, agent-windows, latency (popovers + punch latency), attendance-replay;
- sensitive-ui (admin portal), sensitive-ui (employee portal).

CI ran on the pushes in between too, but those runs were not read (speed rule). This note is a docs-only commit after run 445; its own run was not read.

## 8. Decisions and what is not verified

**Decisions:**
- **Merges:** the order as asked; the skipped branch does not exist; C1 resolved as in the rehearsal.
- **Item 3c done:** the owner had not disagreed.
- **Sign-in lifetimes:**
  - the conventional values are in force until two directors change them ("Default in use"), as asked;
  - links and sessions already issued keep their lifetime;
  - each use of a session renews it for the set number of days (sliding, as before).
- **`JWT_REFRESH_TTL` removed** rather than kept as a second source of truth. A deployment that still sets it is unaffected: unknown env keys are ignored.

**Not verified:**
- the invitation set-password page by keyboard (only the reset page reached from a Forgot-password mail);
- real BullMQ timing under load (the queue test drains one employee's jobs);
- CI is read only on the final commit.

**Open (not caused by the merge):** the Apply leave range-picker keyboard trap (§6). `TZ_BUSINESS` is still ignored (C-6 of the audit, reported earlier).
